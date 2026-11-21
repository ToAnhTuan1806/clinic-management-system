// Run on the D10 host helper's isolated Chrome/MySQL copy. Secret values stay in RAM.
export async function runExaminationReal(
  browser,
  page,
  origin,
  existingAppointmentId,
) {
  const qa = await page.evaluate(() => window.__d03Acceptance)
  if (!qa?.scopeVerified || !qa.sourceProtected)
    throw Error('QA_SCOPE_REQUIRED')
  const checks = [],
    http = [],
    tokens = new Map()
  const assert = (value, label) => {
    if (!value) throw Error(label)
  }
  const check = async (name, action) => {
    try {
      await action()
      checks.push(name)
    } catch (error) {
      throw Error(name + ' / ' + error.name)
    }
  }
  const request = async (actor, method, path, data) => {
    if (actor && !tokens.has(actor)) {
      const account = qa.accounts[actor]
      const signed = await page.request.post(qa.apiURL + '/api/v1/auth/login', {
        data: { email: account.email, password: account.password },
      })
      assert(signed.status() === 200, 'QA_LOGIN')
      tokens.set(actor, (await signed.json()).data.accessToken)
    }
    const result = await page.request.fetch(qa.apiURL + path, {
      method,
      ...(data ? { data } : {}),
      headers: actor ? { Authorization: 'Bearer ' + tokens.get(actor) } : {},
    })
    http.push({ method, path, status: result.status() })
    return { status: result.status(), body: await result.json() }
  }
  const ok = async (actor, method, path, data, status = 200) => {
    const result = await request(actor, method, path, data)
    assert(result.status === status, 'HTTP_' + result.status)
    return result.body.data
  }
  const button = (p, name) => p.getByRole('button', { name, exact: true })
  const login = async (p, actor) => {
    await p.goto(origin + '/login')
    await p.getByLabel('Email', { exact: true }).fill(qa.accounts[actor].email)
    await p
      .getByLabel('Mật khẩu', { exact: true })
      .fill(qa.accounts[actor].password)
    await button(p, 'Đăng nhập').click()
    await p.waitForURL(actor === 'PATIENT' ? '**/booking' : '**/dashboard')
    await p.evaluate(() => {
      history.pushState(null, '', '/medical-records')
      dispatchEvent(new PopStateEvent('popstate'))
    })
  }
  let appointment, record, otherContext
  try {
    await check('Real D10 QA synthetic CHECKED_IN appointment', async () => {
      if (existingAppointmentId) {
        appointment = await ok(
          'RECEPTIONIST',
          'GET',
          '/api/v1/appointments/' + existingAppointmentId,
        )
        assert(appointment.status === 'CHECKED_IN', 'CHECKED_IN')
        return
      }
      const start = new Date(
        Math.ceil((Date.now() + 5 * 60000) / 60000) * 60000,
      )
      const end = new Date(start.getTime() + 30 * 60000)
      const patient = await ok(
        'RECEPTIONIST',
        'POST',
        '/api/v1/patients',
        {
          patientCode: 'D10_' + Date.now(),
          fullName: 'Synthetic D10 patient',
          userId: qa.fixtureIds.users.PATIENT,
        },
        201,
      )
      const schedule = await ok(
        'RECEPTIONIST',
        'POST',
        '/api/v1/doctor-schedules',
        {
          doctorId: '1',
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          slotMinutes: 30,
          status: 'ACTIVE',
        },
        201,
      )
      appointment = await ok(
        'RECEPTIONIST',
        'POST',
        '/api/v1/appointments',
        {
          patientId: patient.id,
          scheduleId: schedule.id,
          startAt: start.toISOString(),
          requestKey: 'D10_' + Date.now(),
        },
        201,
      )
      appointment = await ok(
        'RECEPTIONIST',
        'POST',
        '/api/v1/appointments/' + appointment.id + '/confirmation',
        { expectedVersion: appointment.version },
      )
      appointment = await ok(
        'RECEPTIONIST',
        'POST',
        '/api/v1/appointments/' + appointment.id + '/check-in',
        { expectedVersion: appointment.version },
      )
      assert(appointment.status === 'CHECKED_IN', 'CHECKED_IN')
    })
    await check(
      'Lookup 404 before create and real doctor UI queue',
      async () => {
        assert(
          (
            await request(
              'DOCTOR_LINKED',
              'GET',
              '/api/v1/medical-records/by-appointment/' + appointment.id,
            )
          ).status === 404,
          'lookup404',
        )
        await login(page, 'DOCTOR_LINKED')
        await button(page, 'Mở chi tiết ' + appointment.appointmentCode).click()
        await button(page, 'Bắt đầu khám').waitFor()
      },
    )
    await check(
      'POST commits but response lost, lookup recovers without another create',
      async () => {
        const pattern = qa.apiURL + '/api/v1/medical-records'
        let submitted = 0
        await page.route(pattern, async (route) => {
          submitted++
          const result = await route.fetch()
          assert(result.status() === 201, 'real create')
          assert(
            Object.keys(route.request().postDataJSON()).join(',') ===
              'appointmentId',
            'create whitelist',
          )
          await route.abort('failed')
        })
        try {
          await button(page, 'Bắt đầu khám').click()
          await button(page, 'Tải lại hồ sơ').waitFor()
        } finally {
          await page.unroute(pattern)
        }
        await button(page, 'Tải lại hồ sơ').click()
        await page.getByLabel('Triệu chứng', { exact: true }).waitFor()
        record = await ok(
          'DOCTOR_LINKED',
          'GET',
          '/api/v1/medical-records/by-appointment/' + appointment.id,
        )
        assert(
          record.status === 'IN_PROGRESS' && submitted === 1,
          'create recovery',
        )
        assert(
          (
            await request('DOCTOR_LINKED', 'POST', '/api/v1/medical-records', {
              appointmentId: appointment.id,
            })
          ).status === 409,
          'duplicate',
        )
        assert(
          (
            await ok(
              'DOCTOR_LINKED',
              'GET',
              '/api/v1/appointments/' + appointment.id,
            )
          ).status === 'IN_PROGRESS',
          'transition',
        )
      },
    )
    await check(
      'Reload and independent browser context discover server record without storage',
      async () => {
        await page.evaluate(() => sessionStorage.clear())
        await login(page, 'DOCTOR_LINKED')
        await button(page, 'Mở chi tiết ' + appointment.appointmentCode).click()
        await page.getByLabel('Triệu chứng', { exact: true }).waitFor()
        otherContext = await browser.newContext()
        const other = await otherContext.newPage()
        await login(other, 'DOCTOR_LINKED')
        await button(
          other,
          'Mở chi tiết ' + appointment.appointmentCode,
        ).click()
        await other.getByLabel('Triệu chứng', { exact: true }).waitFor()
        assert(
          await other.evaluate(() => sessionStorage.length === 0),
          'storage dependency',
        )
      },
    )
    await check(
      'Draft PATCH and stale version require lookup before retry',
      async () => {
        for (const [label, value] of [
          ['Triệu chứng', 'Synthetic symptoms'],
          ['Chẩn đoán mô phỏng', 'Synthetic diagnosis'],
          ['Ghi chú', 'Synthetic notes'],
          ['Kết luận', 'Synthetic conclusion'],
        ])
          await page.getByLabel(label, { exact: true }).fill(value)
        await button(page, 'Lưu nháp').click()
        await page
          .getByRole('dialog')
          .getByText('Đã lưu nháp.', { exact: true })
          .waitFor()
        record = await ok(
          'DOCTOR_LINKED',
          'GET',
          '/api/v1/medical-records/by-appointment/' + appointment.id,
        )
        assert(record.version === 1, 'draftversion')
        await ok(
          'DOCTOR_LINKED',
          'PATCH',
          '/api/v1/medical-records/' + record.id,
          {
            notes: 'Synthetic concurrent note',
            expectedVersion: record.version,
          },
        )
        await page
          .getByLabel('Ghi chú', { exact: true })
          .fill('Synthetic stale note')
        await button(page, 'Lưu nháp').click()
        await page.getByText(/Hồ sơ đã thay đổi/).waitFor()
        assert(await button(page, 'Lưu nháp').isDisabled(), 'stale enabled')
        await button(page, 'Tải lại hồ sơ').click()
        await page.getByLabel('Ghi chú', { exact: true }).waitFor()
        assert(
          (await page.getByLabel('Ghi chú', { exact: true }).inputValue()) ===
            'Synthetic concurrent note',
          'fresh version',
        )
      },
    )
    await check('Real RBAC, ownership and draft privacy', async () => {
      for (const role of ['ADMIN', 'RECEPTIONIST', 'PATIENT']) {
        assert(
          (
            await request(role, 'POST', '/api/v1/medical-records', {
              appointmentId: appointment.id,
            })
          ).status === 403,
          'create permission',
        )
        assert(
          (
            await request(
              role,
              'PATCH',
              '/api/v1/medical-records/' + record.id,
              { notes: 'Denied', expectedVersion: 2 },
            )
          ).status === 403,
          'patch permission',
        )
        assert(
          (
            await request(
              role,
              'POST',
              '/api/v1/medical-records/' + record.id + '/completion',
              { expectedVersion: 2 },
            )
          ).status === 403,
          'complete permission',
        )
      }
      for (const role of ['ADMIN', 'RECEPTIONIST']) {
        const metadata = await ok(
          role,
          'GET',
          '/api/v1/medical-records/by-appointment/' + appointment.id,
        )
        assert(
          !('diagnosis' in metadata) && !('notes' in metadata),
          'clinical projection',
        )
      }
      assert(
        (
          await request(
            'PATIENT',
            'GET',
            '/api/v1/medical-records/by-appointment/' + appointment.id,
          )
        ).status === 404,
        'patient draft',
      )
      assert(
        (
          await request(
            'DOCTOR_INACTIVE',
            'GET',
            '/api/v1/medical-records/by-appointment/' + appointment.id,
          )
        ).status === 404,
        'other doctor',
      )
      assert(
        (
          await request(
            null,
            'GET',
            '/api/v1/medical-records/by-appointment/' + appointment.id,
          )
        ).status === 401,
        'anonymous',
      )
      assert(
        (
          await request('DOCTOR_LINKED', 'POST', '/api/v1/medical-records', {
            appointmentId: appointment.id,
            expectedVersion: 0,
          })
        ).status === 400,
        'unknown field',
      )
    })
    await check(
      'Real completion confirmation and immutable COMPLETED record',
      async () => {
        await button(page, 'Hoàn tất khám').click()
        await button(page, 'Xác nhận hoàn tất').click()
        await page.getByText('Đã hoàn tất · Chỉ đọc', { exact: true }).waitFor()
        assert(
          (await page
            .getByLabel('Triệu chứng', { exact: true })
            .getAttribute('readonly')) !== null,
          'readonly',
        )
        record = await ok(
          'DOCTOR_LINKED',
          'GET',
          '/api/v1/medical-records/by-appointment/' + appointment.id,
        )
        assert(
          record.status === 'COMPLETED' && record.version === 3,
          'completed version',
        )
        assert(
          (
            await ok(
              'DOCTOR_LINKED',
              'GET',
              '/api/v1/appointments/' + appointment.id,
            )
          ).status === 'COMPLETED',
          'atomic state',
        )
        assert(
          (
            await request(
              'DOCTOR_LINKED',
              'PATCH',
              '/api/v1/medical-records/' + record.id,
              { notes: 'Denied', expectedVersion: 3 },
            )
          ).status === 409,
          'final patch',
        )
        assert(
          (
            await request(
              'DOCTOR_LINKED',
              'POST',
              '/api/v1/medical-records/' + record.id + '/completion',
              { expectedVersion: 3 },
            )
          ).status === 409,
          'final complete',
        )
        assert(
          (
            await ok(
              'PATIENT',
              'GET',
              '/api/v1/medical-records/by-appointment/' + appointment.id,
            )
          ).id === record.id,
          'released ownership',
        )
      },
    )
    return { source: 'REAL D10 HTTP + MYSQL QA COPY', checks, http }
  } catch (error) {
    return {
      source: 'REAL D10 HTTP + MYSQL QA COPY',
      checks,
      http,
      error: error.message,
    }
  } finally {
    if (otherContext) await otherContext.close()
  }
}
