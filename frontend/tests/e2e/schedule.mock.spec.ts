import { expect, test } from '@playwright/test'

const authenticateAs = async (
  page: any,
  role: 'ADMIN' | 'RECEPTIONIST' | 'DOCTOR' | 'PATIENT',
  userId = '1001',
  fullName = 'Test User',
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
  }, '/schedules')
  await page.waitForURL('**/schedules')
}

test('Doctor Work Schedule UI E2E (CL-D06-FE)', async ({ page, baseURL }) => {
  test.setTimeout(120_000)

  // 1. Initial load
  await page.goto(`${baseURL}/login`)
  await page
    .getByRole('heading', { name: 'Chào mừng trở lại', level: 1 })
    .waitFor()

  // 2. ADMIN View & Operations
  await authenticateAs(page, 'ADMIN', '10', 'Quản trị viên Hệ thống')

  // Verify page title and header
  await expect(
    page.getByRole('heading', { name: 'Lịch làm việc bác sĩ', level: 1 }),
  ).toBeVisible()
  await expect(
    page.locator('[data-slot="badge"]').filter({ hasText: 'Quản trị viên' }),
  ).toBeVisible()

  // Verify "Thêm ca làm việc" button is present for ADMIN
  const addBtn = page.getByRole('button', { name: /Thêm ca làm việc/i })
  await expect(addBtn).toBeVisible()

  // Verify week view is default and shows weekday columns
  await expect(page.getByText('Theo tuần')).toBeVisible()
  await expect(page.getByText('Thứ 2')).toBeVisible()
  await expect(page.getByText('Chủ Nhật')).toBeVisible()

  // Test view toggle: switch to day view
  await page.getByRole('button', { name: 'Theo ngày' }).click()
  await expect(page.getByText(/Lịch làm việc ngày/i)).toBeVisible()

  // Switch back to week view
  await page.getByRole('button', { name: 'Theo tuần' }).click()

  // Open "Thêm ca làm việc" modal
  await addBtn.click()
  await expect(
    page.getByRole('heading', { name: 'Thêm ca làm việc mới' }),
  ).toBeVisible()

  // Verify form elements in dialog
  await expect(page.getByLabel(/Bác sĩ phụ trách/i)).toBeVisible()
  await expect(page.getByLabel(/Ngày làm việc/i)).toBeVisible()
  await expect(page.getByLabel(/Giờ bắt đầu/i)).toBeVisible()
  await expect(page.getByLabel(/Giờ kết thúc/i)).toBeVisible()
  await expect(page.getByText('30 phút')).toBeVisible()

  // Close modal
  await page.getByRole('button', { name: 'Hủy' }).click()

  // 3. RECEPTIONIST View
  await authenticateAs(page, 'RECEPTIONIST', '20', 'Lễ tân Tiếp đón')
  await expect(
    page.getByRole('heading', { name: 'Lịch làm việc bác sĩ', level: 1 }),
  ).toBeVisible()
  await expect(
    page.locator('[data-slot="badge"]').filter({ hasText: 'Lễ tân' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /Thêm ca làm việc/i }),
  ).toBeVisible()

  // 4. DOCTOR Role Isolation
  await authenticateAs(page, 'DOCTOR', '1001', 'TS.BS Nguyễn Văn A')
  await expect(
    page.getByRole('heading', { name: 'Lịch làm việc bác sĩ', level: 1 }),
  ).toBeVisible()
  await expect(
    page.locator('[data-slot="badge"]').filter({ hasText: 'Bác sĩ' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /Thêm ca làm việc/i }),
  ).not.toBeVisible()
  await expect(page.getByText(/Lịch của tôi:/i)).toBeVisible()

  // 5. PATIENT Role Boundaries
  await authenticateAs(page, 'PATIENT', '3001', 'Bệnh nhân Nguyễn An')
  await expect(
    page.getByRole('heading', { name: 'Lịch làm việc bác sĩ', level: 1 }),
  ).toBeVisible()
  await expect(
    page.locator('[data-slot="badge"]').filter({ hasText: 'Bệnh nhân' }),
  ).toBeVisible()
  await expect(
    page.getByText(/Chế độ xem lịch khám cho bệnh nhân/i),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /Thêm ca làm việc/i }),
  ).not.toBeVisible()

  // 6. Responsive Check at 320px
  await page.setViewportSize({ width: 320, height: 600 })
  await expect(
    page.getByRole('heading', { name: 'Lịch làm việc bác sĩ', level: 1 }),
  ).toBeVisible()
})
