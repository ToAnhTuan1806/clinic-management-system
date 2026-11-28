// MOCK ONLY. Intercepts every /api/v1 request; no live backend integration.
// Shared by Playwright CLI and Playwright MCP. Never returns or logs tokens.

export async function runAuthMockQA(
  page,
  { baseURL = 'http://127.0.0.1:5174', screenshotDir } = {},
) {
  // Self-contained assertions let this same runner execute in MCP's isolated VM.
  const poll = async (predicate, label) => {
    const end = Date.now() + 6000
    while (Date.now() < end) {
      try {
        if (await predicate()) return
      } catch {
        /* Wait for the target to settle. */
      }
      await page.waitForTimeout(50)
    }
    throw new Error(`MOCK assertion failed: ${label}`)
  }
  const expect = (value) => {
    const checkClass = async (pattern, inverted = false) =>
      poll(
        async () =>
          pattern.test((await value.getAttribute('class')) || '') !== inverted,
        'class',
      )
    return {
      toBe: (expected) => {
        if (value !== expected)
          throw new Error('MOCK assertion failed: boolean/value')
      },
      toEqual: (expected) => {
        if (JSON.stringify(value) !== JSON.stringify(expected))
          throw new Error('MOCK assertion failed: structure')
      },
      toBeVisible: () => value.waitFor({ state: 'visible', timeout: 6000 }),
      toBeFocused: () =>
        poll(
          () => value.evaluate((element) => element === document.activeElement),
          'focus',
        ),
      toBeDisabled: () => poll(() => value.isDisabled(), 'disabled'),
      toHaveURL: (pattern) => poll(() => pattern.test(value.url()), 'URL'),
      toHaveCount: (count) =>
        poll(async () => (await value.count()) === count, 'count'),
      toHaveText: (text) =>
        poll(async () => (await value.innerText()).trim() === text, 'text'),
      toHaveAttribute: (name, expected) =>
        poll(
          async () => (await value.getAttribute(name)) === expected,
          'attribute',
        ),
      toHaveClass: (pattern) => checkClass(pattern),
      not: { toHaveClass: (pattern) => checkClass(pattern, true) },
    }
  }
  const checks = []
  const runtimeErrors = []
  const onError = () => runtimeErrors.push('Uncaught browser error')
  page.on('pageerror', onError)
  const token = globalThis.crypto.randomUUID()
  const password = globalThis.crypto.randomUUID()
  const model = {
    role: 'PATIENT',
    login: 'success',
    register: 'success',
    meStatus: 200,
    loginGate: null,
    loginCalls: 0,
    registerCalls: 0,
    meCalls: 0,
    validBearer: true,
    registerKeys: [],
    unexpectedCalls: 0,
  }
  const origin = new URL(baseURL).origin
  const pattern = `${origin}/api/v1/**`
  await page.unroute(pattern)
  await page.route(pattern, async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const problem = (status, code, errors) =>
      route.fulfill({
        status,
        contentType: 'application/problem+json',
        body: JSON.stringify({ status, code, errors }),
      })
    const success = (data, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({ data }),
      })
    if (path === '/api/v1/auth/login' && request.method() === 'POST') {
      model.loginCalls++
      if (model.loginGate) await model.loginGate
      if (model.login === 'network') return route.abort('failed')
      if (model.login === 'wrong') return problem(401, 'INVALID_CREDENTIALS')
      if (model.login === 'malformed') return success({})
      return success({ accessToken: token })
    }
    if (path === '/api/v1/auth/register' && request.method() === 'POST') {
      model.registerCalls++
      model.registerKeys = Object.keys(request.postDataJSON()).sort()
      if (model.register === 'network') return route.abort('failed')
      if (model.register === 'duplicate')
        return problem(409, 'EMAIL_ALREADY_EXISTS')
      if (model.register === 'validation')
        return problem(400, 'VALIDATION_FAILED', [
          { field: 'fullName', message: 'MOCK validation' },
        ])
      return success(
        {
          id: 'mock-patient',
          role: model.register === 'elevated' ? 'ADMIN' : 'PATIENT',
        },
        201,
      )
    }
    if (path === '/api/v1/auth/me' && request.method() === 'GET') {
      model.meCalls++
      model.validBearer &&=
        request.headers().authorization === `Bearer ${token}`
      if (model.meStatus !== 200)
        return problem(
          model.meStatus,
          model.meStatus === 401 ? 'AUTHENTICATION_REQUIRED' : 'ACCESS_DENIED',
        )
      return success({
        id: 'mock-user',
        fullName: 'DEMO',
        email: 'demo@clinic.test',
        role: model.role,
      })
    }
    if (path === '/api/v1/dashboard/summary' && request.method() === 'GET') {
      const url = new URL(request.url())
      return success({
        from: url.searchParams.get('from') ?? '2026-11-01',
        to: url.searchParams.get('to') ?? '2026-11-28',
        timezone: 'Asia/Ho_Chi_Minh',
        totalAppointments: 0,
        appointmentsByStatus: {
          PENDING: 0,
          CONFIRMED: 0,
          CHECKED_IN: 0,
          IN_PROGRESS: 0,
          COMPLETED: 0,
          CANCELLED: 0,
          NO_SHOW: 0,
        },
        checkedInCount: 0,
        completedCount: 0,
        uniquePatients: 0,
      })
    }
    if (path === '/api/v1/notifications' && request.method() === 'GET') {
      return success({
        items: [],
        page: 0,
        size: 20,
        totalElements: 0,
        totalPages: 0,
        unreadCount: 0,
      })
    }
    model.unexpectedCalls++
    return route.abort('blockedbyclient')
  })
  const check = async (label, task) => {
    try {
      await task()
    } catch (error) {
      throw new Error(
        `${label}: ${error.message}; completed checks: ${checks.length}`,
      )
    }
    checks.push({ label, result: 'PASS', source: 'API MOCK' })
  }
  const go = async (path) => {
    await page.goto(baseURL + path)
    await page.locator('h1').waitFor()
  }
  const fillLogin = async () => {
    await page.getByLabel('Email', { exact: true }).fill('demo@clinic.test')
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password)
  }
  const loginAs = async (role) => {
    model.role = role
    model.login = 'success'
    model.meStatus = 200
    await go('/login')
    // Default-home test: clear a previous authorized return destination.
    await page.evaluate(() => {
      history.replaceState(null, '', location.href)
      dispatchEvent(new PopStateEvent('popstate'))
    })
    await fillLogin()
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
    await expect(page).toHaveURL(
      new RegExp(role === 'PATIENT' ? '/booking$' : '/dashboard$'),
    )
    await page.locator('h1').waitFor()
  }
  const nav = () => page.getByRole('navigation', { name: 'Điều hướng chính' })
  const spaPath = async (path) =>
    page.evaluate((value) => {
      history.pushState(null, '', value)
      dispatchEvent(new PopStateEvent('popstate'))
    }, path)
  const storageSafe = async () =>
    page.evaluate(
      () =>
        Object.keys(localStorage).every((key) => key === 'clinic-theme') &&
        sessionStorage.length === 0,
    )
  const screenshot = async (name) => {
    if (!screenshotDir) return
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({
      path: `${screenshotDir}/${name}`,
      fullPage: true,
      animations: 'disabled',
    })
  }
  try {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.emulateMedia({
      reducedMotion: 'no-preference',
      colorScheme: 'light',
    })
    await check('Unauthenticated direct URL redirects to Login', async () => {
      await go('/patients')
      await expect(page).toHaveURL(/\/login$/)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'Chào mừng trở lại',
      )
    })
    await check(
      'Login validation and focus; no request on invalid form',
      async () => {
        const before = model.loginCalls
        await page
          .getByRole('button', { name: 'Đăng nhập', exact: true })
          .click()
        await expect(
          page.getByText('Vui lòng nhập email.', { exact: true }),
        ).toBeVisible()
        await expect(
          page.getByText('Vui lòng nhập mật khẩu.', { exact: true }),
        ).toBeVisible()
        await expect(page.getByLabel('Email', { exact: true })).toBeFocused()
        await page.getByLabel('Email', { exact: true }).fill('invalid')
        await page.getByLabel('Mật khẩu', { exact: true }).fill('x')
        await page
          .getByRole('button', { name: 'Đăng nhập', exact: true })
          .click()
        await expect(
          page.getByText('Vui lòng nhập email hợp lệ.', { exact: true }),
        ).toBeVisible()
        expect(model.loginCalls === before).toBe(true)
        await screenshot('login-validation-desktop.png')
      },
    )
    await check('Password visibility and keyboard Enter submits', async () => {
      await fillLogin()
      await page
        .getByRole('button', { name: 'Hiện mật khẩu', exact: true })
        .click()
      await expect(
        page.getByLabel('Mật khẩu', { exact: true }),
      ).toHaveAttribute('type', 'text')
      await page
        .getByRole('button', { name: 'Ẩn mật khẩu', exact: true })
        .click()
      await expect(
        page.getByLabel('Mật khẩu', { exact: true }),
      ).toHaveAttribute('type', 'password')
      model.login = 'wrong'
      await page.getByLabel('Mật khẩu', { exact: true }).press('Enter')
      await expect(
        page.getByText('Email hoặc mật khẩu không đúng.', { exact: true }),
      ).toBeVisible()
      await expect(page.locator('[data-slot=alert]')).toBeFocused()
      await expect(page).toHaveURL(/\/login$/)
    })
    await check(
      'Login network error and malformed success never authenticate',
      async () => {
        model.login = 'network'
        await page
          .getByRole('button', { name: 'Đăng nhập', exact: true })
          .click()
        await expect(
          page.getByText(
            'Không thể kết nối dịch vụ. Kiểm tra mạng và thử lại.',
            { exact: true },
          ),
        ).toBeVisible()
        model.login = 'malformed'
        await page
          .getByRole('button', { name: 'Đăng nhập', exact: true })
          .click()
        await expect(
          page.getByText(
            'Phản hồi xác thực không hợp lệ. Vui lòng thử lại sau.',
            { exact: true },
          ),
        ).toBeVisible()
        await expect(page).toHaveURL(/\/login$/)
      },
    )
    await check(
      'Register validation, matching confirmation, no privileged role selection',
      async () => {
        await go('/register')
        await page
          .getByRole('button', { name: 'Đăng ký tài khoản', exact: true })
          .click()
        await expect(
          page.getByText('Vui lòng nhập họ tên, tối đa 120 ký tự.', {
            exact: true,
          }),
        ).toBeVisible()
        await expect(
          page.getByLabel('Họ và tên', { exact: true }),
        ).toBeFocused()
        await page.getByLabel('Họ và tên', { exact: true }).fill('DEMO Patient')
        await page.getByLabel('Email', { exact: true }).fill('demo@clinic.test')
        await page.getByLabel('Mật khẩu', { exact: true }).fill('short')
        await page
          .getByLabel('Xác nhận mật khẩu', { exact: true })
          .fill('different')
        await page
          .getByRole('button', { name: 'Đăng ký tài khoản', exact: true })
          .click()
        await expect(
          page.getByText('Mật khẩu cần ít nhất 12 ký tự.', { exact: true }),
        ).toBeVisible()
        await expect(
          page.getByText('Xác nhận mật khẩu không khớp.', { exact: true }),
        ).toBeVisible()
        expect(model.registerCalls === 0).toBe(true)
        await expect(page.getByRole('combobox')).toHaveCount(0)
        await expect(page.locator('input[name=role]')).toHaveCount(0)
        await expect(
          page.getByText('Dành cho bệnh nhân đăng ký mới', { exact: true }),
        ).toBeVisible()
        await page.getByLabel('Mật khẩu', { exact: true }).fill(password)
        await page
          .getByLabel('Xác nhận mật khẩu', { exact: true })
          .fill(password)
      },
    )
    await check(
      'Register maps network, duplicate email and Problem Details field errors',
      async () => {
        for (const [mode, message] of [
          ['network', 'Không thể kết nối dịch vụ. Kiểm tra mạng và thử lại.'],
          ['duplicate', 'Email này đã được sử dụng. Vui lòng dùng email khác.'],
          [
            'validation',
            'Họ tên không đáp ứng yêu cầu. Vui lòng kiểm tra lại.',
          ],
        ]) {
          model.register = mode
          await page
            .getByRole('button', { name: 'Đăng ký tài khoản', exact: true })
            .click()
          await expect(
            page.getByText(message, { exact: true }).first(),
          ).toBeVisible()
          await expect(page).toHaveURL(/\/register$/)
        }
        model.register = 'elevated'
        await page
          .getByRole('button', { name: 'Đăng ký tài khoản', exact: true })
          .click()
        await expect(
          page.getByText(
            'Phản hồi xác thực không hợp lệ. Vui lòng thử lại sau.',
            { exact: true },
          ),
        ).toBeVisible()
      },
    )
    await check(
      'Register PATIENT success redirects to Login with explicit MOCK notice',
      async () => {
        model.register = 'success'
        await page
          .getByRole('button', { name: 'Đăng ký tài khoản', exact: true })
          .click()
        await expect(page).toHaveURL(/\/login$/)
        await expect(
          page.getByText(
            'DEMO · API mock đã phản hồi đăng ký PATIENT. Chưa xác minh với Backend thật.',
            { exact: true },
          ),
        ).toBeVisible()
        expect(model.registerKeys).toEqual(['email', 'fullName', 'password'])
      },
    )
    await check(
      'Loading and double-submit lock; /me validates identity before entry',
      async () => {
        model.login = 'success'
        model.role = 'PATIENT'
        let release
        model.loginGate = new Promise((resolve) => {
          release = resolve
        })
        const before = model.loginCalls
        try {
          await fillLogin()
          await page
            .getByRole('button', { name: 'Đăng nhập', exact: true })
            .click()
          await expect(
            page.getByRole('button', { name: 'Đang đăng nhập…', exact: true }),
          ).toBeDisabled()
          await expect(page.locator('form')).toHaveAttribute(
            'aria-busy',
            'true',
          )
          await page.locator('form').evaluate((form) => {
            form.requestSubmit()
            form.requestSubmit()
          })
          await screenshot('login-loading-desktop.png')
        } finally {
          release()
          model.loginGate = null
        }
        await expect(page).toHaveURL(/\/booking$/)
        expect(model.loginCalls === before + 1).toBe(true)
        expect(model.validBearer).toBe(true)
        expect(await storageSafe()).toBe(true)
        expect((await page.locator('body').innerText()).includes(token)).toBe(
          false,
        )
      },
    )
    await check(
      '403 keeps session and shows missing permission; 401 clears and redirects',
      async () => {
        await nav().getByRole('link', { name: 'Cài đặt', exact: true }).click()
        model.meStatus = 403
        await page
          .getByRole('button', { name: 'Kiểm tra phiên', exact: true })
          .click()
        await expect(
          page.getByText('Bạn không có quyền thực hiện thao tác này.', {
            exact: true,
          }),
        ).toBeVisible()
        await expect(
          page.getByRole('button', { name: 'Đăng xuất', exact: true }),
        ).toBeVisible()
        await expect(page).toHaveURL(/\/settings$/)
        await page
          .getByRole('button', { name: 'Đóng thông báo', exact: true })
          .click()
        model.meStatus = 401
        await page
          .getByRole('button', { name: 'Kiểm tra phiên', exact: true })
          .click()
        await expect(page).toHaveURL(/\/login$/)
        await expect(
          page.getByText(
            'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
            { exact: true },
          ),
        ).toBeVisible()
        expect(
          await page.evaluate(async () => {
            const { getAuthSnapshot } =
              await import('/src/auth/session-store.ts')
            const state = getAuthSnapshot()
            return state.accessToken === null && state.user === null
          }),
        ).toBe(true)
      },
    )
    await check(
      'All four roles enter the correct workspace and guard direct SPA URLs',
      async () => {
        for (const role of ['ADMIN', 'DOCTOR', 'RECEPTIONIST', 'PATIENT']) {
          await loginAs(role)
          if (role === 'ADMIN') {
            await expect(
              nav().getByRole('link', { name: 'Bệnh nhân', exact: true }),
            ).toBeVisible()
            await screenshot('admin-dashboard-light.png')
          }
          if (role === 'DOCTOR') {
            await expect(page.getByRole('heading', { level: 1 })).toHaveText(
              'Không gian bác sĩ',
            )
            await expect(
              nav().getByRole('link', { name: 'Bệnh nhân', exact: true }),
            ).toHaveCount(0)
          }
          if (role === 'RECEPTIONIST')
            await expect(page.getByRole('heading', { level: 1 })).toHaveText(
              'Không gian lễ tân',
            )
          if (role === 'PATIENT') {
            await expect(
              nav().getByRole('link', { name: 'Tổng quan', exact: true }),
            ).toHaveCount(0)
            await expect(page.getByRole('heading', { level: 1 })).toHaveText(
              'Đặt lịch khám',
            )
          }
          await spaPath(
            role === 'DOCTOR'
              ? '/patients'
              : role === 'PATIENT'
                ? '/dashboard'
                : '/medical-records',
          )
          await expect(page).toHaveURL(/\/forbidden$/)
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(
            'Bạn không có quyền truy cập màn hình này',
          )
          if (role === 'PATIENT') await screenshot('role-forbidden.png')
          await page
            .getByRole('link', { name: 'Về không gian của tôi', exact: true })
            .click()
          await expect(page).toHaveURL(
            new RegExp(role === 'PATIENT' ? '/booking$' : '/dashboard$'),
          )
        }
      },
    )
    await check(
      'Logout and reload remove authentication; history cannot restore it',
      async () => {
        await page
          .getByRole('button', { name: 'Đăng xuất', exact: true })
          .click()
        await expect(page).toHaveURL(/\/login$/)
        await page.goBack()
        await expect(page).toHaveURL(/\/login$/)
        await loginAs('DOCTOR')
        await page.reload()
        await expect(page).toHaveURL(/\/login$/)
        expect(await storageSafe()).toBe(true)
      },
    )
    await check('Keyboard skip link and focus are usable', async () => {
      await go('/login')
      await page.keyboard.press('Tab')
      await expect(
        page.getByRole('link', { name: 'Đến nội dung chính', exact: true }),
      ).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page.locator('#main-content')).toBeFocused()
    })
    await check(
      'Mobile navigation traps focus, closes on Escape and supports logout',
      async () => {
        await page.setViewportSize({ width: 390, height: 844 })
        await loginAs('PATIENT')
        await screenshot('patient-booking-mobile.png')
        const trigger = page.getByRole('button', {
          name: 'Mở menu điều hướng',
          exact: true,
        })
        await trigger.click()
        const dialog = page.getByRole('dialog', { name: 'Menu điều hướng' })
        await expect(dialog).toBeVisible()
        for (let i = 0; i < 12; i++) await page.keyboard.press('Tab')
        expect(
          await dialog.evaluate((element) =>
            element.contains(document.activeElement),
          ),
        ).toBe(true)
        await screenshot('patient-navigation-mobile.png')
        await page.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)
        await expect(trigger).toBeFocused()
        await trigger.click()
        await dialog.getByRole('link', { name: 'Cài đặt', exact: true }).click()
        await expect(page).toHaveURL(/\/settings$/)
        await expect(page.locator('#main-content')).toBeFocused()
        await page.getByRole('button', { name: 'Tối', exact: true }).click()
        await expect(page.locator('html')).toHaveClass(/dark/)
        await page
          .getByRole('button', { name: 'Hệ thống', exact: true })
          .click()
        await page.emulateMedia({ colorScheme: 'dark' })
        await expect(page.locator('html')).toHaveClass(/dark/)
        await page.emulateMedia({ colorScheme: 'light' })
        await expect(page.locator('html')).not.toHaveClass(/dark/)
        await trigger.click()
        await dialog
          .getByRole('button', { name: 'Đăng xuất', exact: true })
          .click()
        await expect(page).toHaveURL(/\/login$/)
      },
    )
    await check(
      'Responsive Light/Dark auth pages at 320/390/768/1440px',
      async () => {
        for (const width of [320, 390, 768, 1440]) {
          await page.setViewportSize({ width, height: 900 })
          for (const path of ['/login', '/register']) {
            await go(path)
            for (let scheme = 0; scheme < 2; scheme++) {
              expect(
                await page.evaluate(
                  () =>
                    document.documentElement.scrollWidth <=
                    document.documentElement.clientWidth,
                ),
              ).toBe(true)
              await page
                .getByRole('button', {
                  name: 'Chuyển giao diện sáng hoặc tối',
                  exact: true,
                })
                .click()
            }
          }
        }
        await page.setViewportSize({ width: 390, height: 844 })
        await go('/register')
        if (
          !(await page
            .locator('html')
            .evaluate((element) => element.classList.contains('dark')))
        )
          await page
            .getByRole('button', {
              name: 'Chuyển giao diện sáng hoặc tối',
              exact: true,
            })
            .click()
        await screenshot('register-mobile-dark.png')
      },
    )
    await check('Reduced motion disables loading animation', async () => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await go('/login')
      await fillLogin()
      model.login = 'success'
      let release
      model.loginGate = new Promise((resolve) => {
        release = resolve
      })
      try {
        await page
          .getByRole('button', { name: 'Đăng nhập', exact: true })
          .click()
        await expect(
          page.getByRole('button', { name: 'Đang đăng nhập…', exact: true }),
        ).toBeVisible()
        expect(
          await page
            .locator('.animate-spin')
            .evaluate(
              (element) => getComputedStyle(element).animationName === 'none',
            ),
        ).toBe(true)
      } finally {
        release()
        model.loginGate = null
      }
      await expect(page).toHaveURL(/\/booking$/)
    })
    expect(runtimeErrors.length === 0).toBe(true)
    expect(model.unexpectedCalls === 0).toBe(true)
    expect(await storageSafe()).toBe(true)
    return {
      label: 'API MOCK ONLY — NOT A REAL BACKEND TEST',
      checks,
      runtimeErrors: runtimeErrors.length,
      requestSummary: {
        login: model.loginCalls,
        register: model.registerCalls,
        me: model.meCalls,
        unexpected: model.unexpectedCalls,
      },
      tokensLogged: false,
    }
  } finally {
    page.removeListener('pageerror', onError)
    await page.unroute(pattern)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
  }
}
