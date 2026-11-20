// REAL HTTP QA ONLY. No route.fulfill, mock server or database writes outside Register.
// Credentials stay in volatile browser/runner memory and are never returned or logged.
export async function runRealAuthQA(
  page,
  {
    phase,
    baseURL = 'http://127.0.0.1:5175',
    apiURL = 'http://127.0.0.1:8080',
    screenshotDir,
  } = {},
) {
  page.setDefaultTimeout(8000)
  const checks = []
  const http = []
  page.__clinicRealResults = { phase, checks, http }
  const runtimeErrors = []
  const onError = () => runtimeErrors.push('Uncaught runtime error')
  const onResponse = (response) => {
    const url = new URL(response.url())
    if (url.origin === apiURL && url.pathname.startsWith('/api/v1/'))
      http.push({
        method: response.request().method(),
        path: url.pathname,
        status: response.status(),
      })
  }
  page.on('response', onResponse)
  page.on('pageerror', onError)
  const assert = (value, label) => {
    if (!value) throw new Error(label)
  }
  const wait = async (predicate) => {
    const end = Date.now() + 7000
    while (Date.now() < end) {
      if (await predicate()) return
      await page.waitForTimeout(50)
    }
    throw new Error('condition timed out')
  }
  const check = async (label, action) => {
    try {
      await action()
    } catch {
      throw new Error(`REAL API QA failed: ${label}`)
    }
    checks.push({ label, result: 'PASS', source: 'REAL HTTP + MYSQL' })
  }
  const visible = (locator) => locator.waitFor({ state: 'visible' })
  const fill = async (label, value) => {
    try {
      await page.getByLabel(label, { exact: true }).fill(value)
    } catch {
      throw new Error('field interaction failed')
    }
  }
  const spa = (path) =>
    page.evaluate((value) => {
      history.pushState(null, '', value)
      dispatchEvent(new PopStateEvent('popstate'))
    }, path)
  const responseFor = (path, method = 'POST') =>
    page.waitForResponse(
      (response) =>
        response.url() === apiURL + path &&
        response.request().method() === method,
    )
  const loginButton = () =>
    page.getByRole('button', { name: 'Đăng nhập', exact: true })
  const registerButton = () =>
    page.getByRole('button', { name: 'Đăng ký tài khoản', exact: true })
  const nav = () => page.getByRole('navigation', { name: 'Điều hướng chính' })
  const storageSafe = () =>
    page.evaluate(
      () =>
        Object.keys(localStorage).every((key) => key === 'clinic-theme') &&
        sessionStorage.length === 0,
    )
  const shot = async (name) => {
    if (!screenshotDir) return
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({
      path: `${screenshotDir}/${name}`,
      fullPage: true,
      animations: 'disabled',
      mask: [
        page.locator('input[name=password]'),
        page.locator('input[name=confirmPassword]'),
      ],
    })
  }
  const fillLogin = async (identity) => {
    await fill('Email', identity.email)
    await fill('Mật khẩu', identity.password)
  }
  const fillRegister = async (identity) => {
    await fill('Họ và tên', identity.fullName)
    await fill('Email', identity.email)
    await fill('Mật khẩu', identity.password)
    await fill('Xác nhận mật khẩu', identity.password)
  }
  const enter = async (identity) => {
    await spa('/login')
    await visible(
      page.getByRole('heading', { name: 'Chào mừng trở lại', level: 1 }),
    )
    await fillLogin(identity)
    const response = responseFor('/api/v1/auth/login')
    await loginButton().click()
    assert((await response).status() === 200, 'login HTTP status')
    await wait(() => !new URL(page.url()).pathname.endsWith('/login'))
  }
  const delayRealPost = async (path, action) => {
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const handler = async (route) => {
      if (route.request().method() === 'POST') await gate
      await route.continue()
    }
    await page.route(apiURL + path, handler)
    try {
      await action(release)
    } finally {
      release()
      await page.unroute(apiURL + path, handler)
    }
  }
  try {
    if (phase === 'ui-setup') {
      await page.evaluate(async () => {
        const identity = {
          email: `fe-d02-final-${crypto.randomUUID()}@example.invalid`,
          password: crypto.randomUUID(),
          fullName: 'QA FE D02 UI Retest',
          id: null,
        }
        const response = await fetch(
          'http://127.0.0.1:8080/api/v1/auth/register',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: identity.email,
              password: identity.password,
              fullName: identity.fullName,
            }),
          },
        )
        const body = await response.json()
        if (
          response.status !== 201 ||
          body.data?.role !== 'PATIENT' ||
          body.data?.status !== 'ACTIVE'
        )
          throw new Error('QA account setup failed')
        identity.id = body.data.id
        Object.defineProperty(window, '__clinicRealQA', {
          configurable: true,
          value: identity,
        })
      })
      checks.push({
        label:
          'UI retest identity created through real public PATIENT Register, without SQL or role elevation',
        result: 'PASS',
        source: 'REAL HTTP + MYSQL',
      })
    } else if (phase === 'register') {
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.goto(baseURL + '/login')
      await visible(
        page.getByRole('heading', { name: 'Chào mừng trở lại', level: 1 }),
      )
      await page.evaluate(() =>
        Object.defineProperty(window, '__clinicRealQA', {
          configurable: true,
          value: {
            email: `fe-d02-final-${crypto.randomUUID()}@example.invalid`,
            password: crypto.randomUUID(),
            fullName: 'QA FE D02 Synthetic',
            id: null,
          },
        }),
      )
      const identity = await page.evaluate(() => window.__clinicRealQA)
      await check(
        'ProtectedRoute sends anonymous access to Login',
        async () => {
          await spa('/patients')
          await visible(
            page.getByRole('heading', { name: 'Chào mừng trở lại', level: 1 }),
          )
          assert(
            new URL(page.url()).pathname === '/login',
            'anonymous redirect',
          )
        },
      )
      await check(
        'Register client validation matches D02, including UTF-8 bytes',
        async () => {
          await page
            .getByRole('link', { name: 'Đăng ký bệnh nhân', exact: true })
            .click()
          await registerButton().click()
          await visible(
            page.getByText('Vui lòng nhập họ tên, tối đa 120 ký tự.', {
              exact: true,
            }),
          )
          await wait(() =>
            page
              .getByLabel('Họ và tên', { exact: true })
              .evaluate((element) => document.activeElement === element),
          )
          await fillRegister(identity)
          await fill('Mật khẩu', identity.password.slice(0, 8))
          await registerButton().click()
          await visible(
            page.getByText('Mật khẩu cần ít nhất 12 ký tự.', { exact: true }),
          )
          await fill('Mật khẩu', 'á'.repeat(37))
          await registerButton().click()
          await visible(
            page.getByText('Mật khẩu không vượt quá 72 byte UTF-8.', {
              exact: true,
            }),
          )
          assert(
            !http.some((event) => event.path === '/api/v1/auth/register'),
            'invalid form sent request',
          )
          await shot('register-validation-desktop.png')
        },
      )
      await check(
        'Register creates PATIENT ACTIVE with real 201 and only allowed fields',
        async () => {
          await fillRegister(identity)
          const responsePromise = responseFor('/api/v1/auth/register')
          await delayRealPost('/api/v1/auth/register', async (release) => {
            await registerButton().click()
            await visible(
              page.getByRole('button', { name: 'Đang đăng ký…', exact: true }),
            )
            assert(
              (await page.locator('form').getAttribute('aria-busy')) === 'true',
              'register loading',
            )
            await page.locator('form').evaluate((form) => {
              form.requestSubmit()
              form.requestSubmit()
            })
            await shot('register-loading-real.png')
            release()
            const response = await responsePromise
            assert(response.status() === 201, 'register status')
            const body = await response.json()
            assert(
              body.data?.role === 'PATIENT' &&
                body.data?.status === 'ACTIVE' &&
                typeof body.data?.id === 'string',
              'register contract',
            )
            assert(
              Object.keys(body.data).sort().join(',') ===
                'email,fullName,id,role,status',
              'public user fields',
            )
            assert(
              Object.keys(response.request().postDataJSON())
                .sort()
                .join(',') === 'email,fullName,password',
              'register payload whitelist',
            )
            assert(
              !response.request().headers().authorization,
              'public request had Bearer',
            )
            const remote = await response.serverAddr()
            assert(remote?.port === 8080, 'response did not come from backend')
            await page.evaluate((id) => {
              window.__clinicRealQA.id = id
            }, body.data.id)
          })
          await visible(
            page.getByText(
              'Đăng ký hoàn tất. Bạn có thể đăng nhập bằng tài khoản vừa tạo.',
              { exact: true },
            ),
          )
          assert(
            new URL(page.url()).pathname === '/login',
            'register success redirect',
          )
          assert(
            http.filter(
              (event) =>
                event.path === '/api/v1/auth/register' && event.status === 201,
            ).length === 1,
            'double submit created extra request',
          )
          await shot('register-success-real.png')
        },
      )
      await check(
        'Duplicate email receives real 409 EMAIL_ALREADY_EXISTS and inline feedback',
        async () => {
          await page
            .getByRole('link', { name: 'Đăng ký bệnh nhân', exact: true })
            .click()
          await fillRegister(identity)
          await fill('Email', ` ${identity.email.toUpperCase()} `)
          const responsePromise = responseFor('/api/v1/auth/register')
          await registerButton().click()
          const response = await responsePromise
          assert(
            response.status() === 409 &&
              (await response.json()).code === 'EMAIL_ALREADY_EXISTS',
            'duplicate status/code',
          )
          await visible(
            page
              .getByText(
                'Email này đã được sử dụng. Vui lòng dùng email khác.',
                { exact: true },
              )
              .first(),
          )
          await shot('duplicate-email-real.png')
        },
      )
    } else {
      const identity = await page.evaluate(() => window.__clinicRealQA)
      assert(
        identity?.email && identity?.password,
        'volatile QA identity unavailable',
      )
      if (phase === 'login') {
        await check(
          'Wrong password receives real 401 INVALID_CREDENTIALS without a session',
          async () => {
            await spa('/login')
            await visible(
              page.getByRole('heading', {
                name: 'Chào mừng trở lại',
                level: 1,
              }),
            )
            await fillLogin(identity)
            await fill(
              'Mật khẩu',
              await page.evaluate(() => crypto.randomUUID()),
            )
            const responsePromise = responseFor('/api/v1/auth/login')
            await page.getByLabel('Mật khẩu', { exact: true }).press('Enter')
            const response = await responsePromise
            assert(
              response.status() === 401 &&
                (await response.json()).code === 'INVALID_CREDENTIALS',
              'wrong-password status/code',
            )
            await visible(
              page.getByText('Email hoặc mật khẩu không đúng.', {
                exact: true,
              }),
            )
            assert(
              await page.evaluate(
                async () =>
                  (await import('/src/auth/session-store.ts')).getAuthSnapshot()
                    .accessToken === null,
              ),
              'wrong password authenticated',
            )
            await shot('login-error-real.png')
          },
        )
        await check(
          'Correct login and Bearer /me validate real JWT, public DTO and PATIENT redirect',
          async () => {
            await fillLogin(identity)
            await page
              .getByRole('button', { name: 'Hiện mật khẩu', exact: true })
              .click()
            assert(
              (await page
                .getByLabel('Mật khẩu', { exact: true })
                .getAttribute('type')) === 'text',
              'password visibility',
            )
            await page
              .getByRole('button', { name: 'Ẩn mật khẩu', exact: true })
              .click()
            const loginResponse = responseFor('/api/v1/auth/login')
            const meResponse = responseFor('/api/v1/auth/me', 'GET')
            await delayRealPost('/api/v1/auth/login', async (release) => {
              await loginButton().click()
              await visible(
                page.getByRole('button', {
                  name: 'Đang đăng nhập…',
                  exact: true,
                }),
              )
              assert(
                await page
                  .getByRole('button', { name: 'Đang đăng nhập…', exact: true })
                  .isDisabled(),
                'login loading lock',
              )
              await page.locator('form').evaluate((form) => {
                form.requestSubmit()
                form.requestSubmit()
              })
              await shot('login-loading-real.png')
              release()
              const login = await loginResponse
              assert(login.status() === 200, 'login status')
              const body = await login.json()
              assert(
                body.data?.tokenType === 'Bearer' &&
                  body.data?.expiresIn === 1800 &&
                  body.data?.accessToken?.split('.').length === 3,
                'login token contract',
              )
              assert(
                body.data.user?.role === 'PATIENT' &&
                  body.data.user?.status === 'ACTIVE',
                'login user',
              )
              const me = await meResponse
              assert(
                me.status() === 200 &&
                  (await me.json()).data?.id === identity.id,
                'me identity',
              )
              assert(
                me.request().headers().authorization ===
                  `Bearer ${body.data.accessToken}`,
                'me Bearer',
              )
              assert(
                (await me.allHeaders())['cache-control']?.includes('no-store'),
                'me caching',
              )
              assert(
                !(await login.allHeaders())['set-cookie'],
                'unexpected auth cookie',
              )
              assert(
                !(await page.locator('body').innerText()).includes(
                  body.data.accessToken,
                ),
                'token visible in UI',
              )
            })
            await visible(
              page.getByRole('heading', { name: 'Đặt lịch khám', level: 1 }),
            )
            assert(new URL(page.url()).pathname === '/booking', 'patient home')
            assert(await storageSafe(), 'auth persisted in browser storage')
            await shot('patient-booking-real.png')
          },
        )
        await check(
          'RoleGuard rejects real PATIENT session on staff dashboard',
          async () => {
            assert(
              (await nav()
                .getByRole('link', { name: 'Tổng quan', exact: true })
                .count()) === 0,
              'staff navigation visible',
            )
            await spa('/dashboard')
            await visible(
              page.getByRole('heading', {
                name: 'Bạn không có quyền truy cập màn hình này',
                level: 1,
              }),
            )
            await shot('patient-role-guard-real.png')
            await page
              .getByRole('link', { name: 'Về không gian của tôi', exact: true })
              .click()
            await visible(
              page.getByRole('heading', { name: 'Đặt lịch khám', level: 1 }),
            )
          },
        )
        await check(
          'Real 403 from a denyAll API shows permission feedback and keeps the session',
          async () => {
            await nav()
              .getByRole('link', { name: 'Cài đặt', exact: true })
              .click()
            const outcome = await page.evaluate(async () => {
              const { apiClient } = await import('/src/lib/api-client.ts')
              try {
                await apiClient.get('/api/v1/patients')
                return { status: 200 }
              } catch (error) {
                return { status: error.status, code: error.code }
              }
            })
            assert(
              outcome.status === 403 && outcome.code === 'ACCESS_DENIED',
              '403 status/code',
            )
            await visible(page.getByText('Không đủ quyền', { exact: true }))
            assert(
              await page.evaluate(
                async () =>
                  (await import('/src/auth/session-store.ts')).getAuthSnapshot()
                    .status === 'authenticated',
              ),
              '403 cleared auth',
            )
            await shot('permission-403-real.png')
            await page
              .getByRole('button', { name: 'Đóng thông báo', exact: true })
              .click()
          },
        )
      } else if (phase === 'security') {
        await check(
          'Real invalid-JWT 401 clears token/user and redirects to Login',
          async () => {
            const outcome = await page.evaluate(async () => {
              const { apiClient } = await import('/src/lib/api-client.ts')
              const { getAuthSnapshot } =
                await import('/src/auth/session-store.ts')
              const current = getAuthSnapshot()
              const parts = current.accessToken.split('.')
              parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1)
              try {
                await apiClient.get('/api/v1/auth/me', {
                  authMode: 'candidate',
                  authSessionVersion: current.version,
                  headers: { Authorization: `Bearer ${parts.join('.')}` },
                })
                return { status: 200 }
              } catch (error) {
                const state = getAuthSnapshot()
                return {
                  status: error.status,
                  code: error.code,
                  cleared: state.accessToken === null && state.user === null,
                }
              }
            })
            assert(
              outcome.status === 401 &&
                outcome.code === 'INVALID_ACCESS_TOKEN' &&
                outcome.cleared,
              '401 status/state',
            )
            await visible(
              page.getByText(
                'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
                { exact: true },
              ),
            )
            assert(new URL(page.url()).pathname === '/login', '401 redirect')
            await shot('invalid-jwt-401-real.png')
          },
        )
        await check(
          'Logout clears the real session locally and ProtectedRoute blocks reuse',
          async () => {
            await enter(identity)
            await page
              .getByRole('button', { name: 'Đăng xuất', exact: true })
              .click()
            await visible(
              page.getByRole('heading', {
                name: 'Chào mừng trở lại',
                level: 1,
              }),
            )
            assert(
              await page.evaluate(async () => {
                const s = (
                  await import('/src/auth/session-store.ts')
                ).getAuthSnapshot()
                return s.accessToken === null && s.user === null
              }),
              'logout state',
            )
            await spa('/settings')
            await wait(() => new URL(page.url()).pathname === '/login')
            assert(await storageSafe(), 'logout storage')
            assert(
              !http.some((event) => event.path.endsWith('/logout')),
              'unimplemented logout endpoint called',
            )
          },
        )
        await check(
          'Offline network fault gives a retryable error without fabricating an API response',
          async () => {
            await fillLogin(identity)
            await page.context().setOffline(true)
            try {
              await loginButton().click()
              await visible(
                page.getByText(
                  'Không thể kết nối dịch vụ. Kiểm tra mạng và thử lại.',
                  { exact: true },
                ),
              )
              await shot('offline-error-ui.png')
            } finally {
              await page.context().setOffline(false)
            }
            const health = await page.evaluate(
              async () =>
                (await fetch('http://127.0.0.1:8080/api/v1/health')).status,
            )
            assert(health === 200, 'network not restored')
            assert(
              new URL(page.url()).pathname === '/login',
              'offline login authenticated',
            )
          },
        )
      } else if (phase === 'ui') {
        await check(
          'Reduced-motion loading still completes a real login',
          async () => {
            await page.emulateMedia({ reducedMotion: 'reduce' })
            await fillLogin(identity)
            await delayRealPost('/api/v1/auth/login', async (release) => {
              await loginButton().click()
              await visible(
                page.getByRole('button', {
                  name: 'Đang đăng nhập…',
                  exact: true,
                }),
              )
              assert(
                await page
                  .locator('.animate-spin')
                  .evaluate(
                    (element) =>
                      getComputedStyle(element).animationName === 'none',
                  ),
                'reduced motion',
              )
              release()
              await wait(() => new URL(page.url()).pathname !== '/login')
            })
            await page.emulateMedia({ reducedMotion: 'no-preference' })
          },
        )
        await check(
          'Mobile navigation and Light/Dark/System work with real PATIENT auth',
          async () => {
            await page.setViewportSize({ width: 390, height: 844 })
            const trigger = page.getByRole('button', {
              name: 'Mở menu điều hướng',
              exact: true,
            })
            await trigger.click()
            const dialog = page.getByRole('dialog', { name: 'Menu điều hướng' })
            await visible(dialog)
            for (let index = 0; index < 12; index++)
              await page.keyboard.press('Tab')
            assert(
              await dialog.evaluate((element) =>
                element.contains(document.activeElement),
              ),
              'focus escaped mobile menu',
            )
            await shot('mobile-navigation-real.png')
            await page.keyboard.press('Escape')
            await wait(() =>
              trigger.evaluate((element) => document.activeElement === element),
            )
            await trigger.click()
            await dialog
              .getByRole('link', { name: 'Cài đặt', exact: true })
              .click()
            await wait(() =>
              page
                .locator('#main-content')
                .evaluate((element) => document.activeElement === element),
            )
            await page.getByRole('button', { name: 'Tối', exact: true }).click()
            await wait(() =>
              page
                .locator('html')
                .evaluate((element) => element.classList.contains('dark')),
            )
            await shot('settings-mobile-dark-real.png')
            await page
              .getByRole('button', { name: 'Sáng', exact: true })
              .click()
            await wait(() =>
              page
                .locator('html')
                .evaluate((element) => !element.classList.contains('dark')),
            )
            await page
              .getByRole('button', { name: 'Hệ thống', exact: true })
              .click()
            await page.emulateMedia({ colorScheme: 'dark' })
            await wait(() =>
              page
                .locator('html')
                .evaluate((element) => element.classList.contains('dark')),
            )
            await page.emulateMedia({ colorScheme: 'light' })
            await wait(() =>
              page
                .locator('html')
                .evaluate((element) => !element.classList.contains('dark')),
            )
            await trigger.click()
            await dialog
              .getByRole('button', { name: 'Đăng xuất', exact: true })
              .click()
            await visible(
              page.getByRole('heading', {
                name: 'Chào mừng trở lại',
                level: 1,
              }),
            )
          },
        )
        await check(
          'Responsive auth forms do not overflow at 320/390/768/1440px in Light and Dark',
          async () => {
            for (const width of [320, 390, 768, 1440]) {
              await page.setViewportSize({ width, height: 900 })
              for (const path of ['/login', '/register']) {
                await spa(path)
                await visible(page.locator('h1'))
                for (let scheme = 0; scheme < 2; scheme++) {
                  assert(
                    await page.evaluate(
                      () =>
                        document.documentElement.scrollWidth <=
                        document.documentElement.clientWidth,
                    ),
                    'horizontal overflow',
                  )
                  await page
                    .getByRole('button', {
                      name: 'Chuyển giao diện sáng hoặc tối',
                      exact: true,
                    })
                    .click()
                }
              }
            }
          },
        )
        await check(
          'Reload forgets the real JWT and no credentials persist in web storage',
          async () => {
            await enter(identity)
            await page.reload()
            await visible(
              page.getByRole('heading', {
                name: 'Chào mừng trở lại',
                level: 1,
              }),
            )
            assert(
              new URL(page.url()).pathname === '/login',
              'reload kept session',
            )
            assert(await storageSafe(), 'persisted auth')
            // RouteEffects can focus main after redirect; start keyboard QA at body.
            await page.locator('body').evaluate((element) => {
              element.tabIndex = -1
              element.focus()
              element.removeAttribute('tabindex')
            })
            await page.keyboard.press('Tab')
            await wait(() =>
              page
                .getByRole('link', { name: 'Đến nội dung chính', exact: true })
                .evaluate((element) => document.activeElement === element),
            )
            await page.keyboard.press('Enter')
            await wait(() =>
              page
                .locator('#main-content')
                .evaluate((element) => document.activeElement === element),
            )
            await shot('login-final-real.png')
          },
        )
      } else throw new Error('Unknown QA phase')
    }
    assert(runtimeErrors.length === 0, 'uncaught runtime errors')
    return {
      source: 'REAL HTTP + MYSQL — NOT MOCK',
      phase,
      checks,
      http,
      runtimeErrors: runtimeErrors.length,
      staffRoles: 'NOT TESTED — no provisioned accounts',
      credentialValuesRecorded: false,
    }
  } finally {
    page.removeListener('response', onResponse)
    page.removeListener('pageerror', onError)
    await page.context().setOffline(false)
  }
}
