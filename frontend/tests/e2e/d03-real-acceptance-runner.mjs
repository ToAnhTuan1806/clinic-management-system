// Real browser + real D03 HTTP/MySQL. The host injects credentials into volatile RAM.
// The supplied QA source is preserved; successful writes run only on its isolated copy.
// No screenshots, trace, HAR, response bodies, credential or token output.
export async function runD03Acceptance(page, { phase }) {
  page.setDefaultTimeout(12000)
  const qa = await page.evaluate(() => window.__d03Acceptance)
  if (!qa?.sourceProtected || !qa.scopeVerified)
    throw new Error('PRIVATE_VERIFIED_HANDOFF_REQUIRED')
  const checks = [],
    http = [],
    errors = [],
    consoleErrors = [],
    leaks = []
  let step = phase
  page.__d03AcceptanceProgress = { phase, checks, http, step }
  const stage = (value) => {
    step = value
    page.__d03AcceptanceProgress.step = value
  }
  const assert = (value) => {
    if (!value) throw new Error('assertion failed')
  }
  const wait = async (predicate, label = 'state') => {
    const end = Date.now() + 10000
    while (Date.now() < end) {
      if (await predicate()) return
      await page.waitForTimeout(35)
    }
    throw new Error(label)
  }
  const visible = (locator) => locator.waitFor({ state: 'visible' })
  const check = async (label, task) => {
    stage(label)
    try {
      await task()
    } catch (error) {
      throw new Error(
        'REAL D03 ' +
          phase +
          ' failed: ' +
          label +
          ' / ' +
          step +
          ' / ' +
          error.name,
      )
    }
    checks.push({
      label,
      result: 'PASS',
      source: 'REAL D03 HTTP + ISOLATED MYSQL COPY',
    })
  }
  const observe = (response) => {
    const url = new URL(response.url())
    if (url.origin === qa.apiURL && url.pathname.startsWith('/api/v1/'))
      http.push({
        method: response.request().method(),
        path: url.pathname,
        status: response.status(),
      })
  }
  const observeError = () => errors.push('runtime error')
  const observeConsole = (message) => {
    const text = message.text()
    if (
      Object.values(qa.accounts).some(
        (account) =>
          text.includes(account.password) || text.includes(account.email),
      ) ||
      /\beyJ[\w-]+\.[\w-]+\.[\w-]+\b|\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}/.test(
        text,
      )
    )
      leaks.push('sensitive console output')
    // Chromium reports expected negative HTTP/offline cases through this message.
    // Never persist the raw message, which could contain private form values.
    if (
      message.type() === 'error' &&
      !/^Failed to load resource: (the server responded with a status of (400|401|403|404|409)\b|net::ERR_)/.test(
        text,
      )
    )
      consoleErrors.push('unexpected console error')
  }
  page.on('response', observe)
  page.on('pageerror', observeError)
  page.on('console', observeConsole)
  const response = (path, method = 'GET') => {
    const result = page.waitForResponse(
      (value) =>
        value.url() === qa.apiURL + path && value.request().method() === method,
      { timeout: 30000 },
    )
    result.catch(() => {})
    return result
  }
  const spa = (path) =>
    page.evaluate((value) => {
      history.pushState(null, '', value)
      dispatchEvent(new PopStateEvent('popstate'))
    }, path)
  const fill = async (root, name, value) => {
    try {
      await root.getByLabel(name, { exact: true }).fill(value)
    } catch {
      throw new Error('private form interaction failed')
    }
  }
  const raw = (path, method = 'get', body = null, params = null) =>
    page.evaluate(
      async ({ path, method, body, params }) => {
        const { apiClient } = await import('/src/lib/api-client.ts')
        try {
          const result = await apiClient.request({
            url: path,
            method,
            ...(body !== null ? { data: body } : {}),
            ...(params ? { params } : {}),
          })
          return { status: result.status, data: result.data.data }
        } catch (error) {
          return { status: error.status, code: error.code }
        }
      },
      { path, method, body, params },
    )
  const ids = qa.fixtureIds
  const s1 = ids.specialties.D03_QA_S1_ACTIVE,
    s2 = ids.specialties.D03_QA_S2_ACTIVE,
    s3 = ids.specialties.D03_QA_S3_INACTIVE
  const d1 = ids.doctors.D03_QA_DOC_ACTIVE,
    d2 = ids.doctors.D03_QA_DOC_INACTIVE
  const region = (kind) =>
    page.getByRole('region', {
      name: kind === 'doctors' ? 'Danh sách bác sĩ' : 'Danh sách chuyên khoa',
    })
  const loaded = async (kind) => {
    await visible(region(kind))
    await wait(
      async () => (await region(kind).getAttribute('aria-busy')) === 'false',
    )
  }
  const navigate = async (kind) => {
    await spa('/' + kind)
    await visible(
      page.getByRole('heading', {
        level: 1,
        name:
          kind === 'specialties'
            ? 'Chuyên khoa'
            : (await page.evaluate(
                  async () =>
                    (
                      await import('/src/auth/session-store.ts')
                    ).getAuthSnapshot().user?.role,
                )) === 'DOCTOR'
              ? 'Hồ sơ bác sĩ của tôi'
              : 'Đội ngũ bác sĩ',
        exact: true,
      }),
    )
    await loaded(kind)
  }
  const search = async (kind, value) => {
    await fill(
      page,
      'Tìm kiếm ' + (kind === 'doctors' ? 'bác sĩ' : 'chuyên khoa'),
      value,
    )
    await loaded(kind)
  }
  const dialog = () => page.getByRole('dialog')
  const card = (kind, code) =>
    region(kind)
      .getByRole('listitem')
      .filter({ has: page.getByText(code, { exact: true }) })
  const dismiss = async () => {
    const button = page.getByRole('button', {
      name: 'Đóng thông báo',
      exact: true,
    })
    if (await button.count()) await button.click()
  }
  const actorRole = (actor) => qa.accounts[actor].role
  const title = (role) =>
    ({
      ADMIN: 'Tổng quan phòng khám',
      RECEPTIONIST: 'Không gian lễ tân',
      DOCTOR: 'Không gian bác sĩ',
      PATIENT: 'Đặt lịch khám',
    })[role]
  const logout = async () => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click()
    await visible(
      page.getByRole('heading', { name: 'Chào mừng trở lại', level: 1 }),
    )
  }
  const login = async (actor) => {
    stage('login ' + actor)
    await page.setViewportSize({ width: 1440, height: 1000 })
    const authenticated = await page.evaluate(
      async () =>
        (await import('/src/auth/session-store.ts')).getAuthSnapshot()
          .status === 'authenticated',
    )
    if (authenticated) await logout()
    await spa('/register')
    await visible(
      page.getByRole('heading', { name: 'Tạo tài khoản bệnh nhân', level: 1 }),
    )
    await page.getByRole('link', { name: 'Đăng nhập', exact: true }).click()
    await visible(
      page.getByRole('heading', { name: 'Chào mừng trở lại', level: 1 }),
    )
    await fill(page, 'Email', qa.accounts[actor].email)
    await fill(page, 'Mật khẩu', qa.accounts[actor].password)
    const signed = response('/api/v1/auth/login', 'POST'),
      me = response('/api/v1/auth/me')
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
    const result = await signed,
      identity = await me,
      body = await result.json(),
      user = (await identity.json()).data
    assert(
      result.status() === 200 &&
        identity.status() === 200 &&
        user.id === ids.users[actor] &&
        user.role === actorRole(actor) &&
        user.status === 'ACTIVE',
    )
    assert(
      body.data.tokenType === 'Bearer' &&
        body.data.expiresIn === 1800 &&
        identity.request().headers().authorization ===
          'Bearer ' + body.data.accessToken,
    )
    assert(
      (await result.serverAddr())?.port === Number(new URL(qa.apiURL).port),
    )
    assert(
      (await identity.allHeaders())['cache-control']?.includes('no-store') &&
        !(await result.allHeaders())['set-cookie'],
    )
    await visible(
      page.getByRole('heading', {
        name: title(actorRole(actor)),
        level: 1,
        exact: true,
      }),
    )
  }
  const noAdmin = async () =>
    assert(
      (await page
        .getByRole('button', {
          name: /^Thêm bác sĩ$|^Thêm chuyên khoa$|^Chỉnh sửa |^Tắt hoạt động |^Bật hoạt động /,
        })
        .count()) === 0,
    )
  const deniedWrites = async () => {
    for (const [path, method, body] of [
      ['/api/v1/specialties', 'post', { code: 'FE_DENIED', name: 'QA denied' }],
      ['/api/v1/specialties/' + s1, 'patch', { isActive: false }],
      [
        '/api/v1/doctors',
        'post',
        { userId: '5', specialtyId: s1, doctorCode: 'FE_DENIED' },
      ],
      ['/api/v1/doctors/' + d1, 'patch', { isActive: false }],
      ['/api/v1/doctors/eligible-users', 'get', null],
    ])
      assert((await raw(path, method, body)).status === 403)
    await visible(page.getByText('Không đủ quyền', { exact: true }))
    await dismiss()
    assert(
      await page.evaluate(
        async () =>
          (await import('/src/auth/session-store.ts')).getAuthSnapshot()
            .status === 'authenticated',
      ),
    )
  }
  const openEdit = async (kind, code) => {
    await card(kind, code)
      .getByRole('button', { name: /^Chỉnh sửa / })
      .click()
    await visible(
      dialog().getByRole('button', { name: 'Lưu thông tin', exact: true }),
    )
    await wait(
      async () =>
        !(await dialog()
          .getByRole('button', { name: 'Lưu thông tin', exact: true })
          .isDisabled()),
    )
  }
  const save = async (path, method = 'PATCH') => {
    const pending = response(path, method)
    await dialog()
      .getByRole('button', { name: 'Lưu thông tin', exact: true })
      .click()
    const result = await pending
    await wait(async () => (await dialog().count()) === 0)
    await visible(page.getByText('Đã lưu thay đổi.', { exact: true }))
    return result
  }
  const toggle = async (kind, code, active) => {
    await card(kind, code)
      .getByRole('button', {
        name: active ? /^Bật hoạt động / : /^Tắt hoạt động /,
      })
      .click()
    const confirm = page.getByRole('alertdialog')
    await visible(confirm)
    const path =
        '/api/v1/' +
        kind +
        '/' +
        (kind === 'doctors' ? qa.created.doctor.id : qa.created.specialty.id),
      pending = response(path, 'PATCH')
    await confirm.getByRole('button', { name: 'Xác nhận', exact: true }).click()
    const result = await pending
    assert(
      result.status() === 200 &&
        JSON.stringify(result.request().postDataJSON()) ===
          JSON.stringify({ isActive: active }),
    )
    await wait(async () => (await confirm.count()) === 0)
    await loaded(kind)
  }
  const persist = async () => {
    await page.evaluate((value) => {
      window.__d03Acceptance.created = value
    }, qa.created)
  }
  try {
    if (phase === 'baseline') {
      await check(
        'Verified real adapter and anonymous ProtectedRoute/HTTP 401',
        async () => {
          assert(
            await page.evaluate(async (url) => {
              const { directoryGateway } =
                  await import('/src/directory/gateway.ts'),
                { apiClient } = await import('/src/lib/api-client.ts')
              return (
                directoryGateway.mode === 'real' &&
                apiClient.defaults.baseURL === url
              )
            }, qa.apiURL),
          )
          await spa('/doctors')
          await visible(
            page.getByRole('heading', { name: 'Chào mừng trở lại', level: 1 }),
          )
          const outcome = await page.evaluate(async (url) => {
            const result = await fetch(url + '/api/v1/doctors')
            return { status: result.status, code: (await result.json()).code }
          }, qa.apiURL)
          assert(
            outcome.status === 401 &&
              outcome.code === 'AUTHENTICATION_REQUIRED',
          )
        },
      )
      await check(
        'ADMIN real Login/ME, complete catalog list/detail and internal projection',
        async () => {
          await login('ADMIN')
          const specialties = await raw('/api/v1/specialties'),
            doctors = await raw('/api/v1/doctors')
          assert(
            specialties.status === 200 &&
              specialties.data.totalElements === 4 &&
              doctors.status === 200 &&
              doctors.data.totalElements === 3,
          )
          assert(
            doctors.data.items.every(
              (item) =>
                typeof item.id === 'string' &&
                typeof item.userId === 'string' &&
                'licenseNumber' in item,
            ),
          )
          await navigate('specialties')
          assert(
            (await region('specialties').getByRole('listitem').count()) === 4,
          )
          await card('specialties', 'D03_QA_S1_ACTIVE')
            .getByRole('button', { name: /^Xem / })
            .click()
          await visible(
            dialog().getByRole('heading', {
              name: 'QA D03 Active Specialty One',
              exact: true,
            }),
          )
          await page.keyboard.press('Escape')
          await navigate('doctors')
          await card('doctors', 'D03_QA_DOC_ACTIVE')
            .getByRole('button', { name: /^Xem / })
            .click()
          await visible(dialog().getByText('Số giấy phép:', { exact: false }))
          await page.keyboard.press('Escape')
          assert((await raw('/api/v1/doctors/' + d1)).status === 200)
        },
      )
      await check(
        'ADMIN code/name search, status/specialty filters and endpoint pagination',
        async () => {
          await navigate('specialties')
          await search('specialties', 'D03_QA_S1_ACTIVE')
          assert(
            (await region('specialties').getByRole('listitem').count()) === 1,
          )
          await search('specialties', '')
          await page
            .getByLabel('Trạng thái', { exact: true })
            .selectOption('inactive')
          await loaded('specialties')
          assert(
            (await region('specialties').getByRole('listitem').count()) === 2,
          )
          await navigate('doctors')
          await page.getByLabel('Chuyên khoa', { exact: true }).selectOption(s1)
          await loaded('doctors')
          assert((await region('doctors').getByRole('listitem').count()) === 1)
          for (const kind of ['doctors', 'specialties']) {
            const first = await raw('/api/v1/' + kind, 'get', null, {
                page: 0,
                size: 1,
              }),
              second = await raw('/api/v1/' + kind, 'get', null, {
                page: 1,
                size: 1,
              })
            assert(
              first.status === 200 &&
                second.status === 200 &&
                first.data.items.length === 1 &&
                second.data.items.length === 1 &&
                first.data.items[0].id !== second.data.items[0].id &&
                first.data.totalPages === first.data.totalElements,
            )
          }
        },
      )
      await check(
        'Eligible-users real projection/search/page, ID 5 included and linked users excluded',
        async () => {
          const eligible = await raw(
            '/api/v1/doctors/eligible-users',
            'get',
            null,
            { page: 0, size: 1 },
          )
          assert(
            eligible.status === 200 &&
              eligible.data.totalElements === 1 &&
              eligible.data.items[0].id === '5',
          )
          const candidate = eligible.data.items[0]
          assert(
            Object.keys(candidate).sort().join(',') === 'email,fullName,id',
          )
          assert(
            (
              await raw('/api/v1/doctors/eligible-users', 'get', null, {
                q: candidate.fullName,
                page: 0,
                size: 1,
              })
            ).data.items[0].id === '5',
          )
          assert(
            (
              await raw('/api/v1/doctors/eligible-users', 'get', null, {
                page: 1,
                size: 1,
              })
            ).data.items.length === 0,
          )
          await page
            .getByRole('button', { name: 'Thêm bác sĩ', exact: true })
            .click()
          await wait(
            async () =>
              !(await dialog()
                .getByRole('button', { name: 'Lưu thông tin', exact: true })
                .isDisabled()),
          )
          assert(
            (await dialog()
              .getByLabel('Tài khoản bác sĩ', { exact: true })
              .locator('option[value="5"]')
              .count()) === 1,
          )
          for (const value of ['4', '6', '7'])
            assert(
              (await dialog()
                .getByLabel('Tài khoản bác sĩ', { exact: true })
                .locator('option[value="' + value + '"]')
                .count()) === 0,
            )
          await fill(dialog(), 'Tìm tài khoản bác sĩ', candidate.fullName)
          await wait(
            async () =>
              (await dialog()
                .getByLabel('Tài khoản bác sĩ', { exact: true })
                .locator('option[value="5"]')
                .count()) === 1,
          )
          assert(
            await dialog()
              .getByRole('button', { name: 'Tài khoản trang sau', exact: true })
              .isDisabled(),
          )
          await page.keyboard.press('Escape')
        },
      )
      await check(
        'RECEPTIONIST real Login, both states visible, minimized DTO and no admin controls',
        async () => {
          await login('RECEPTIONIST')
          for (const kind of ['specialties', 'doctors']) {
            await navigate(kind)
            await noAdmin()
          }
          const result = await raw('/api/v1/doctors')
          assert(
            result.status === 200 &&
              result.data.totalElements === 3 &&
              result.data.items.some((item) => !item.isActive),
          )
          assert(
            result.data.items.every(
              (item) =>
                'userStatus' in item &&
                !('userId' in item) &&
                !('licenseNumber' in item) &&
                !('email' in item),
            ),
          )
          await card('doctors', 'D03_QA_DOC_INACTIVE')
            .getByRole('button', { name: /^Xem / })
            .click()
          await visible(
            dialog().getByText('D03_QA_DOC_INACTIVE', { exact: true }),
          )
          assert(
            (await dialog()
              .getByText('Số giấy phép:', { exact: false })
              .count()) === 0,
          )
          await page.keyboard.press('Escape')
        },
      )
      await check(
        'RECEPTIONIST HTTP POST/PATCH/eligible-users denied 403 and session retained',
        deniedWrites,
      )
      await check(
        'Linked DOCTOR real Login, own list/detail only and active specialty scope',
        async () => {
          await login('DOCTOR_LINKED')
          await navigate('doctors')
          await noAdmin()
          assert((await region('doctors').getByRole('listitem').count()) === 1)
          const result = await raw('/api/v1/doctors')
          assert(
            result.data.items.length === 1 &&
              result.data.items[0].id === d1 &&
              result.data.items[0].userId === ids.users.DOCTOR_LINKED,
          )
          assert((await raw('/api/v1/doctors/' + d1)).status === 200)
          assert((await raw('/api/v1/doctors/' + d2)).status === 404)
          await navigate('specialties')
          assert(
            (await region('specialties').getByRole('listitem').count()) === 2 &&
              (await page.getByLabel('Trạng thái', { exact: true }).count()) ===
                0,
          )
          assert(
            (await raw('/api/v1/specialties', 'get', null, { isActive: false }))
              .status === 403,
          )
          await dismiss()
        },
      )
      await check(
        'DOCTOR HTTP admin writes and eligible-users denied 403',
        deniedWrites,
      )
      await check(
        'PATIENT real Login, positive active catalog and public projection only',
        async () => {
          await login('PATIENT')
          await navigate('specialties')
          await noAdmin()
          assert(
            (await region('specialties').getByRole('listitem').count()) === 2,
          )
          await navigate('doctors')
          await noAdmin()
          assert((await region('doctors').getByRole('listitem').count()) === 1)
          const result = await raw('/api/v1/doctors')
          assert(
            result.data.items.length === 1 && result.data.items[0].id === d1,
          )
          assert(
            Object.keys(result.data.items[0]).sort().join(',') ===
              'biography,doctorCode,fullName,id,isActive,specialtyId,specialtyName',
          )
          await card('doctors', 'D03_QA_DOC_ACTIVE')
            .getByRole('button', { name: /^Xem / })
            .click()
          await visible(
            dialog().getByText('D03_QA_DOC_ACTIVE', { exact: true }),
          )
          assert(
            (await dialog()
              .getByText('Số giấy phép:', { exact: false })
              .count()) === 0,
          )
          await page.keyboard.press('Escape')
          assert(
            (await page.getByLabel('Trạng thái', { exact: true }).count()) ===
              0,
          )
        },
      )
      await check(
        'PATIENT inactive filters/writes 403, hidden detail 404 and RoleGuard',
        async () => {
          await deniedWrites()
          assert(
            (await raw('/api/v1/doctors', 'get', null, { isActive: false }))
              .status === 403,
          )
          assert(
            (await raw('/api/v1/specialties', 'get', null, { isActive: false }))
              .status === 403,
          )
          await dismiss()
          assert(
            (await raw('/api/v1/doctors/' + d2)).status === 404 &&
              (await raw('/api/v1/specialties/' + s3)).status === 404,
          )
          await spa('/dashboard')
          await visible(
            page.getByRole('heading', {
              name: 'Bạn không có quyền truy cập màn hình này',
              level: 1,
            }),
          )
        },
      )
      await check(
        'Inactive linked DOCTOR can read own inactive profile; eligible DOCTOR has empty scope',
        async () => {
          await login('DOCTOR_INACTIVE')
          const own = await raw('/api/v1/doctors')
          assert(
            own.data.items.length === 1 &&
              own.data.items[0].id === d2 &&
              !own.data.items[0].isActive,
          )
          await login('DOCTOR_ELIGIBLE')
          await navigate('doctors')
          assert((await raw('/api/v1/doctors')).data.totalElements === 0)
          await visible(
            page.getByRole('heading', {
              name: 'Không tìm thấy bác sĩ',
              exact: true,
            }),
          )
        },
      )
    } else if (phase === 'admin') {
      await login('ADMIN')
      const nonce = crypto
        .randomUUID()
        .replaceAll('-', '')
        .slice(0, 10)
        .toUpperCase()
      qa.created = { nonce, specialty: null, doctor: null, pageCodes: [] }
      await persist()
      const specCode = 'FE_SP_' + nonce,
        docCode = 'FE_DR_' + nonce,
        license = 'FE-LIC-' + nonce
      await check(
        'ADMIN UI specialty validation, real POST 201 and loading/double-submit lock',
        async () => {
          await navigate('specialties')
          await page
            .getByRole('button', { name: 'Thêm chuyên khoa', exact: true })
            .click()
          const before = http.filter(
            (item) =>
              item.path === '/api/v1/specialties' && item.method === 'POST',
          ).length
          await dialog()
            .getByRole('button', { name: 'Lưu thông tin', exact: true })
            .click()
          await visible(
            dialog().getByText(
              'Vui lòng nhập tên chuyên khoa, tối đa 120 ký tự.',
              { exact: true },
            ),
          )
          assert(
            http.filter(
              (item) =>
                item.path === '/api/v1/specialties' && item.method === 'POST',
            ).length === before,
          )
          await fill(dialog(), 'Mã chuyên khoa', specCode.toLowerCase())
          await fill(dialog(), 'Tên chuyên khoa', 'QA FE Acceptance ' + nonce)
          await fill(dialog(), 'Mô tả', 'Synthetic real FE acceptance')
          let release,
            calls = 0
          const gate = new Promise((resolve) => {
              release = resolve
            }),
            pattern = qa.apiURL + '/api/v1/specialties',
            handler = async (route) => {
              if (route.request().method() === 'POST') {
                calls++
                await gate
              }
              await route.continue()
            }
          await page.route(pattern, handler)
          try {
            const pending = response('/api/v1/specialties', 'POST')
            await dialog()
              .getByRole('button', { name: 'Lưu thông tin', exact: true })
              .click()
            await visible(
              dialog().getByRole('button', { name: 'Đang lưu…', exact: true }),
            )
            assert(
              await dialog()
                .getByRole('button', { name: 'Đang lưu…', exact: true })
                .isDisabled(),
            )
            await dialog()
              .locator('form')
              .evaluate((form) => {
                for (let i = 0; i < 3; i++)
                  form.dispatchEvent(
                    new Event('submit', { bubbles: true, cancelable: true }),
                  )
              })
            await wait(() => calls === 1)
            release()
            const result = await pending
            assert(result.status() === 201)
            const item = (await result.json()).data
            assert(item.code === specCode && typeof item.id === 'string')
            qa.created.specialty = item
            await persist()
            await wait(async () => (await dialog().count()) === 0)
          } finally {
            release()
            await page.unroute(pattern, handler)
          }
          await search('specialties', specCode)
          assert(
            (await region('specialties').getByRole('listitem').count()) === 1,
          )
        },
      )
      await check(
        'ADMIN specialty GET/PATCH and confirmed inactive/active toggles',
        async () => {
          await openEdit('specialties', specCode)
          await fill(dialog(), 'Mô tả', 'Updated real FE specialty')
          const result = await save(
            '/api/v1/specialties/' + qa.created.specialty.id,
          )
          assert(result.status() === 200)
          assert(
            (await raw('/api/v1/specialties/' + qa.created.specialty.id)).data
              .description === 'Updated real FE specialty',
          )
          await loaded('specialties')
          await toggle('specialties', specCode, false)
          await toggle('specialties', specCode, true)
        },
      )
      await check(
        'Real specialty duplicate code/name 409 and active-doctor deactivation blocked',
        async () => {
          for (const [body, code] of [
            [
              { code: specCode, name: 'QA other ' + nonce },
              'SPECIALTY_CODE_EXISTS',
            ],
            [
              { code: 'FE_UNIQUE_' + nonce, name: 'QA FE Acceptance ' + nonce },
              'SPECIALTY_NAME_EXISTS',
            ],
          ]) {
            const result = await raw('/api/v1/specialties', 'post', body)
            assert(result.status === 409 && result.code === code)
          }
          await search('specialties', 'D03_QA_S1_ACTIVE')
          await card('specialties', 'D03_QA_S1_ACTIVE')
            .getByRole('button', { name: /^Tắt hoạt động / })
            .click()
          const denied = response('/api/v1/specialties/' + s1, 'PATCH')
          await page
            .getByRole('alertdialog')
            .getByRole('button', { name: 'Xác nhận', exact: true })
            .click()
          const result = await denied
          assert(
            result.status() === 409 &&
              (await result.json()).code === 'SPECIALTY_HAS_ACTIVE_DOCTORS',
          )
          await visible(
            page
              .getByRole('alertdialog')
              .getByText(
                'Chuyên khoa còn bác sĩ đang hoạt động. Hãy ngừng hoạt động các hồ sơ đó trước.',
                { exact: true },
              ),
          )
          await page
            .getByRole('alertdialog')
            .getByRole('button', { name: 'Hủy', exact: true })
            .click()
          assert((await raw('/api/v1/specialties/' + s1)).data.isActive)
        },
      )
      await check(
        'Doctor pre-create conflicts code/license/linked user/inactive specialty and 400/404',
        async () => {
          const active = (await raw('/api/v1/doctors/' + d1)).data
          const base = {
            userId: '5',
            specialtyId: s1,
            doctorCode: 'FE_REJECT_' + nonce,
          }
          for (const [body, expected] of [
            [{ ...base, doctorCode: active.doctorCode }, 'DOCTOR_CODE_EXISTS'],
            [
              { ...base, licenseNumber: active.licenseNumber },
              'LICENSE_NUMBER_EXISTS',
            ],
            [
              { ...base, userId: ids.users.DOCTOR_LINKED },
              'USER_ALREADY_LINKED',
            ],
            [{ ...base, userId: ids.users.ADMIN }, 'USER_NOT_ELIGIBLE'],
            [{ ...base, specialtyId: s3 }, 'SPECIALTY_INACTIVE'],
          ]) {
            const result = await raw('/api/v1/doctors', 'post', body)
            assert(result.status === 409 && result.code === expected)
          }
          assert(
            (
              await raw('/api/v1/doctors', 'post', {
                ...base,
                specialtyId: '9223372036854775806',
              })
            ).status === 404,
          )
          assert(
            (await raw('/api/v1/specialties', 'post', { code: '!', name: '' }))
              .status === 400,
          )
          for (const params of [
            { page: -1 },
            { size: 101 },
            { q: 'X'.repeat(121) },
          ])
            assert(
              (await raw('/api/v1/doctors', 'get', null, params)).status ===
                400,
            )
          assert(
            (await raw('/api/v1/doctors/9223372036854775806')).status === 404,
          )
          assert(
            (await raw('/api/v1/doctors/eligible-users')).data.items[0].id ===
              '5',
          )
        },
      )
      await check(
        'ADMIN UI eligible selection, license 409 recovery, real doctor POST 201 and eligibility consumed only in copy',
        async () => {
          await navigate('doctors')
          await page
            .getByRole('button', { name: 'Thêm bác sĩ', exact: true })
            .click()
          await wait(
            async () =>
              !(await dialog()
                .getByRole('button', { name: 'Lưu thông tin', exact: true })
                .isDisabled()),
          )
          await dialog()
            .getByRole('button', { name: 'Lưu thông tin', exact: true })
            .click()
          await visible(
            dialog().getByText('Vui lòng chọn tài khoản bác sĩ hợp lệ.', {
              exact: true,
            }),
          )
          await dialog()
            .getByLabel('Tài khoản bác sĩ', { exact: true })
            .selectOption('5')
          await dialog()
            .getByLabel('Chuyên khoa', { exact: true })
            .selectOption(qa.created.specialty.id)
          await fill(dialog(), 'Mã bác sĩ', docCode.toLowerCase())
          await fill(
            dialog(),
            'Số giấy phép',
            (await raw('/api/v1/doctors/' + d1)).data.licenseNumber,
          )
          await fill(
            dialog(),
            'Giới thiệu chuyên môn',
            'Synthetic real FE doctor',
          )
          const duplicate = response('/api/v1/doctors', 'POST')
          await dialog()
            .getByRole('button', { name: 'Lưu thông tin', exact: true })
            .click()
          const rejected = await duplicate
          assert(
            rejected.status() === 409 &&
              (await rejected.json()).code === 'LICENSE_NUMBER_EXISTS',
          )
          await visible(
            dialog()
              .getByText('Số giấy phép đã được sử dụng.', { exact: true })
              .first(),
          )
          assert(
            (await dialog()
              .getByLabel('Tài khoản bác sĩ', { exact: true })
              .inputValue()) === '5',
          )
          await fill(dialog(), 'Số giấy phép', license.toLowerCase())
          const created = await save('/api/v1/doctors', 'POST'),
            item = (await created.json()).data
          assert(
            created.status() === 201 &&
              item.userId === '5' &&
              item.doctorCode === docCode &&
              item.licenseNumber === license,
          )
          assert(
            Object.keys(created.request().postDataJSON()).sort().join(',') ===
              'biography,doctorCode,licenseNumber,specialtyId,userId',
          )
          qa.created.doctor = item
          await persist()
          const eligible = await raw('/api/v1/doctors/eligible-users')
          assert(
            eligible.data.totalElements === 0 &&
              !eligible.data.items.some((value) => value.id === '5'),
          )
          await page
            .getByRole('button', { name: 'Thêm bác sĩ', exact: true })
            .click()
          await visible(
            dialog().getByText(
              'Không có tài khoản bác sĩ khả dụng. Cần tài khoản DOCTOR ACTIVE chưa liên kết.',
              { exact: true },
            ),
          )
          assert(
            (await dialog()
              .getByLabel('Tài khoản bác sĩ', { exact: true })
              .locator('option[value="5"]')
              .count()) === 0,
          )
          await page.keyboard.press('Escape')
        },
      )
      await check(
        'Doctor GET/PATCH editing uses immutable userId and official whitelist; optional text clears',
        async () => {
          await search('doctors', docCode)
          await openEdit('doctors', docCode)
          assert(
            await dialog()
              .getByLabel('Tài khoản bác sĩ', { exact: true })
              .isDisabled(),
          )
          await fill(dialog(), 'Mã bác sĩ', docCode + '_U')
          await fill(dialog(), 'Số giấy phép', '')
          await fill(
            dialog(),
            'Giới thiệu chuyên môn',
            'Updated doctor biography',
          )
          await dialog()
            .getByLabel('Chuyên khoa', { exact: true })
            .selectOption(s2)
          const result = await save('/api/v1/doctors/' + qa.created.doctor.id),
            body = result.request().postDataJSON(),
            updated = (await result.json()).data
          assert(
            result.status() === 200 &&
              Object.keys(body).sort().join(',') ===
                'biography,doctorCode,licenseNumber,specialtyId' &&
              updated.userId === '5' &&
              updated.licenseNumber === null &&
              updated.specialtyId === s2,
          )
          qa.created.doctor = updated
          await persist()
          const denied = await raw('/api/v1/doctors/' + updated.id, 'patch', {
            userId: ids.users.DOCTOR_LINKED,
          })
          assert(denied.status === 400)
          const conflict = await raw('/api/v1/doctors/' + updated.id, 'patch', {
            doctorCode: 'D03_QA_DOC_ACTIVE',
            biography: 'MUST_NOT_PERSIST',
          })
          assert(
            conflict.status === 409 && conflict.code === 'DOCTOR_CODE_EXISTS',
          )
          const persisted = (await raw('/api/v1/doctors/' + updated.id)).data
          assert(
            persisted.userId === '5' &&
              persisted.biography === 'Updated doctor biography' &&
              persisted.doctorCode === docCode + '_U',
          )
        },
      )
      await check(
        'Doctor status cancel/confirm, inactive-specialty activation conflict, no hard delete',
        async () => {
          stage('status cancel and focus')
          const currentCode = qa.created.doctor.doctorCode
          await loaded('doctors')
          const trigger = card('doctors', currentCode).getByRole('button', {
            name: /^Tắt hoạt động /,
          })
          await trigger.click()
          await page
            .getByRole('alertdialog')
            .getByRole('button', { name: 'Hủy', exact: true })
            .click()
          await wait(() =>
            trigger.evaluate((element) => element === document.activeElement),
          )
          await toggle('doctors', currentCode, false)
          stage('status move to owned specialty')
          assert(
            (
              await raw('/api/v1/doctors/' + qa.created.doctor.id, 'patch', {
                specialtyId: qa.created.specialty.id,
              })
            ).status === 200,
          )
          assert(
            (
              await raw(
                '/api/v1/specialties/' + qa.created.specialty.id,
                'patch',
                { isActive: false },
              )
            ).status === 200,
          )
          const inactive = await raw(
            '/api/v1/doctors/' + qa.created.doctor.id,
            'patch',
            { isActive: true },
          )
          assert(
            inactive.status === 409 && inactive.code === 'SPECIALTY_INACTIVE',
          )
          assert(
            (
              await raw(
                '/api/v1/specialties/' + qa.created.specialty.id,
                'patch',
                { isActive: true },
              )
            ).status === 200,
          )
          await navigate('doctors')
          await search('doctors', currentCode)
          stage('status activation UI')
          await toggle('doctors', currentCode, true)
          stage('status deactivation UI')
          await toggle('doctors', currentCode, false)
          stage('status no hard delete controls')
          assert(
            (await page
              .getByRole('button', {
                name: /^Xóa (bác sĩ|chuyên khoa)|^Delete/i,
              })
              .count()) === 0,
          )
          stage('status server DELETE denial without browser CORS preflight')
          // DELETE is excluded from the browser CORS allowlist. Exercise the
          // server deny rule with real HTTP separately, without spoofing a response.
          const token = await page.evaluate(
            async () =>
              (await import('/src/auth/session-store.ts')).getAuthSnapshot()
                .accessToken,
          )
          const denied = await page.request.delete(
            qa.apiURL + '/api/v1/doctors/' + qa.created.doctor.id,
            { headers: { Authorization: 'Bearer ' + token } },
          )
          http.push({
            method: 'DELETE',
            path: '/api/v1/doctors/' + qa.created.doctor.id,
            status: denied.status(),
            channel: 'real APIRequestContext',
          })
          assert(
            denied.status() === 403 &&
              (await denied.json()).code === 'ACCESS_DENIED',
          )
          await dismiss()
          stage('status record still exists')
          assert(
            (await raw('/api/v1/doctors/' + qa.created.doctor.id)).status ===
              200,
          )
          await navigate('specialties')
          await search('specialties', qa.created.specialty.code)
          await toggle('specialties', qa.created.specialty.code, false)
        },
      )
      await check(
        'Real UI pagination after synthetic API seeds, loading/empty and stale request cancellation',
        async () => {
          for (let i = 0; i < 6; i++) {
            const code = 'FE_PAGE_' + nonce + '_' + i
            assert(
              (
                await raw('/api/v1/specialties', 'post', {
                  code,
                  name: 'QA FE page ' + nonce + ' ' + i,
                })
              ).status === 201,
            )
            qa.created.pageCodes.push(code)
          }
          await persist()
          await navigate('specialties')
          await search('specialties', '')
          assert(
            (await region('specialties').getByRole('listitem').count()) === 10,
          )
          await page
            .getByRole('button', { name: 'Trang sau', exact: true })
            .click()
          await loaded('specialties')
          assert(
            (await region('specialties').getByRole('listitem').count()) === 1,
          )
          await page
            .getByRole('button', { name: 'Trang trước', exact: true })
            .click()
          await loaded('specialties')
          let release,
            held = false
          const gate = new Promise((resolve) => {
              release = resolve
            }),
            pattern = qa.apiURL + '/api/v1/specialties?**'
          const handler = async (route) => {
            if (
              new URL(route.request().url()).searchParams.get('q') ===
              'D03_QA_S1_ACTIVE'
            ) {
              held = true
              await gate
            }
            await route.continue().catch(() => {})
          }
          await page.route(pattern, handler)
          try {
            await fill(page, 'Tìm kiếm chuyên khoa', 'D03_QA_S1_ACTIVE')
            await wait(() => held)
            assert(
              (await region('specialties').getAttribute('aria-busy')) ===
                'true' &&
                (await region('specialties').getByRole('listitem').count()) ===
                  0,
            )
            await fill(page, 'Tìm kiếm chuyên khoa', qa.created.pageCodes[0])
            await loaded('specialties')
            release()
            await page.waitForTimeout(150)
            assert(
              (await card('specialties', qa.created.pageCodes[0]).count()) ===
                1 &&
                (await card('specialties', 'D03_QA_S1_ACTIVE').count()) === 0,
            )
          } finally {
            release()
            await page.unroute(pattern, handler)
          }
          await search('specialties', 'NO_MATCH_' + nonce)
          await visible(
            page.getByRole('heading', {
              name: 'Không tìm thấy chuyên khoa',
              exact: true,
            }),
          )
        },
      )
    } else if (phase === 'security') {
      for (const actor of [
        'ADMIN',
        'RECEPTIONIST',
        'DOCTOR_LINKED',
        'PATIENT',
      ]) {
        await check(
          actor +
            ' real session responsive, Light/Dark, keyboard/mobile navigation and logout',
          async () => {
            await login(actor)
            await navigate('doctors')
            for (const width of [320, 768, 1440]) {
              await page.setViewportSize({ width, height: 900 })
              assert(
                await page.evaluate(
                  () => document.documentElement.scrollWidth <= innerWidth,
                ),
              )
            }
            await page.setViewportSize({ width: 390, height: 844 })
            const trigger = page.getByRole('button', {
              name: 'Mở menu điều hướng',
              exact: true,
            })
            await trigger.click()
            const menu = page.getByRole('dialog', { name: 'Menu điều hướng' })
            await visible(menu)
            for (let i = 0; i < 12; i++) await page.keyboard.press('Tab')
            assert(
              await menu.evaluate((element) =>
                element.contains(document.activeElement),
              ),
            )
            await page.keyboard.press('Escape')
            await wait(() =>
              trigger.evaluate((element) => element === document.activeElement),
            )
            await trigger.click()
            await menu
              .getByRole('link', { name: 'Cài đặt', exact: true })
              .click()
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
            await page
              .getByRole('button', { name: 'Sáng', exact: true })
              .click()
            assert(
              await page
                .locator('html')
                .evaluate((element) => !element.classList.contains('dark')),
            )
            await logout()
            await spa('/doctors')
            await visible(
              page.getByRole('heading', {
                name: 'Chào mừng trở lại',
                level: 1,
              }),
            )
            await page.waitForURL((url) => url.pathname === '/login')
          },
        )
      }
      await check(
        'Real offline network error and successful online retry',
        async () => {
          await login('ADMIN')
          await navigate('doctors')
          await page.context().setOffline(true)
          try {
            await fill(page, 'Tìm kiếm bác sĩ', 'offline-qa')
            await visible(
              page.getByRole('heading', {
                name: 'Không thể tải danh mục',
                exact: true,
              }),
            )
          } finally {
            await page.context().setOffline(false)
          }
          const pending = page.waitForResponse(
            (result) =>
              result.url().startsWith(qa.apiURL + '/api/v1/doctors?') &&
              result.status() === 200,
          )
          await page
            .getByRole('button', { name: 'Thử lại', exact: true })
            .click()
          await pending
          await loaded('doctors')
        },
      )
      await check(
        'D02 real wrong Login, invalid JWT 401, cleared auth, reload and no persistent token',
        async () => {
          await logout()
          await fill(page, 'Email', qa.accounts.ADMIN.email)
          await fill(page, 'Mật khẩu', crypto.randomUUID())
          const wrong = response('/api/v1/auth/login', 'POST')
          await page
            .getByRole('button', { name: 'Đăng nhập', exact: true })
            .click()
          assert((await wrong).status() === 401)
          await visible(
            page.getByText('Email hoặc mật khẩu không đúng.', { exact: true }),
          )
          await login('ADMIN')
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
          await login('PATIENT')
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
                !window.__d03Acceptance &&
                !state.accessToken &&
                !state.user &&
                sessionStorage.length === 0 &&
                Object.keys(localStorage).every((key) => key === 'clinic-theme')
              )
            }),
          )
        },
      )
    } else throw new Error('UNKNOWN_PHASE')
    assert(errors.length === 0)
    assert(consoleErrors.length === 0)
    assert(leaks.length === 0)
    return {
      source: 'REAL CHROME + REAL D03 HTTP + MYSQL QA COPY',
      phase,
      checks,
      http,
      runtimeErrors: errors.length,
      unexpectedConsoleErrors: consoleErrors.length,
      sensitiveConsoleOutput: leaks.length,
      mockUsed: false,
      sourceFixtureProtected: true,
      screenshotsCreated: 0,
      credentialsRecorded: false,
    }
  } finally {
    page.removeListener('response', observe)
    page.removeListener('pageerror', observeError)
    page.removeListener('console', observeConsole)
    await page.context().setOffline(false)
  }
}
