import { test } from '@playwright/test'

// HTTP MOCK ONLY: DTOs aligned with Backend API_CONTRACT §3.11.
// This is not evidence of Backend scope, notification emission, or real API success.
// BEGIN D13 RUNNER
async function runOperationsMock(page, origin) {
  const checks = [],
    requests = [],
    errors = [],
    consoleErrors = []
  let role = 'ADMIN',
    actorId = '1',
    summaryFault = 0,
    inboxFault = 0,
    readFault = 0,
    slowInbox = false
  const store = new Map()
  const assert = (condition, label) => {
    if (!condition) throw Error(label)
  }
  const button = (name) => page.getByRole('button', { name, exact: true })
  const inbox = () =>
    page.getByRole('dialog', { name: 'Trung tâm thông báo', exact: true })
  const bell = () =>
    page.getByRole('button', { name: /^Thông báo(?:,|$)/, includeHidden: true })
  const wait = (locator) =>
    locator.waitFor({ state: 'visible', timeout: 10000 })
  const check = async (name, action) => {
    try {
      await action()
      checks.push(name)
    } catch (error) {
      throw Error(name + ' / ' + error.message.split('\n')[0])
    }
  }
  const go = async (path) =>
    page.evaluate((path) => {
      history.pushState(null, '', path)
      dispatchEvent(new PopStateEvent('popstate'))
    }, path)
  const rows = (key = role + ':' + actorId) => {
    if (!store.has(key))
      store.set(
        key,
        Array.from({ length: 25 }, (_, i) => ({
          id: (9007199254740993123n + BigInt(i)).toString(),
          eventType: [
            'APPOINTMENT_CREATED',
            'APPOINTMENT_RESCHEDULED',
            'APPOINTMENT_CANCELLED',
            'APPOINTMENT_CONFIRMED',
          ][i % 4],
          appointmentId: '9007199254740993999',
          appointmentCode: 'MOCK_' + key + '_' + i,
          createdAt: '2026-11-21T18:00:00Z',
          readAt: i < 3 ? null : '2026-11-21T19:00:00Z',
          body: 'MOCK_PRIVATE_CLINICAL',
          href: 'https://invalid.example',
        })),
      )
    return store.get(key)
  }
  const onError = () => errors.push('runtime')
  const onConsole = (message) => {
    if (
      message.type() === 'error' &&
      !/^Failed to load resource:/.test(message.text())
    )
      consoleErrors.push('console error')
  }
  page.on('pageerror', onError)
  page.on('console', onConsole)
  const pattern = origin + '/api/v1/**'
  await page.route(pattern, async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname,
      method = route.request().method()
    const currentRole = role,
      key = role + ':' + actorId
    requests.push({ path, method, query: url.search })
    const ok = (data) => route.fulfill({ json: { data } })
    const problem = (status) =>
      route.fulfill({
        status,
        json: {
          status,
          code: 'HTTP_' + status,
          detail: 'MOCK_PRIVATE_CLINICAL',
        },
      })
    if (path === '/api/v1/dashboard/summary') {
      if (currentRole === 'PATIENT') return problem(403)
      if (summaryFault) return problem(summaryFault)
      const empty = url.searchParams.get('from') === '2020-01-01'
      const count = empty ? 0 : currentRole === 'DOCTOR' ? 1 : 10
      if (url.searchParams.get('from') === '2026-01-01')
        await new Promise((resolve) => setTimeout(resolve, 200))
      return ok({
        from: url.searchParams.get('from'),
        to: url.searchParams.get('to'),
        timezone: 'Asia/Ho_Chi_Minh',
        totalAppointments: count * 7,
        checkedInCount: count * 2,
        completedCount: count,
        uniquePatients: count * 4,
        appointmentsByStatus: Object.fromEntries(
          [
            'PENDING',
            'CONFIRMED',
            'CHECKED_IN',
            'IN_PROGRESS',
            'COMPLETED',
            'CANCELLED',
            'NO_SHOW',
          ].map((s) => [s, count]),
        ),
        revenue: 'MOCK_PRIVATE_CLINICAL',
      })
    }
    if (path === '/api/v1/notifications') {
      if (inboxFault === -1) return route.abort('failed')
      if (inboxFault) return problem(inboxFault)
      const all = rows(key).map((item) => ({ ...item })),
        pageNumber = Number(url.searchParams.get('page') || 0)
      if (slowInbox) {
        slowInbox = false
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      return ok({
        items: all.slice(pageNumber * 20, pageNumber * 20 + 20),
        page: pageNumber,
        size: 20,
        totalElements: all.length,
        totalPages: Math.ceil(all.length / 20),
        unreadCount: all.filter((i) => !i.readAt).length,
      })
    }
    if (/^\/api\/v1\/notifications\/\d+\/read$/.test(path)) {
      if (readFault) return problem(readFault)
      const id = path.split('/')[4],
        all = rows(key),
        item = all.find((i) => i.id === id)
      if (!item) return problem(404)
      item.readAt ||= '2026-11-22T01:00:00Z'
      // Another session also read one item: the FE must use server count, not decrement by one.
      all[1].readAt ||= '2026-11-22T01:00:00Z'
      return route.fulfill({ status: 204, body: '' })
    }
    if (path === '/api/v1/appointments' && method === 'GET')
      return ok({
        items: [],
        page: 0,
        size: 20,
        totalElements: 0,
        totalPages: 0,
      })
    if (/^\/api\/v1\/appointments\/\d+$/.test(path)) {
      if (path.endsWith('/777')) return problem(404)
      return ok({
        id: '9007199254740993999',
        appointmentCode: 'MOCK_LINKED_' + key,
        patientId: '21',
        doctorId: '1',
        scheduleId: '8',
        startAt: '2026-11-25T02:00:00Z',
        endAt: '2026-11-25T02:30:00Z',
        status: 'CONFIRMED',
        version: 0,
      })
    }
    if (
      (path === '/api/v1/appointments' && method === 'POST') ||
      /^\/api\/v1\/appointments\/\d+\/(slot|cancellation|confirmation)$/.test(
        path,
      )
    ) {
      if (currentRole !== 'RECEPTIONIST') return problem(403)
      if (path.endsWith('/slot') && method !== 'PATCH') return problem(405)
      const recipient = 'DOCTOR:1'
      const type = path.endsWith('/slot')
        ? 'APPOINTMENT_RESCHEDULED'
        : path.endsWith('/cancellation')
          ? 'APPOINTMENT_CANCELLED'
          : path.endsWith('/confirmation')
            ? 'APPOINTMENT_CONFIRMED'
            : 'APPOINTMENT_CREATED'
      rows(recipient).unshift({
        ...rows(recipient)[0],
        id: (9007199254740994000n + BigInt(rows(recipient).length)).toString(),
        eventType: type,
        appointmentCode: 'MOCK_EVENT_' + type,
        readAt: null,
      })
      return ok({ id: '9007199254740993999', version: 1 })
    }
    return problem(404)
  })
  const authenticate = async (nextRole, id = '1', path = '/dashboard') => {
    role = nextRole
    actorId = id
    await page.evaluate(async () => {
      const store = await import('/src/auth/session-store.ts')
      store.clearSession()
    })
    await go('/login')
    await page.waitForURL('**/login')
    await page.evaluate(
      async ({ role, id }) => {
        const store = await import('/src/auth/session-store.ts')
        store.establishSession(
          store.beginAuthentication(),
          'synthetic-d13-only',
          {
            id,
            role,
            email: 'synthetic@d13.invalid',
            fullName: 'MOCK ' + role,
          },
        )
      },
      { role, id },
    )
    await page.waitForURL((url) => url.pathname !== '/login')
    await go(path)
  }
  const openInbox = async () => {
    await bell().click()
    await wait(inbox().getByRole('list', { name: 'Danh sách thông báo' }))
  }
  const closeInbox = async () => {
    await page.keyboard.press('Escape')
    await inbox().waitFor({ state: 'hidden' })
  }
  const total = () => page.locator('[aria-label="Chỉ số vận hành"] dd').first()
  try {
    await page.goto(origin + '/login')
    await page.evaluate(async () => {
      const { operationsApi, createOperationsApi } =
        await import('/src/operations/api.ts')
      const { apiClient } = await import('/src/lib/api-client.ts')
      Object.assign(operationsApi, createOperationsApi(apiClient, true))
      const { bookingGateway } = await import('/src/booking/gateway.ts')
      const { createBookingApi } = await import('/src/booking/api.ts')
      Object.assign(bookingGateway, createBookingApi(apiClient))
    })
    await check(
      'MOCK role-scoped Dashboard ADMIN / RECEPTIONIST / DOCTOR and PATIENT guard',
      async () => {
        for (const r of ['ADMIN', 'RECEPTIONIST', 'DOCTOR']) {
          await authenticate(r)
          await wait(total())
          assert(
            (await total().textContent()) === (r === 'DOCTOR' ? '7' : '70'),
            'role scoped total',
          )
          assert(
            (await page
              .getByText('MOCK_PRIVATE_CLINICAL', { exact: true })
              .count()) === 0,
            'no clinical/financial payload',
          )
        }
        const before = requests.filter((r) =>
          r.path.endsWith('/summary'),
        ).length
        await authenticate('PATIENT')
        await page.waitForURL('**/forbidden')
        assert(
          requests.filter((r) => r.path.endsWith('/summary')).length === before,
          'patient sent summary request',
        )
      },
    )
    await check(
      'MOCK date filters, validation, empty, loading and latest response',
      async () => {
        await authenticate('ADMIN')
        await wait(total())
        await page.getByLabel('Từ ngày', { exact: true }).fill('2026-11-23')
        await page.getByLabel('Đến ngày', { exact: true }).fill('2026-11-22')
        const before = requests.filter((r) =>
          r.path.endsWith('/summary'),
        ).length
        await button('Áp dụng').click()
        await wait(
          page.getByText('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.', {
            exact: true,
          }),
        )
        assert(
          requests.filter((r) => r.path.endsWith('/summary')).length === before,
          'invalid date request',
        )
        await page.getByLabel('Từ ngày', { exact: true }).fill('2020-01-01')
        await page.getByLabel('Đến ngày', { exact: true }).fill('2020-01-01')
        await button('Áp dụng').click()
        await wait(
          page.getByText('Chưa có lịch hẹn trong khoảng ngày này', {
            exact: true,
          }),
        )
        assert((await total().textContent()) === '0', 'genuine empty metrics')
        await page.getByLabel('Từ ngày', { exact: true }).fill('2026-01-01')
        await page.getByLabel('Đến ngày', { exact: true }).fill('2026-11-22')
        await button('Áp dụng').click()
        await wait(page.getByText('Đang tải giao diện…', { exact: true }))
        assert((await total().count()) === 0, 'stale metrics during load')
        await page.getByLabel('Từ ngày', { exact: true }).fill('2026-02-01')
        await button('Áp dụng').click()
        await wait(total())
        await page.waitForTimeout(300)
        assert(
          (await total().textContent()) === '70',
          'stale response replaced latest',
        )
        const query = new URLSearchParams(
          requests.filter((r) => r.path.endsWith('/summary')).at(-1).query,
        )
        assert(
          query.get('from') === '2026-02-01' &&
            query.get('to') === '2026-11-22' &&
            [...query.keys()].length === 2,
          'date-only query',
        )
      },
    )
    await check(
      'MOCK Dashboard errors and retry without stale KPI data',
      async () => {
        summaryFault = 500
        await button('Áp dụng').click()
        await wait(button('Thử lại Dashboard'))
        assert((await total().count()) === 0, 'error retained KPI')
        summaryFault = 0
        await button('Thử lại Dashboard').click()
        await wait(total())
      },
    )
    await check(
      'MOCK inbox pagination, BIGINT ids, unreadCount and no polling',
      async () => {
        await openInbox()
        assert(
          (await inbox().getByRole('listitem').count()) === 20,
          'first page',
        )
        await inbox()
          .getByRole('button', { name: 'Tải thêm thông báo', exact: true })
          .click()
        await wait(
          inbox().getByText('Đã hiển thị 25 / 25 thông báo', { exact: true }),
        )
        assert(
          (await inbox().getByRole('listitem').count()) === 25,
          'second page',
        )
        const before = requests.filter(
          (r) => r.path === '/api/v1/notifications',
        ).length
        await page.waitForTimeout(250)
        assert(
          requests.filter((r) => r.path === '/api/v1/notifications').length ===
            before,
          'unnecessary polling',
        )
        assert(
          (await inbox()
            .getByText('MOCK_PRIVATE_CLINICAL', { exact: true })
            .count()) === 0,
          'raw notification body',
        )
        assert(
          (await bell().getAttribute('aria-label')) === 'Thông báo, 3 chưa đọc',
          'unread badge',
        )
      },
    )
    await check(
      'MOCK mark-read reconciles server unreadCount and repeated PATCH is idempotent',
      async () => {
        await inbox()
          .getByRole('button', {
            name: 'Đánh dấu đã đọc thông báo 9007199254740993123',
            exact: true,
          })
          .click()
        await wait(inbox().getByText('1 thông báo chưa đọc', { exact: true }))
        assert(
          (await inbox()
            .getByRole('button', {
              name: 'Đánh dấu đã đọc thông báo 9007199254740993123',
              exact: true,
            })
            .count()) === 0,
          'read item remains unread',
        )
        assert(
          (await inbox().getByRole('listitem').count()) === 25,
          'read discarded loaded pages',
        )
        await page.evaluate(async () => {
          const { operationsApi } = await import('/src/operations/api.ts')
          await operationsApi.markRead('9007199254740993123')
          await operationsApi.markRead('9007199254740993123')
        })
        await inbox()
          .getByRole('button', { name: 'Làm mới thông báo', exact: true })
          .click()
        await wait(inbox().getByText('1 thông báo chưa đọc', { exact: true }))
      },
    )
    await check('MOCK safe related appointment deep link and 404', async () => {
      await inbox()
        .getByRole('link', { name: 'Mở lịch hẹn', exact: true })
        .first()
        .click()
      await page.waitForURL('**/appointments?appointmentId=9007199254740993999')
      const panel = page.getByRole('region', {
        name: 'Lịch hẹn liên quan',
        exact: true,
      })
      await wait(panel.getByText('MOCK_LINKED_ADMIN:1', { exact: true }))
      await go('/appointments?appointmentId=777')
      await wait(panel.getByRole('alert'))
      assert(
        (await panel
          .getByText('MOCK_LINKED_ADMIN:1', { exact: true })
          .count()) === 0,
        '404 retained prior appointment',
      )
    })
    await check(
      'MOCK administrative create/reschedule/cancel/confirm fixtures refresh on open',
      async () => {
        for (const action of [
          '',
          '/9007199254740993999/slot',
          '/9007199254740993999/confirmation',
          '/9007199254740993999/cancellation',
        ]) {
          await authenticate('RECEPTIONIST', '1', '/appointments')
          await page.evaluate(async (path) => {
            const { apiClient } = await import('/src/lib/api-client.ts')
            const data = path.endsWith('/slot')
              ? {
                  scheduleId: '8',
                  startAt: '2026-11-25T02:00:00Z',
                  expectedVersion: 0,
                }
              : path.endsWith('/cancellation')
                ? { reason: 'Synthetic cancellation', expectedVersion: 0 }
                : path.endsWith('/confirmation')
                  ? { expectedVersion: 0 }
                  : {
                      patientId: '21',
                      scheduleId: '8',
                      startAt: '2026-11-25T02:00:00Z',
                      requestKey: 'synthetic-d13-event',
                    }
            await apiClient.request({
              url: path,
              method: path.endsWith('/slot') ? 'PATCH' : 'POST',
              data,
            })
          }, '/api/v1/appointments' + action)
          await authenticate('DOCTOR', '1')
          await openInbox()
          await wait(
            inbox().getByText(
              'Mã lịch: MOCK_EVENT_' +
                (action.endsWith('slot')
                  ? 'APPOINTMENT_RESCHEDULED'
                  : action.endsWith('cancellation')
                    ? 'APPOINTMENT_CANCELLED'
                    : action.endsWith('confirmation')
                      ? 'APPOINTMENT_CONFIRMED'
                      : 'APPOINTMENT_CREATED'),
              { exact: true },
            ),
          )
          await closeInbox()
        }
      },
    )
    await check(
      'MOCK inbox 403/404/network and PATCH 404 clear data and allow retry',
      async () => {
        for (const fault of [403, 404, -1]) {
          inboxFault = fault
          await bell().click()
          await wait(
            inbox().getByRole('button', {
              name: 'Thử lại thông báo',
              exact: true,
            }),
          )
          assert(
            (await inbox().getByRole('listitem').count()) === 0,
            'error retained inbox',
          )
          inboxFault = 0
          await inbox()
            .getByRole('button', { name: 'Thử lại thông báo', exact: true })
            .click()
          await wait(inbox().getByRole('list', { name: 'Danh sách thông báo' }))
          await closeInbox()
        }
        readFault = 404
        await openInbox()
        await inbox()
          .getByRole('button', { name: /Đánh dấu đã đọc thông báo/ })
          .first()
          .click()
        await wait(
          inbox().getByText('Không tìm thấy dữ liệu trong phạm vi được phép.', {
            exact: true,
          }),
        )
        assert(
          (await inbox().getByRole('listitem').count()) === 0,
          'PATCH error retained inbox',
        )
        readFault = 0
        await inbox()
          .getByRole('button', { name: 'Thử lại thông báo', exact: true })
          .click()
        await wait(inbox().getByRole('list', { name: 'Danh sách thông báo' }))
        await closeInbox()
      },
    )
    await check(
      'MOCK 401 clears session; switch account rejects late prior inbox responses',
      async () => {
        inboxFault = 401
        await bell().click()
        await page.waitForURL('**/login')
        inboxFault = 0
        await authenticate('ADMIN')
        await openInbox()
        slowInbox = true
        await inbox()
          .getByRole('button', { name: 'Làm mới thông báo', exact: true })
          .click()
        await authenticate('RECEPTIONIST', '2')
        await openInbox()
        await page.waitForTimeout(350)
        assert(
          (await inbox()
            .getByText(/MOCK_ADMIN/)
            .count()) === 0,
          'previous account notification',
        )
        assert(
          (await inbox()
            .getByText(/MOCK_RECEPTIONIST:2/)
            .count()) > 0,
          'current owner missing',
        )
        assert(
          await page.evaluate(
            () =>
              Object.keys(localStorage).every((k) => k === 'clinic-theme') &&
              sessionStorage.length === 0,
          ),
          'sensitive storage',
        )
        await closeInbox()
      },
    )
    await check(
      'MOCK desktop/mobile 320px, Light/Dark, focus and reduced motion',
      async () => {
        await page.emulateMedia({ reducedMotion: 'reduce' })
        for (const width of [1280, 768, 320]) {
          await page.setViewportSize({ width, height: 850 })
          assert(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            'page overflow',
          )
          await openInbox()
          assert(
            await inbox().evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
            'sheet overflow',
          )
          await page.keyboard.press('Tab')
          assert(
            await page.evaluate(
              () => !!document.activeElement.closest('[role=dialog]'),
            ),
            'focus escaped sheet',
          )
          await closeInbox()
          await page.waitForFunction(() =>
            document.activeElement
              ?.getAttribute('aria-label')
              ?.startsWith('Thông báo'),
          )
          assert(
            await bell().evaluate((e) => e === document.activeElement),
            'focus not restored',
          )
        }
        const theme = page.getByRole('button', {
          name: 'Chuyển giao diện sáng hoặc tối',
          exact: true,
        })
        const before = await page
          .locator('html')
          .evaluate((e) => e.classList.contains('dark'))
        await theme.click()
        assert(
          (await page
            .locator('html')
            .evaluate((e) => e.classList.contains('dark'))) !== before,
          'theme toggle',
        )
        await theme.click()
        await page.setViewportSize({ width: 1280, height: 850 })
      },
    )
    await check(
      'MOCK empty inbox, zero unread and loading skeleton',
      async () => {
        store.set('ADMIN:3', [])
        await authenticate('ADMIN', '3')
        await page.waitForFunction(
          () =>
            !!document.querySelector(
              'button[aria-label="Thông báo, 0 chưa đọc"]',
            ),
        )
        slowInbox = true
        await bell().click()
        await wait(inbox().getByText('Đang tải giao diện…', { exact: true }))
        await wait(
          inbox().getByRole('heading', {
            name: 'Chưa có thông báo',
            exact: true,
          }),
        )
        assert(
          (await inbox().getByRole('listitem').count()) === 0,
          'empty invented rows',
        )
        assert(
          (await bell().getAttribute('aria-label')) === 'Thông báo, 0 chưa đọc',
          'empty unread count',
        )
        await closeInbox()
      },
    )
    await check(
      'Pending API gate makes no D13 requests and never invents statistics',
      async () => {
        await page.evaluate(async () => {
          const { operationsApi, createOperationsApi } =
            await import('/src/operations/api.ts')
          const { apiClient } = await import('/src/lib/api-client.ts')
          Object.assign(operationsApi, createOperationsApi(apiClient, false))
        })
        const before = requests.filter(
          (r) =>
            r.path === '/api/v1/notifications' || r.path.endsWith('/summary'),
        ).length
        await authenticate('ADMIN', '9')
        await wait(
          page.getByText('Thống kê chưa sẵn sàng. Vui lòng thử lại sau.', {
            exact: true,
          }),
        )
        await bell().click()
        await wait(
          inbox().getByText('Thông báo chưa sẵn sàng. Vui lòng thử lại sau.', {
            exact: true,
          }),
        )
        assert(
          requests.filter(
            (r) =>
              r.path === '/api/v1/notifications' || r.path.endsWith('/summary'),
          ).length === before,
          'pending gate sent HTTP',
        )
        assert((await total().count()) === 0, 'pending has fake numbers')
        await closeInbox()
      },
    )
    assert(
      errors.length === 0 && consoleErrors.length === 0,
      'runtime/console errors',
    )
    return {
      source: 'HTTP MOCK ONLY — D13 DTO',
      checks,
      requests,
      runtimeErrors: errors.length,
      consoleErrors: consoleErrors.length,
    }
  } catch (error) {
    return {
      source: 'HTTP MOCK ONLY — D13 DTO',
      checks,
      requests,
      failure: error.message,
      runtimeErrors: errors.length,
      consoleErrors: consoleErrors.length,
    }
  } finally {
    await page.unroute(pattern)
    page.off('pageerror', onError)
    page.off('console', onConsole)
  }
}
// END D13 RUNNER

test('D13 HTTP MOCK ONLY — role Dashboard and Notification Center candidate contract', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(180000)
  const result = await runOperationsMock(
    page,
    baseURL || 'http://127.0.0.1:5174',
  )
  if (result.failure) throw Error(result.failure)
  console.log(
    JSON.stringify({
      source: result.source,
      groups: result.checks.length,
      checks: result.checks,
      runtimeErrors: result.runtimeErrors,
      consoleErrors: result.consoleErrors,
    }),
  )
})
