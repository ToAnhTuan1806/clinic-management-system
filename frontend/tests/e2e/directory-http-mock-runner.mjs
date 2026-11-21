// MOCK HTTP only, exercising the actual D03 Axios adapter and official wire DTOs.
// Requires Vite with AUTH_MOCK=false, DIRECTORY_MOCK=false and API origin 59999.
export async function installDirectoryHttpMock(page) {
  await page.evaluate(async () => {
    const { createDirectoryMock } =
      await import('/src/testing/directory-mock.ts')
    window.__directoryWireMock = createDirectoryMock({ latency: 30 })
  })
  const calls = []
  const pattern = 'http://127.0.0.1:59999/api/v1/**'
  const handler = async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      method = request.method()
    const body = request.postDataJSON()
    const result = await page.evaluate(
      async ({ path, method, body, query }) => {
        const gateway = window.__directoryWireMock,
          signal = new AbortController().signal
        const q = {
          search: query.q ?? '',
          page: Number(query.page ?? 0),
          pageSize: Number(query.size ?? 20),
          active:
            query.isActive === undefined
              ? 'all'
              : query.isActive === 'true'
                ? 'active'
                : 'inactive',
          specialtyId: query.specialtyId ?? '',
        }
        const specialty = (value) => ({
          id: value.id,
          code: value.code,
          name: value.name,
          description: value.description || null,
          isActive: value.active,
        })
        const doctor = (value) => {
          const result = {
            id: value.id,
            doctorCode: value.doctorCode,
            fullName: value.fullName,
            specialtyId: value.specialtyId,
            specialtyName: value.specialtyName,
            biography: value.biography || null,
            isActive: value.active,
          }
          if (value.userStatus !== undefined)
            result.userStatus = value.userStatus
          if (value.userId !== undefined) result.userId = value.userId
          if (value.licenseNumber !== undefined)
            result.licenseNumber = value.licenseNumber || null
          return result
        }
        const pageOf = (value, map) => ({
          items: value.items.map(map),
          page: value.page,
          size: value.pageSize,
          totalElements: value.total,
          totalPages: Math.ceil(value.total / value.pageSize),
        })
        try {
          if (path === '/api/v1/doctors/eligible-users')
            return {
              status: 200,
              data: pageOf(await gateway.doctorUsers(signal, q), (value) => ({
                id: value.id,
                fullName: value.fullName,
                email: value.email,
              })),
            }
          const match = path.match(
            /^\/api\/v1\/(doctors|specialties)(?:\/([1-9]\d*))?$/,
          )
          if (!match) return { status: 404, code: 'RESOURCE_NOT_FOUND' }
          const [, kind, id] = match,
            isDoctor = kind === 'doctors',
            map = isDoctor ? doctor : specialty
          if (method === 'GET') {
            if (id)
              return {
                status: 200,
                data: map(
                  await (isDoctor
                    ? gateway.getDoctor(id, signal)
                    : gateway.getSpecialty(id, signal)),
                ),
              }
            return {
              status: 200,
              data: pageOf(
                await (isDoctor
                  ? gateway.listDoctors(q, signal)
                  : gateway.listSpecialties(q, signal)),
                map,
              ),
            }
          }
          if (method === 'POST' || method === 'PATCH') {
            if (id && Object.keys(body).join(',') === 'isActive')
              await gateway.setActive(kind, id, body.isActive, signal)
            else if (isDoctor) {
              const current = id ? await gateway.getDoctor(id, signal) : null
              await gateway.saveDoctor(
                id,
                {
                  userId: current?.userId ?? body.userId,
                  specialtyId: body.specialtyId,
                  doctorCode: body.doctorCode,
                  licenseNumber: body.licenseNumber ?? '',
                  biography: body.biography ?? '',
                },
                signal,
              )
            } else
              await gateway.saveSpecialty(
                id,
                {
                  code: body.code,
                  name: body.name,
                  description: body.description ?? '',
                },
                signal,
              )
            const items = id
              ? null
              : await (isDoctor
                  ? gateway.listDoctors(
                      { ...q, search: body.doctorCode, pageSize: 100 },
                      signal,
                    )
                  : gateway.listSpecialties(
                      { ...q, search: body.code, pageSize: 100 },
                      signal,
                    ))
            const createdId = id ?? items.items[0].id
            return {
              status: id ? 200 : 201,
              data: map(
                await (isDoctor
                  ? gateway.getDoctor(createdId, signal)
                  : gateway.getSpecialty(createdId, signal)),
              ),
            }
          }
          return { status: 403, code: 'ACCESS_DENIED' }
        } catch (error) {
          return {
            status: error.status ?? 500,
            code: error.code ?? 'INTERNAL_ERROR',
            fields: error.fields ?? {},
          }
        }
      },
      {
        path: url.pathname,
        method,
        body,
        query: Object.fromEntries(url.searchParams),
      },
    )
    calls.push({ method, path: url.pathname, status: result.status })
    if (result.status === 0) {
      await route.abort('failed')
      return
    }
    const response =
      result.status < 400
        ? { data: result.data }
        : {
            status: result.status,
            code: result.code,
            errors: Object.entries(result.fields ?? {}).map(
              ([field, message]) => ({ field, message }),
            ),
          }
    await route.fulfill({
      status: result.status,
      contentType:
        result.status < 400 ? 'application/json' : 'application/problem+json',
      body: JSON.stringify(response),
    })
  }
  await page.route(pattern, handler)
  return {
    calls,
    cleanup: async () => {
      await page.unroute(pattern, handler)
      await page.evaluate(() => {
        delete window.__directoryWireMock
      })
    },
  }
}

