// MOCK UI acceptance only. Does not call D03 HTTP endpoints or create screenshots.
export async function runDirectoryMock(
  page,
  { phase = 'all', wire = false } = {},
) {
  await page.bringToFront()
  page.setDefaultTimeout(8000)
  const checks = []
  const errors = []
  const observeError = () => errors.push('runtime error')
  page.on('pageerror', observeError)
  page.__d03Progress = checks
  const assert = (condition) => {
    if (!condition) throw new Error('assertion failed')
  }
  const visible = (locator) => locator.waitFor({ state: 'visible' })
  const wait = async (predicate, reason = 'state') => {
    const end = Date.now() + 7000
    while (Date.now() < end) {
      if (await predicate()) return
      await page.waitForTimeout(30)
    }
    throw new Error(reason + ' did not settle')
  }
  const check = async (label, task) => {
    if (
      phase === 'roles' &&
      !/^(RECEPTIONIST|DOCTOR only|PATIENT|Mobile|MOCK 401)/.test(label)
    )
      return
    try {
      await task()
    } catch (error) {
      throw new Error('D03 MOCK UI failed: ' + label + ' / ' + error.message)
    }
    checks.push({
      label,
      result: 'PASS',
      source: 'MOCK FE gateway + synthetic auth state',
    })
  }
  const spa = async (path) => {
    await page.evaluate((value) => {
      history.pushState(null, '', value)
      dispatchEvent(new PopStateEvent('popstate'))
    }, path)
    await wait(() => new URL(page.url()).pathname === path, 'navigate ' + path)
  }
  const login = async (role) => {
    await page.evaluate(async () =>
      (await import('/src/auth/session-store.ts')).clearSession(),
    )
    await visible(
      page.getByRole('heading', { name: 'Chào mừng trở lại', level: 1 }),
    )
    await page.evaluate(async (value) => {
      const store = await import('/src/auth/session-store.ts')
      store.establishSession(store.beginAuthentication(), crypto.randomUUID(), {
        id: '1001',
        fullName: 'DEMO UI QA',
        email: 'demo@example.invalid',
        role: value,
      })
    }, role)
    // D02 correctly restores an authorized deep link after re-authentication.
    await wait(
      () => new URL(page.url()).pathname !== '/login',
      'authenticated redirect ' + role,
    )
    await spa(role === 'PATIENT' ? '/booking' : '/dashboard')
    await visible(
      page.getByRole('heading', {
        level: 1,
        name: {
          PATIENT: 'Đặt lịch khám',
          ADMIN: 'Tổng quan phòng khám',
          DOCTOR: 'Không gian bác sĩ',
          RECEPTIONIST: 'Không gian lễ tân',
        }[role],
        exact: true,
      }),
    )
  }
  const region = (kind) =>
    page.getByRole('region', {
      name: kind === 'doctors' ? 'Danh sách bác sĩ' : 'Danh sách chuyên khoa',
    })
  const loaded = async (kind) => {
    await visible(region(kind))
    await wait(
      async () => (await region(kind).getAttribute('aria-busy')) === 'false',
      'load ' + kind,
    )
  }
  const navigate = async (kind) => {
    await spa('/' + kind)
    await loaded(kind)
  }
  const search = (kind, value) =>
    page
      .getByLabel(`Tìm kiếm ${kind === 'doctors' ? 'bác sĩ' : 'chuyên khoa'}`, {
        exact: true,
      })
      .fill(value)
  const dialog = () => page.getByRole('dialog')
  const save = async () => {
    await dialog()
      .getByRole('button', { name: 'Lưu thông tin', exact: true })
      .click()
    await wait(() =>
      dialog()
        .count()
        .then((count) => count === 0),
    )
    await visible(
      page.getByText(wire ? 'Đã lưu thay đổi.' : 'DEMO · Đã lưu thay đổi.', {
        exact: true,
      }),
    )
  }
  try {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await login('ADMIN')
    await check(
      'ADMIN specialty list, pagination, search and empty state',
      async () => {
        await navigate('specialties')
        assert(
          (await region('specialties').getByRole('listitem').count()) === 10,
        )
        await page
          .getByRole('button', { name: 'Trang sau', exact: true })
          .click()
        await loaded('specialties')
        assert(
          (await region('specialties').getByRole('listitem').count()) === 2,
        )
        await search('specialties', 'no-matching-demo')
        await loaded('specialties')
        await visible(
          page.getByRole('heading', { name: 'Không tìm thấy chuyên khoa' }),
        )
        assert(
          await page
            .getByRole('button', { name: 'Trang trước', exact: true })
            .isDisabled(),
        )
        await search('specialties', '')
        await loaded('specialties')
      },
    )
    await check(
      'Specialty create validation and successful DEMO save',
      async () => {
        await page
          .getByRole('button', { name: 'Thêm chuyên khoa', exact: true })
          .click()
        await dialog()
          .getByRole('button', { name: 'Lưu thông tin', exact: true })
          .click()
        await visible(
          page.getByText('Vui lòng nhập tên chuyên khoa, tối đa 120 ký tự.', {
            exact: true,
          }),
        )
        await wait(() =>
          dialog()
            .getByLabel('Mã chuyên khoa')
            .evaluate((element) => element === document.activeElement),
        )
        await dialog().getByLabel('Mã chuyên khoa').fill('QA_UI_NEW')
        await dialog()
          .getByLabel('Tên chuyên khoa')
          .fill('DEMO QA Chuyên khoa mới')
        await dialog()
          .getByLabel('Mô tả', { exact: true })
          .fill('DEMO mô tả mới')
        await save()
        await search('specialties', 'DEMO QA Chuyên khoa mới')
        await loaded('specialties')
        assert(
          (await region('specialties').getByRole('listitem').count()) === 1,
        )
      },
    )
    await check(
      'Specialty edit and status cancel/confirm, no hard delete',
      async () => {
        await page
          .getByRole('button', {
            name: 'Chỉnh sửa DEMO QA Chuyên khoa mới',
            exact: true,
          })
          .click()
        await dialog()
          .getByLabel('Mô tả', { exact: true })
          .fill('DEMO mô tả chỉnh sửa')
        await save()
        await loaded('specialties')
        await visible(page.getByText('DEMO mô tả chỉnh sửa', { exact: true }))
        const toggle = page.getByRole('button', {
          name: 'Tắt hoạt động DEMO QA Chuyên khoa mới',
          exact: true,
        })
        await toggle.click()
        const confirm = page.getByRole('alertdialog')
        await visible(confirm)
        await wait(() =>
          confirm
            .getByRole('button', { name: 'Hủy', exact: true })
            .evaluate((element) => element === document.activeElement),
        )
        await confirm.getByRole('button', { name: 'Hủy', exact: true }).click()
        await wait(() =>
          toggle.evaluate((element) => element === document.activeElement),
        )
        await toggle.click()
        await confirm
          .getByRole('button', { name: 'Xác nhận', exact: true })
          .click()
        await wait(() => confirm.count().then((count) => count === 0))
        await loaded('specialties')
        await visible(
          page.getByRole('button', {
            name: 'Bật hoạt động DEMO QA Chuyên khoa mới',
            exact: true,
          }),
        )
        assert(
          (await page.getByRole('button', { name: /xóa|delete/i }).count()) ===
            0,
        )
      },
    )
    await check(
      'Duplicate specialty error remains in form, preserves input',
      async () => {
        await page
          .getByRole('button', { name: 'Thêm chuyên khoa', exact: true })
          .click()
        await dialog().getByLabel('Mã chuyên khoa').fill('QA_UI_NEW')
        await dialog()
          .getByLabel('Tên chuyên khoa')
          .fill('DEMO QA Chuyên khoa mới')
        await dialog()
          .getByRole('button', { name: 'Lưu thông tin', exact: true })
          .click()
        await visible(
          page
            .getByText('Tên chuyên khoa đã tồn tại.', { exact: true })
            .first(),
        )
        assert(
          (await dialog().getByLabel('Tên chuyên khoa').inputValue()) ===
            'DEMO QA Chuyên khoa mới',
        )
        await page.keyboard.press('Escape')
        await wait(() =>
          dialog()
            .count()
            .then((count) => count === 0),
        )
      },
    )
    await check(
      'MOCK pending save disables form and blocks double submit and dismissal',
      async () => {
        await page
          .getByRole('button', { name: 'Thêm chuyên khoa', exact: true })
          .click()
        await dialog().getByLabel('Mã chuyên khoa').fill('QA_UI_BUSY')
        await dialog().getByLabel('Tên chuyên khoa').fill('DEMO QA busy')
        await page.evaluate(() => {
          let release
          const gate = new Promise((resolve) => {
            release = resolve
          })
          window.__directoryMockGate = { calls: 0, wait: gate }
          window.__d03Release = release
        })
        try {
          await dialog()
            .getByRole('button', { name: 'Lưu thông tin', exact: true })
            .click()
          await visible(
            dialog().getByRole('button', { name: 'Đang lưu…', exact: true }),
          )
          await wait(() =>
            page.evaluate(() => window.__directoryMockGate.calls === 1),
          )
          assert(
            await dialog()
              .getByRole('button', { name: 'Đang lưu…', exact: true })
              .isDisabled(),
          )
          await wait(
            async () =>
              await dialog()
                .getByRole('button', { name: 'Đóng hộp thoại', exact: true })
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
          await page.keyboard.press('Escape')
          assert(await dialog().isVisible())
          assert(
            (await page.evaluate(() => window.__directoryMockGate.calls)) === 1,
          )
        } finally {
          await page.evaluate(() => {
            window.__d03Release()
            delete window.__directoryMockGate
            delete window.__d03Release
          })
        }
        await wait(() =>
          dialog()
            .count()
            .then((count) => count === 0),
        )
        await visible(
          page.getByText(
            wire ? 'Đã lưu thay đổi.' : 'DEMO · Đã lưu thay đổi.',
            { exact: true },
          ),
        )
      },
    )
    await check(
      'Doctor list specialty filter, active filter, search and pagination',
      async () => {
        await navigate('doctors')
        assert((await region('doctors').getByRole('listitem').count()) === 10)
        await page
          .getByRole('button', { name: 'Trang sau', exact: true })
          .click()
        await loaded('doctors')
        assert((await region('doctors').getByRole('listitem').count()) === 2)
        await page.getByLabel('Chuyên khoa', { exact: true }).selectOption('1')
        await loaded('doctors')
        assert((await region('doctors').getByRole('listitem').count()) === 3)
        await page.getByLabel('Chuyên khoa', { exact: true }).selectOption('')
        await page
          .getByLabel('Trạng thái', { exact: true })
          .selectOption('inactive')
        await loaded('doctors')
        assert((await region('doctors').getByRole('listitem').count()) === 1)
        await page.getByLabel('Trạng thái', { exact: true }).selectOption('all')
        await search('doctors', 'Bác sĩ 01')
        await loaded('doctors')
        assert((await region('doctors').getByRole('listitem').count()) === 1)
      },
    )
    await check(
      'Doctor create validates choices, excludes inactive specialties and invalid users',
      async () => {
        await page
          .getByRole('button', { name: 'Thêm bác sĩ', exact: true })
          .click()
        const submit = dialog().getByRole('button', {
          name: 'Lưu thông tin',
          exact: true,
        })
        await wait(async () => !(await submit.isDisabled()))
        await submit.click()
        await visible(
          page.getByText('Vui lòng chọn tài khoản bác sĩ hợp lệ.', {
            exact: true,
          }),
        )
        assert(
          (await dialog()
            .getByLabel('Tài khoản bác sĩ', { exact: true })
            .locator('option')
            .count()) === 4,
        )
        assert(
          (await dialog()
            .getByLabel('Chuyên khoa', { exact: true })
            .locator('option[value="3"]')
            .count()) === 0,
        )
        await dialog()
          .getByLabel('Tài khoản bác sĩ', { exact: true })
          .selectOption('1013')
        await dialog().getByLabel('Mã bác sĩ').fill('QA_UI_DR_13')
        await dialog()
          .getByLabel('Chuyên khoa', { exact: true })
          .selectOption('1')
        await dialog()
          .getByLabel('Giới thiệu chuyên môn')
          .fill('DEMO QA bác sĩ tạo mới')
        await save()
        await search('doctors', 'Bác sĩ 13')
        await loaded('doctors')
        assert((await region('doctors').getByRole('listitem').count()) === 1)
      },
    )
    await check(
      'Doctor edit, active status confirmation and details',
      async () => {
        await page
          .getByRole('button', {
            name: 'Chỉnh sửa DEMO · Bác sĩ 13',
            exact: true,
          })
          .click()
        await wait(
          async () =>
            !(await dialog()
              .getByRole('button', { name: 'Lưu thông tin', exact: true })
              .isDisabled()),
        )
        assert(
          await dialog()
            .getByLabel('Tài khoản bác sĩ', { exact: true })
            .isDisabled(),
        )
        await dialog()
          .getByLabel('Giới thiệu chuyên môn')
          .fill('DEMO QA bác sĩ đã sửa')
        await dialog()
          .getByLabel('Chuyên khoa', { exact: true })
          .selectOption('2')
        await save()
        await loaded('doctors')
        await page
          .getByRole('button', {
            name: 'Tắt hoạt động DEMO · Bác sĩ 13',
            exact: true,
          })
          .click()
        await page
          .getByRole('alertdialog')
          .getByRole('button', { name: 'Xác nhận', exact: true })
          .click()
        await wait(() =>
          page
            .getByRole('alertdialog')
            .count()
            .then((count) => count === 0),
        )
        await loaded('doctors')
        await visible(
          page.getByRole('button', {
            name: 'Bật hoạt động DEMO · Bác sĩ 13',
            exact: true,
          }),
        )
        await page
          .getByRole('button', { name: 'Xem DEMO · Bác sĩ 13', exact: true })
          .click()
        await visible(
          dialog().getByText('DEMO QA bác sĩ đã sửa', { exact: true }),
        )
        await page.keyboard.press('Escape')
      },
    )
    await check(
      'MOCK 403 save shows error without success or closing editor',
      async () => {
        await page
          .getByRole('button', {
            name: 'Chỉnh sửa DEMO · Bác sĩ 13',
            exact: true,
          })
          .click()
        await wait(
          async () =>
            !(await dialog()
              .getByRole('button', { name: 'Lưu thông tin', exact: true })
              .isDisabled()),
        )
        await page.evaluate(() => {
          window.__directoryMockFault = 403
        })
        await dialog()
          .getByRole('button', { name: 'Lưu thông tin', exact: true })
          .click()
        await visible(
          dialog().getByText('Bạn không có quyền thực hiện thao tác này.', {
            exact: true,
          }),
        )
        await page.keyboard.press('Escape')
        const notice = page.getByRole('button', {
          name: 'Đóng thông báo',
          exact: true,
        })
        if (await notice.count()) await notice.click()
      },
    )
    await check(
      'Network-like MOCK list fault offers retry, clears stale results',
      async () => {
        await page.evaluate(() => {
          window.__directoryMockFault = 0
        })
        await search('doctors', 'Bác sĩ 12')
        await loaded('doctors')
        await visible(
          page.getByRole('heading', {
            name: 'Không thể tải danh mục',
            exact: true,
          }),
        )
        assert((await region('doctors').getByRole('listitem').count()) === 0)
        await page.getByRole('button', { name: 'Thử lại', exact: true }).click()
        await loaded('doctors')
        assert((await region('doctors').getByRole('listitem').count()) === 1)
      },
    )
    await check(
      'RECEPTIONIST reads both lists without management controls',
      async () => {
        await login('RECEPTIONIST')
        for (const kind of ['doctors', 'specialties']) {
          await navigate(kind)
          await wait(
            async () => (await region(kind).getByRole('listitem').count()) > 0,
          )
          assert(
            (await page
              .getByRole('button', {
                name: /Thêm bác sĩ|Thêm chuyên khoa|^Chỉnh sửa |^Tắt hoạt động |^Bật hoạt động /,
              })
              .count()) === 0,
          )
        }
      },
    )
    await check(
      'DOCTOR only sees own profile and can open details',
      async () => {
        await login('DOCTOR')
        await navigate('doctors')
        await visible(
          page.getByRole('heading', { name: 'Hồ sơ bác sĩ của tôi', level: 1 }),
        )
        assert((await region('doctors').getByRole('listitem').count()) === 1)
        await page
          .getByRole('button', { name: 'Xem DEMO · Bác sĩ 01', exact: true })
          .click()
        await visible(
          dialog().getByRole('heading', {
            name: 'DEMO · Bác sĩ 01',
            exact: true,
          }),
        )
        await page.keyboard.press('Escape')
        assert(
          (await page.getByRole('button', { name: /^Chỉnh sửa / }).count()) ===
            0,
        )
      },
    )
    await check(
      'PATIENT sees only active entries, no status/admin controls, RoleGuard remains',
      async () => {
        await login('PATIENT')
        await navigate('doctors')
        assert(
          (await region('doctors')
            .getByText('Ngừng hoạt động', { exact: true })
            .count()) === 0,
        )
        assert((await region('doctors').getByRole('listitem').count()) === 8)
        assert(
          (await page.getByLabel('Trạng thái', { exact: true }).count()) === 0,
        )
        await navigate('specialties')
        assert(
          (await region('specialties')
            .getByText('Ngừng hoạt động', { exact: true })
            .count()) === 0,
        )
        assert(
          (await page
            .getByRole('button', { name: /^Thêm |^Chỉnh sửa / })
            .count()) === 0,
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
      'Mobile/tablet/desktop, Light/Dark and modal focus/escape',
      async () => {
        await login('ADMIN')
        await navigate('specialties')
        for (const width of [320, 390, 768, 1440]) {
          await page.setViewportSize({ width, height: 900 })
          await page.evaluate(() => {
            document.documentElement.classList.add('dark')
          })
          assert(
            await page.evaluate(
              () =>
                document.documentElement.scrollWidth <=
                document.documentElement.clientWidth,
            ),
          )
          await page
            .getByRole('button', { name: 'Thêm chuyên khoa', exact: true })
            .click()
          await visible(dialog())
          for (let i = 0; i < 8; i++) await page.keyboard.press('Tab')
          assert(
            await dialog().evaluate((element) =>
              element.contains(document.activeElement),
            ),
          )
          assert(
            await dialog().evaluate(
              (element) =>
                element.getBoundingClientRect().left >= 0 &&
                element.getBoundingClientRect().right <= innerWidth,
            ),
          )
          await page.keyboard.press('Escape')
          await wait(() =>
            page
              .getByRole('button', { name: 'Thêm chuyên khoa', exact: true })
              .evaluate((element) => element === document.activeElement),
          )
          await page.evaluate(() => {
            document.documentElement.classList.remove('dark')
          })
        }
        await page.setViewportSize({ width: 390, height: 844 })
        await page
          .getByRole('button', { name: 'Mở menu điều hướng', exact: true })
          .click()
        const menu = page.getByRole('dialog', { name: 'Menu điều hướng' })
        await menu.getByRole('link', { name: 'Bác sĩ', exact: true }).click()
        await loaded('doctors')
      },
    )
    await check(
      'MOCK 401 expires session, redirects Login, ProtectedRoute blocks reuse',
      async () => {
        await page.evaluate(() => {
          window.__directoryMockFault = 401
        })
        await search('doctors', 'Bác sĩ 11')
        await visible(
          page.getByRole('heading', { name: 'Chào mừng trở lại', level: 1 }),
        )
        await visible(
          page.getByText(
            'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
            { exact: true },
          ),
        )
        await page.evaluate(() => {
          history.pushState(null, '', '/specialties')
          dispatchEvent(new PopStateEvent('popstate'))
        })
        await wait(() => new URL(page.url()).pathname === '/login')
        assert(
          await page.evaluate(async () => {
            const state = (
              await import('/src/auth/session-store.ts')
            ).getAuthSnapshot()
            return (
              !state.user &&
              !state.accessToken &&
              !sessionStorage.length &&
              Object.keys(localStorage).every((key) => key === 'clinic-theme')
            )
          }),
        )
      },
    )
    assert(errors.length === 0)
    return {
      source: wire
        ? 'MOCK HTTP WITH REAL FE AXIOS ADAPTER — NO BACKEND'
        : 'MOCK ONLY — NO D03 BACKEND HTTP',
      checks,
      count: checks.length,
      runtimeErrors: errors.length,
      screenshotsCreated: 0,
    }
  } finally {
    page.removeListener('pageerror', observeError)
  }
}
