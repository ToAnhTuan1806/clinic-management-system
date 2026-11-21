// Sprint 1 acceptance: real HTTP only; credentials stay in private host/Chrome RAM.
// No screenshots, video, trace, HAR, token values or response bodies in results.
export async function runSprint1Real(page, { phase, skip = 0 }) {
  page.setDefaultTimeout(12000)
  const qa = await page.evaluate(() => window.__d03Acceptance)
  if (!qa?.scopeVerified || !qa.sourceProtected)
    throw Error('SAFE_HANDOFF_REQUIRED')
  const checks = [],
    http = [],
    runtime = [],
    consoleErrors = [],
    leaks = []
  let step = phase
  let checkIndex = 0
  const assert = (value) => {
    if (!value) throw Error('ASSERTION')
  }
  const visible = (locator) => locator.waitFor({ state: 'visible' })
  const wait = async (fn) => {
    const end = Date.now() + 12000
    while (Date.now() < end) {
      if (await fn()) return
      await page.waitForTimeout(30)
    }
    throw Error('STATE_TIMEOUT')
  }
  const stage = (name) => {
    step = name
  }
  const check = async (label, action) => {
    if (++checkIndex <= skip) return
    step = label
    try {
      await action()
    } catch (error) {
      throw Error(
        'SPRINT1 ' + phase + ' / ' + label + ' / ' + step + ' / ' + error.name,
      )
    }
    checks.push({
      label,
      result: 'PASS',
      source: 'REAL HTTP / CHROME / MYSQL COPY',
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
  const observeRuntime = () => runtime.push('runtime')
  const observeConsole = (message) => {
    const text = message.text()
    if (
      Object.values(qa.accounts).some(
        (a) => text.includes(a.password) || text.includes(a.email),
      ) ||
      /\beyJ[\w-]+\.[\w-]+\.[\w-]+\b|\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}/.test(
        text,
      )
    )
      leaks.push('sensitive output')
    if (
      message.type() === 'error' &&
      !/^Failed to load resource: (the server responded with a status of (400|401|403|404|409)\b|net::ERR_)/.test(
        text,
      )
    )
      consoleErrors.push('unexpected error')
  }
  page.on('response', observe)
  page.on('pageerror', observeRuntime)
  page.on('console', observeConsole)
  const spa = (path) =>
    page.evaluate((path) => {
      history.pushState(null, '', path)
      dispatchEvent(new PopStateEvent('popstate'))
    }, path)
  const raw = (path, method = 'get', data = null, params = null) =>
    page.evaluate(
      async ({ path, method, data, params }) => {
        const { apiClient } = await import('/src/lib/api-client.ts')
        try {
          const response = await apiClient.request({
            url: path,
            method,
            ...(data !== null ? { data } : {}),
            ...(params ? { params } : {}),
          })
          return { status: response.status, data: response.data.data }
        } catch (error) {
          return { status: error.status, code: error.code }
        }
      },
      { path, method, data, params },
    )
  const response = (path, method) => {
    const pending = page.waitForResponse(
      (r) =>
        new URL(r.url()).origin === qa.apiURL &&
        new URL(r.url()).pathname === path &&
        r.request().method() === method,
    )
    pending.catch(() => {})
    return pending
  }
  const fill = async (label, value, root = page) => {
    try {
      await root.getByLabel(label, { exact: true }).fill(value)
    } catch {
      throw Error('PRIVATE_FORM_INTERACTION')
    }
  }
  const login = async (actor) => {
    stage('Login ' + actor)
    await page.setViewportSize({ width: 1280, height: 960 })
    if (
      await page.evaluate(
        async () =>
          (await import('/src/auth/session-store.ts')).getAuthSnapshot()
            .status === 'authenticated',
      )
    ) {
      await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click()
      await page.waitForURL('**/login')
    }
    await spa('/register')
    await visible(
      page.getByRole('heading', {
        name: 'Tạo tài khoản bệnh nhân',
        exact: true,
      }),
    )
    await page.getByRole('link', { name: 'Đăng nhập', exact: true }).click()
    await fill('Email', qa.accounts[actor].email)
    await fill('Mật khẩu', qa.accounts[actor].password)
    const pending = response('/api/v1/auth/login', 'POST'),
      identity = response('/api/v1/auth/me', 'GET')
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
    const signed = await pending,
      me = await identity,
      body = await signed.json(),
      user = (await me.json()).data
    assert(
      signed.status() === 200 &&
        me.status() === 200 &&
        user.id === qa.fixtureIds.users[actor] &&
        user.role === qa.accounts[actor].role,
    )
    assert(
      me.request().headers().authorization ===
        'Bearer ' + body.data.accessToken,
    )
    await page.waitForURL(
      qa.accounts[actor].role === 'PATIENT' ? '**/booking' : '**/dashboard',
    )
  }
  const profile = async () => {
    await spa('/profile')
    await visible(page.locator('#profile-fullName'))
    await wait(
      async () => !!(await page.locator('#profile-fullName').inputValue()),
    )
  }
  const patients = async () => {
    await spa('/patients')
    await visible(
      page.getByRole('heading', { name: 'Quản lý bệnh nhân', exact: true }),
    )
    await wait(
      async () =>
        (await page
          .getByRole('table', { name: 'Danh sách bệnh nhân' })
          .count()) > 0 ||
        (await page
          .getByText('Không tìm thấy bệnh nhân nào', { exact: true })
          .count()) > 0,
    )
  }
  const dialog = () => page.getByRole('dialog')
  const close = async () => {
    await page.keyboard.press('Escape')
    await wait(async () => !(await dialog().count()))
  }
  const patientFields = async (code, name, userId = '') => {
    await fill('Mã bệnh nhân *', code, dialog())
    await fill('Họ và tên *', name, dialog())
    await fill('Số điện thoại', '0900000000', dialog())
    if (userId) await fill('ID tài khoản liên kết (tùy chọn)', userId, dialog())
  }
  const addPatient = async (code, name, userId = '') => {
    await patients()
    await page
      .getByRole('button', { name: 'Thêm bệnh nhân', exact: true })
      .click()
    await visible(dialog())
    await patientFields(code, name, userId)
    const pending = response('/api/v1/patients', 'POST')
    await dialog()
      .getByRole('button', { name: 'Tạo hồ sơ', exact: true })
      .click()
    const result = await pending
    assert(result.status() === 201)
    const item = (await result.json()).data
    await wait(async () => !(await dialog().count()))
    return item
  }
  const sample = (code, name = 'Synthetic Sprint Patient') => ({
    patientCode: code,
    fullName: name,
    dateOfBirth: '2000-01-02',
    sex: 'UNKNOWN',
    phone: '0900000000',
    address: 'Synthetic QA address',
  })
  const nonce = qa.sprint?.nonce ?? Date.now().toString(36).toUpperCase()
  const records = qa.sprint ?? { nonce }
  const persist = () =>
    page.evaluate((value) => {
      window.__d03Acceptance.sprint = value
    }, records)
  try {
    await page.evaluate(async () => {
      await Promise.all([
        import('/src/pages/profile.tsx'),
        import('/src/pages/patients.tsx'),
        import('/src/pages/settings.tsx'),
        import('/src/pages/forbidden.tsx'),
      ])
    })
    if (phase === 'profiles') {
      await check(
        'All four gateways use real adapters with mock flags disabled',
        async () => {
          assert(
            await page.evaluate(async () => {
              const p = await import('/src/profile/gateway.ts'),
                t = await import('/src/patient/gateway.ts')
              return (
                p.profileGateway.mode === 'real' &&
                !p.isProfileMock &&
                t.patientGateway.mode === 'real' &&
                !t.isPatientMock
              )
            }),
          )
        },
      )
      for (const actor of [
        'ADMIN',
        'RECEPTIONIST',
        'DOCTOR_LINKED',
        'PATIENT',
      ]) {
        await check(
          actor +
            ' GET/PATCH profile, readonly identity, header/sidebar identity sync',
          async () => {
            await login(actor)
            await profile()
            const original = (await raw('/api/v1/me/profile')).data
            assert(
              original.id === qa.fixtureIds.users[actor] &&
                original.role === qa.accounts[actor].role,
            )
            assert((await page.locator('input[type=password]').count()) === 0)
            assert((await page.locator('input').count()) === 3)
            await fill('Họ và tên *', '')
            await page
              .getByRole('button', { name: 'Lưu thay đổi', exact: true })
              .click()
            assert(
              await page
                .locator('#profile-fullName')
                .evaluate((e) => document.activeElement === e),
            )
            const name = 'Synthetic ' + actor + ' ' + nonce
            await fill('Họ và tên *', name)
            await fill('Số điện thoại liên hệ', '0900000000')
            await fill(
              'Địa chỉ thường trú / liên hệ',
              'Synthetic Sprint QA ' + actor,
            )
            const pending = response('/api/v1/me/profile', 'PATCH')
            await page
              .getByRole('button', { name: 'Lưu thay đổi', exact: true })
              .click()
            const saved = await pending
            assert(saved.status() === 200)
            assert(
              Object.keys(saved.request().postDataJSON()).sort().join(',') ===
                'address,fullName,phone',
            )
            await visible(
              page.getByText('Hồ sơ cá nhân đã được cập nhật thành công.', {
                exact: true,
              }),
            )
            assert(
              (await page
                .locator('aside')
                .getByText(name, { exact: true })
                .count()) === 1,
            )
            assert(
              (await page
                .locator('header')
                .getByText(name, { exact: true })
                .count()) === 1,
            )
            const after = (await raw('/api/v1/me/profile')).data
            for (const key of ['id', 'email', 'role', 'status'])
              assert(after[key] === original[key])
            assert(
              after.fullName === name &&
                after.phone === '0900000000' &&
                after.address === 'Synthetic Sprint QA ' + actor,
            )
            await spa('/doctors')
            await spa('/profile')
            await visible(page.locator('#profile-fullName'))
            await wait(
              async () =>
                (await page.locator('#profile-fullName').inputValue()) === name,
            )
          },
        )
      }
      await check(
        'Real profile 400 readonly fields, length validation and trimmed nullable contacts',
        async () => {
          await login('ADMIN')
          for (const body of [
            { role: 'PATIENT' },
            { email: 'immutable@example.invalid' },
            { id: '3' },
            { status: 'DISABLED' },
            { password: '<rejected-not-a-secret>' },
            { fullName: ' ' },
            { phone: 'x'.repeat(25) },
            { address: 'x'.repeat(256) },
          ])
            assert(
              (await raw('/api/v1/me/profile', 'patch', body)).status === 400,
            )
          const original = (await raw('/api/v1/me/profile')).data
          const result = await raw('/api/v1/me/profile', 'patch', {
            fullName: original.fullName,
            phone: '  ',
            address: '  ',
          })
          assert(
            result.status === 200 &&
              result.data.phone === null &&
              result.data.address === null,
          )
        },
      )
      await check(
        'Profile short contact and whitespace clearing through the real form',
        async () => {
          await profile()
          await fill('Số điện thoại liên hệ', '123')
          let pending = response('/api/v1/me/profile', 'PATCH')
          await page
            .getByRole('button', { name: 'Lưu thay đổi', exact: true })
            .click()
          let saved = await pending
          assert(
            saved.status() === 200 && (await saved.json()).data.phone === '123',
          )
          await visible(
            page.getByText('Hồ sơ cá nhân đã được cập nhật thành công.', {
              exact: true,
            }),
          )
          await fill('Số điện thoại liên hệ', '  ')
          pending = response('/api/v1/me/profile', 'PATCH')
          await page
            .getByRole('button', { name: 'Lưu thay đổi', exact: true })
            .click()
          saved = await pending
          assert(
            saved.status() === 200 && (await saved.json()).data.phone === null,
          )
        },
      )
      await check(
        'Profile real loading state locks repeated submit until PATCH completes',
        async () => {
          await login('ADMIN')
          await profile()
          await fill('Địa chỉ thường trú / liên hệ', 'Synthetic locked update')
          const pattern = qa.apiURL + '/api/v1/me/profile'
          let release,
            arrived,
            count = 0
          const gate = new Promise((resolve) => {
              release = resolve
            }),
            started = new Promise((resolve) => {
              arrived = resolve
            })
          await page.route(pattern, async (route) => {
            if (route.request().method() === 'PATCH') {
              count++
              arrived()
              await gate
            }
            await route.continue().catch(() => {})
          })
          try {
            const pending = response('/api/v1/me/profile', 'PATCH')
            await page
              .getByRole('button', { name: 'Lưu thay đổi', exact: true })
              .click()
            await started
            assert(
              await page
                .getByRole('button', { name: 'Đang lưu…', exact: true })
                .isDisabled(),
            )
            await page.locator('form').dispatchEvent('submit')
            await page.locator('form').dispatchEvent('submit')
            assert(count === 1)
            release()
            assert((await pending).status() === 200)
            await visible(
              page.getByText('Hồ sơ cá nhân đã được cập nhật thành công.', {
                exact: true,
              }),
            )
            assert(count === 1)
          } finally {
            release()
            await page.unroute(pattern)
          }
        },
      )
      await check(
        'Profile offline read/write show errors, retain form, no fake success',
        async () => {
          await profile()
          await fill('Họ và tên *', 'Synthetic offline unsaved')
          await page.context().setOffline(true)
          try {
            await page
              .getByRole('button', { name: 'Lưu thay đổi', exact: true })
              .click()
            await visible(
              page.getByText(
                'Không thể kết nối hồ sơ cá nhân. Vui lòng thử lại.',
                { exact: true },
              ),
            )
            assert(
              !(await page
                .getByText('Hồ sơ cá nhân đã được cập nhật thành công.', {
                  exact: true,
                })
                .count()),
            )
            assert(
              (await page.locator('#profile-fullName').inputValue()) ===
                'Synthetic offline unsaved',
            )
          } finally {
            await page.context().setOffline(false)
          }
          await spa('/settings')
          await visible(
            page.getByRole('heading', {
              name: 'Cài đặt không gian làm việc',
              exact: true,
            }),
          )
          await page.context().setOffline(true)
          try {
            await spa('/profile')
            await visible(
              page.getByText(
                'Không thể kết nối hồ sơ cá nhân. Vui lòng thử lại.',
                { exact: true },
              ),
            )
            assert(
              !(await page
                .getByRole('button', { name: 'Lưu thay đổi', exact: true })
                .count()),
            )
          } finally {
            await page.context().setOffline(false)
          }
          await page
            .getByRole('button', { name: 'Thử lại', exact: true })
            .click()
          await visible(page.locator('#profile-fullName'))
        },
      )
    } else if (phase === 'patients') {
      await check(
        'ADMIN patient create validation and real POST, dialog closes',
        async () => {
          await login('ADMIN')
          await patients()
          await page
            .getByRole('button', { name: 'Thêm bệnh nhân', exact: true })
            .click()
          await visible(dialog())
          await dialog()
            .getByRole('button', { name: 'Tạo hồ sơ', exact: true })
            .click()
          assert(
            await dialog()
              .locator('#patient-field-patientCode')
              .evaluate((e) => document.activeElement === e),
          )
          await close()
          records.linked = await addPatient(
            'D05_LINK_' + nonce,
            'Synthetic linked ' + nonce,
            qa.fixtureIds.users.PATIENT,
          )
          await persist()
        },
      )
      await check(
        'ADMIN patient PATCH, details GET, duplicate phone accepted',
        async () => {
          records.other = await addPatient(
            'D05_OTHER_' + nonce,
            'Synthetic family ' + nonce,
          )
          assert(
            records.other.phone === records.linked.phone &&
              records.other.id !== records.linked.id,
          )
          await page
            .getByRole('button', {
              name: 'Chỉnh sửa ' + records.other.fullName,
              exact: true,
            })
            .click()
          await visible(
            dialog().getByRole('button', { name: 'Lưu thay đổi', exact: true }),
          )
          await fill('Họ và tên *', 'Synthetic edited ' + nonce, dialog())
          await fill('Địa chỉ', 'Synthetic edited address', dialog())
          const pending = response(
            '/api/v1/patients/' + records.other.id,
            'PATCH',
          )
          await dialog()
            .getByRole('button', { name: 'Lưu thay đổi', exact: true })
            .click()
          assert((await pending).status() === 200)
          await wait(async () => !(await dialog().count()))
          records.other.fullName = 'Synthetic edited ' + nonce
          await persist()
          const detail = (await raw('/api/v1/patients/' + records.other.id))
            .data
          assert(
            detail.fullName === records.other.fullName &&
              detail.address === 'Synthetic edited address',
          )
          await page
            .getByRole('button', {
              name: 'Xem chi tiết ' + records.other.fullName,
              exact: true,
            })
            .click()
          await visible(
            dialog().getByText(records.other.patientCode, { exact: true }),
          )
          await close()
        },
      )
      await check(
        'Duplicate patient code UI 409 retains form, no fake success',
        async () => {
          await page
            .getByRole('button', { name: 'Thêm bệnh nhân', exact: true })
            .click()
          await patientFields(records.linked.patientCode, 'Synthetic duplicate')
          const pending = response('/api/v1/patients', 'POST')
          await dialog()
            .getByRole('button', { name: 'Tạo hồ sơ', exact: true })
            .click()
          assert((await pending).status() === 409)
          await visible(
            dialog()
              .getByText('Mã bệnh nhân đã tồn tại trong hệ thống.', {
                exact: true,
              })
              .first(),
          )
          assert(
            (await dialog().locator('#patient-field-fullName').inputValue()) ===
              'Synthetic duplicate',
          )
          await close()
        },
      )
      await check(
        'Soft delete/reactivate confirmation, focus restore and no hard delete',
        async () => {
          for (const active of [false, true]) {
            const trigger = page.getByRole('button', {
              name:
                (active ? 'Kích hoạt lại ' : 'Ngừng hoạt động ') +
                records.other.fullName,
              exact: true,
            })
            await trigger.click()
            const confirm = page.getByRole('alertdialog')
            await visible(confirm)
            if (!active) {
              await confirm
                .getByRole('button', { name: 'Hủy', exact: true })
                .click()
              await wait(async () => !(await confirm.count()))
              assert(
                await trigger.evaluate((e) => e === document.activeElement),
              )
              await trigger.click()
            }
            const pending = response(
              '/api/v1/patients/' + records.other.id,
              'PATCH',
            )
            await confirm
              .getByRole('button', { name: 'Xác nhận', exact: true })
              .click()
            assert((await pending).status() === 200)
            await wait(async () => !(await confirm.count()))
            assert(
              (await raw('/api/v1/patients/' + records.other.id)).data
                .isActive === active,
            )
          }
          assert(
            !(await page
              .getByRole('button', { name: /^Xóa bệnh nhân|^Delete/ })
              .count()),
          )
        },
      )
      await check(
        'Patient search by code/name/phone, status filter, real pagination and empty state',
        async () => {
          for (const q of [
            records.linked.patientCode,
            records.linked.fullName,
            records.linked.phone,
          ]) {
            await fill('Tìm kiếm bệnh nhân', q)
            await wait(
              async () =>
                (await page
                  .getByRole('table')
                  .getByText(records.linked.patientCode, { exact: true })
                  .count()) === 1,
            )
          }
          await fill('Tìm kiếm bệnh nhân', 'NO_MATCH_' + nonce)
          await visible(
            page.getByText('Không tìm thấy bệnh nhân nào', { exact: true }),
          )
          await fill('Tìm kiếm bệnh nhân', '')
          for (let i = 0; i < 10; i++)
            assert(
              (
                await raw(
                  '/api/v1/patients',
                  'post',
                  sample(
                    'D05_PAGE_' + nonce + '_' + i,
                    'Synthetic paging ' + i,
                  ),
                )
              ).status === 201,
            )
          await spa('/settings')
          await visible(
            page.getByRole('heading', {
              name: 'Cài đặt không gian làm việc',
              exact: true,
            }),
          )
          await patients()
          await page
            .getByRole('button', { name: 'Trang sau', exact: true })
            .click()
          await wait(
            async () => (await page.getByText(/Trang 2 \/ 2/).count()) === 1,
          )
          assert(
            (await raw('/api/v1/patients', 'get', null, { page: 1, size: 10 }))
              .data.items.length === 2,
          )
          await page
            .getByRole('button', { name: 'Trang trước', exact: true })
            .click()
          assert(
            (
              await raw('/api/v1/patients/' + records.other.id, 'patch', {
                isActive: false,
              })
            ).status === 200,
          )
          await page
            .getByRole('button', { name: 'Ngừng hoạt động', exact: true })
            .click()
          await wait(
            async () =>
              (await page
                .getByRole('table')
                .getByText(records.other.patientCode, { exact: true })
                .count()) === 1,
          )
          assert(
            (await page
              .getByRole('table')
              .getByText(records.linked.patientCode, { exact: true })
              .count()) === 0,
          )
          await page
            .getByRole('button', { name: 'Hoạt động', exact: true })
            .click()
          await wait(
            async () =>
              (await page
                .getByRole('table')
                .getByText(records.other.patientCode, { exact: true })
                .count()) === 0,
          )
          await raw('/api/v1/patients/' + records.other.id, 'patch', {
            isActive: true,
          })
        },
      )
      await check(
        'Patient 400/404/409 real validation and invalid linking',
        async () => {
          for (const body of [
            { ...sample('BAD ' + nonce) },
            { ...sample('D05_FUT_' + nonce), dateOfBirth: '2999-01-01' },
          ])
            assert((await raw('/api/v1/patients', 'post', body)).status === 400)
          assert(
            (await raw('/api/v1/patients/' + records.other.id, 'patch', {}))
              .status === 400,
          )
          assert(
            (await raw('/api/v1/patients/9223372036854775806')).status === 404,
          )
          for (const [userId, status, code] of [
            [qa.fixtureIds.users.ADMIN, 409, 'USER_NOT_ELIGIBLE'],
            [qa.fixtureIds.users.PATIENT, 409, 'USER_ALREADY_LINKED'],
            ['9223372036854775806', 404, 'RESOURCE_NOT_FOUND'],
          ]) {
            const result = await raw('/api/v1/patients', 'post', {
              ...sample('D05_LINK_FAIL_' + nonce),
              userId,
            })
            assert(result.status === status && result.code === code)
          }
          const token = await page.evaluate(
            async () =>
              (await import('/src/auth/session-store.ts')).getAuthSnapshot()
                .accessToken,
          )
          const denied = await page.request.delete(
            qa.apiURL + '/api/v1/patients/' + records.other.id,
            { headers: { Authorization: 'Bearer ' + token } },
          )
          http.push({
            method: 'DELETE',
            path: '/api/v1/patients/' + records.other.id,
            status: denied.status(),
            channel: 'real APIRequestContext',
          })
          assert(denied.status() === 403)
        },
      )
      await check(
        'RECEPTIONIST real create/edit and clinic-wide reads',
        async () => {
          await login('RECEPTIONIST')
          records.reception = await addPatient(
            'D05_REC_' + nonce,
            'Synthetic reception ' + nonce,
          )
          await fill('Tìm kiếm bệnh nhân', records.reception.patientCode)
          await page
            .getByRole('button', {
              name: 'Chỉnh sửa ' + records.reception.fullName,
              exact: true,
            })
            .click()
          await visible(
            dialog().getByRole('button', { name: 'Lưu thay đổi', exact: true }),
          )
          await fill('Địa chỉ', 'Reception desk QA', dialog())
          await fill(
            'Họ và tên *',
            'Synthetic reception edited ' + nonce,
            dialog(),
          )
          const pending = response(
            '/api/v1/patients/' + records.reception.id,
            'PATCH',
          )
          await dialog()
            .getByRole('button', { name: 'Lưu thay đổi', exact: true })
            .click()
          assert((await pending).status() === 200)
          await wait(async () => !(await dialog().count()))
          await persist()
        },
      )
      await check(
        'DOCTOR denied clinic-wide patient list/detail/write, no leaked records',
        async () => {
          await login('DOCTOR_LINKED')
          await spa('/patients')
          await visible(
            page.getByRole('heading', {
              name: 'Bạn không có quyền truy cập màn hình này',
              exact: true,
            }),
          )
          for (const [path, method, body] of [
            ['/api/v1/patients', 'get', null],
            ['/api/v1/patients/' + records.linked.id, 'get', null],
            ['/api/v1/patients', 'post', sample('D05_DENIED')],
            [
              '/api/v1/patients/' + records.linked.id,
              'patch',
              { fullName: 'Denied' },
            ],
          ])
            assert((await raw(path, method, body)).status === 403)
          assert(
            !(await page
              .getByText(records.linked.patientCode, { exact: true })
              .count()),
          )
          assert(
            !(await page
              .getByRole('button', { name: 'Thêm bệnh nhân', exact: true })
              .count()),
          )
        },
      )
      await check(
        'PATIENT linked-only view and 404 ownership, no auto-sync with personal contacts',
        async () => {
          await login('PATIENT')
          await spa('/patients')
          await visible(
            page.getByRole('heading', {
              name: 'Bạn không có quyền truy cập màn hình này',
              exact: true,
            }),
          )
          await profile()
          await visible(
            page.getByText(records.linked.patientCode, { exact: true }),
          )
          assert(
            !(await page
              .getByText(records.other.patientCode, { exact: true })
              .count()),
          )
          assert((await raw('/api/v1/patients')).status === 403)
          assert(
            (await raw('/api/v1/patients/' + records.other.id)).status === 404,
          )
          assert(
            (await raw('/api/v1/patients/' + records.linked.id)).status === 200,
          )
          assert(
            (
              await raw('/api/v1/patients/' + records.linked.id, 'patch', {
                userId: qa.fixtureIds.users.ADMIN,
              })
            ).status === 403,
          )
          const before = (await raw('/api/v1/me/patient-profile')).data
          await profile()
          await fill('Số điện thoại liên hệ', '0911111111')
          await fill(
            'Địa chỉ thường trú / liên hệ',
            'Separate personal contact',
          )
          const pending = response('/api/v1/me/profile', 'PATCH')
          await page
            .getByRole('button', { name: 'Lưu thay đổi', exact: true })
            .click()
          assert((await pending).status() === 200)
          await visible(
            page.getByText('Hồ sơ cá nhân đã được cập nhật thành công.', {
              exact: true,
            }),
          )
          const after = (await raw('/api/v1/me/patient-profile')).data
          assert(
            after.phone === before.phone && after.address === before.address,
          )
        },
      )
      await check(
        'Patient real loading locks submit and modal close, then restores focus',
        async () => {
          await login('ADMIN')
          await patients()
          const trigger = page.getByRole('button', {
            name: 'Thêm bệnh nhân',
            exact: true,
          })
          await trigger.click()
          await patientFields('D05_LOCK_' + nonce, 'Synthetic locked patient')
          await fill('Số điện thoại', '123', dialog())
          const pattern = qa.apiURL + '/api/v1/patients'
          let release,
            arrived,
            count = 0
          const gate = new Promise((resolve) => {
              release = resolve
            }),
            started = new Promise((resolve) => {
              arrived = resolve
            })
          await page.route(pattern, async (route) => {
            if (route.request().method() === 'POST') {
              count++
              arrived()
              await gate
            }
            await route.continue().catch(() => {})
          })
          try {
            const pending = response('/api/v1/patients', 'POST')
            await dialog()
              .getByRole('button', { name: 'Tạo hồ sơ', exact: true })
              .click()
            await started
            assert(
              await dialog()
                .getByRole('button', { name: 'Đang lưu…', exact: true })
                .isDisabled(),
            )
            await dialog().locator('form').dispatchEvent('submit')
            await dialog().locator('form').dispatchEvent('submit')
            await page.keyboard.press('Escape')
            assert(await dialog().isVisible())
            assert(count === 1)
            release()
            const saved = await pending
            assert(
              saved.status() === 201 &&
                (await saved.json()).data.phone === '123',
            )
            await wait(async () => !(await dialog().count()))
            assert(count === 1)
            assert(await trigger.evaluate((e) => document.activeElement === e))
          } finally {
            release()
            await page.unroute(pattern)
          }
        },
      )
      await persist()
    } else if (phase === 'security') {
      await check(
        'New PATIENT real Register, Login, unlinked empty view and duplicate email 409',
        async () => {
          await login('ADMIN')
          await page
            .getByRole('button', { name: 'Đăng xuất', exact: true })
            .click()
          await spa('/register')
          await visible(
            page.getByRole('heading', {
              name: 'Tạo tài khoản bệnh nhân',
              exact: true,
            }),
          )
          const email = 'sprint-' + nonce.toLowerCase() + '@example.invalid',
            password = qa.accounts.PATIENT.password
          await fill('Họ và tên', 'Synthetic registered ' + nonce)
          await fill('Email', email)
          await fill('Mật khẩu', password)
          await fill('Xác nhận mật khẩu', password)
          const pending = response('/api/v1/auth/register', 'POST')
          await page
            .getByRole('button', { name: 'Đăng ký tài khoản', exact: true })
            .click()
          const result = await pending
          assert(
            result.status() === 201 &&
              (await result.json()).data.role === 'PATIENT',
          )
          await page.waitForURL('**/login')
          await fill('Email', email)
          await fill('Mật khẩu', password)
          const signed = response('/api/v1/auth/login', 'POST')
          await page
            .getByRole('button', { name: 'Đăng nhập', exact: true })
            .click()
          assert((await signed).status() === 200)
          await page.waitForURL('**/booking')
          await profile()
          await visible(
            page.getByText('Chưa có hồ sơ bệnh nhân liên kết', { exact: true }),
          )
          assert((await raw('/api/v1/me/patient-profile')).status === 404)
          const duplicate = await raw('/api/v1/auth/register', 'post', {
            fullName: 'Synthetic duplicate',
            email,
            password,
          })
          assert(duplicate.status === 409)
        },
      )
      await check(
        'Signed expired JWT rejected 401 and client session cleared',
        async () => {
          await login('ADMIN')
          const expired = await page.evaluate(async (token) => {
            const { apiClient } = await import('/src/lib/api-client.ts'),
              { getAuthSnapshot } = await import('/src/auth/session-store.ts')
            try {
              await apiClient.get('/api/v1/me/profile', {
                authMode: 'candidate',
                authSessionVersion: getAuthSnapshot().version,
                headers: { Authorization: 'Bearer ' + token },
              })
              return 200
            } catch (e) {
              return e.status
            }
          }, qa.expiredToken)
          assert(expired === 401)
          await page.waitForURL('**/login')
          assert(
            await page.evaluate(
              async () =>
                !(await import('/src/auth/session-store.ts')).getAuthSnapshot()
                  .accessToken,
            ),
          )
        },
      )
      await check(
        'Patient list offline error/retry and no fallback mock',
        async () => {
          await login('ADMIN')
          await spa('/settings')
          await visible(
            page.getByRole('heading', {
              name: 'Cài đặt không gian làm việc',
              exact: true,
            }),
          )
          await page.context().setOffline(true)
          try {
            await spa('/patients')
            await visible(
              page.getByText(
                'Không thể kết nối hồ sơ bệnh nhân. Vui lòng thử lại.',
                { exact: true },
              ),
            )
            assert(!(await page.getByRole('table').count()))
          } finally {
            await page.context().setOffline(false)
          }
          await page
            .getByRole('button', { name: 'Thử lại', exact: true })
            .click()
          await visible(
            page.getByRole('table', { name: 'Danh sách bệnh nhân' }),
          )
        },
      )
      await check(
        'Linked patient network error is distinct from unlinked 404, with retry',
        async () => {
          await login('PATIENT')
          await spa('/settings')
          await visible(
            page.getByRole('heading', {
              name: 'Cài đặt không gian làm việc',
              exact: true,
            }),
          )
          await page
            .getByRole('heading', {
              name: 'Cài đặt không gian làm việc',
              exact: true,
            })
            .waitFor()
          const pattern = qa.apiURL + '/api/v1/me/patient-profile'
          let release, arrived
          const gate = new Promise((resolve) => {
              release = resolve
            }),
            started = new Promise((resolve) => {
              arrived = resolve
            })
          await page.route(pattern, async (route) => {
            arrived()
            await gate
            await route.continue().catch(() => {})
          })
          try {
            await spa('/profile')
            await visible(page.locator('#profile-fullName'))
            await started
            await page.context().setOffline(true)
            release()
            await visible(
              page.getByText(
                'Không thể kết nối hồ sơ bệnh nhân. Vui lòng thử lại.',
                { exact: true },
              ),
            )
            assert(
              !(await page
                .getByText('Chưa có hồ sơ bệnh nhân liên kết', { exact: true })
                .count()),
            )
          } finally {
            release()
            await page.context().setOffline(false)
            await page.unroute(pattern)
          }
          await page
            .getByRole('button', {
              name: 'Thử lại hồ sơ bệnh nhân',
              exact: true,
            })
            .click()
          await visible(
            page.getByText(records.linked.patientCode, { exact: true }),
          )
        },
      )
      await check(
        '375/1280 responsive profile/patients, theme, keyboard/dialog focus and restore',
        async () => {
          await login('ADMIN')
          for (const width of [1280, 375])
            for (const route of ['/profile', '/patients']) {
              await page.setViewportSize({ width, height: 900 })
              await spa('/settings')
              await visible(
                page.getByRole('heading', {
                  name: 'Cài đặt không gian làm việc',
                  exact: true,
                }),
              )
              await spa(route)
              await visible(
                page.getByRole('heading', {
                  name:
                    route === '/profile'
                      ? 'Hồ sơ cá nhân'
                      : 'Quản lý bệnh nhân',
                  exact: true,
                }),
              )
              await wait(
                async () =>
                  !(await page
                    .getByText('Đang tải giao diện…', { exact: true })
                    .count()),
              )
              assert(
                await page.evaluate(
                  () => document.documentElement.scrollWidth <= innerWidth,
                ),
              )
              for (let i = 0; i < 2; i++) {
                const previous = await page
                  .locator('html')
                  .evaluate((e) => e.classList.contains('dark'))
                await page
                  .getByRole('button', {
                    name: 'Chuyển giao diện sáng hoặc tối',
                    exact: true,
                  })
                  .click()
                assert(
                  (await page
                    .locator('html')
                    .evaluate((e) => e.classList.contains('dark'))) !==
                    previous,
                )
              }
              if (route === '/patients') {
                const trigger = page.getByRole('button', {
                  name: 'Thêm bệnh nhân',
                  exact: true,
                })
                await trigger.focus()
                await page.keyboard.press('Enter')
                await visible(dialog())
                for (let i = 0; i < 12; i++) {
                  await page.keyboard.press('Tab')
                  assert(
                    await dialog().evaluate((e) =>
                      e.contains(document.activeElement),
                    ),
                  )
                }
                await page.keyboard.press('Escape')
                await wait(async () => !(await dialog().count()))
                assert(
                  await trigger.evaluate((e) => document.activeElement === e),
                )
              }
            }
        },
      )
    } else throw Error('UNKNOWN_PHASE')
    assert(!runtime.length && !consoleErrors.length && !leaks.length)
    return {
      phase,
      skippedGroups: skip,
      checks,
      http,
      runtimeErrors: runtime.length,
      unexpectedConsoleErrors: consoleErrors.length,
      sensitiveConsoleOutput: leaks.length,
      mockUsed: false,
      screenshotsCreated: 0,
    }
  } catch (error) {
    page.__sprintProgress = {
      phase,
      step,
      checks,
      http,
      runtimeErrors: runtime.length,
      consoleErrors: consoleErrors.length,
      sensitiveOutput: leaks.length,
    }
    throw error
  } finally {
    page.removeListener('response', observe)
    page.removeListener('pageerror', observeRuntime)
    page.removeListener('console', observeConsole)
    await page.context().setOffline(false)
  }
}

// A transport-fault UI check, reported separately from successful real HTTP.
export async function runColdRouteRecovery(browser, origin) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 900 },
  })
  const page = await context.newPage()
  let runtimeErrors = 0,
    consoleReports = 0
  page.on('pageerror', () => {
    runtimeErrors++
  })
  page.on('console', (message) => {
    if (message.type() === 'error') consoleReports++
  })
  try {
    await page.goto(origin + '/login')
    await page
      .getByRole('heading', { name: 'Chào mừng trở lại', exact: true })
      .waitFor()
    await context.setOffline(true)
    await page
      .getByRole('link', { name: 'Đăng ký bệnh nhân', exact: true })
      .click()
    await page
      .getByRole('heading', { name: 'Không thể tải giao diện', exact: true })
      .waitFor()
    if (
      !(await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ))
    )
      throw Error('RECOVERY_OVERFLOW')
    await context.setOffline(false)
    await page
      .getByRole('button', { name: 'Tải lại ứng dụng', exact: true })
      .focus()
    await page.keyboard.press('Enter')
    await page
      .getByRole('heading', { name: 'Tạo tài khoản bệnh nhân', exact: true })
      .waitFor()
    if (
      !(await page.evaluate(async () => {
        const state = (
          await import('/src/auth/session-store.ts')
        ).getAuthSnapshot()
        return state.status === 'anonymous' && !state.accessToken && !state.user
      }))
    )
      throw Error('RECOVERY_AUTH_STATE')
    return {
      label: 'Cold route module failure has safe recovery and keyboard reload',
      result: 'PASS',
      source: 'REAL CHROME TRANSPORT FAULT, NO MOCK RESPONSE',
      runtimeErrors,
      expectedFaultConsoleReports: consoleReports,
      credentialUsed: false,
      screenshotsCreated: 0,
    }
  } finally {
    await context.setOffline(false)
    await context.close()
  }
}
