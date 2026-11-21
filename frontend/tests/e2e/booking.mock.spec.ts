import { expect, test } from '@playwright/test'

const authenticateAs = async (
  page: any,
  role: 'ADMIN' | 'RECEPTIONIST' | 'DOCTOR' | 'PATIENT',
  userId = '10',
  fullName = 'Test User',
  destination = '/booking',
) => {
  await page.evaluate(
    async ({ role, userId, fullName }: any) => {
      const store = await import('/src/auth/session-store.ts')
      store.establishSession(store.beginAuthentication(), crypto.randomUUID(), {
        id: userId,
        fullName,
        email: `${role.toLowerCase()}@clinic.invalid`,
        role,
      })
    },
    { role, userId, fullName },
  )
  // Client-side SPA navigation
  await page.evaluate((path: string) => {
    history.pushState(null, '', path)
    dispatchEvent(new PopStateEvent('popstate'))
  }, destination)
  await page.waitForURL(`**${destination}`)
}

test('Patient Appointment Booking UI E2E (CL-D07-FE)', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000)

  // 1. Initial load
  await page.goto(`${baseURL}/login`)
  await page
    .getByRole('heading', { name: 'Chào mừng trở lại', level: 1 })
    .waitFor()

  // 2. PATIENT Booking Wizard Flow
  await authenticateAs(page, 'PATIENT', '10', 'Bệnh nhân Nguyễn An')

  // Verify page title and header
  await expect(
    page.getByRole('heading', { name: 'Đặt lịch khám', exact: true, level: 1 }),
  ).toBeVisible()
  await expect(
    page
      .locator('[data-slot="badge"]')
      .filter({ hasText: 'Khu vực bệnh nhân' }),
  ).toBeVisible()

  // Step 1: Lựa chọn chuyên khoa
  await expect(
    page.getByRole('heading', { name: /Bước 1: Lựa chọn chuyên khoa/i }),
  ).toBeVisible()

  // Click on "Nội tổng quát" specialty
  const specialtyBtn = page
    .getByRole('button', { name: /Nội tổng quát/i })
    .first()
  await expect(specialtyBtn).toBeVisible()
  await specialtyBtn.click()

  // Step 2: Chọn bác sĩ phụ trách
  await expect(
    page.getByRole('heading', { name: /Bước 2: Chọn bác sĩ/i }),
  ).toBeVisible()
  const selectDoctorBtn = page
    .getByRole('button', { name: /Chọn bác sĩ/i })
    .first()
  await expect(selectDoctorBtn).toBeVisible()
  await selectDoctorBtn.click()

  // Step 3: Chọn ngày và khung giờ khám
  await expect(
    page.getByRole('heading', { name: /Bước 3: Chọn ngày và khung giờ/i }),
  ).toBeVisible()

  // Choose "Ngày mai" (Tomorrow) for reliable future slots
  const tomorrowBtn = page.getByRole('button', { name: /Ngày mai/i })
  if (await tomorrowBtn.isVisible()) {
    await tomorrowBtn.click()
  }

  // Pick first available slot
  const slotBtn = page
    .locator('button:has-text(":")')
    .filter({ hasText: '-' })
    .first()
  await expect(slotBtn).toBeVisible({ timeout: 10_000 })
  await slotBtn.click()

  // Click "Tiếp tục xác nhận"
  const proceedBtn = page.getByRole('button', { name: /Tiếp tục xác nhận/i })
  await expect(proceedBtn).toBeEnabled()
  await proceedBtn.click()

  // Step 4: Kiểm tra và xác nhận lịch hẹn
  await expect(
    page.getByRole('heading', { name: /Bước 4: Kiểm tra và xác nhận/i }),
  ).toBeVisible()

  // Enter reason
  const reasonInput = page.getByPlaceholder(/Khám định kỳ, kiểm tra huyết áp/i)
  await expect(reasonInput).toBeVisible()
  await reasonInput.fill('Khám sức khỏe tổng quát định kỳ')

  // Click "Xác nhận & Đặt lịch" to open dialog
  const submitBookingBtn = page.getByRole('button', {
    name: /Xác nhận & Đặt lịch/i,
  })
  await submitBookingBtn.click()

  // Confirm dialog is displayed
  await expect(
    page.getByRole('heading', { name: 'Xác nhận đặt lịch khám' }),
  ).toBeVisible()

  // Click "Đồng ý & Đặt lịch" inside dialog
  const confirmDialogBtn = page.getByRole('button', {
    name: /Đồng ý & Đặt lịch/i,
  })
  await confirmDialogBtn.click()

  // Step 5: Kết quả đặt lịch
  await expect(
    page.getByRole('heading', { name: 'Đặt lịch khám thành công!' }),
  ).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/Mã cuộc hẹn của bạn:/i)).toBeVisible()
  await expect(page.getByText(/APT_/i)).toBeVisible()

  // Reset to Step 1 via "Đặt lịch khám khác"
  const resetBtn = page.getByRole('button', { name: /Đặt lịch khám khác/i })
  await expect(resetBtn).toBeVisible()
  await resetBtn.click()
  await expect(
    page.getByRole('heading', { name: /Bước 1: Lựa chọn chuyên khoa/i }),
  ).toBeVisible()

  // 3. Responsive Check at 320px for PATIENT
  await page.setViewportSize({ width: 320, height: 600 })
  await expect(
    page.getByRole('heading', { name: 'Đặt lịch khám', exact: true, level: 1 }),
  ).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 800 })

  // 4. RECEPTIONIST Role View
  await authenticateAs(page, 'RECEPTIONIST', '20', 'Lễ tân Tiếp đón')
  await expect(
    page.getByRole('heading', { name: 'Đặt lịch khám', exact: true, level: 1 }),
  ).toBeVisible()
  await expect(
    page
      .locator('[data-slot="badge"]')
      .filter({ hasText: 'Đặt lịch tại quầy tiếp đón' }),
  ).toBeVisible()

  // 5. DOCTOR Role Isolation (Forbidden access to /booking)
  await page.evaluate(async () => {
    const store = await import('/src/auth/session-store.ts')
    store.establishSession(store.beginAuthentication(), crypto.randomUUID(), {
      id: '1001',
      fullName: 'TS.BS Nguyễn Văn A',
      email: 'doctor@clinic.invalid',
      role: 'DOCTOR',
    })
  })
  await page.evaluate((path: string) => {
    history.pushState(null, '', path)
    dispatchEvent(new PopStateEvent('popstate'))
  }, '/booking')
  // DOCTOR cannot access booking screen or see it in navigation
  await expect(
    page.getByRole('link', { name: 'Đặt lịch khám' }),
  ).not.toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Đặt lịch khám trực tuyến', level: 1 }),
  ).not.toBeVisible()
})
