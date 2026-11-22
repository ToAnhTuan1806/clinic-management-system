// D11 in-memory MOCK acceptance. No successful real API integration is asserted.
export async function runHistoryMock(page, origin) {
  const checks = []
  const images = []
  const errors = []
  let role = 'DOCTOR'
  const button = (name) => page.getByRole('button', { name, exact: true })
  const wait = (locator) =>
    locator.waitFor({ state: 'visible', timeout: 10000 })
  const assert = (value, label) => {
    if (!value) throw Error(label)
  }
  const check = async (name, action) => {
    await action()
    checks.push(name)
  }
  const onError = () => errors.push('runtime')
  page.on('pageerror', onError)
  await page.route(origin + '/api/v1/auth/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const data = path.endsWith('/login')
      ? { accessToken: 'MOCK-D11-ONLY' }
      : {
          id: '50',
          email: 'synthetic@example.test',
          fullName: 'Tài khoản DEMO',
          role,
        }
    await route.fulfill({ json: { data } })
  })
  const login = async (next) => {
    role = next
    await page.goto(origin + '/login')
    await page
      .getByLabel('Email', { exact: true })
      .fill('synthetic@example.test')
    await page
      .getByLabel('Mật khẩu', { exact: true })
      .fill('synthetic-fixture-only')
    await button('Đăng nhập').click()
    await page.waitForURL(next === 'PATIENT' ? '**/booking' : '**/dashboard')
    await page.evaluate(() => {
      history.pushState(null, '', '/medical-history')
      dispatchEvent(new PopStateEvent('popstate'))
    })
  }
  const detail = () => page.getByRole('dialog', { name: 'Chi tiết lượt khám' })
  const close = async () => {
    await page.keyboard.press('Escape')
    await detail().waitFor({ state: 'hidden' })
  }
  const alter = async (method, status) =>
    page.evaluate(
      async ({ method, status }) => {
        const { historyGateway } = await import('/src/history/gateway.ts')
        const { HistoryError } = await import('/src/history/model.ts')
        window.__historyOriginal ??= {}
        window.__historyOriginal[method] = historyGateway[method]
        historyGateway[method] = async () => {
          throw new HistoryError(status)
        }
      },
      { method, status },
    )
  const restore = async (method) =>
    page.evaluate(async (method) => {
      const { historyGateway } = await import('/src/history/gateway.ts')
      historyGateway[method] = window.__historyOriginal[method]
    }, method)
  try {
    await check('RoleGuard excludes ADMIN/RECEPTIONIST', async () => {
      for (const other of ['ADMIN', 'RECEPTIONIST']) {
        await login(other)
        await page.waitForURL('**/forbidden')
        assert(
          (await page.getByRole('list', { name: 'Các lượt khám' }).count()) ===
            0,
          'list exposure',
        )
      }
    })
    await check(
      'Doctor timeline, pagination, search and empty state',
      async () => {
        await login('DOCTOR')
        await wait(button('Xem chi tiết lượt 1'))
        await button('Trang sau').click()
        await wait(button('Xem chi tiết lượt 7'))
        await button('Trang trước').click()
        await page.getByLabel('Tìm bác sĩ hoặc chuyên khoa').fill('no match')
        await wait(page.getByText('Chưa có lượt khám phù hợp.'))
        await page.getByLabel('Tìm bác sĩ hoặc chuyên khoa').fill('')
        await page.getByLabel('Từ ngày', { exact: true }).fill('2026-12-01')
        await page.getByLabel('Đến ngày', { exact: true }).fill('2026-11-01')
        await wait(
          page.getByText('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.'),
        )
        await page.getByLabel('Từ ngày', { exact: true }).fill('')
        await page.getByLabel('Đến ngày', { exact: true }).fill('')
        await wait(button('Xem chi tiết lượt 1'))
      },
    )
    await check(
      '320px mobile, desktop, theme, keyboard modal and screenshots',
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
            'overflow',
          )
          images.push({
            label,
            data: (
              await page.screenshot({ type: 'jpeg', quality: 25 })
            ).toString('base64'),
          })
          await button('Xem chi tiết lượt 1').focus()
          await page.keyboard.press('Enter')
          await wait(detail())
          for (let i = 0; i < 8; i++) {
            await page.keyboard.press('Tab')
            assert(
              await detail().evaluate((element) =>
                element.contains(document.activeElement),
              ),
              'focus escape',
            )
          }
          await close()
          assert(
            await button('Xem chi tiết lượt 1').evaluate(
              (element) => element === document.activeElement,
            ),
            'restore focus',
          )
        }
      },
    )
    await check(
      'Confirmed release, refetched publication and version conflict recovery',
      async () => {
        await button('Xem chi tiết lượt 1').click()
        await button('Công bố hồ sơ').click()
        await wait(page.getByRole('dialog', { name: 'Xác nhận công bố hồ sơ' }))
        await button('Quay lại').click()
        await button('Công bố hồ sơ').click()
        await alter('release', 409)
        await button('Xác nhận công bố').click()
        await wait(page.getByText(/Hồ sơ đã thay đổi/))
        assert(
          (await page
            .getByText('Triệu chứng DEMO', { exact: true })
            .count()) === 0,
          'stale clinical details',
        )
        await restore('release')
        await button('Tải lại hồ sơ').click()
        await button('Công bố hồ sơ').click()
        await button('Xác nhận công bố').click()
        await wait(page.getByText('Đã công bố hồ sơ.', { exact: true }))
        await detail().waitFor({ state: 'hidden' })
        await button('Xem chi tiết lượt 1').click()
        await wait(detail().getByText('Đã công bố', { exact: true }))
        assert((await button('Công bố hồ sơ').count()) === 0, 'repeat release')
        await close()
      },
    )
    await check(
      'Detail errors 401/403/404/network hide all clinical content and retry',
      async () => {
        for (const status of [401, 403, 404, 0]) {
          await alter('detail', status)
          await button('Xem chi tiết lượt 1').click()
          await button('Tải lại hồ sơ').waitFor()
          assert(
            (await page
              .getByText('Triệu chứng DEMO', { exact: true })
              .count()) === 0,
            'clinical content on error',
          )
          await restore('detail')
          await button('Tải lại hồ sơ').click()
          await wait(page.getByText('Triệu chứng DEMO', { exact: true }))
          await close()
        }
      },
    )
    await check('List network error removes rows, retry recovers', async () => {
      await alter('list', 0)
      await button('Tải lại').click()
      await wait(
        page.getByText(
          'Không thể tải lịch sử khám. Kiểm tra kết nối và thử lại.',
          { exact: true },
        ),
      )
      assert(
        (await page.getByRole('list', { name: 'Các lượt khám' }).count()) === 0,
        'stale timeline',
      )
      await restore('list')
      await button('Tải lại').click()
      await wait(button('Xem chi tiết lượt 1'))
    })
    await check(
      'PATIENT published only, no role actions or previous account state',
      async () => {
        await login('PATIENT')
        await wait(button('Xem chi tiết lượt 2'))
        assert(
          (await button('Xem chi tiết lượt 1').count()) === 0,
          'doctor previous state',
        )
        assert(
          (await button('Xem chi tiết lượt 3').count()) === 0,
          'patient draft',
        )
        await button('Xem chi tiết lượt 2').click()
        await wait(page.getByText('Triệu chứng DEMO', { exact: true }))
        assert((await button('Công bố hồ sơ').count()) === 0, 'patient release')
        await page.evaluate(async () => {
          ;(await import('/src/auth/session-store.ts')).clearSession()
        })
        await page.waitForURL('**/login')
        assert(
          (await page
            .getByText('Triệu chứng DEMO', { exact: true })
            .count()) === 0,
          'logout disclosure',
        )
      },
    )
    assert(errors.length === 0, 'runtime error')
    return {
      source: 'D11 IN-MEMORY MOCK',
      checks,
      runtimeErrors: errors.length,
      images,
    }
  } finally {
    page.removeListener('pageerror', onError)
    await page.unroute(origin + '/api/v1/auth/**')
  }
}
