import { expect, test } from '@playwright/test'

const authenticateAs = async (
  page: any,
  role: 'ADMIN' | 'RECEPTIONIST' | 'DOCTOR' | 'PATIENT',
  userId = '10',
  fullName = 'Test User',
  destination = '/appointments',
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

test('Patient Appointments Management, Change Slot & Cancel UI E2E (CL-D08-FE)', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000)

  // 1. Initial load
  await page.goto(`${baseURL}/login`)
  await page
    .getByRole('heading', { name: 'Chào mừng trở lại', level: 1 })
    .waitFor()

  // 2. PATIENT View
  await authenticateAs(page, 'PATIENT', '10', 'Bệnh nhân Nguyễn An')

  // Verify page title and header
  await expect(
    page.getByRole('heading', {
      name: 'Lịch hẹn của tôi',
      exact: true,
      level: 1,
    }),
  ).toBeVisible()
  await expect(
    page.locator('[data-slot="badge"]').filter({ hasText: 'Bệnh nhân' }),
  ).toBeVisible()

  // Verify filter buttons exist
  await expect(page.getByRole('button', { name: 'Tất cả' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Chờ xác nhận' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Đã xác nhận' })).toBeVisible()

  // 3. Change Slot Flow (Đổi lịch khám)
  // Find "Đổi lịch" button on an active appointment
  const changeBtn = page.getByRole('button', { name: 'Đổi lịch' }).first()
  await expect(changeBtn).toBeVisible()
  await changeBtn.click()

  // Modal Dialog "Đổi lịch khám bệnh"
  await expect(
    page.getByRole('heading', { name: 'Đổi lịch khám bệnh' }),
  ).toBeVisible()
  await expect(page.getByText(/Chọn ngày và khung giờ khám mới/i)).toBeVisible()

  // Click quick date "Ngày mai"
  const tomorrowBtn = page.getByRole('button', { name: /Ngày mai/i })
  if (await tomorrowBtn.isVisible()) {
    await tomorrowBtn.click()
  }

  // Select an available slot
  const slotBtn = page
    .locator('button:has-text(":")')
    .filter({ hasText: '-' })
    .first()
  await expect(slotBtn).toBeVisible({ timeout: 10_000 })
  await slotBtn.click()

  // Confirm change
  const confirmChangeBtn = page.getByRole('button', {
    name: 'Xác nhận đổi lịch',
  })
  await expect(confirmChangeBtn).toBeEnabled()
  await confirmChangeBtn.click()

  // Check success feedback banner
  await expect(page.getByText(/Đổi lịch hẹn .* thành công/i)).toBeVisible({
    timeout: 15_000,
  })

  // 4. Cancel Appointment Flow (Hủy lịch)
  const cancelBtn = page.getByRole('button', { name: 'Hủy lịch' }).first()
  await expect(cancelBtn).toBeVisible()
  await cancelBtn.click()

  // Modal Dialog "Xác nhận hủy lịch khám"
  await expect(
    page.getByRole('heading', { name: 'Xác nhận hủy lịch khám' }),
  ).toBeVisible()
  await expect(page.getByText(/Lưu ý: Sau khi xác nhận hủy/i)).toBeVisible()

  // Fill cancellation reason
  const reasonInput = page.getByPlaceholder(/VD: Bận công việc đột xuất/i)
  await expect(reasonInput).toBeVisible()
  await reasonInput.fill('Bận công việc gia đình đột xuất không thể đến khám')

  // Confirm cancellation
  const confirmCancelBtn = page.getByRole('button', {
    name: 'Xác nhận hủy lịch',
  })
  await expect(confirmCancelBtn).toBeEnabled()
  await confirmCancelBtn.click()

  // Check cancellation feedback banner
  await expect(page.getByText(/Đã hủy cuộc hẹn .* thành công/i)).toBeVisible({
    timeout: 15_000,
  })
  await expect(
    page.getByText(/Lý do hủy: Bận công việc gia đình đột xuất/i),
  ).toBeVisible()

  // 5. Responsive Check at 320px
  await page.setViewportSize({ width: 320, height: 600 })
  await expect(
    page.getByRole('heading', {
      name: 'Lịch hẹn của tôi',
      exact: true,
      level: 1,
    }),
  ).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 800 })

  // 6. Role Isolation: DOCTOR view
  await authenticateAs(page, 'DOCTOR', '1', 'Bác sĩ Lê Thị Mai')

  await expect(
    page.getByRole('heading', {
      name: 'Quản lý lịch hẹn',
      exact: true,
      level: 1,
    }),
  ).toBeVisible()
  await expect(
    page.locator('[data-slot="badge"]').filter({ hasText: 'Bác sĩ' }),
  ).toBeVisible()

  // Doctor does not have permission to change or cancel patient appointments
  await expect(page.getByRole('button', { name: 'Đổi lịch' })).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Hủy lịch' })).not.toBeVisible()
})
