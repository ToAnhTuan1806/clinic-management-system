// Real HTTP acceptance against the host helper's owned V10 QA copy.
// No token, credential or clinical response bodies are returned as evidence.
export async function runHistoryReal(browser, page, origin) {
  const qa = await page.evaluate(() => window.__d03Acceptance)
  if (!qa?.sourceProtected || !qa.scopeVerified)
    throw Error('PRIVATE_QA_SCOPE_REQUIRED')
  const checks = [],
    http = [],
    images = [],
    tokens = new Map(),
    runtime = []
  const observe = (response) => {
    const url = new URL(response.url())
    if (url.origin === qa.apiURL && url.pathname.startsWith('/api/v1/'))
      http.push({
        channel: 'browser',
        method: response.request().method(),
        path: url.pathname,
        status: response.status(),
      })
  }
  const onError = () => runtime.push('uncaught runtime')
  const consoleErrors = []
  const onConsole = (message) => {
    const text = message.text()
    if (
      Object.values(qa.accounts).some(
        (account) =>
          text.includes(account.email) || text.includes(account.password),
      ) ||
      /\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/.test(text)
    )
      consoleErrors.push('sensitive output')
    if (
      message.type() === 'error' &&
      !/^Failed to load resource: (the server responded with a status of (400|401|403|404|409)\b|net::ERR_)/.test(
        text,
      )
    )
      consoleErrors.push('unexpected console error')
  }
  page.on('response', observe)
  page.on('pageerror', onError)
  page.on('console', onConsole)
  const assert = (value, label) => {
    if (!value) throw Error(label)
  }
  const check = async (id, label, action) => {
    try {
      await action()
      checks.push({ id, label, result: 'PASS' })
    } catch (error) {
      throw Error(id + ' ' + label + ' / ' + error.name)
    }
  }
  const token = async (actor) => {
    if (!tokens.has(actor)) {
      const account = qa.accounts[actor],
        result = await page.request.post(qa.apiURL + '/api/v1/auth/login', {
          data: { email: account.email, password: account.password },
        })
      assert(result.status() === 200, 'QA_LOGIN')
      tokens.set(actor, (await result.json()).data.accessToken)
    }
    return tokens.get(actor)
  }
  const request = async (actor, path, method = 'GET', data) => {
    const response = await page.request.fetch(qa.apiURL + path, {
      method,
      ...(data ? { data } : {}),
      headers: actor ? { Authorization: 'Bearer ' + (await token(actor)) } : {},
    })
    http.push({
      channel: 'request',
      method,
      path: path.split('?')[0],
      status: response.status(),
    })
    return { status: response.status(), body: await response.json() }
  }
  const button = (name, p = page) =>
    p.getByRole('button', { name, exact: true })
  const wait = (locator) =>
    locator.waitFor({ state: 'visible', timeout: 15000 })
  const login = async (actor, p = page) => {
    await p.goto(origin + '/login')
    await p.getByLabel('Email', { exact: true }).fill(qa.accounts[actor].email)
    await p
      .getByLabel('Mật khẩu', { exact: true })
      .fill(qa.accounts[actor].password)
    await button('Đăng nhập', p).click()
    await p.waitForURL(actor === 'PATIENT' ? '**/booking' : '**/dashboard')
    await p.evaluate(() => {
      history.pushState(null, '', '/medical-history')
      dispatchEvent(new PopStateEvent('popstate'))
    })
  }
  const dialog = () => page.getByRole('dialog', { name: 'Chi tiết lượt khám' })
  const close = async () => {
    await page.keyboard.press('Escape')
    await dialog().waitFor({ state: 'hidden' })
  }
  const list = () => page.getByRole('list', { name: 'Các lượt khám' })
  let record
  try {
    await check(
      'FE01',
      'Doctor real auth and complete patient discovery beyond 100 appointments',
      async () => {
        await login('DOCTOR_LINKED')
        await wait(button('Xem chi tiết lượt 101'))
        const options = await page
          .getByLabel('Bệnh nhân được phân công')
          .locator('option')
          .count()
        assert(options === 2, 'patient after appointment 100 missing')
        assert(
          await page.evaluate(async () => {
            const m = await import('/src/history/gateway.ts')
            return m.historyGateway.mode === 'real' && !m.isHistoryMock
          }),
          'real adapter',
        )
        assert(
          http.filter(
            (r) => r.channel === 'browser' && r.path === '/api/v1/appointments',
          ).length === 2,
          'appointment request count',
        )
      },
    )
    await check(
      'FE02',
      'Backend totals, stable descending order and metadata enrichment cache',
      async () => {
        const result = await request(
          'DOCTOR_LINKED',
          '/api/v1/patients/1/medical-history?page=0&size=5',
        )
        assert(
          result.status === 200 &&
            result.body.data.totalElements === 101 &&
            result.body.data.totalPages === 21,
          'history totals',
        )
        assert(
          result.body.data.items.map((r) => r.id).join(',') ===
            '101,100,99,98,97',
          'backend order',
        )
        assert(
          !http.some(
            (r) =>
              r.channel === 'browser' &&
              /^\/api\/v1\/appointments\/\d+$/.test(r.path),
          ),
          'redundant enrichment',
        )
        await button('Trang sau').click()
        await wait(button('Xem chi tiết lượt 96'))
        await button('Trang trước').click()
        await wait(button('Xem chi tiết lượt 101'))
      },
    )
    await check(
      'FE04',
      'Patient unreleased and other-owner records are hidden',
      async () => {
        for (const id of ['1', '101', '103'])
          assert(
            (await request('PATIENT', '/api/v1/medical-records/' + id))
              .status === 404,
            'unreleased/owner detail',
          )
        assert(
          (await request('PATIENT', '/api/v1/patients/2/medical-history'))
            .status === 404,
          'other patient history',
        )
        const own = await request(
          'PATIENT',
          '/api/v1/patients/1/medical-history?page=0&size=100',
        )
        assert(
          own.body.data.totalElements === 99 &&
            own.body.data.items.every((r) => r.releasedAt),
          'publication scope',
        )
      },
    )
    await check(
      'FE07',
      'Concurrent update returns 409 and requires fresh server version',
      async () => {
        await button('Xem chi tiết lượt 101').click()
        await wait(button('Công bố hồ sơ'))
        record = (await request('DOCTOR_LINKED', '/api/v1/medical-records/101'))
          .body.data
        const updated = await request(
          'DOCTOR_LINKED',
          '/api/v1/medical-records/101/release',
          'POST',
          { expectedVersion: record.version },
        )
        assert(updated.status === 200, 'concurrent release')
        await button('Công bố hồ sơ').click()
        await button('Xác nhận công bố').click()
        await wait(page.getByText(/Hồ sơ đã thay đổi/))
        assert(
          (await page
            .getByText('Synthetic symptoms', { exact: true })
            .count()) === 0,
          'stale clinical content',
        )
        await button('Tải lại hồ sơ').click()
        await wait(dialog().getByText('Đã công bố', { exact: true }))
        assert((await button('Công bố hồ sơ').count()) === 0, 'repeat action')
        await close()
      },
    )
    await check(
      'FE03',
      'Assigned DOCTOR confirms real publication of unreleased completed record',
      async () => {
        await page.getByLabel('Trạng thái công bố').selectOption('UNRELEASED')
        await wait(button('Xem chi tiết lượt 1'))
        await button('Xem chi tiết lượt 1').click()
        await button('Công bố hồ sơ').click()
        await button('Quay lại').click()
        assert(
          !(await request('DOCTOR_LINKED', '/api/v1/medical-records/1')).body
            .data.releasedAt,
          'cancel published',
        )
        await button('Công bố hồ sơ').click()
        await button('Xác nhận công bố').click()
        await wait(page.getByText('Đã công bố hồ sơ.', { exact: true }))
        const fresh = await request(
          'DOCTOR_LINKED',
          '/api/v1/medical-records/1',
        )
        assert(
          fresh.status === 200 &&
            fresh.body.data.version === 1 &&
            fresh.body.data.releasedAt,
          'real publication',
        )
        await wait(
          page.getByText('Chưa có lượt khám phù hợp.', { exact: true }),
        )
        await page.getByLabel('Trạng thái công bố').selectOption('ALL')
        await wait(button('Xem chi tiết lượt 101'))
      },
    )
    await check(
      'FE06',
      'Staff metadata excludes clinical fields, wrong roles cannot release, foreign doctor 404',
      async () => {
        for (const actor of ['ADMIN', 'RECEPTIONIST', 'PATIENT']) {
          assert(
            (
              await request(
                actor,
                '/api/v1/medical-records/1/release',
                'POST',
                { expectedVersion: 1 },
              )
            ).status === 403,
            'release RBAC',
          )
          if (actor !== 'PATIENT') {
            const row = (await request(actor, '/api/v1/medical-records/1')).body
              .data
            assert(
              !('symptoms' in row) &&
                !('diagnosis' in row) &&
                !('notes' in row) &&
                !('conclusion' in row),
              'metadata leakage',
            )
          }
        }
        assert(
          (await request('DOCTOR_INACTIVE', '/api/v1/medical-records/1'))
            .status === 404,
          'doctor ownership',
        )
        assert(
          (await request(null, '/api/v1/patients/1/medical-history')).status ===
            401,
          'missing JWT',
        )
      },
    )
    await check(
      'FE08',
      'Global filters include final Backend page and retain server ordering',
      async () => {
        await page.getByLabel('Từ ngày', { exact: true }).fill('2026-06-02')
        await page.getByLabel('Đến ngày', { exact: true }).fill('2026-06-02')
        await wait(button('Xem chi tiết lượt 1'))
        assert(
          (await list().locator('li').count()) === 1,
          'date filter across page 100',
        )
        await page.getByLabel('Từ ngày', { exact: true }).fill('')
        await page.getByLabel('Đến ngày', { exact: true }).fill('')
        await page
          .getByLabel('Tìm bác sĩ hoặc chuyên khoa')
          .fill('missing synthetic keyword')
        await wait(
          page.getByText('Chưa có lượt khám phù hợp.', { exact: true }),
        )
        await page.getByLabel('Tìm bác sĩ hoặc chuyên khoa').fill('')
        await wait(button('Xem chi tiết lượt 101'))
      },
    )
    await check(
      'FE09',
      'Real request loading, empty state and retry',
      async () => {
        const pattern = qa.apiURL + '/api/v1/patients/1/medical-history?**'
        let release, arrived
        const gate = new Promise((r) => {
            release = r
          }),
          started = new Promise((r) => {
            arrived = r
          })
        await page.route(pattern, async (route) => {
          arrived()
          await gate
          await route.continue().catch(() => {})
        })
        try {
          await page
            .getByLabel('Tìm bác sĩ hoặc chuyên khoa')
            .fill('loading test')
          await started
          await wait(page.locator('[aria-busy=true]').first())
          assert((await list().count()) === 0, 'old rows while loading')
        } finally {
          release()
          await page.unroute(pattern)
        }
        await wait(
          page.getByText('Chưa có lượt khám phù hợp.', { exact: true }),
        )
        await page.getByLabel('Tìm bác sĩ hoặc chuyên khoa').fill('')
        await wait(button('Xem chi tiết lượt 101'))
      },
    )
    await check(
      'FE10',
      'Offline and real 404 show errors without synthetic clinical success',
      async () => {
        await page.context().setOffline(true)
        try {
          await page.getByLabel('Tìm bác sĩ hoặc chuyên khoa').fill('offline')
          await wait(
            page.getByText(
              'Không thể tải lịch sử khám. Kiểm tra kết nối và thử lại.',
              { exact: true },
            ),
          )
          assert((await list().count()) === 0, 'old rows during error')
        } finally {
          await page.context().setOffline(false)
        }
        await page.getByLabel('Tìm bác sĩ hoặc chuyên khoa').fill('')
        await wait(button('Xem chi tiết lượt 101'))
        const pattern = qa.apiURL + '/api/v1/medical-records/101'
        const other = await token('DOCTOR_INACTIVE')
        await page.route(pattern, (route) =>
          route.continue({
            headers: {
              ...route.request().headers(),
              Authorization: 'Bearer ' + other,
            },
          }),
        )
        try {
          await button('Xem chi tiết lượt 101').click()
          await wait(button('Tải lại hồ sơ'))
          assert(
            (await page
              .getByText('Synthetic symptoms', { exact: true })
              .count()) === 0,
            'clinical on 404',
          )
        } finally {
          await page.unroute(pattern)
        }
        await button('Tải lại hồ sơ').click()
        await wait(page.getByText('Synthetic symptoms', { exact: true }))
        await close()
      },
    )
    await check(
      'FE12',
      '320px/desktop Light-Dark keyboard and synthetic screenshots',
      async () => {
        for (const [width, label] of [
          [1280, 'desktop'],
          [320, 'mobile'],
        ]) {
          await page.setViewportSize({ width, height: 900 })
          if (width === 320)
            await button('Chuyển giao diện sáng hoặc tối').click()
          assert(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            'horizontal overflow',
          )
          images.push({
            label,
            data: (
              await page.screenshot({ type: 'jpeg', quality: 35 })
            ).toString('base64'),
          })
          await button('Xem chi tiết lượt 101').focus()
          await page.keyboard.press('Enter')
          await wait(dialog())
          for (let i = 0; i < 8; i++) {
            await page.keyboard.press('Tab')
            assert(
              await dialog().evaluate((e) =>
                e.contains(document.activeElement),
              ),
              'focus trap',
            )
          }
          await close()
          assert(
            await button('Xem chi tiết lượt 101').evaluate(
              (e) => e === document.activeElement,
            ),
            'focus restore',
          )
        }
      },
    )
    await check(
      'FE05',
      'PATIENT sees released own history and clinical detail after publication',
      async () => {
        await page.setViewportSize({ width: 1280, height: 900 })
        await login('PATIENT')
        await wait(button('Xem chi tiết lượt 101'))
        assert(
          (await page.getByLabel('Bệnh nhân được phân công').count()) === 0,
          'patient selector',
        )
        await button('Xem chi tiết lượt 101').click()
        await wait(page.getByText('Synthetic symptoms', { exact: true }))
        assert((await button('Công bố hồ sơ').count()) === 0, 'patient action')
      },
    )
    await check(
      'FE11',
      'Logout/account switch remove clinical content and enforce RoleGuard',
      async () => {
        await page.evaluate(async () => {
          ;(await import('/src/auth/session-store.ts')).clearSession()
        })
        await page.waitForURL('**/login')
        assert(
          (await page
            .getByText('Synthetic symptoms', { exact: true })
            .count()) === 0,
          'logout leak',
        )
        for (const actor of ['ADMIN', 'RECEPTIONIST']) {
          await login(actor)
          await page.waitForURL('**/forbidden')
          assert((await list().count()) === 0, 'staff timeline')
        }
      },
    )
    assert(runtime.length === 0, 'uncaught runtime errors')
    assert(consoleErrors.length === 0, 'unexpected console output')
    return {
      source: 'REAL D11 HTTP / MYSQL V10 QA COPY',
      checks,
      http,
      runtimeErrors: runtime.length,
      unexpectedConsoleErrors: consoleErrors.length,
      images,
    }
  } catch (error) {
    return {
      source: 'REAL D11 HTTP / MYSQL V10 QA COPY',
      checks,
      http,
      error: error.message,
      runtimeErrors: runtime.length,
    }
  } finally {
    await page.context().setOffline(false)
    await page.unroute(qa.apiURL + '/api/v1/**')
    page.removeListener('response', observe)
    page.removeListener('pageerror', onError)
    page.removeListener('console', onConsole)
  }
}
