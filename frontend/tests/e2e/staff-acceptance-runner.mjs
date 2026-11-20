// Real Chrome + real D02 HTTP only. No mocked responses and no credential output.
// The authorized PowerShell host injects the named WinCred fixture into volatile RAM.
export async function runStaffAcceptance(page, { phase, screenshotDir } = {}) {
  page.setDefaultTimeout(10000)
  const checks = []
  const http = []
  const errors = []
  page.__staffSafeProgress = { phase, checks, http }
  const payload = await page.evaluate(() => window.__staffAcceptance)
  if (!payload?.dbRolesVerified || payload.fixtureId !== '83710bc5bb2e')
    throw new Error('STAFF_QA_PRIVATE_HANDOFF_REQUIRED')
  const apiURL = payload.apiURL
  const observe = (response) => {
    const url = new URL(response.url())
    if (url.origin === apiURL && url.pathname.startsWith('/api/v1/'))
      http.push({
        method: response.request().method(),
        path: url.pathname,
        status: response.status(),
      })
  }
  const observeError = () => errors.push('Uncaught runtime error')
  page.on('response', observe)
  page.on('pageerror', observeError)
  const assert = (value) => {
    if (!value) throw new Error('assertion failed')
  }
  const wait = async (predicate) => {
    const end = Date.now() + 8000
    while (Date.now() < end) {
      if (await predicate()) return
      await page.waitForTimeout(40)
    }
    throw new Error('state did not settle')
  }
  const check = async (label, action) => {
    try {
      await action()
    } catch {
      throw new Error(`REAL STAFF QA failed: ${phase} / ${label}`)
    }
    checks.push({ label, result: 'PASS', source: 'REAL HTTP + QA MYSQL' })
  }
  const visible = (locator) => locator.waitFor({ state: 'visible' })
  const spa = (path) =>
    page.evaluate((value) => {
      history.pushState(null, '', value)
      dispatchEvent(new PopStateEvent('popstate'))
    }, path)
  const fill = async (name, value) => {
    try {
      await page.getByLabel(name, { exact: true }).fill(value)
    } catch {
      throw new Error('sensitive form interaction failed')
    }
  }
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
      mask: [page.locator('input')],
    })
  }
  const responseFor = (path, method = 'POST') =>
    page.waitForResponse(
      (response) =>
        response.url() === apiURL + path &&
        response.request().method() === method,
    )
  const identity = (role) => payload.accounts[role]
  const title = (role) =>
    ({
      ADMIN: 'Tổng quan phòng khám',
      DOCTOR: 'Không gian bác sĩ',
      RECEPTIONIST: 'Không gian lễ tân',
      PATIENT: 'Đặt lịch khám',
    })[role]
  const home = (role) => (role === 'PATIENT' ? '/booking' : '/dashboard')
  const allowed = (role) =>
    ({
      ADMIN: '/patients',
      DOCTOR: '/medical-records',
      RECEPTIONIST: '/patients',
      PATIENT: '/booking',
    })[role]
  const denied = (role) =>
    ({
      ADMIN: '/medical-records',
      DOCTOR: '/patients',
      RECEPTIONIST: '/medical-records',
      PATIENT: '/dashboard',
    })[role]
  const allowedTitle = (role) =>
    ({
      ADMIN: 'Quản lý bệnh nhân',
      DOCTOR: 'Hồ sơ bệnh án',
      RECEPTIONIST: 'Quản lý bệnh nhân',
      PATIENT: 'Đặt lịch khám',
    })[role]
  const stateIsClear = () =>
    page.evaluate(async () => {
      const s = (await import('/src/auth/session-store.ts')).getAuthSnapshot()
      return (
        s.accessToken === null && s.user === null && s.status === 'anonymous'
      )
    })
  async function login(role) {
    await spa('/login')
    await visible(
      page.getByRole('heading', { name: 'Chào mừng trở lại', level: 1 }),
    )
    await fill('Email', identity(role).email)
    await fill('Mật khẩu', identity(role).password)
    const loginResponse = responseFor('/api/v1/auth/login')
    const meResponse = responseFor('/api/v1/auth/me', 'GET')
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
    const response = await loginResponse
    const body = await response.json()
    const me = await meResponse
    const user = (await me.json()).data
    assert(response.status() === 200 && me.status() === 200)
    assert(
      body.data.tokenType === 'Bearer' &&
        body.data.expiresIn === 1800 &&
        body.data.user.role === role,
    )
    assert(
      user.role === role &&
        user.status === 'ACTIVE' &&
        user.email === identity(role).email,
    )
    assert(typeof user.id === 'string' && user.id === body.data.user.id)
    if (payload.databaseIds[role]) assert(user.id === payload.databaseIds[role])
    assert(
      me.request().headers().authorization ===
        `Bearer ${body.data.accessToken}`,
    )
    assert(
      Object.keys(user).sort().join(',') === 'email,fullName,id,role,status',
    )
    assert(!(await response.allHeaders())['set-cookie'])
    assert((await me.allHeaders())['cache-control']?.includes('no-store'))
    assert(
      !(await page.locator('body').innerText()).includes(body.data.accessToken),
    )
    assert((await response.serverAddr())?.port === new URL(apiURL).port * 1)
    await visible(page.getByRole('heading', { name: title(role), level: 1 }))
    assert(new URL(page.url()).pathname === home(role))
    assert(await storageSafe())
  }
  async function logout(mobile = false) {
    if (mobile)
      await page
        .getByRole('button', { name: 'Mở menu điều hướng', exact: true })
        .click()
    await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click()
    await visible(
      page.getByRole('heading', { name: 'Chào mừng trở lại', level: 1 }),
    )
    assert(await stateIsClear())
    assert(await storageSafe())
  }
  try {
    if (phase === 'PATIENT') {
      await page.setViewportSize({ width: 1440, height: 1000 })
      await check(
        'PATIENT register 201, duplicate 409, wrong login 401 on the staff QA stack',
        async () => {
          const patient = await page.evaluate(() => ({
            email: `fe-acceptance-${crypto.randomUUID()}@example.invalid`,
            password: crypto.randomUUID(),
            role: 'PATIENT',
            status: 'ACTIVE',
          }))
          await spa('/register')
          await visible(
            page.getByRole('heading', {
              name: 'Tạo tài khoản bệnh nhân',
              level: 1,
            }),
          )
          const fillRegistration = async () => {
            await fill('Họ và tên', 'QA FE Acceptance Synthetic')
            await fill('Email', patient.email)
            await fill('Mật khẩu', patient.password)
            await fill('Xác nhận mật khẩu', patient.password)
          }
          await fillRegistration()
          const response = responseFor('/api/v1/auth/register')
          await page
            .getByRole('button', { name: 'Đăng ký tài khoản', exact: true })
            .click()
          const registered = await response
          const body = await registered.json()
          assert(
            registered.status() === 201 &&
              body.data.role === 'PATIENT' &&
              body.data.status === 'ACTIVE',
          )
          assert(
            Object.keys(registered.request().postDataJSON())
              .sort()
              .join(',') === 'email,fullName,password',
          )
          payload.accounts.PATIENT = patient
          payload.databaseIds.PATIENT = body.data.id
          await page.evaluate(
            ({ patient, id }) => {
              window.__staffAcceptance.accounts.PATIENT = patient
              window.__staffAcceptance.databaseIds.PATIENT = id
            },
            { patient, id: body.data.id },
          )
          await visible(
            page.getByRole('heading', { name: 'Chào mừng trở lại', level: 1 }),
          )
          await spa('/register')
          await visible(
            page.getByRole('heading', {
              name: 'Tạo tài khoản bệnh nhân',
              level: 1,
            }),
          )
          await fillRegistration()
          const duplicate = responseFor('/api/v1/auth/register')
          await page
            .getByRole('button', { name: 'Đăng ký tài khoản', exact: true })
            .click()
          const duplicateResponse = await duplicate
          assert(
            duplicateResponse.status() === 409 &&
              (await duplicateResponse.json()).code === 'EMAIL_ALREADY_EXISTS',
          )
          await visible(
            page
              .getByText(
                'Email này đã được sử dụng. Vui lòng dùng email khác.',
                { exact: true },
              )
              .first(),
          )
          await spa('/login')
          await visible(
            page.getByRole('heading', { name: 'Chào mừng trở lại', level: 1 }),
          )
          await fill('Email', patient.email)
          await fill('Mật khẩu', await page.evaluate(() => crypto.randomUUID()))
          const rejected = responseFor('/api/v1/auth/login')
          await page
            .getByRole('button', { name: 'Đăng nhập', exact: true })
            .click()
          const wrong = await rejected
          assert(
            wrong.status() === 401 &&
              (await wrong.json()).code === 'INVALID_CREDENTIALS',
          )
          await visible(
            page.getByText('Email hoặc mật khẩu không đúng.', { exact: true }),
          )
          assert(await stateIsClear())
        },
      )
    }
    if (['PATIENT', 'ADMIN', 'DOCTOR', 'RECEPTIONIST'].includes(phase)) {
      const role = phase
      await page.setViewportSize({ width: 1440, height: 1000 })
      await check(
        `${role}: Login 200, Bearer me 200, ACTIVE role matches database and correct home`,
        async () => {
          await login(role)
          await shot(`${role.toLowerCase()}-desktop-real.png`)
        },
      )
      await check(
        `${role}: allowed route works, forbidden direct SPA route shows RoleGuard 403`,
        async () => {
          await spa(allowed(role))
          await wait(() => new URL(page.url()).pathname === allowed(role))
          await visible(
            page.getByRole('heading', {
              name: allowedTitle(role),
              level: 1,
              exact: true,
            }),
          )
          assert((await page.getByRole('heading', { level: 1 }).count()) === 1)
          await spa(denied(role))
          await visible(
            page.getByRole('heading', {
              name: 'Bạn không có quyền truy cập màn hình này',
              level: 1,
            }),
          )
          assert(new URL(page.url()).pathname === '/forbidden')
          await shot(`${role.toLowerCase()}-role-guard.png`)
          await page
            .getByRole('link', { name: 'Về không gian của tôi', exact: true })
            .click()
          await visible(
            page.getByRole('heading', { name: title(role), level: 1 }),
          )
        },
      )
      await check(
        `${role}: real denyAll API 403 keeps session and shows missing permission`,
        async () => {
          const outcome = await page.evaluate(async () => {
            const { apiClient } = await import('/src/lib/api-client.ts')
            try {
              await apiClient.get('/api/v1/patients')
              return { status: 200 }
            } catch (error) {
              return { status: error.status, code: error.code }
            }
          })
          assert(outcome.status === 403 && outcome.code === 'ACCESS_DENIED')
          await visible(page.getByText('Không đủ quyền', { exact: true }))
          assert(
            await page.evaluate(
              async () =>
                (await import('/src/auth/session-store.ts')).getAuthSnapshot()
                  .status === 'authenticated',
            ),
          )
          await page
            .getByRole('button', { name: 'Đóng thông báo', exact: true })
            .click()
        },
      )
      await check(
        `${role}: invalid JWT gets real 401, clears state and redirects`,
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
              return { status: error.status, code: error.code }
            }
          })
          assert(
            outcome.status === 401 && outcome.code === 'INVALID_ACCESS_TOKEN',
          )
          await visible(
            page.getByRole('heading', { name: 'Chào mừng trở lại', level: 1 }),
          )
          assert(await stateIsClear())
          await visible(
            page.getByText(
              'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
              { exact: true },
            ),
          )
        },
      )
      await check(
        `${role}: logout clears client auth and ProtectedRoute blocks reuse`,
        async () => {
          await login(role)
          await logout()
          await spa(allowed(role))
          await wait(() => new URL(page.url()).pathname === '/login')
          assert(await stateIsClear())
          assert(!http.some((event) => event.path.endsWith('/logout')))
        },
      )
      await check(
        `${role}: mobile navigation, keyboard focus and Light/Dark`,
        async () => {
          await login(role)
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
          )
          await shot(`${role.toLowerCase()}-mobile-navigation.png`)
          await page.keyboard.press('Escape')
          await wait(() =>
            trigger.evaluate((element) => document.activeElement === element),
          )
          await trigger.click()
          await dialog
            .getByRole('link', { name: 'Cài đặt', exact: true })
            .click()
          await visible(
            page.getByRole('heading', {
              name: 'Cài đặt không gian làm việc',
              level: 1,
            }),
          )
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
          assert(
            await page.evaluate(
              () =>
                document.documentElement.scrollWidth <=
                document.documentElement.clientWidth,
            ),
          )
          await shot(`${role.toLowerCase()}-mobile-dark.png`)
          await page.getByRole('button', { name: 'Sáng', exact: true }).click()
          await wait(() =>
            page
              .locator('html')
              .evaluate((element) => !element.classList.contains('dark')),
          )
          await logout(true)
        },
      )
    } else if (phase === 'public-regression') {
      await page.setViewportSize({ width: 1440, height: 1000 })
      await check(
        'Login/Register client validation, password visibility and keyboard work without invalid API requests',
        async () => {
          await spa('/login')
          await visible(
            page.getByRole('heading', { name: 'Chào mừng trở lại', level: 1 }),
          )
          const before = http.length
          await page
            .getByRole('button', { name: 'Đăng nhập', exact: true })
            .click()
          await visible(page.getByText('Vui lòng nhập email.', { exact: true }))
          await wait(() =>
            page
              .getByLabel('Email', { exact: true })
              .evaluate((element) => element === document.activeElement),
          )
          await spa('/register')
          await visible(
            page.getByRole('heading', {
              name: 'Tạo tài khoản bệnh nhân',
              level: 1,
            }),
          )
          await page
            .getByRole('button', { name: 'Đăng ký tài khoản', exact: true })
            .click()
          await visible(
            page.getByText('Vui lòng nhập họ tên, tối đa 120 ký tự.', {
              exact: true,
            }),
          )
          await fill('Họ và tên', 'QA Validation Synthetic')
          await fill('Email', 'invalid')
          await fill('Mật khẩu', 'short')
          await fill('Xác nhận mật khẩu', 'different')
          await page
            .getByRole('button', { name: 'Đăng ký tài khoản', exact: true })
            .click()
          await visible(
            page.getByText('Vui lòng nhập email hợp lệ.', { exact: true }),
          )
          await visible(
            page.getByText('Mật khẩu cần ít nhất 12 ký tự.', { exact: true }),
          )
          await fill('Mật khẩu', 'ắ'.repeat(25))
          await page
            .getByRole('button', { name: 'Đăng ký tài khoản', exact: true })
            .click()
          await visible(
            page.getByText('Mật khẩu không vượt quá 72 byte UTF-8.', {
              exact: true,
            }),
          )
          await page
            .getByRole('button', { name: 'Hiện mật khẩu', exact: true })
            .focus()
          await page.keyboard.press('Enter')
          assert(
            (await page
              .getByLabel('Mật khẩu', { exact: true })
              .getAttribute('type')) === 'text',
          )
          await page
            .getByRole('button', { name: 'Ẩn mật khẩu', exact: true })
            .click()
          assert(
            (await page
              .getByLabel('Mật khẩu', { exact: true })
              .getAttribute('type')) === 'password',
          )
          assert(http.length === before)
          await shot('public-validation.png')
        },
      )
      await check(
        'Reduced-motion loading and double-submit lock preserve one real Login request',
        async () => {
          await spa('/login')
          await visible(
            page.getByRole('heading', { name: 'Chào mừng trở lại', level: 1 }),
          )
          await fill('Email', identity('ADMIN').email)
          await fill('Mật khẩu', identity('ADMIN').password)
          await page.emulateMedia({ reducedMotion: 'reduce' })
          let release
          let intercepted = 0
          const gate = new Promise((resolve) => {
            release = resolve
          })
          const pattern = apiURL + '/api/v1/auth/login'
          const handler = async (route) => {
            intercepted++
            await gate
            await route.continue()
          }
          await page.route(pattern, handler)
          try {
            const response = responseFor('/api/v1/auth/login')
            await page.getByLabel('Mật khẩu', { exact: true }).press('Enter')
            await wait(() => intercepted === 1)
            const pending = page.getByRole('button', {
              name: 'Đang đăng nhập…',
              exact: true,
            })
            await visible(pending)
            assert(await pending.isDisabled())
            assert(
              (await page.locator('form').getAttribute('aria-busy')) === 'true',
            )
            assert(
              await page
                .locator('.animate-spin')
                .evaluate(
                  (element) =>
                    getComputedStyle(element).animationName === 'none',
                ),
            )
            await page.locator('form').evaluate((element) => {
              for (let i = 0; i < 3; i++)
                element.dispatchEvent(
                  new Event('submit', { bubbles: true, cancelable: true }),
                )
            })
            await page.waitForTimeout(150)
            assert(intercepted === 1)
            await shot('real-login-loading.png')
            release()
            assert((await response).status() === 200)
            await visible(
              page.getByRole('heading', { name: title('ADMIN'), level: 1 }),
            )
            assert(intercepted === 1)
            await logout()
          } finally {
            release()
            await page.unroute(pattern, handler)
            await page.emulateMedia({ reducedMotion: 'no-preference' })
          }
        },
      )
      await check(
        'Real browser offline error is retryable; online recovery reaches the QA Backend',
        async () => {
          await fill('Email', identity('ADMIN').email)
          await fill('Mật khẩu', identity('ADMIN').password)
          await page.context().setOffline(true)
          try {
            await page
              .getByRole('button', { name: 'Đăng nhập', exact: true })
              .click()
            await visible(
              page.getByText(
                'Không thể kết nối dịch vụ. Kiểm tra mạng và thử lại.',
                { exact: true },
              ),
            )
            assert(await stateIsClear())
            await shot('real-network-error.png')
          } finally {
            await page.context().setOffline(false)
          }
          assert(
            (await page.evaluate(
              async (url) => (await fetch(url + '/api/v1/health')).status,
              apiURL,
            )) === 200,
          )
          await login('ADMIN')
          await logout()
          await page.reload()
          await visible(
            page.getByRole('heading', { name: 'Chào mừng trở lại', level: 1 }),
          )
          assert(await stateIsClear())
          assert(await storageSafe())
        },
      )
    } else if (phase === 'security') {
      await page.setViewportSize({ width: 1440, height: 1000 })
      await check(
        'Signed expired JWT is rejected by real Backend for each staff role; FE clears auth',
        async () => {
          for (const role of ['ADMIN', 'DOCTOR', 'RECEPTIONIST']) {
            await login(role)
            const outcome = await page.evaluate(async (value) => {
              const { apiClient } = await import('/src/lib/api-client.ts')
              const { getAuthSnapshot } =
                await import('/src/auth/session-store.ts')
              const current = getAuthSnapshot()
              try {
                await apiClient.get('/api/v1/auth/me', {
                  authMode: 'candidate',
                  authSessionVersion: current.version,
                  headers: {
                    Authorization: `Bearer ${window.__staffAcceptance.expiredTokens[value]}`,
                  },
                })
                return { status: 200 }
              } catch (error) {
                return { status: error.status, code: error.code }
              }
            }, role)
            assert(
              outcome.status === 401 && outcome.code === 'INVALID_ACCESS_TOKEN',
            )
            await visible(
              page.getByRole('heading', {
                name: 'Chào mừng trở lại',
                level: 1,
              }),
            )
            assert(await stateIsClear())
          }
          await shot('expired-jwt-login.png')
        },
      )
      await check(
        'Changing frontend role cannot elevate Backend identity or permissions',
        async () => {
          await login('PATIENT')
          const outcome = await page.evaluate(async () => {
            const store = await import('/src/auth/session-store.ts')
            const { apiClient } = await import('/src/lib/api-client.ts')
            const current = store.getAuthSnapshot()
            store.updateSessionUser(
              { ...current.user, role: 'ADMIN' },
              current.version,
            )
            const me = await apiClient.get('/api/v1/auth/me')
            let deniedStatus = 0
            try {
              await apiClient.get('/api/v1/users')
            } catch (error) {
              deniedStatus = error.status
            }
            store.updateSessionUser(
              {
                id: me.data.data.id,
                email: me.data.data.email,
                fullName: me.data.data.fullName,
                role: me.data.data.role,
              },
              current.version,
            )
            return { serverRole: me.data.data.role, deniedStatus }
          })
          assert(
            outcome.serverRole === 'PATIENT' && outcome.deniedStatus === 403,
          )
          if (
            await page
              .getByRole('button', { name: 'Đóng thông báo', exact: true })
              .count()
          )
            await page
              .getByRole('button', { name: 'Đóng thông báo', exact: true })
              .click()
          await logout()
        },
      )
      await check(
        'Token, credentials and password hashes are absent from persistent storage and displayed text',
        async () => {
          await login('ADMIN')
          assert(await storageSafe())
          const safe = await page.evaluate(() => {
            const text = document.body.innerText
            const qa = window.__staffAcceptance
            return (
              !Object.values(qa.accounts).some(
                (account) =>
                  text.includes(account.password) ||
                  text.includes(account.email),
              ) &&
              !/\$2[aby]\$\d\d\$/.test(text) &&
              !/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/.test(text)
            )
          })
          assert(safe)
          await logout()
        },
      )
      await check(
        'Reload drops the real staff session; public auth remains responsive in Light/Dark',
        async () => {
          await login('DOCTOR')
          await page.reload()
          await visible(
            page.getByRole('heading', { name: 'Chào mừng trở lại', level: 1 }),
          )
          assert(await stateIsClear())
          assert(await storageSafe())
          for (const width of [320, 768, 1440]) {
            await page.setViewportSize({ width, height: 900 })
            for (const path of ['/login', '/register']) {
              await spa(path)
              await visible(page.getByRole('heading', { level: 1 }))
              for (let scheme = 0; scheme < 2; scheme++) {
                assert(
                  await page.evaluate(
                    () =>
                      document.documentElement.scrollWidth <=
                      document.documentElement.clientWidth,
                  ),
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
          await spa('/login')
          await visible(
            page.getByRole('heading', { name: 'Chào mừng trở lại', level: 1 }),
          )
          await shot('final-public-login.png')
        },
      )
    } else throw new Error('UNKNOWN_ACCEPTANCE_PHASE')
    assert(errors.length === 0)
    return {
      source: 'REAL CHROME + REAL D02 HTTP + QA MYSQL',
      phase,
      fixtureId: payload.fixtureId,
      checks,
      http,
      uncaughtErrors: errors.length,
      credentialValuesRecorded: false,
      mockUsed: false,
    }
  } finally {
    page.removeListener('response', observe)
    page.removeListener('pageerror', observeError)
  }
}
