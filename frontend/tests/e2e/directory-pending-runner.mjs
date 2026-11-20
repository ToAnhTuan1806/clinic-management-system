// Production bundle + MOCK HTTP only. Verifies QA flags cannot enable directory fixtures.
// Build API origin 59999, AUTH_MOCK=true/DIRECTORY_MOCK=true, preview 5177.
export async function runDirectoryPendingQA(page) {
  const requests = [],
    token = crypto.randomUUID()
  const user = {
    id: '1',
    role: 'ADMIN',
    status: 'ACTIVE',
    fullName: 'DEMO QA',
    email: 'demo@example.invalid',
  }
  const pattern = 'http://127.0.0.1:59999/api/v1/**'
  await page.route(pattern, async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname
    requests.push(path)
    const data =
      path === '/api/v1/auth/login'
        ? { accessToken: token, tokenType: 'Bearer', expiresIn: 1800, user }
        : path === '/api/v1/auth/me'
          ? user
          : {
              items: [],
              page: Number(url.searchParams.get('page') ?? 0),
              size: Number(url.searchParams.get('size') ?? 20),
              totalElements: 0,
              totalPages: 0,
            }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
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
      throw new Error('Production auth mock enabled')
    for (const kind of ['doctors', 'specialties']) {
      await page.evaluate((path) => {
        history.pushState(null, '', path)
        dispatchEvent(new PopStateEvent('popstate'))
      }, '/' + kind)
      await page
        .getByRole('heading', {
          name:
            kind === 'doctors'
              ? 'Không tìm thấy bác sĩ'
              : 'Không tìm thấy chuyên khoa',
          exact: true,
        })
        .waitFor()
      const add = page.getByRole('button', {
        name: kind === 'doctors' ? 'Thêm bác sĩ' : 'Thêm chuyên khoa',
        exact: true,
      })
      if (await add.isDisabled())
        throw new Error('Configured real adapter unexpectedly disabled')
      if (await page.getByText('DEMO · Bác sĩ 01', { exact: true }).count())
        throw new Error('Production directory mock enabled')
    }
    if (
      !requests.includes('/api/v1/doctors') ||
      !requests.includes('/api/v1/specialties')
    )
      throw new Error('Approved D03 API was not called')
    await page.unroute(pattern)
    await page.context().setOffline(true)
    try {
      await page
        .getByLabel('Tìm kiếm chuyên khoa', { exact: true })
        .fill('offline')
      await page
        .getByRole('heading', { name: 'Không thể tải danh mục', exact: true })
        .waitFor()
      if (
        await page.getByText('DEMO · Nội tổng quát 1', { exact: true }).count()
      )
        throw new Error('Real failure fell back to mock')
    } finally {
      await page.context().setOffline(false)
    }
    await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click()
    await page
      .getByRole('heading', { name: 'Chào mừng trở lại', level: 1 })
      .waitFor()
    return {
      source: 'PRODUCTION BUNDLE + MOCK HTTP; NOT REAL BACKEND',
      result: 'PASS',
      approvedD03RequestsObserved: true,
      mockDirectoryEnabled: false,
      noMockFallbackOnFailure: true,
      screenshotsCreated: 0,
    }
  } finally {
    await page.unroute(pattern)
    await page.context().setOffline(false)
  }
}
