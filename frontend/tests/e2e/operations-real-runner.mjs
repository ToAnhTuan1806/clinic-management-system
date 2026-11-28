// Real HTTP only. Run on the host helper's owned MySQL V12 copy, every mock flag OFF.
// qa is an in-memory vault handoff. expected contains independent SQL aggregates
// from synthetic boundary appointments (no notification rows are seeded by FE).
export async function runOperationsReal(browser, page, origin, qa, expected) {
  if (
    !qa?.scopeVerified ||
    !qa.sourceProtected ||
    !expected?.sqlVerified ||
    expected.cloneId !== qa.cloneId
  )
    throw Error('QA_SCOPE_REQUIRED')
  const checks = [],
    http = [],
    runtime = [],
    consoleErrors = [],
    tokens = new Map()
  const b = (name, p = page) => p.getByRole('button', { name, exact: true })
  const bell = (p = page) =>
    p.getByRole('button', { name: /^Thông báo(?:,|$)/, includeHidden: true })
  const inbox = (p = page) =>
    p.getByRole('dialog', { name: 'Trung tâm thông báo', exact: true })
  const assert = (value, label) => {
    if (!value) throw Error('assert:' + label)
  }
  const wait = (locator) =>
    locator.waitFor({ state: 'visible', timeout: 15000 })
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
  const onError = () => runtime.push('runtime')
  const onConsole = (m) => {
    const text = m.text()
    if (
      Object.values(qa.accounts).some(
        (a) => text.includes(a.email) || text.includes(a.password),
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
  page.on('response', observe)
  page.on('pageerror', onError)
  page.on('console', onConsole)
  const token = async (actor) => {
    if (!tokens.has(actor)) {
      const a = qa.accounts[actor],
        r = await page.request.post(qa.apiURL + '/api/v1/auth/login', {
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
  const nav = (path, p = page) =>
    p.evaluate((path) => {
      history.pushState(null, '', path)
      dispatchEvent(new PopStateEvent('popstate'))
    }, path)
  const login = async (actor, path = '/dashboard', p = page) => {
    await p.goto(origin + '/login')
    await p.getByLabel('Email', { exact: true }).fill(qa.accounts[actor].email)
    await p
      .getByLabel('Mật khẩu', { exact: true })
      .fill(qa.accounts[actor].password)
    await b('Đăng nhập', p).click()
    await p.waitForURL(
      (u) => u.pathname !== '/login' && u.pathname !== '/register',
    )
    await nav(path, p)
  }
  const check = async (id, action) => {
    try {
      await action()
      checks.push({ id, result: 'PASS' })
    } catch (error) {
      throw Error(
        id + ' / ' + error.name + ' / ' + error.message.split('\n')[0],
      )
    }
  }
  const metrics = () => page.locator('[aria-label="Chỉ số vận hành"] dd')
  const readMetrics = async () => {
    await wait(metrics().first())
    return (await metrics().allTextContents()).map((text) =>
      Number(text.replaceAll('.', '').trim()),
    )
  }
  const assertMetrics = async (actor) => {
    const from = await page.getByLabel('Từ ngày', { exact: true }).inputValue(),
      to = await page.getByLabel('Đến ngày', { exact: true }).inputValue()
    const data = await ok(
      actor,
      '/api/v1/dashboard/summary?from=' + from + '&to=' + to,
    )
    assert(
      JSON.stringify(await readMetrics()) ===
        JSON.stringify([
          data.totalAppointments,
          data.checkedInCount,
          data.completedCount,
          data.uniquePatients,
        ]),
      'KPI/API mismatch',
    )
    const values = await page
      .locator('[aria-label="Phân bố trạng thái"] dd')
      .allTextContents()
    if (data.totalAppointments > 0)
      assert(
        values.map((t) => Number(t.replaceAll('.', ''))).join() ===
          [
            'PENDING',
            'CONFIRMED',
            'CHECKED_IN',
            'IN_PROGRESS',
            'COMPLETED',
            'CANCELLED',
            'NO_SHOW',
          ]
            .map((s) => data.appointmentsByStatus[s])
            .join(),
        'status distribution',
      )
    return data
  }
  const range = async (from, to) => {
    await page.getByLabel('Từ ngày', { exact: true }).fill(from)
    await page.getByLabel('Đến ngày', { exact: true }).fill(to)
    await b('Áp dụng').click()
    await wait(metrics().first())
  }
  const list = (actor) => ok(actor, '/api/v1/notifications?page=0&size=20')
  const allNotifications = async (actor) => {
    let out = [],
      meta
    for (let n = 0; ; n++) {
      meta = await ok(actor, '/api/v1/notifications?page=' + n + '&size=20')
      out.push(...meta.items)
      if (n + 1 >= meta.totalPages) break
    }
    return { ...meta, items: out }
  }
  const openInbox = async () => {
    await bell().click()
    await wait(inbox())
    await wait(
      inbox().getByRole('button', { name: 'Làm mới thông báo', exact: true }),
    )
    await page.waitForFunction(() => {
      const dialog = [...document.querySelectorAll('[role=dialog]')].find((e) =>
        e.textContent.includes('Trung tâm thông báo'),
      )
      return (
        dialog &&
        !dialog.querySelector('[aria-busy=true]') &&
        !dialog.textContent.includes('Đang tải giao diện')
      )
    })
  }
  const closeInbox = async () => {
    await page.keyboard.press('Escape')
    await inbox().waitFor({ state: 'hidden' })
  }
  const assertBadge = async (count) => {
    await page.waitForFunction(
      (count) =>
        !!document.querySelector(
          'button[aria-label="Thông báo, ' + count + ' chưa đọc"]',
        ),
      count,
    )
    assert(
      (await bell().getAttribute('aria-label')) ===
        'Thông báo, ' + count + ' chưa đọc',
      'badge count',
    )
  }
  const findNotice = (code, type) =>
    inbox()
      .getByRole('listitem')
      .filter({ has: page.getByText('Mã lịch: ' + code, { exact: true }) })
      .filter({
        has: page.getByText(
          {
            APPOINTMENT_CREATED: 'Lịch khám mới được tạo',
            APPOINTMENT_RESCHEDULED: 'Lịch khám đã được đổi giờ',
            APPOINTMENT_CANCELLED: 'Lịch khám đã được hủy',
            APPOINTMENT_CONFIRMED: 'Lịch khám đã được xác nhận',
          }[type],
          { exact: true },
        ),
      })
      .first()
  let patient, schedule, appointment, futureDate, firstReadId, firstReadAt
  const summaryPattern = qa.apiURL + '/api/v1/dashboard/summary**'
  const notificationPattern = qa.apiURL + '/api/v1/notifications?**'
  try {
    await page.setViewportSize({ width: 1280, height: 850 })
    await check('FE01', async () => {
      await login('ADMIN')
      assert(
        await page.evaluate(async () => {
          const a = await import('/src/auth/config.ts'),
            o = await import('/src/operations/api.ts'),
            p = await import('/src/prescription/gateway.ts'),
            h = await import('/src/history/gateway.ts'),
            b = await import('/src/booking/gateway.ts')
          return (
            !a.isAuthMock &&
            o.operationsApi.ready &&
            p.prescriptionGateway.mode === 'real' &&
            h.historyGateway.mode === 'real' &&
            b.bookingGateway.mode === 'real'
          )
        }),
        'real runtime flags',
      )
      const data = await assertMetrics('ADMIN')
      assert(
        data.totalAppointments === expected.month.total &&
          data.checkedInCount === expected.month.checkedIn &&
          data.completedCount === expected.month.completed &&
          data.uniquePatients === expected.month.uniquePatients,
        'independent SQL admin aggregate',
      )
      assert(data.timezone === 'Asia/Ho_Chi_Minh', 'VN timezone')
    })
    await check('FE02', async () => {
      await login('RECEPTIONIST')
      const data = await assertMetrics('RECEPTIONIST')
      assert(
        data.totalAppointments === expected.month.total,
        'receptionist clinic scope',
      )
      await openInbox()
      await wait(
        inbox().getByRole('heading', {
          name: 'Chưa có thông báo',
          exact: true,
        }),
      )
      await assertBadge(0)
      await closeInbox()
    })
    await check('FE03', async () => {
      await login('DOCTOR_LINKED')
      const data = await assertMetrics('DOCTOR_LINKED')
      assert(
        data.totalAppointments === expected.doctor.total &&
          data.uniquePatients === expected.doctor.uniquePatients &&
          data.totalAppointments < expected.month.total,
        'doctor independent SQL scope',
      )
      const injected = await ok(
        'DOCTOR_LINKED',
        '/api/v1/dashboard/summary?from=2026-11-01&to=2026-11-22&doctorId=2',
      )
      assert(
        injected.totalAppointments === expected.doctor.total,
        'client doctorId scope spoof',
      )
      const other = await ok(
        'DOCTOR_INACTIVE',
        '/api/v1/dashboard/summary?from=2026-11-01&to=2026-11-22',
      )
      assert(
        other.totalAppointments ===
          expected.month.total - expected.doctor.total,
        'other doctor scope',
      )
    })
    await check('FE04', async () => {
      await login('PATIENT', '/dashboard')
      await page.waitForURL('**/forbidden')
      assert((await metrics().count()) === 0, 'patient admin data')
      assert(
        (await req('PATIENT', '/api/v1/dashboard/summary')).status === 403,
        'Backend patient forbidden',
      )
      await nav('/appointments')
      await wait(page.getByRole('heading', { level: 1 }))
    })
    await check('FE05', async () => {
      await login('ADMIN')
      await range('2026-11-22', '2026-11-22')
      const day22 = await assertMetrics('ADMIN')
      assert(day22.totalAppointments === expected.day22, 'VN day22 boundary')
      await range('2026-11-23', '2026-11-23')
      const day23 = await assertMetrics('ADMIN')
      assert(day23.totalAppointments === expected.day23, 'VN day23 boundary')
      assert(
        (
          await req(
            'ADMIN',
            '/api/v1/dashboard/summary?from=2026-11-23&to=2026-11-22',
          )
        ).status === 400,
        'Backend reversed date validation',
      )
      await range('2026-11-01', '2026-11-22')
    })
    await check('FE06', async () => {
      let entered, release
      const reached = new Promise((r) => (entered = r)),
        gate = new Promise((r) => (release = r))
      await page.route(summaryPattern, async (route) => {
        entered()
        await gate
        await route.continue()
      })
      try {
        await b('Áp dụng').click()
        await reached
        await wait(page.getByText('Đang tải giao diện…', { exact: true }))
        assert((await metrics().count()) === 0, 'stale KPIs during load')
        release()
        await wait(metrics().first())
      } finally {
        release()
        await page.unroute(summaryPattern)
      }
      await range('2020-01-01', '2020-01-01')
      await wait(
        page.getByText('Chưa có lịch hẹn trong khoảng ngày này', {
          exact: true,
        }),
      )
      assert(
        (await readMetrics()).every((n) => n === 0),
        'genuine empty',
      )
      const patientToken = await token('PATIENT')
      await page.route(summaryPattern, (route) =>
        route.continue({
          headers: {
            ...route.request().headers(),
            authorization: 'Bearer ' + patientToken,
          },
        }),
      )
      await b('Áp dụng').click()
      await wait(b('Thử lại Dashboard'))
      assert((await metrics().count()) === 0, 'error retained KPIs')
      assert(
        http.some(
          (r) =>
            r.channel === 'browser' &&
            r.path === '/api/v1/dashboard/summary' &&
            r.status === 403,
        ),
        'real 403',
      )
      await page.unroute(summaryPattern)
      await b('Thử lại Dashboard').click()
      await wait(metrics().first())
      await range('2026-11-01', '2026-11-22')
    })
    await check('FE07', async () => {
      patient = await ok('PATIENT', '/api/v1/me/patient-profile')
      const today = await page.evaluate(async () => {
        const m = await import('/src/schedule/model.ts')
        return m.getVnTodayString()
      })
      futureDate = new Date(Date.parse(today + 'T00:00:00Z') + 3 * 86400000)
        .toISOString()
        .slice(0, 10)
      const start = new Date(futureDate + 'T01:00:00Z')
      schedule = await ok(
        'RECEPTIONIST',
        '/api/v1/doctor-schedules',
        'POST',
        {
          doctorId: '1',
          startAt: start.toISOString(),
          endAt: new Date(+start + 13 * 3600000).toISOString(),
          slotMinutes: 30,
          status: 'ACTIVE',
        },
        201,
      )
      const before = {}
      for (const actor of [
        'PATIENT',
        'DOCTOR_LINKED',
        'DOCTOR_CRUD',
        'ADMIN',
        'RECEPTIONIST',
      ])
        before[actor] = (await list(actor)).totalElements
      appointment = await ok(
        'RECEPTIONIST',
        '/api/v1/appointments',
        'POST',
        {
          patientId: patient.id,
          scheduleId: schedule.id,
          startAt: start.toISOString(),
          requestKey: 'D13_FIRST_' + Date.now(),
        },
        201,
      )
      for (const actor of [
        'PATIENT',
        'DOCTOR_LINKED',
        'DOCTOR_CRUD',
        'ADMIN',
        'RECEPTIONIST',
      ]) {
        const after = await list(actor)
        const receives = ['PATIENT', 'DOCTOR_LINKED'].includes(actor)
        assert(
          after.totalElements === before[actor] + (receives ? 1 : 0),
          'real publisher recipient ' + actor,
        )
        if (receives)
          assert(
            after.items.some(
              (n) =>
                n.appointmentId === appointment.id &&
                n.eventType === 'APPOINTMENT_CREATED',
            ),
            'booking notification',
          )
      }
      await login('PATIENT', '/appointments')
      await openInbox()
      await wait(findNotice(appointment.appointmentCode, 'APPOINTMENT_CREATED'))
      await closeInbox()
    })
    await check('FE08', async () => {
      const next = new Date(
        Date.parse(futureDate + 'T01:00:00Z') + 30 * 60000,
      ).toISOString()
      for (const action of ['slot', 'confirmation', 'cancellation']) {
        const data =
          action === 'slot'
            ? {
                scheduleId: schedule.id,
                startAt: next,
                expectedVersion: appointment.version,
              }
            : action === 'cancellation'
              ? {
                  reason: 'Synthetic administrative cancellation',
                  expectedVersion: appointment.version,
                }
              : { expectedVersion: appointment.version }
        appointment = await ok(
          'RECEPTIONIST',
          '/api/v1/appointments/' + appointment.id + '/' + action,
          action === 'slot' ? 'PATCH' : 'POST',
          data,
        )
        const type = {
          slot: 'APPOINTMENT_RESCHEDULED',
          confirmation: 'APPOINTMENT_CONFIRMED',
          cancellation: 'APPOINTMENT_CANCELLED',
        }[action]
        await openInbox()
        await wait(findNotice(appointment.appointmentCode, type))
        await closeInbox()
        for (const actor of ['PATIENT', 'DOCTOR_LINKED']) {
          const data = await list(actor)
          assert(
            data.items.some(
              (n) => n.appointmentId === appointment.id && n.eventType === type,
            ),
            'mutation event ' + type,
          )
          assert(
            data.items.every(
              (n) =>
                !('patientId' in n) &&
                !('diagnosis' in n) &&
                !('symptoms' in n) &&
                !('prescription' in n) &&
                !n.body.includes('Synthetic administrative cancellation'),
            ),
            'clinical/reason leakage',
          )
        }
      }
      // Actual booking API generates enough notifications for page 2; never insert notifications.
      for (let slot = 2; slot <= 22; slot++)
        await ok(
          'RECEPTIONIST',
          '/api/v1/appointments',
          'POST',
          {
            patientId: patient.id,
            scheduleId: schedule.id,
            startAt: new Date(
              Date.parse(futureDate + 'T01:00:00Z') + slot * 30 * 60000,
            ).toISOString(),
            requestKey: 'D13_PAGE_' + slot + '_' + Date.now(),
          },
          201,
        )
      assert((await list('PATIENT')).totalPages >= 2, 'real pagination fixture')
    })
    await check('FE09', async () => {
      const before = await list('PATIENT')
      await openInbox()
      await assertBadge(before.unreadCount)
      const first = before.items.find((n) => !n.readAt)
      assert(first, 'unread fixture')
      firstReadId = first.id
      const response = page.waitForResponse(
        (r) =>
          r.url() ===
            qa.apiURL + '/api/v1/notifications/' + first.id + '/read' &&
          r.request().method() === 'PATCH',
      )
      await inbox()
        .getByRole('button', {
          name: 'Đánh dấu đã đọc thông báo ' + first.id,
          exact: true,
        })
        .click()
      const r = await response
      assert(r.status() === 200, 'mark read HTTP')
      firstReadAt = (await r.json()).data.readAt
      const after = await list('PATIENT')
      assert(
        after.unreadCount === before.unreadCount - 1,
        'Backend unread count',
      )
      await assertBadge(after.unreadCount)
    })
    await check('FE10', async () => {
      const repeat = await ok(
        'PATIENT',
        '/api/v1/notifications/' + firstReadId + '/read',
        'PATCH',
      )
      assert(repeat.readAt === firstReadAt, 'idempotent read timestamp')
      const before = await list('PATIENT'),
        second = before.items.find((n) => !n.readAt)
      const external = await ok(
        'PATIENT',
        '/api/v1/notifications/' + second.id + '/read',
        'PATCH',
      )
      const response = page.waitForResponse(
        (r) =>
          r.url() ===
            qa.apiURL + '/api/v1/notifications/' + second.id + '/read' &&
          r.request().method() === 'PATCH',
      )
      await inbox()
        .getByRole('button', {
          name: 'Đánh dấu đã đọc thông báo ' + second.id,
          exact: true,
        })
        .click()
      const r = await response
      assert(
        r.status() === 200 && (await r.json()).data.readAt === external.readAt,
        'repeat through UI',
      )
      const after = await list('PATIENT')
      assert(after.unreadCount === before.unreadCount - 1, 'no false decrement')
      await assertBadge(after.unreadCount)
    })
    await check('FE11', async () => {
      const all = await allNotifications('PATIENT')
      await inbox()
        .getByRole('button', { name: 'Tải thêm thông báo', exact: true })
        .click()
      await wait(
        inbox().getByText(
          'Đã hiển thị ' +
            all.totalElements +
            ' / ' +
            all.totalElements +
            ' thông báo',
          { exact: true },
        ),
      )
      const rows = inbox().getByRole('listitem')
      assert((await rows.count()) === all.totalElements, 'real metadata')
      for (let i = 0; i < all.items.length; i++) {
        assert(
          (await rows.nth(i).innerText()).includes(
            all.items[i].appointmentCode,
          ),
          'UI order',
        )
        if (i > 0) {
          const a = all.items[i - 1],
            b = all.items[i]
          assert(
            Date.parse(a.createdAt) > Date.parse(b.createdAt) ||
              (Date.parse(a.createdAt) === Date.parse(b.createdAt) &&
                BigInt(a.id) > BigInt(b.id)),
            'server createdAt/id order',
          )
        }
      }
      const target = all.items[0]
      await rows
        .first()
        .getByRole('link', { name: 'Mở lịch hẹn', exact: true })
        .click()
      await page.waitForURL(
        '**/appointments?appointmentId=' + target.appointmentId,
      )
      await wait(
        page
          .getByRole('region', { name: 'Lịch hẹn liên quan', exact: true })
          .getByText(target.appointmentCode, { exact: true }),
      )
      assert(
        http.some(
          (r) =>
            r.channel === 'browser' &&
            r.path === '/api/v1/appointments/' + target.appointmentId &&
            r.status === 200,
        ),
        'related real GET',
      )
      assert(
        (
          await req(
            'DOCTOR_CRUD',
            '/api/v1/notifications/' + firstReadId + '/read',
            'PATCH',
          )
        ).status === 404,
        'foreign owner read',
      )
    })
    await check('FE12', async () => {
      await page
        .getByRole('button', { name: /Đăng xuất/ })
        .first()
        .click()
      await page.waitForURL('**/login')
      await login('ADMIN')
      await openInbox()
      await wait(
        inbox().getByRole('heading', {
          name: 'Chưa có thông báo',
          exact: true,
        }),
      )
      await assertBadge(0)
      await closeInbox()
      await login('DOCTOR_CRUD')
      await openInbox()
      await wait(
        inbox().getByRole('heading', {
          name: 'Chưa có thông báo',
          exact: true,
        }),
      )
      await assertBadge(0)
      await closeInbox()
      await login('PATIENT', '/appointments')
      await page.route(notificationPattern, (route) =>
        route.continue({
          headers: {
            ...route.request().headers(),
            authorization: 'Bearer ' + qa.expiredToken,
          },
        }),
      )
      await bell().click()
      await page.waitForURL('**/login')
      await page.unroute(notificationPattern)
      assert(
        (await page
          .getByRole('list', { name: 'Danh sách thông báo' })
          .count()) === 0,
        'expired stale data',
      )
      assert(
        await page.evaluate(
          () =>
            Object.keys(localStorage).every((k) => k === 'clinic-theme') &&
            sessionStorage.length === 0,
        ),
        'JWT/notification storage',
      )
    })
    await check('FE13', async () => {
      assert(
        (await req(null, '/api/v1/notifications')).status === 401,
        'anonymous Backend 401',
      )
      await login('PATIENT', '/appointments')
      const before = await list('PATIENT'),
        unread = before.items.find((n) => !n.readAt),
        readPattern = qa.apiURL + '/api/v1/notifications/' + unread.id + '/read'
      await openInbox()
      await page.route(readPattern, (route) =>
        route.continue({
          url: qa.apiURL + '/api/v1/notifications/9223372036854775806/read',
        }),
      )
      await inbox()
        .getByRole('button', {
          name: 'Đánh dấu đã đọc thông báo ' + unread.id,
          exact: true,
        })
        .click()
      await wait(
        inbox().getByText('Không tìm thấy dữ liệu trong phạm vi được phép.', {
          exact: true,
        }),
      )
      assert(
        (await inbox().getByRole('listitem').count()) === 0,
        '404 retained notifications',
      )
      await page.unroute(readPattern)
      await inbox()
        .getByRole('button', { name: 'Thử lại thông báo', exact: true })
        .click()
      await wait(inbox().getByRole('list', { name: 'Danh sách thông báo' }))
      await assertBadge(before.unreadCount)
      await closeInbox()
      await page.context().setOffline(true)
      await bell().click()
      await wait(
        inbox().getByRole('button', { name: 'Thử lại thông báo', exact: true }),
      )
      assert(
        (await inbox().getByRole('listitem').count()) === 0,
        'offline fixture fallback',
      )
      await page.context().setOffline(false)
      await inbox()
        .getByRole('button', { name: 'Thử lại thông báo', exact: true })
        .click()
      await wait(inbox().getByRole('list', { name: 'Danh sách thông báo' }))
      await assertBadge((await list('PATIENT')).unreadCount)
      await closeInbox()
    })
    await check('FE14', async () => {
      await login('DOCTOR_LINKED')
      await wait(metrics().first())
      await page.emulateMedia({ reducedMotion: 'reduce' })
      for (const width of [1280, 320]) {
        await page.setViewportSize({ width, height: 850 })
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          'dashboard overflow',
        )
        await openInbox()
        assert(
          await inbox().evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
          'inbox overflow',
        )
        assert(
          await inbox().evaluate((e) =>
            getComputedStyle(e)
              .animationDuration.split(',')
              .every((v) => parseFloat(v) <= 0.05),
          ),
          'reduced motion',
        )
        await page.keyboard.press('Tab')
        assert(
          await page.evaluate(
            () => !!document.activeElement.closest('[role=dialog]'),
          ),
          'focus trap',
        )
        await closeInbox()
        await page.waitForFunction(() =>
          document.activeElement
            ?.getAttribute('aria-label')
            ?.startsWith('Thông báo'),
        )
      }
      const theme = b('Chuyển giao diện sáng hoặc tối'),
        before = await page
          .locator('html')
          .evaluate((e) => e.classList.contains('dark'))
      await theme.click()
      await page.waitForFunction(
        (before) =>
          document.documentElement.classList.contains('dark') !== before,
        before,
      )
      await theme.click()
      await page.waitForFunction(
        (before) =>
          document.documentElement.classList.contains('dark') === before,
        before,
      )
      await page.setViewportSize({ width: 1280, height: 850 })
      assert(
        runtime.length === 0 && consoleErrors.length === 0,
        'runtime/console',
      )
    })
    return {
      source: 'REAL HTTP / MySQL 8.4.11 / Flyway V12',
      checks,
      http,
      runtimeErrors: runtime.length,
      unexpectedConsoleErrors: consoleErrors.length,
    }
  } catch (error) {
    return {
      source: 'REAL HTTP / MySQL V12',
      checks,
      http,
      failure: error.message,
      runtimeErrors: runtime.length,
      unexpectedConsoleErrors: consoleErrors.length,
      fixture: {
        scheduleId: schedule?.id,
        appointmentId: appointment?.id,
        futureDate,
      },
    }
  } finally {
    await page.context().setOffline(false)
    await page.unroute(summaryPattern)
    await page.unroute(notificationPattern)
    page.off('response', observe)
    page.off('pageerror', onError)
    page.off('console', onConsole)
  }
}
