// REAL D03 HTTP / MySQL QA. PATIENT only; staff CRUD requires provisioned fixtures.
// No screenshot, trace, HAR, credential or token output.
export async function runD03PatientReal(page, { baseURL, apiURL }) {
  page.setDefaultTimeout(10000)
  const checks = [],
    http = [],
    errors = []
  let step = 'initial'
  page.__d03RealProgress = { checks, http, step }
  const stage = (value) => {
    step = value
    page.__d03RealProgress.step = value
  }
  const assert = (value) => {
    if (!value) throw new Error('assertion failed')
  }
  const visible = (locator) => locator.waitFor({ state: 'visible' })
  const check = async (label, task) => {
    stage(label)
    try {
      await task()
    } catch (error) {
      throw new Error(
        'REAL D03 PATIENT failed: ' + label + ' / ' + step + ' / ' + error.name,
      )
    }
    checks.push({ label, result: 'PASS', source: 'REAL D03 HTTP + QA MYSQL' })
  }
  const response = (path, method = 'GET') => {
    const pending = page.waitForResponse(
      (value) =>
        value.url() === apiURL + path && value.request().method() === method,
      { timeout: 30000 },
    )
    pending.catch(() => {})
    return pending
  }
  const observe = (value) => {
    const url = new URL(value.url())
    if (url.origin === apiURL && url.pathname.startsWith('/api/v1/'))
      http.push({
        method: value.request().method(),
        path: url.pathname,
        status: value.status(),
      })
  }
  const observeError = () => errors.push('runtime error')
  page.on('response', observe)
  page.on('pageerror', observeError)
  const spa = async (path) => {
    await page.evaluate((value) => {
      history.pushState(null, '', value)
      dispatchEvent(new PopStateEvent('popstate'))
    }, path)
  }
  const fill = async (name, value) => {
    try {
      await page.getByLabel(name, { exact: true }).fill(value)
    } catch {
      throw new Error('private form interaction failed')
    }
  }
  const patient = {
    email: 'fe-d03-' + crypto.randomUUID() + '@example.invalid',
    password: crypto.randomUUID(),
  }
  let counts = { specialties: null, doctors: null }
  const login = async () => {
    await spa('/login')
    await visible(
      page.getByRole('heading', { name: 'Chào mừng trở lại', level: 1 }),
    )
    await fill('Email', patient.email)
    await fill('Mật khẩu', patient.password)
    const signedIn = response('/api/v1/auth/login', 'POST'),
      me = response('/api/v1/auth/me')
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
    const result = await signedIn,
      identity = await me,
      body = await result.json(),
      user = (await identity.json()).data
    assert(
      result.status() === 200 &&
        identity.status() === 200 &&
        user.role === 'PATIENT' &&
        user.status === 'ACTIVE',
    )
    assert(
      identity.request().headers().authorization ===
        'Bearer ' + body.data.accessToken,
    )
    assert((await result.serverAddr())?.port === new URL(apiURL).port * 1)
    await page.waitForURL((url) => url.pathname !== '/login')
    await spa('/booking')
    await visible(
      page.getByRole('heading', { name: 'Đặt lịch khám', level: 1 }),
    )
  }
  const invoke = async (path, method = 'get', params = null) =>
    page.evaluate(
      async ({ path, method, params }) => {
        const { apiClient } = await import('/src/lib/api-client.ts')
        try {
          const result =
            method === 'get'
              ? await apiClient.get(path, { params })
              : await apiClient[method](path, params)
          return { status: result.status }
        } catch (error) {
          return { status: error.status, code: error.code }
        }
      },
      { path, method, params },
    )
  const dismiss = async () => {
    const button = page.getByRole('button', {
      name: 'Đóng thông báo',
      exact: true,
    })
    if (await button.count()) await button.click()
  }
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(baseURL + '/doctors')
    await check('ProtectedRoute and real anonymous catalog 401', async () => {
      await visible(
        page.getByRole('heading', { name: 'Chào mừng trở lại', level: 1 }),
      )
      const outcome = await page.evaluate(async (url) => {
        const result = await fetch(url + '/api/v1/doctors')
        return { status: result.status, code: (await result.json()).code }
      }, apiURL)
      assert(
        outcome.status === 401 && outcome.code === 'AUTHENTICATION_REQUIRED',
      )
      assert(
        await page.evaluate(async (url) => {
          const { directoryGateway } = await import('/src/directory/gateway.ts')
          const { apiClient } = await import('/src/lib/api-client.ts')
          return (
            directoryGateway.mode === 'real' &&
            apiClient.defaults.baseURL === url
          )
        }, apiURL),
      )
    })
    await check(
      'Register PATIENT 201, real loading/double-submit/reduced-motion and duplicate 409',
      async () => {
        await spa('/register')
        await visible(
          page.getByRole('heading', {
            name: 'Tạo tài khoản bệnh nhân',
            level: 1,
          }),
        )
        const values = async () => {
          await fill('Họ và tên', 'QA FE D03 Synthetic')
          await fill('Email', patient.email)
          await fill('Mật khẩu', patient.password)
          await fill('Xác nhận mật khẩu', patient.password)
        }
        await values()
        stage('register values filled')
        let release,
          intercepted = 0
        const gate = new Promise((resolve) => {
            release = resolve
          }),
          pattern = apiURL + '/api/v1/auth/register'
        const handler = async (route) => {
          intercepted++
          await gate
          await route.continue()
        }
        await page.route(pattern, handler)
        try {
          const registered = response('/api/v1/auth/register', 'POST')
          await page
            .getByLabel('Xác nhận mật khẩu', { exact: true })
            .press('Enter')
          stage('register submitted')
          await visible(
            page.getByRole('button', { name: 'Đang đăng ký…', exact: true }),
          )
          stage('register pending visible')
          assert(
            (await page.locator('form').getAttribute('aria-busy')) === 'true',
          )
          await page.locator('form').evaluate((form) => {
            for (let i = 0; i < 3; i++)
              form.dispatchEvent(
                new Event('submit', { bubbles: true, cancelable: true }),
              )
          })
          assert(
            await page
              .locator('.animate-spin')
              .evaluate(
                (element) => getComputedStyle(element).animationName === 'none',
              ),
          )
          release()
          stage('register request continued')
          const result = await registered,
            body = await result.json()
          assert(
            result.status() === 201 &&
              body.data.role === 'PATIENT' &&
              intercepted === 1,
          )
          assert(
            Object.keys(result.request().postDataJSON()).sort().join(',') ===
              'email,fullName,password',
          )
        } finally {
          release()
          await page.unroute(pattern, handler)
          await page.emulateMedia({ reducedMotion: 'no-preference' })
        }
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
        await values()
        const duplicate = response('/api/v1/auth/register', 'POST')
        await page
          .getByRole('button', { name: 'Đăng ký tài khoản', exact: true })
          .click()
        const rejected = await duplicate
        assert(
          rejected.status() === 409 &&
            (await rejected.json()).code === 'EMAIL_ALREADY_EXISTS',
        )
      },
    )
    await check(
      'Wrong Login 401 followed by real Login/ME Bearer 200',
      async () => {
        await spa('/login')
        await visible(
          page.getByRole('heading', { name: 'Chào mừng trở lại', level: 1 }),
        )
        await fill('Email', patient.email)
        await fill('Mật khẩu', crypto.randomUUID())
        const rejected = response('/api/v1/auth/login', 'POST')
        await page
          .getByRole('button', { name: 'Đăng nhập', exact: true })
          .click()
        assert((await rejected).status() === 401)
        await visible(
          page.getByText('Email hoặc mật khẩu không đúng.', { exact: true }),
        )
        await login()
      },
    )
    await check(
      'D03 specialties/doctors real 200, official pagination and PATIENT read UI',
      async () => {
        for (const kind of ['specialties', 'doctors']) {
          const loaded = page.waitForResponse(
            (result) =>
              result.url().startsWith(apiURL + '/api/v1/' + kind + '?') &&
              result.request().method() === 'GET',
          )
          await spa('/' + kind)
          const result = await loaded,
            body = await result.json()
          assert(
            result.status() === 200 &&
              Array.isArray(body.data.items) &&
              typeof body.data.totalElements === 'number' &&
              typeof body.data.totalPages === 'number',
          )
          counts[kind] = body.data.totalElements
          assert(body.data.items.every((item) => item.isActive === true))
          if (kind === 'doctors')
            assert(
              body.data.items.every(
                (item) =>
                  Object.keys(item).sort().join(',') ===
                  'biography,doctorCode,fullName,id,isActive,specialtyId,specialtyName',
              ),
            )
          const region = page.getByRole('region', {
            name:
              kind === 'doctors' ? 'Danh sách bác sĩ' : 'Danh sách chuyên khoa',
          })
          await page.waitForFunction(
            (label) =>
              document
                .querySelector('section[aria-label="' + label + '"]')
                ?.getAttribute('aria-busy') === 'false',
            kind === 'doctors' ? 'Danh sách bác sĩ' : 'Danh sách chuyên khoa',
          )
          if (!body.data.totalElements)
            await visible(
              region.getByRole('heading', {
                name:
                  kind === 'doctors'
                    ? 'Không tìm thấy bác sĩ'
                    : 'Không tìm thấy chuyên khoa',
              }),
            )
          assert(
            (await page
              .getByRole('button', { name: /^Thêm |^Chỉnh sửa / })
              .count()) === 0,
          )
        }
        const searched = page.waitForResponse(
          (result) =>
            result.url().startsWith(apiURL + '/api/v1/doctors?') &&
            new URL(result.url()).searchParams.get('q') === 'NO_MATCH_%_QA',
        )
        await fill('Tìm kiếm bác sĩ', 'NO_MATCH_%_QA')
        assert((await searched).status() === 200)
      },
    )
    await check(
      'Real query validation 400 and missing/scoped resources 404',
      async () => {
        for (const params of [
          { page: -1 },
          { size: 101 },
          { q: 'X'.repeat(121) },
        ])
          assert(
            (await invoke('/api/v1/doctors', 'get', params)).status === 400,
          )
        for (const path of [
          '/api/v1/doctors/9223372036854775807',
          '/api/v1/specialties/9223372036854775807',
        ])
          assert((await invoke(path)).status === 404)
      },
    )
    await check(
      'PATIENT server 403 for eligible-users, writes and inactive filter; FE keeps session',
      async () => {
        assert((await invoke('/api/v1/doctors/eligible-users')).status === 403)
        assert(
          (
            await invoke('/api/v1/specialties', 'post', {
              code: 'QA_DENIED',
              name: 'QA denied',
            })
          ).status === 403,
        )
        assert(
          (await invoke('/api/v1/doctors/1', 'patch', { isActive: false }))
            .status === 403,
        )
        assert(
          (await invoke('/api/v1/doctors', 'get', { isActive: false }))
            .status === 403,
        )
        await visible(page.getByText('Không đủ quyền', { exact: true }))
        assert(
          await page.evaluate(
            async () =>
              (await import('/src/auth/session-store.ts')).getAuthSnapshot()
                .status === 'authenticated',
          ),
        )
        await dismiss()
        await spa('/dashboard')
        await visible(
          page.getByRole('heading', {
            name: 'Bạn không có quyền truy cập màn hình này',
            level: 1,
          }),
        )
      },
    )
    await check('Real network offline error and online retry', async () => {
      await spa('/doctors')
      await visible(
        page.getByRole('heading', { name: 'Đội ngũ bác sĩ', level: 1 }),
      )
      await page.context().setOffline(true)
      try {
        await fill('Tìm kiếm bác sĩ', 'offline-qa')
        await visible(
          page.getByRole('heading', {
            name: 'Không thể tải danh mục',
            exact: true,
          }),
        )
      } finally {
        await page.context().setOffline(false)
      }
      const retried = page.waitForResponse(
        (result) =>
          result.url().startsWith(apiURL + '/api/v1/doctors?') &&
          result.status() === 200,
      )
      await page.getByRole('button', { name: 'Thử lại', exact: true }).click()
      await retried
    })
    await check(
      'Responsive mobile navigation, Light/Dark and keyboard with real PATIENT session',
      async () => {
        for (const width of [320, 768, 1440]) {
          await page.setViewportSize({ width, height: 900 })
          assert(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          )
        }
        await page.setViewportSize({ width: 390, height: 844 })
        await page
          .getByRole('button', { name: 'Mở menu điều hướng', exact: true })
          .click()
        const menu = page.getByRole('dialog', { name: 'Menu điều hướng' })
        await visible(menu)
        for (let i = 0; i < 12; i++) await page.keyboard.press('Tab')
        assert(
          await menu.evaluate((element) =>
            element.contains(document.activeElement),
          ),
        )
        await page.keyboard.press('Escape')
        await page
          .getByRole('button', { name: 'Mở menu điều hướng', exact: true })
          .click()
        await menu.getByRole('link', { name: 'Cài đặt', exact: true }).click()
        await visible(
          page.getByRole('heading', {
            name: 'Cài đặt không gian làm việc',
            level: 1,
          }),
        )
        await page.getByRole('button', { name: 'Tối', exact: true }).click()
        assert(
          await page
            .locator('html')
            .evaluate((element) => element.classList.contains('dark')),
        )
        await page.getByRole('button', { name: 'Sáng', exact: true }).click()
        assert(
          await page
            .locator('html')
            .evaluate((element) => !element.classList.contains('dark')),
        )
      },
    )
    await check(
      'Invalid JWT real 401, logout and reload clear auth; ProtectedRoute remains',
      async () => {
        const result = await page.evaluate(async () => {
          const { apiClient } = await import('/src/lib/api-client.ts'),
            { getAuthSnapshot } = await import('/src/auth/session-store.ts'),
            state = getAuthSnapshot()
          const parts = state.accessToken.split('.')
          parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1)
          try {
            await apiClient.get('/api/v1/doctors', {
              authMode: 'candidate',
              authSessionVersion: state.version,
              headers: { Authorization: 'Bearer ' + parts.join('.') },
            })
            return 200
          } catch (error) {
            return error.status
          }
        })
        assert(result === 401)
        await visible(
          page.getByRole('heading', { name: 'Chào mừng trở lại', level: 1 }),
        )
        await page.setViewportSize({ width: 1440, height: 1000 })
        await login()
        await page
          .getByRole('button', { name: 'Đăng xuất', exact: true })
          .click()
        await visible(
          page.getByRole('heading', { name: 'Chào mừng trở lại', level: 1 }),
        )
        await spa('/doctors')
        await visible(
          page.getByRole('heading', { name: 'Chào mừng trở lại', level: 1 }),
        )
        await login()
        await page.reload()
        await visible(
          page.getByRole('heading', { name: 'Chào mừng trở lại', level: 1 }),
        )
        assert(
          await page.evaluate(async () => {
            const state = (
              await import('/src/auth/session-store.ts')
            ).getAuthSnapshot()
            return (
              !state.accessToken &&
              !state.user &&
              sessionStorage.length === 0 &&
              Object.keys(localStorage).every((key) => key === 'clinic-theme')
            )
          }),
        )
      },
    )
    assert(errors.length === 0)
    return {
      source: 'REAL D03 HTTP + MYSQL 8.4 QA; PATIENT ONLY',
      checks,
      http,
      catalogCounts: counts,
      positiveActiveCatalogVisibilityTested:
        counts.doctors > 0 && counts.specialties > 0,
      staffCrudTested: false,
      requiresStaffFixtures: true,
      runtimeErrors: errors.length,
      screenshotsCreated: 0,
      credentialsRecorded: false,
    }
  } finally {
    page.removeListener('response', observe)
    page.removeListener('pageerror', observeError)
    await page.context().setOffline(false)
  }
}
