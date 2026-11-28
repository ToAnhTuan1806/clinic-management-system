// Run through Playwright MCP against the owned host QA copy, with every mock flag OFF.
// qa is the private in-memory vault handoff. Never return credentials, tokens or bodies.
export async function runPrescriptionReal(
  browser,
  page,
  origin,
  qa,
  fixture = {},
) {
  if (!qa?.scopeVerified || !qa.sourceProtected)
    throw Error('QA_SCOPE_REQUIRED')
  await page.setViewportSize({ width: 1280, height: 850 })
  const checks = [],
    http = [],
    runtime = [],
    consoleErrors = [],
    tokens = new Map()
  const assert = (value, label) => {
    if (!value) throw Error(label)
  }
  const b = (name, p = page) => p.getByRole('button', { name, exact: true })
  const nav = (p, path) =>
    p.evaluate((path) => {
      history.pushState(null, '', path)
      dispatchEvent(new PopStateEvent('popstate'))
    }, path)
  const observe = (r) => {
    const u = new URL(r.url())
    if (u.origin === qa.apiURL && u.pathname.startsWith('/api/v1/'))
      http.push({
        channel: 'browser',
        method: r.request().method(),
        path: u.pathname,
        status: r.status(),
      })
  }
  const onError = () => runtime.push('uncaught runtime')
  const onConsole = (m) => {
    const text = m.text()
    if (
      Object.values(qa.accounts).some(
        (a) => text.includes(a.password) || text.includes(a.email),
      ) ||
      /\beyJ[\w-]+\.[\w-]+\.[\w-]+\b|\$2[aby]\$\d\d\$/.test(text)
    )
      consoleErrors.push('sensitive output')
    if (
      m.type() === 'error' &&
      !/^Failed to load resource: (the server responded with a status of (400|401|403|404|409)\b|net::ERR_)/.test(
        text,
      )
    )
      consoleErrors.push('unexpected console')
  }
  const attach = (p) => {
    p.on('response', observe)
    p.on('pageerror', onError)
    p.on('console', onConsole)
  }
  attach(page)
  const token = async (actor) => {
    if (!tokens.has(actor)) {
      const a = qa.accounts[actor]
      const r = await page.request.post(qa.apiURL + '/api/v1/auth/login', {
        data: { email: a.email, password: a.password },
      })
      http.push({
        channel: 'request',
        method: 'POST',
        path: '/api/v1/auth/login',
        status: r.status(),
      })
      assert(r.status() === 200, 'fixture login')
      tokens.set(actor, (await r.json()).data.accessToken)
    }
    return tokens.get(actor)
  }
  const req = async (actor, path, method = 'GET', data) => {
    const r = await page.request.fetch(qa.apiURL + path, {
      method,
      ...(data ? { data } : {}),
      headers: actor ? { Authorization: 'Bearer ' + (await token(actor)) } : {},
    })
    http.push({
      channel: 'request',
      method,
      path: path.split('?')[0],
      status: r.status(),
    })
    return { status: r.status(), body: await r.json() }
  }
  const ok = async (actor, path, method = 'GET', data, status = 200) => {
    const r = await req(actor, path, method, data)
    assert(r.status === status, 'HTTP_' + r.status + ' ' + path)
    return r.body.data
  }
  const login = async (p, actor, path = '/medical-records') => {
    await p.goto(origin + '/login')
    await p.getByLabel('Email', { exact: true }).fill(qa.accounts[actor].email)
    await p
      .getByLabel('Mật khẩu', { exact: true })
      .fill(qa.accounts[actor].password)
    await b('Đăng nhập', p).click()
    await p.waitForURL((url) =>
      actor === 'PATIENT'
        ? ['/booking', '/medical-history'].includes(url.pathname)
        : ['/dashboard', '/medical-records', '/medical-history'].includes(
            url.pathname,
          ),
    )
    await nav(p, path)
  }
  const check = async (id, action) => {
    if (Number(id.slice(2)) < (fixture.resumeAt || 1)) return
    try {
      await action()
      checks.push({ id, result: 'PASS' })
    } catch (error) {
      throw Error(
        id +
          ' / ' +
          error.name +
          ' / ' +
          (error.message?.split('\n')[0] || 'assertion or locator'),
      )
    }
  }
  const poll = async (fn, label) => {
    for (let i = 0; i < 100; i++) {
      if (await fn()) return
      await page.waitForTimeout(50)
    }
    throw Error('assert:' + label)
  }
  let patient,
    appointment,
    record,
    otherContext,
    otherPage,
    longName,
    latestVersion
  const path = () => '/api/v1/medical-records/' + record.id
  const open = async (p = page) => {
    await b('Mở chi tiết ' + appointment.appointmentCode, p).click()
    await b('Đơn thuốc mô phỏng', p).waitFor()
  }
  const presc = async (p = page) => {
    await b('Đơn thuốc mô phỏng', p).click()
    await p.locator('#med-name-0').waitFor()
  }
  const clinical = async (p = page) => {
    await b('Hồ sơ lâm sàng', p).click()
    await p.getByLabel('Triệu chứng', { exact: true }).waitFor()
  }
  const fillRow = async (i, name) => {
    for (const [field, value] of Object.entries({
      name,
      qty: '10',
      dosage: '1 tablet',
      freq: 'daily',
      days: '5',
      inst: 'Synthetic only',
    }))
      await page.locator('#med-' + field + '-' + i).fill(value)
  }
  const save = async () => {
    const before = await ok('DOCTOR_LINKED', path())
    const response = page.waitForResponse(
      (r) =>
        r.url() === qa.apiURL + path() + '/prescription' &&
        r.request().method() === 'PUT',
    )
    await b('Lưu đơn thuốc').click()
    const r = await response
    assert(r.status() === 200, 'assert:save status')
    const body = r.request().postDataJSON()
    assert(
      body.expectedVersion === before.version &&
        body.items.every((i) => !('id' in i)),
      'assert:DTO/version',
    )
    await page
      .getByText('Đã lưu toàn bộ đơn thuốc mô phỏng thành công.', {
        exact: true,
      })
      .waitFor()
    const saved = (await r.json()).data
    assert(saved.recordVersion === before.version + 1, 'assert:version once')
    latestVersion = saved.recordVersion
    return saved
  }
  try {
    if (fixture.recordId) {
      record = await ok(
        'DOCTOR_LINKED',
        '/api/v1/medical-records/' + fixture.recordId,
      )
      appointment = await ok(
        'DOCTOR_LINKED',
        '/api/v1/appointments/' + record.appointmentId,
      )
      patient = await ok('PATIENT', '/api/v1/me/patient-profile')
      longName = (await ok('DOCTOR_LINKED', path() + '/prescription')).items[0]
        ?.medicationName
      latestVersion = record.version
      await login(page, 'DOCTOR_LINKED')
      if ((fixture.resumeAt || 1) < 10) {
        await open()
        await presc()
      }
    }
    await check('FE01', async () => {
      const self = await req('PATIENT', '/api/v1/me/patient-profile')
      patient =
        self.status === 200
          ? self.body.data
          : await ok(
              'RECEPTIONIST',
              '/api/v1/patients',
              'POST',
              {
                patientCode: 'D12_' + Date.now(),
                fullName: 'Synthetic D12 patient',
                userId: qa.fixtureIds.users.PATIENT,
              },
              201,
            )
      // Each rerun gets a new non-overlapping slot on this isolated copy.
      const count = await ok('ADMIN', '/api/v1/appointments?size=100')
      const start = new Date(
        Math.ceil(
          (Date.now() + (count.totalElements + 1) * 90 * 60000) / 60000,
        ) * 60000,
      )
      const schedule = await ok(
        'RECEPTIONIST',
        '/api/v1/doctor-schedules',
        'POST',
        {
          doctorId: '1',
          startAt: start.toISOString(),
          endAt: new Date(+start + 30 * 60000).toISOString(),
          slotMinutes: 30,
          status: 'ACTIVE',
        },
        201,
      )
      appointment = await ok(
        'RECEPTIONIST',
        '/api/v1/appointments',
        'POST',
        {
          patientId: patient.id,
          scheduleId: schedule.id,
          startAt: start.toISOString(),
          requestKey: 'D12_' + Date.now(),
        },
        201,
      )
      for (const action of ['confirmation', 'check-in'])
        appointment = await ok(
          'RECEPTIONIST',
          '/api/v1/appointments/' + appointment.id + '/' + action,
          'POST',
          { expectedVersion: appointment.version },
        )
      await login(page, 'DOCTOR_LINKED')
      assert(
        await page.evaluate(async () => {
          const p = await import('/src/prescription/gateway.ts')
          return p.prescriptionGateway.mode === 'real' && !p.isPrescriptionMock
        }),
        'assert:real mode',
      )
      await b('Mở chi tiết ' + appointment.appointmentCode).click()
      await b('Bắt đầu khám').click()
      await b('Đơn thuốc mô phỏng').waitFor()
      record = await ok(
        'DOCTOR_LINKED',
        '/api/v1/medical-records/by-appointment/' + appointment.id,
      )
      await b('Đơn thuốc mô phỏng').click()
      await page
        .getByText('Chưa có dòng thuốc nào trong đơn thuốc mô phỏng.', {
          exact: true,
        })
        .waitFor()
      const empty = await ok('DOCTOR_LINKED', path() + '/prescription')
      assert(
        empty.id === null && empty.items.length === 0,
        'assert:official empty',
      )
    })
    await check('FE02', async () => {
      for (let i = 0; i < 3; i++) {
        await b('Thêm thuốc').click()
        await fillRow(i, 'Synthetic medicine ' + i)
      }
      const url = qa.apiURL + path() + '/prescription'
      let release,
        entered,
        calls = 0
      const gate = new Promise((resolve) => {
        release = resolve
      })
      const started = new Promise((resolve) => {
        entered = resolve
      })
      await page.route(url, async (route) => {
        if (route.request().method() === 'PUT') {
          calls++
          entered()
          await gate
        }
        await route.continue()
      })
      try {
        const saving = save()
        await started
        const pending = b('Đang lưu…')
        await pending.waitFor()
        assert(await pending.isDisabled(), 'assert:loading submit lock')
        await pending.evaluate((button) => button.click())
        release()
        assert(
          (await saving).items.length === 3 && calls === 1,
          'assert:multiple rows/single submit',
        )
      } finally {
        release()
        await page.unroute(url)
      }
    })
    await check('FE03', async () => {
      await page.reload()
      await page.waitForURL('**/login')
      await login(page, 'DOCTOR_LINKED')
      await open()
      await presc()
      assert(
        (await page.locator('#med-name-0').inputValue()) ===
          'Synthetic medicine 0',
        'assert:reload',
      )
    })
    await check('FE04', async () => {
      await page.locator('#med-name-0').fill('Synthetic edited')
      await b('Di chuyển thuốc #3 lên').click()
      await b('Xóa thuốc #3').click()
      const saved = await save()
      assert(
        saved.items.map((i) => i.medicationName).join('|') ===
          'Synthetic edited|Synthetic medicine 2',
        'assert:order/delete',
      )
    })
    await check('FE05', async () => {
      const puts = () =>
        http.filter((r) => r.channel === 'browser' && r.method === 'PUT').length
      const before = puts()
      for (const invalid of ['0', '1.5', '10001']) {
        await page.locator('#med-qty-0').fill(invalid)
        await b('Lưu đơn thuốc').click()
        await page.getByText(/Số lượng phải là số nguyên/).waitFor()
        if (invalid === '1.5')
          assert(
            (await page.locator('#med-qty-0').inputValue()) === invalid,
            'assert:no numeric coercion',
          )
      }
      assert(puts() === before, 'assert:client validation')
      longName = 'Synthetic D12 ' + 'A'.repeat(180)
      await page.locator('#med-name-0').fill(longName)
      await page.locator('#med-qty-0').fill('10000')
      await page.locator('#med-days-0').fill('365')
      await page.locator('#med-dosage-0').fill('D'.repeat(100))
      await page.locator('#med-freq-0').fill('F'.repeat(100))
      await page.locator('#med-inst-0').fill('I'.repeat(1000))
      const saved = await save()
      assert(
        saved.items[0].quantity === 10000 &&
          saved.items[0].durationDays === 365,
        'assert:boundaries',
      )
      // Corrupt only the outgoing request; the 400 is generated by real Backend validation.
      const url = qa.apiURL + path() + '/prescription'
      await page.route(url, (route) => {
        if (route.request().method() !== 'PUT') return route.continue()
        const data = route.request().postDataJSON()
        data.items[0].quantity = 10001
        return route.continue({ postData: JSON.stringify(data) })
      })
      await page.locator('#med-qty-0').fill('9999')
      const rejected = page.waitForResponse(
        (r) => r.url() === url && r.request().method() === 'PUT',
      )
      await b('Lưu đơn thuốc').click()
      assert((await rejected).status() === 400, 'assert:real validation 400')
      await page
        .getByText('Thông tin đơn thuốc không hợp lệ. Vui lòng kiểm tra lại.', {
          exact: true,
        })
        .waitFor()
      await page.unroute(url)
      await b('Tải lại hồ sơ').click()
      await page.locator('#med-qty-0').waitFor()
      assert(
        (await page.locator('#med-qty-0').inputValue()) === '10000',
        'assert:400 rollback/reconcile',
      )
    })
    await check('FE06', async () => {
      await clinical()
      for (const [label, value] of Object.entries({
        'Triệu chứng': 'Synthetic symptoms',
        'Chẩn đoán mô phỏng': 'Synthetic diagnosis',
        'Ghi chú': 'Synthetic notes',
        'Kết luận': 'Synthetic conclusion',
      }))
        await page.getByLabel(label, { exact: true }).fill(value)
      const response = page.waitForResponse(
        (r) =>
          r.request().method() === 'PATCH' && r.url() === qa.apiURL + path(),
      )
      await b('Lưu nháp').click()
      const r = await response
      assert(
        r.status() === 200 &&
          r.request().postDataJSON().expectedVersion === latestVersion,
        'assert:PATCH uses PUT version',
      )
      await page.getByText('Đã lưu nháp.', { exact: true }).last().waitFor()
    })
    await check('FE07', async () => {
      await page
        .getByLabel('Ghi chú', { exact: true })
        .fill('Synthetic unsaved clinical')
      await presc()
      await page.locator('#med-qty-0').fill('9999')
      await clinical()
      assert(
        (await page.getByLabel('Ghi chú', { exact: true }).inputValue()) ===
          'Synthetic unsaved clinical',
        'assert:clinical retained',
      )
      await page.getByLabel('Ghi chú', { exact: true }).fill('Synthetic notes')
      assert(
        await b('Hoàn tất khám').isDisabled(),
        'assert:unsaved prescription blocks completion',
      )
      await page.getByText(/Đơn thuốc còn thay đổi chưa lưu/).waitFor()
      await page
        .getByLabel('Ghi chú', { exact: true })
        .fill('Synthetic unsaved clinical')
      await presc()
      assert(
        (await page.locator('#med-qty-0').inputValue()) === '9999',
        'assert:prescription retained',
      )
      await save()
      await clinical()
      assert(
        (await page.getByLabel('Ghi chú', { exact: true }).inputValue()) ===
          'Synthetic unsaved clinical',
        'assert:save preserves other tab',
      )
      await b('Lưu nháp').click()
      await page.getByText('Đã lưu nháp.', { exact: true }).last().waitFor()
    })
    await check('FE08', async () => {
      otherContext = await browser.newContext()
      otherPage = await otherContext.newPage()
      attach(otherPage)
      await login(otherPage, 'DOCTOR_LINKED')
      await open(otherPage)
      await clinical(otherPage)
      await otherPage
        .getByLabel('Ghi chú', { exact: true })
        .fill('Synthetic external clinical revision')
      await b('Lưu nháp', otherPage).click()
      await otherPage
        .getByText('Đã lưu nháp.', { exact: true })
        .last()
        .waitFor()
      await presc()
      await page.locator('#med-qty-0').fill('9998')
      const response = page.waitForResponse(
        (r) =>
          r.request().method() === 'PUT' &&
          r.url() === qa.apiURL + path() + '/prescription',
      )
      await b('Lưu đơn thuốc').click()
      assert((await response).status() === 409, 'assert:real conflict')
      await page.getByText(/xung đột phiên bản/).waitFor()
      await b('Tải lại hồ sơ').click()
      await clinical()
      assert(
        (await page.getByLabel('Ghi chú', { exact: true }).inputValue()) ===
          'Synthetic external clinical revision',
        'assert:refresh all clinical',
      )
      await presc()
      await page.locator('#med-qty-0').fill('9998')
      await save()
      assert(
        (await ok('DOCTOR_LINKED', path())).notes ===
          'Synthetic external clinical revision',
        'assert:no blind version overwrite',
      )
      if (otherContext) await otherContext.close()
      otherContext = null
    })
    await check('FE09', async () => {
      await clinical()
      const before = await ok('DOCTOR_LINKED', path())
      await b('Hoàn tất khám').click()
      const response = page.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          r.url() === qa.apiURL + path() + '/completion',
      )
      await b('Xác nhận hoàn tất').click()
      const r = await response
      assert(
        r.status() === 200 &&
          r.request().postDataJSON().expectedVersion === before.version,
        'assert:completion fresh version',
      )
      await page
        .getByText('Đã hoàn tất khám.', { exact: true })
        .last()
        .waitFor()
      await b('Đơn thuốc mô phỏng').click()
      await page
        .getByText('Đã hoàn tất · Chỉ đọc', { exact: true })
        .first()
        .waitFor()
      assert(
        await page.locator('#med-name-0').isDisabled(),
        'assert:completed read only',
      )
      assert(
        (await b('Lưu đơn thuốc').count()) === 0 &&
          (await b('Thêm thuốc').count()) === 0,
        'assert:no mutations',
      )
      assert(
        (
          await req('DOCTOR_LINKED', path() + '/prescription', 'PUT', {
            expectedVersion: (await ok('DOCTOR_LINKED', path())).version,
            items: [],
          })
        ).status === 409,
        'assert:backend lock',
      )
    })
    await check('FE10', async () => {
      assert(
        (await req('PATIENT', path() + '/prescription')).status === 404,
        'assert:unreleased',
      )
      const own = await ok(
        'PATIENT',
        '/api/v1/patients/' + patient.id + '/medical-history',
      )
      assert(
        !own.items.some((i) => i.id === record.id),
        'assert:unreleased history',
      )
      // A second synthetic PATIENT is registered through the real public endpoint.
      qa.accounts.OTHER_PATIENT = {
        email: 'd12-other-' + Date.now() + '@example.test',
        password: 'Synthetic!A9' + Math.random().toString(36).slice(2),
      }
      await ok(
        null,
        '/api/v1/auth/register',
        'POST',
        { ...qa.accounts.OTHER_PATIENT, fullName: 'Synthetic other patient' },
        201,
      )
      const foreign = await ok(
        'RECEPTIONIST',
        '/api/v1/patients',
        'POST',
        {
          patientCode: 'D12_FOREIGN_' + Date.now(),
          fullName: 'Synthetic other patient',
        },
        201,
      )
      assert(
        (
          await req(
            'PATIENT',
            '/api/v1/patients/' + foreign.id + '/medical-history',
          )
        ).status === 404,
        'assert:foreign history',
      )
      assert(
        (await req('DOCTOR_CRUD', path() + '/prescription')).status === 404,
        'assert:cross doctor',
      )
      otherContext = await browser.newContext()
      otherPage = await otherContext.newPage()
      attach(otherPage)
      await login(otherPage, 'PATIENT', '/medical-history')
      assert(
        (await b('Xem chi tiết lượt ' + record.id, otherPage).count()) === 0,
        'assert:patient UI unpublished',
      )
    })
    await check('FE11', async () => {
      await page.keyboard.press('Escape')
      await nav(page, '/medical-history')
      await page.getByLabel('Bệnh nhân được phân công').selectOption(patient.id)
      await b('Xem chi tiết lượt ' + record.id).click()
      await b('Công bố hồ sơ').click()
      await b('Xác nhận công bố').click()
      await page.getByText('Đã công bố hồ sơ.', { exact: true }).waitFor()
      await b('Tải lại', otherPage).click()
      await b('Xem chi tiết lượt ' + record.id, otherPage).click()
      await otherPage.getByText(longName, { exact: false }).waitFor()
      assert(
        (await b('Lưu đơn thuốc', otherPage).count()) === 0,
        'assert:patient no write',
      )
      assert(
        (await ok('PATIENT', path() + '/prescription')).items[0]
          .medicationName === longName,
        'assert:published prescription',
      )
      assert(
        (await req('OTHER_PATIENT', path() + '/prescription')).status === 404,
        'assert:cross patient after release',
      )
    })
    await check('FE12', async () => {
      for (const actor of ['ADMIN', 'RECEPTIONIST']) {
        assert(
          (await req(actor, path() + '/prescription')).status === 403,
          'assert:staff prescription forbidden',
        )
        const meta = await ok(actor, path())
        assert(
          !('symptoms' in meta) && !('prescription' in meta),
          'assert:metadata only',
        )
        await login(page, actor, '/medical-history')
        await page.waitForURL('**/forbidden')
        assert(
          (await page.getByText(longName, { exact: false }).count()) === 0,
          'assert:no staff clinical',
        )
      }
      if (otherContext) await otherContext.close()
      otherContext = null
    })
    await check('FE13', async () => {
      // Return to a real, completed doctor record; no response mocking.
      await login(page, 'DOCTOR_LINKED', '/medical-history')
      await page.getByLabel('Bệnh nhân được phân công').selectOption(patient.id)
      const prescriptionPattern = qa.apiURL + path() + '/prescription'
      for (const [actor, status] of [
        ['DOCTOR_CRUD', 404],
        ['ADMIN', 403],
      ]) {
        await page.route(prescriptionPattern, async (route) =>
          route.continue({
            headers: {
              ...route.request().headers(),
              authorization: 'Bearer ' + (await token(actor)),
            },
          }),
        )
        await b('Xem chi tiết lượt ' + record.id).click()
        await page
          .getByText(
            /Không tìm thấy hồ sơ hoặc đơn thuốc|Bạn không có quyền xem hoặc chỉnh sửa đơn thuốc/,
          )
          .waitFor()
        assert(
          (await page.getByText(longName, { exact: false }).count()) === 0,
          'assert:denial hides prescription',
        )
        assert(
          http.some(
            (r) =>
              r.channel === 'browser' &&
              r.path === path() + '/prescription' &&
              r.status === status,
          ),
          'assert:real denial response',
        )
        await page.unroute(prescriptionPattern)
        await b('Tải lại').last().click()
        await page.getByText(longName, { exact: false }).waitFor()
        await page.keyboard.press('Escape')
      }
      await b('Xem chi tiết lượt ' + record.id).click()
      await page.getByText(longName, { exact: false }).waitFor()
      await page.keyboard.press('Escape')
      await page.context().setOffline(true)
      await b('Xem chi tiết lượt ' + record.id).click()
      await page
        .getByText(
          /Không thể tải lịch sử khám|Không thể kết nối|Không thể tải hồ sơ/,
        )
        .first()
        .waitFor()
      assert(
        (await page.getByText(longName, { exact: false }).count()) === 0,
        'assert:offline no fallback',
      )
      await page.context().setOffline(false)
      await b('Tải lại hồ sơ').click()
      await page.getByText(longName, { exact: false }).waitFor()
      await page.keyboard.press('Escape')
      await page.route(prescriptionPattern, async (route) =>
        route.continue({
          headers: {
            ...route.request().headers(),
            authorization: 'Bearer ' + qa.expiredToken,
          },
        }),
      )
      await b('Xem chi tiết lượt ' + record.id).click()
      await page.waitForURL('**/login')
      await page.unroute(prescriptionPattern)
      await login(page, 'DOCTOR_LINKED', '/medical-history')
      const logout = page.getByRole('button', { name: /Đăng xuất/ }).first()
      await logout.click()
      await page.waitForURL('**/login')
      await login(page, 'PATIENT', '/medical-history')
      assert(
        await page.evaluate(
          () =>
            Object.keys(localStorage).every((k) => k === 'clinic-theme') &&
            sessionStorage.length === 0,
        ),
        'assert:memory only',
      )
    })
    await check('FE14', async () => {
      await b('Xem chi tiết lượt ' + record.id).click()
      await page.getByText(longName, { exact: false }).waitFor()
      for (const width of [1280, 320]) {
        await page.setViewportSize({ width, height: 850 })
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          'assert:page overflow',
        )
        assert(
          await page
            .getByRole('dialog', { name: 'Chi tiết lượt khám', exact: true })
            .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
          'assert:dialog overflow',
        )
        await page.keyboard.press('Tab')
        assert(
          await page.evaluate(
            () => !!document.activeElement?.closest('[role=dialog]'),
          ),
          'assert:focus trap',
        )
      }
      await page.getByText(/Đơn thuốc mô phỏng — Chỉ phục vụ/).waitFor()
      await page.keyboard.press('Escape')
      assert(
        await b('Xem chi tiết lượt ' + record.id).evaluate(
          (e) => e === document.activeElement,
        ),
        'assert:focus restore',
      )
      const theme = page
        .getByRole('button', { name: /Chuyển giao diện/ })
        .first()
      const before = await page
        .locator('html')
        .evaluate((e) => e.classList.contains('dark'))
      await theme.click()
      await poll(
        async () =>
          (await page
            .locator('html')
            .evaluate((e) => e.classList.contains('dark'))) !== before,
        'theme toggle',
      )
      await theme.click()
      await poll(
        async () =>
          (await page
            .locator('html')
            .evaluate((e) => e.classList.contains('dark'))) === before,
        'theme restore',
      )
      await page.setViewportSize({ width: 1280, height: 850 })
      assert(
        runtime.length === 0 && consoleErrors.length === 0,
        'assert:runtime/console',
      )
    })
    return {
      source: 'REAL HTTP / MySQL V11',
      checks,
      http,
      runtimeErrors: runtime.length,
      unexpectedConsoleErrors: consoleErrors.length,
    }
  } catch (failure) {
    return {
      source: 'REAL HTTP / MySQL V11',
      checks,
      http,
      failure: failure.message,
      recordId: record?.id,
      appointmentId: appointment?.id,
      runtimeErrors: runtime.length,
      unexpectedConsoleErrors: consoleErrors.length,
    }
  } finally {
    await page.context().setOffline(false)
    if (otherContext) if (otherContext) await otherContext.close()
    page.off('response', observe)
    page.off('pageerror', onError)
    page.off('console', onConsole)
  }
}