export async function runDirectoryHttpEdgeCases(page) {
  await page.evaluate(async () => {
    const store = await import('/src/auth/session-store.ts')
    store.establishSession(store.beginAuthentication(), crypto.randomUUID(), {
      id: '1001',
      role: 'ADMIN',
      fullName: 'DEMO QA',
      email: 'demo@example.invalid',
    })
  })
  await page.waitForURL((url) => url.pathname !== '/login')
  await page.evaluate(() => {
    history.pushState(null, '', '/specialties')
    dispatchEvent(new PopStateEvent('popstate'))
  })
  await page
    .getByRole('button', {
      name: 'Tắt hoạt động DEMO · Nội tổng quát 1',
      exact: true,
    })
    .click()
  const confirm = page.getByRole('alertdialog')
  await confirm.getByRole('button', { name: 'Xác nhận', exact: true }).click()
  await confirm
    .getByText(
      'Chuyên khoa còn bác sĩ đang hoạt động. Hãy ngừng hoạt động các hồ sơ đó trước.',
      { exact: true },
    )
    .waitFor()
  await confirm.getByRole('button', { name: 'Hủy', exact: true }).click()
  const pattern = 'http://127.0.0.1:59999/api/v1/specialties/1'
  await page.route(pattern, (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/problem+json',
      body: JSON.stringify({ status: 404, code: 'RESOURCE_NOT_FOUND' }),
    }),
  )
  try {
    await page
      .getByRole('button', { name: 'Xem DEMO · Nội tổng quát 1', exact: true })
      .click()
    await page
      .getByRole('dialog')
      .getByRole('heading', { name: 'Không thể mở thông tin', exact: true })
      .waitFor()
  } finally {
    await page.unroute(pattern)
  }
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Thử lại', exact: true })
    .click()
  await page
    .getByRole('dialog')
    .getByRole('heading', { name: 'DEMO · Nội tổng quát 1', exact: true })
    .waitFor()
  await page.keyboard.press('Escape')
  return {
    source: 'MOCK HTTP ONLY',
    checks: [
      {
        label:
          '409 active doctors prevents specialty deactivation with clear confirmation error',
        result: 'PASS',
      },
      {
        label: 'GET detail 404 shows error and retry recovers',
        result: 'PASS',
      },
    ],
    screenshotsCreated: 0,
  }
}
