// Same-origin synthetic fixtures. Run Vite with VITE_AUTH_MOCK=true and
// VITE_EXAMINATION_MOCK=true. No live clinical endpoint is contacted.
export async function runExaminationMock(page, origin) {
  const checks = []
  let role = 'DOCTOR'
  let fault = 0
  let versionConflict = false
  let createCalls = 0
  let readCalls = 0
  let queueCalls = 0
  let runtimeErrors = 0
  let current
  const onError = () => runtimeErrors++
  page.on('pageerror', onError)
  const pattern = origin + '/api/v1/**'
  const statuses = []
  const fields = {
    symptoms: '',
    diagnosis: '',
    notes: '',
    conclusion: '',
  }
  const assert = (condition, message) => {
    if (!condition) throw new Error(message)
  }
  const heading = (name) => page.getByRole('heading', { name, exact: true })
  const button = (name) => page.getByRole('button', { name, exact: true })
  const wait = (locator) => locator.waitFor({ state: 'visible', timeout: 9000 })
  const check = async (name, action) => {
    await action()
    checks.push(name)
  }
  const appointment = (id, date) => ({
    id: String(id),
    patientId: String(id + 20),
    doctorId: '9',
    scheduleId: '8',
    patientFullName: 'Synthetic patient ' + id,
    appointmentCode: 'MOCK-' + id,
    startAt: date + 'T02:00:00Z',
    endAt: date + 'T02:30:00Z',
    status:
      id === 1 && current
        ? current.status === 'COMPLETED'
          ? 'COMPLETED'
          : 'IN_PROGRESS'
        : 'CHECKED_IN',

    version: 0,
  })
  await page.route(pattern, async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    const path = url.pathname.replace('/api/v1', '')
    const json = (status, body) => {
      statuses.push({ method, path, status })
      return route.fulfill({ status, json: body })
    }
    const ok = (data, status = 200) => json(status, { data })
    const problem = (status, code) => json(status, { status, code })
    if (path === '/auth/login')
      return ok({ accessToken: 'synthetic-browser-fixture' })
    if (path === '/auth/me')
      return ok({
        id: '50',
        fullName: 'Synthetic account',
        email: 'synthetic@example.test',
        role,
      })
    if (role !== 'DOCTOR') return problem(403, 'ACCESS_DENIED')
    const date = url.searchParams.get('date') ?? '2026-11-25'
    if (path === '/appointments') {
      queueCalls++
      const items =
        date === '2020-01-01'
          ? []
          : Array.from({ length: 10 }, (_, i) =>
              appointment(i + 1, date),
            ).filter((item) => item.status === url.searchParams.get('status'))
      return ok({
        items,
        page: 0,
        size: 100,
        totalElements: items.length,
        totalPages: items.length ? 1 : 0,
      })
    }
    if (/^\/appointments\/\d+$/.test(path))
      return ok(appointment(Number(path.split('/').pop()), date))
    if (/^\/medical-records\/by-appointment\/\d+$/.test(path)) {
      readCalls++
      if (fault)
        return problem(
          fault,
          fault === 403 ? 'ACCESS_DENIED' : 'RESOURCE_NOT_FOUND',
        )
      return current && path.endsWith('/1')
        ? ok(current)
        : problem(404, 'RESOURCE_NOT_FOUND')
    }
    if (path === '/medical-records' && method === 'POST') {
      createCalls++
      if (current) return problem(409, 'DUPLICATE_RECORD')
      const body = route.request().postDataJSON()
      if (
        body.appointmentId !== '1' ||
        Object.keys(body).join(',') !== 'appointmentId'
      )
        return problem(400, 'VALIDATION_FAILED')
      await new Promise((resolve) => setTimeout(resolve, 150))
      current = {
        id: '45',
        appointmentId: '1',
        status: 'IN_PROGRESS',
        version: 0,
        ...fields,
      }
      return ok(current, 201)
    }
    if (path === '/medical-records/45' && method === 'GET') {
      readCalls++
      if (fault)
        return problem(
          fault,
          fault === 401
            ? 'INVALID_ACCESS_TOKEN'
            : fault === 403
              ? 'ACCESS_DENIED'
              : 'RESOURCE_NOT_FOUND',
        )
      return ok(current)
    }
    if (
      path === '/medical-records/45' ||
      path === '/medical-records/45/completion'
    ) {
      const body = route.request().postDataJSON()
      if (current.status === 'COMPLETED')
        return problem(409, 'INVALID_STATE_TRANSITION')
      if (versionConflict) {
        versionConflict = false
        current.version++
      }
      if (body.expectedVersion !== current.version)
        return problem(409, 'VERSION_CONFLICT')
      if (method === 'PATCH') {
        for (const key of Object.keys(fields)) current[key] = body[key]
      } else current.status = 'COMPLETED'
      current.version++
      return ok(current)
    }
    return problem(404, 'RESOURCE_NOT_FOUND')
  })

  const open = async () => {
    await button('Mở chi tiết MOCK-1').click()
    await wait(heading('Chi tiết khám bệnh'))
  }
  const close = async () => {
    await page.keyboard.press('Escape')
    await heading('Chi tiết khám bệnh').waitFor({ state: 'hidden' })
  }
  const login = async (nextRole) => {
    role = nextRole
    await page.goto(origin + '/login')
    await page
      .getByLabel('Email', { exact: true })
      .fill('synthetic@example.test')
    await page
      .getByLabel('Mật khẩu', { exact: true })
      .fill('synthetic-fixture-only')
    await button('Đăng nhập').click()
    await page.waitForURL(
      nextRole === 'PATIENT' ? '**/booking' : '**/dashboard',
    )
    await page.evaluate(() => {
      history.pushState(null, '', '/medical-records')
      dispatchEvent(new PopStateEvent('popstate'))
    })
  }
  try {
    await page.goto(origin + '/login')
    await page.evaluate(() => sessionStorage.clear())
    await check(
      'RoleGuard blocks PATIENT, ADMIN and RECEPTIONIST without clinical requests',
      async () => {
        const before = statuses.length
        for (const other of ['PATIENT', 'ADMIN', 'RECEPTIONIST']) {
          await login(other)
          await page.waitForURL('**/forbidden')
          await wait(heading('Bạn không có quyền truy cập màn hình này'))
        }
        assert(
          !statuses
            .slice(before)
            .some((entry) => entry.path.startsWith('/medical-records')),
          'clinical request under wrong role',
        )
      },
    )
    await check(
      'Doctor queue: date, status, search, and pagination',
      async () => {
        await login('DOCTOR')
        await wait(heading('Không gian khám bệnh'))
        await button('Trang sau').click()
        await wait(button('Mở chi tiết MOCK-10'))
        await page.getByLabel('Tìm bệnh nhân hoặc mã hẹn').fill('MOCK-1')
        await wait(button('Mở chi tiết MOCK-1'))
        await page.getByLabel('Trạng thái').selectOption('IN_PROGRESS')
        await wait(page.getByText('Không có lịch khám phù hợp.'))
        await page.getByLabel('Trạng thái').selectOption('ALL')
        await page.getByLabel('Ngày khám (Việt Nam)').fill('2020-01-01')
        await wait(page.getByText('Không có lịch khám phù hợp.'))
        await page.getByLabel('Ngày khám (Việt Nam)').fill('2026-11-25')
        await wait(button('Mở chi tiết MOCK-1'))
      },
    )
    await check(
      'Start once, reopen by linked ID, reject duplicate at mock boundary',
      async () => {
        await open()
        await button('Bắt đầu khám').evaluate((element) => {
          element.click()
          element.click()
        })
        await wait(page.getByLabel('Triệu chứng'))
        assert(createCalls === 1, 'double create')
        await close()
        await open()
        await wait(page.getByLabel('Triệu chứng'))
        const status = await page.evaluate(
          async () =>
            (
              await fetch('/api/v1/medical-records', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  appointmentId: '1',
                  expectedVersion: 0,
                }),
              })
            ).status,
        )
        assert(status === 409 && readCalls >= 2, 'duplicate or read contract')
      },
    )
    await check(
      '409 blocks repeat save, reconciles before a successful retry',
      async () => {
        versionConflict = true
        await page.getByLabel('Triệu chứng').fill('Synthetic symptom')
        await button('Lưu nháp').click()
        await wait(page.getByText(/Hồ sơ đã thay đổi/))
        assert(
          await button('Lưu nháp').isDisabled(),
          'stale save still enabled',
        )
        await button('Tải lại hồ sơ').click()
        await page.getByLabel('Triệu chứng').fill('Synthetic symptom')
        await page.getByLabel('Chẩn đoán mô phỏng').fill('Synthetic diagnosis')
        await page.getByLabel('Ghi chú').fill('Synthetic notes')
        await page.getByLabel('Kết luận').fill('Synthetic conclusion')
        await button('Lưu nháp').click()
        await wait(
          page.getByRole('dialog').getByText('Đã lưu nháp.', { exact: true }),
        )
      },
    )
    await check('403 and 404 safe error states with retry', async () => {
      for (const [status, message] of [
        [403, /không có quyền thao tác/],
        [404, /Lịch đang khám nhưng không tìm thấy hồ sơ/],
      ]) {
        fault = status
        await close()
        await open()
        await wait(page.getByText(message))
        assert(
          (await button('Bắt đầu khám').count()) === 0,
          'rejected lookup must not create',
        )
        assert(
          (await page.getByLabel('Triệu chứng').count()) === 0,
          'clinical fields shown on rejected read',
        )
        fault = 0
        await button('Tải lại hồ sơ').click()
        await wait(page.getByLabel('Triệu chứng'))
      }
    })
    await check(
      'Mobile 320px, desktop, Light/Dark, keyboard dialog and final read-only',
      async () => {
        await close()
        for (const width of [320, 1280]) {
          await page.setViewportSize({ width, height: 850 })
          await button('Chuyển giao diện sáng hoặc tối').click()
          assert(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            'queue overflow',
          )
          await open()
          await button('Hoàn tất khám').focus()
          await page.keyboard.press('Enter')
          await wait(heading('Xác nhận hoàn tất khám'))
          for (let i = 0; i < 5; i++) {
            await page.keyboard.press('Tab')
            assert(
              await page
                .getByRole('dialog', { name: 'Xác nhận hoàn tất khám' })
                .evaluate((element) =>
                  element.contains(document.activeElement),
                ),
              'focus escaped',
            )
          }
          await page.keyboard.press('Escape')
          await heading('Xác nhận hoàn tất khám').waitFor({ state: 'hidden' })
          await close()
        }
        const before = queueCalls
        await open()
        await button('Hoàn tất khám').click()
        await button('Xác nhận hoàn tất').click()
        await wait(page.getByText('Đã hoàn tất · Chỉ đọc').first())
        assert(
          (await page.getByLabel('Triệu chứng').getAttribute('readonly')) !==
            null,
          'final editable',
        )
        assert((await button('Lưu nháp').count()) === 0, 'save still visible')
        await close()
        await button('Mở chi tiết MOCK-1').waitFor({ state: 'hidden' })
        assert(queueCalls > before, 'queue not refreshed after completion')
      },
    )
    await check('401 clears the client session', async () => {
      // Simulate the server rejecting a subsequent appointment queue request.
      await page.route(origin + '/api/v1/appointments?**', (route) =>
        route.fulfill({
          status: 401,
          json: { status: 401, code: 'INVALID_ACCESS_TOKEN' },
        }),
      )
      await button('Làm mới').click()
      await page.waitForURL('**/login')
      await wait(heading('Chào mừng trở lại'))
    })
    assert(runtimeErrors === 0, 'uncaught browser errors')
    return { source: 'MOCK', checks, runtimeErrors, statuses }
  } finally {
    await page.unroute(origin + '/api/v1/appointments?**')
    await page.unroute(pattern)
    page.removeListener('pageerror', onError)
  }
}
