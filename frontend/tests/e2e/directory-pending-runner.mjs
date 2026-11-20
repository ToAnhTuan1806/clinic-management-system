// Production UI test with MOCK D02 auth transport only. NO real Backend evidence.
// Build with VITE_API_BASE_URL=http://127.0.0.1:59999, QA flags=true, then preview on 5177.
export async function runDirectoryPendingQA(page) {
  const requests = []
  const token = crypto.randomUUID()
  const user = {
    id: '1',
    role: 'ADMIN',
    status: 'ACTIVE',
    fullName: 'DEMO QA',
    email: 'demo@example.invalid',
  }
  const pattern = 'http://127.0.0.1:59999/api/v1/**'
  await page.route(pattern, async (route) => {
    const path = new URL(route.request().url()).pathname
    requests.push(path)
    const data =
      path === '/api/v1/auth/login'
        ? { accessToken: token, tokenType: 'Bearer', expiresIn: 1800, user }
        : user
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:5177' },
      body: JSON.stringify({ data }),
    })
  })
  try {
    await page.goto('http://127.0.0.1:5177/login')
    await page.getByLabel('Email', { exact: true }).fill(user.email)
    await page.getByLabel('Mật khẩu', { exact: true }).fill(crypto.randomUUID())
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
    await page
      .getByRole('heading', { name: 'Tổng quan phòng khám', level: 1 })
      .waitFor()
    if (await page.getByText('API MOCK', { exact: true }).count())
      throw new Error('Production auth mock unexpectedly enabled')
    for (const kind of ['doctors', 'specialties']) {
      await page.evaluate((path) => {
        history.pushState(null, '', path)
        dispatchEvent(new PopStateEvent('popstate'))
      }, '/' + kind)
      await page
        .getByRole('heading', { name: 'Danh mục chưa sẵn sàng', exact: true })
        .waitFor()
      const add = page.getByRole('button', {
        name: kind === 'doctors' ? 'Thêm bác sĩ' : 'Thêm chuyên khoa',
        exact: true,
      })
      if (!(await add.isDisabled()))
        throw new Error('Unconfigured production mutation enabled')
      if (await page.getByText('DEMO · Bác sĩ 01', { exact: true }).count())
        throw new Error('Production demo data unexpectedly visible')
    }
    if (
      requests.some(
        (path) => !['/api/v1/auth/login', '/api/v1/auth/me'].includes(path),
      )
    )
      throw new Error('Unapproved D03 API was called')
    await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click()
    await page
      .getByRole('heading', { name: 'Chào mừng trở lại', level: 1 })
      .waitFor()
    return {
      source: 'PRODUCTION UI WITH MOCK D02 AUTH ONLY — NO REAL BACKEND',
      result: 'PASS',
      d03Requests: 0,
      mockDirectoryEnabled: false,
      unconfiguredMutationsDisabled: true,
      screenshotsCreated: 0,
    }
  } finally {
    await page.unroute(pattern)
  }
}
