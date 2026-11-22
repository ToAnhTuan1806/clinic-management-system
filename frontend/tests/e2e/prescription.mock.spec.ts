import { expect, test } from '@playwright/test'
import { PRESCRIPTION_SIMULATION_NOTICE } from '../../src/prescription/model'

test('Prescription Management UI E2E (CL-D12-FE)', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000)

  const origin = baseURL || 'http://127.0.0.1:5174'
  let currentRole = 'DOCTOR'
  let currentUserId = '1'
  let currentFullName = 'Bác sĩ Trần Hùng'

  const currentRecord = {
    id: '45',
    appointmentId: '1',
    status: 'IN_PROGRESS',
    version: 0,
    symptoms: 'Đau họng, sốt nhẹ',
    diagnosis: 'Viêm họng cấp',
    notes: 'Theo dõi 3 ngày',
    conclusion: 'Dùng thuốc theo đơn',
  }

  // Intercept backend API requests so examinations.tsx and booking APIs function in Playwright mock mode
  await page.route(origin + '/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    const path = url.pathname.replace('/api/v1', '')

    const json = (status: number, body: any) =>
      route.fulfill({ status, json: body })
    const ok = (data: any, status = 200) => json(status, { data })
    const problem = (status: number, code: string) =>
      json(status, { status, code })

    if (path === '/auth/login') {
      return ok({ accessToken: 'mock-synthetic-token' })
    }
    if (path === '/auth/me') {
      return ok({
        id: currentUserId,
        fullName: currentFullName,
        email: `${currentRole.toLowerCase()}@clinic.invalid`,
        role: currentRole,
      })
    }

    if (path === '/appointments') {
      const statusParam = url.searchParams.get('status')
      const items =
        statusParam === 'IN_PROGRESS'
          ? [
              {
                id: '1',
                patientId: '21',
                doctorId: currentUserId,
                scheduleId: '8',
                patientFullName: 'Bệnh nhân Nguyễn Văn A',
                appointmentCode: 'MOCK-1',
                startAt: '2026-11-25T02:00:00Z',
                endAt: '2026-11-25T02:30:00Z',
                status: 'IN_PROGRESS',
                version: 0,
              },
            ]
          : []
      return ok({
        items,
        page: 0,
        size: 100,
        totalElements: items.length,
        totalPages: items.length ? 1 : 0,
      })
    }

    if (/^\/appointments\/\d+$/.test(path)) {
      return ok({
        id: '1',
        patientId: '21',
        doctorId: currentUserId,
        scheduleId: '8',
        patientFullName: 'Bệnh nhân Nguyễn Văn A',
        appointmentCode: 'MOCK-1',
        startAt: '2026-11-25T02:00:00Z',
        endAt: '2026-11-25T02:30:00Z',
        status: 'IN_PROGRESS',
        version: 0,
      })
    }

    if (/^\/medical-records\/by-appointment\/\d+$/.test(path)) {
      return ok(currentRecord)
    }

    if (path === '/medical-records/45' && method === 'GET') {
      return ok(currentRecord)
    }

    if (path === '/medical-records/45' && method === 'PATCH') {
      const body = route.request().postDataJSON()
      if (body.expectedVersion !== currentRecord.version) {
        return problem(409, 'VERSION_CONFLICT')
      }
      Object.assign(currentRecord, body)
      currentRecord.version++
      return ok(currentRecord)
    }

    return route.continue()
  })

  const authenticateAs = async (
    role: 'ADMIN' | 'RECEPTIONIST' | 'DOCTOR' | 'PATIENT',
    userId = '50',
    fullName = 'Người dùng MOCK',
    destination = '/medical-records',
  ) => {
    currentRole = role
    currentUserId = userId
    currentFullName = fullName

    await page.evaluate(
      async ({ role, userId, fullName }: any) => {
        const store = await import('/src/auth/session-store.ts')
        const token =
          typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : 'mock-token-' + Date.now()
        store.establishSession(store.beginAuthentication(), token, {
          id: userId,
          fullName,
          email: `${role.toLowerCase()}@clinic.invalid`,
          role,
        })
      },
      { role, userId, fullName },
    )
    await page.evaluate((path: string) => {
      history.pushState(null, '', path)
      dispatchEvent(new PopStateEvent('popstate'))
    }, destination)
    await page.waitForURL(`**${destination}`)
  }

  // 1. Initial Load & Login page
  await page.goto(`${origin}/login`)
  // MOCK ONLY: both adapters share MedicalRecord.version in the real backend.
  await page.exposeFunction('d12MockVersion', (version: number) => {
    currentRecord.version = version
  })
  await page.evaluate(async () => {
    const { prescriptionGateway } = await import('/src/prescription/gateway.ts')
    const save = prescriptionGateway.save.bind(prescriptionGateway)
    prescriptionGateway.save = async (...args: any[]) => {
      const saved = await save(...args)
      await (window as any).d12MockVersion(saved.recordVersion)
      return saved
    }
  })
  await page
    .getByRole('heading', { name: 'Chào mừng trở lại', level: 1 })
    .waitFor()

  // ----------------------------------------------------
  // 2. DOCTOR FLOW: Tạo, Sửa, Xóa, Lưu đơn thuốc mô phỏng
  // ----------------------------------------------------
  await authenticateAs('DOCTOR', '1', 'Bác sĩ Trần Hùng', '/medical-records')

  await expect(
    page.getByRole('heading', { name: 'Không gian khám bệnh', level: 1 }),
  ).toBeVisible()

  // Select an appointment in progress or open examination modal
  const openExamBtn = page.getByRole('button', { name: /Mở chi tiết/i }).first()
  await expect(openExamBtn).toBeVisible({ timeout: 10_000 })
  await openExamBtn.click()

  // Dialog title "Chi tiết khám bệnh"
  await expect(
    page.getByRole('heading', { name: 'Chi tiết khám bệnh' }),
  ).toBeVisible()

  // If appointment is CHECKED_IN but record not created yet, click "Bắt đầu khám"
  const startExamBtn = page.getByRole('button', { name: 'Bắt đầu khám' })
  if (await startExamBtn.isVisible()) {
    await startExamBtn.click()
  }

  // Check tabs: "Hồ sơ lâm sàng" and "Đơn thuốc mô phỏng"
  const prescriptionTab = page.getByRole('button', {
    name: 'Đơn thuốc mô phỏng',
    exact: true,
  })
  const clinicalTab = page.getByRole('button', {
    name: 'Hồ sơ lâm sàng',
    exact: true,
  })

  await expect(prescriptionTab).toBeVisible({ timeout: 10_000 })
  await prescriptionTab.click()

  // Simulation disclaimer notice must be visible
  await expect(page.getByText(PRESCRIPTION_SIMULATION_NOTICE)).toBeVisible()

  // Add a medication row
  const addBtn = page.getByRole('button', { name: /Thêm thuốc/i }).first()
  await expect(addBtn).toBeVisible()
  await addBtn.click()

  // Fill row details
  const medNameInput = page.getByPlaceholder(/VD: Paracetamol 500mg/i).last()
  await expect(medNameInput).toBeVisible()
  await medNameInput.fill('Amoxicillin 500mg')

  const qtyInput = page.getByPlaceholder('10').last()
  await qtyInput.fill('14')

  const dosageInput = page.getByPlaceholder(/VD: 500mg \/ 1 viên/i).last()
  await dosageInput.fill('1 viên')

  const freqInput = page.getByPlaceholder(/VD: 2 lần\/ngày sau ăn/i).last()
  await freqInput.fill('2 lần/ngày sau khi ăn')

  const daysInput = page.getByPlaceholder('5').last()
  await daysInput.fill('7')

  const instInput = page.getByPlaceholder(/VD: Uống với nhiều nước/i).last()
  await instInput.fill('Uống đủ liều 7 ngày liên tục')

  // Verify dirty badge "Chưa lưu"
  await expect(page.getByText('Chưa lưu')).toBeVisible()

  // Save prescription
  const saveBtn = page.getByRole('button', { name: 'Lưu đơn thuốc' })
  await expect(saveBtn).toBeEnabled()
  await saveBtn.click()

  // Verify success feedback
  await expect(
    page.getByText(/Đã lưu toàn bộ đơn thuốc mô phỏng thành công/i),
  ).toBeVisible()

  // Test delete a row
  await addBtn.click()
  const deleteBtns = page.getByRole('button', { name: /Xóa/i })
  const countBefore = await deleteBtns.count()
  expect(countBefore).toBeGreaterThan(0)
  await deleteBtns.last().click()

  // Test validation: input invalid quantity (e.g. 0)
  await qtyInput.fill('0')
  await saveBtn.click()
  await expect(
    page.getByText(/Số lượng phải là số nguyên từ 1 đến 10.000/i),
  ).toBeVisible()

  // Update to a new valid quantity (15) so dirty state is true, then save
  await qtyInput.fill('15')
  await expect(saveBtn).toBeEnabled()
  await saveBtn.click()
  await expect(
    page.getByText(/Đã lưu toàn bộ đơn thuốc mô phỏng thành công/i),
  ).toBeVisible()

  // Switch back to clinical tab
  await clinicalTab.click()
  await expect(page.getByLabel('Triệu chứng')).toBeVisible()

  // Close examination dialog
  const closeBtn = page.getByRole('button', { name: 'Đóng hộp thoại' })
  if (await closeBtn.isVisible()) {
    await closeBtn.click()
  } else {
    await page.keyboard.press('Escape')
  }

  // ----------------------------------------------------
  // 3. RESPONSIVE CHECK: 320px
  // ----------------------------------------------------
  await page.setViewportSize({ width: 320, height: 600 })
  const hasHorizontalScroll = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  )
  expect(hasHorizontalScroll).toBe(false)
  await page.setViewportSize({ width: 1280, height: 800 })

  // ----------------------------------------------------
  // 4. PATIENT FLOW: Xem đơn thuốc đã công bố (Chỉ đọc)
  // ----------------------------------------------------
  await authenticateAs(
    'PATIENT',
    '1',
    'Bệnh nhân Lê Văn Nam',
    '/medical-history',
  )

  await expect(
    page.getByRole('heading', { name: 'Lịch sử khám', level: 1 }),
  ).toBeVisible()

  // Open completed & released record detail (Record 4 has released prescription)
  const viewDetailBtn = page.getByRole('button', {
    name: 'Xem chi tiết lượt 4',
  })
  await expect(viewDetailBtn).toBeVisible({ timeout: 10_000 })
  await viewDetailBtn.click()

  await expect(
    page.getByRole('heading', { name: 'Chi tiết lượt khám' }),
  ).toBeVisible()

  // In detail dialog, prescription viewer should be displayed
  const prescriptionSection = page.getByText(PRESCRIPTION_SIMULATION_NOTICE)
  await expect(prescriptionSection).toBeVisible()

  // Check medication item rendered
  await expect(page.getByText('Paracetamol 500mg')).toBeVisible()

  // Must be read-only: no "Thêm thuốc", "Lưu đơn thuốc", or "Xóa"
  await expect(
    page.getByRole('button', { name: 'Thêm thuốc' }),
  ).not.toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Lưu đơn thuốc' }),
  ).not.toBeVisible()
  await expect(page.getByRole('button', { name: /Xóa/i })).not.toBeVisible()

  // Badge "Chỉ đọc"
  await expect(page.getByText('Chỉ đọc').first()).toBeVisible()

  await page.keyboard.press('Escape')

  // ----------------------------------------------------
  // 5. ROLE GUARD: RECEPTIONIST không được truy cập lịch sử khám
  // ----------------------------------------------------
  await authenticateAs('RECEPTIONIST', '200', 'Lễ tân Hoàng', '/dashboard')

  // Receptionist attempts navigating to /medical-history -> must redirect to /forbidden
  await page.evaluate(() => {
    history.pushState(null, '', '/medical-history')
    dispatchEvent(new PopStateEvent('popstate'))
  })
  await page.waitForURL('**/forbidden')
  await expect(
    page.getByRole('heading', { name: 'Không có quyền truy cập', level: 1 }),
  ).toBeVisible()
})
