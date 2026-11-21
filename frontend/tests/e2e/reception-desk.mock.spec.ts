import { expect, test } from '@playwright/test'

const authenticateAs = async (
  page: any,
  role: 'ADMIN' | 'RECEPTIONIST' | 'DOCTOR' | 'PATIENT',
  userId = '200',
  fullName = 'Lễ Tân Tiếp Đón',
  destination = '/reception/appointments',
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

test('Receptionist Appointment Desk E2E (CL-D09-FE)', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000)

  // 1. Initial load
  await page.goto(`${baseURL}/login`)
  await page
    .getByRole('heading', { name: 'Chào mừng trở lại', level: 1 })
    .waitFor()

  // 2. Authenticate as RECEPTIONIST
  await authenticateAs(
    page,
    'RECEPTIONIST',
    '200',
    'Lễ tân Nguyễn Thị Hoa',
    '/reception/appointments',
  )

  // Verify Page Title and Header
  await expect(
    page.getByRole('heading', {
      name: 'Bàn tiếp đón & Điều phối lịch khám',
      level: 1,
    }),
  ).toBeVisible()
  await expect(
    page.locator('[data-slot="badge"]').filter({ hasText: 'Lễ tân tiếp đón' }),
  ).toBeVisible()

  // Verify Stat Cards
  await expect(page.getByText('Tổng lịch hẹn')).toBeVisible()
  await expect(
    page.locator('div').filter({ hasText: /^Chờ xác nhận$/ }),
  ).toBeVisible()
  await expect(
    page.locator('div').filter({ hasText: /^Đã xác nhận$/ }),
  ).toBeVisible()
  await expect(
    page.locator('div').filter({ hasText: /^Đã tiếp đón$/ }),
  ).toBeVisible()
  await expect(
    page.locator('div').filter({ hasText: /^Vắng mặt$/ }),
  ).toBeVisible()

  // Verify Quick Date & Status Filter Buttons
  await expect(page.getByRole('button', { name: 'Hôm nay' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ngày mai' })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Tất cả', exact: true }),
  ).toBeVisible()

  // 3. Confirm Appointment Flow (PENDING -> CONFIRMED)
  const confirmBtn = page.getByRole('button', { name: 'Xác nhận lịch' }).first()
  await expect(confirmBtn).toBeVisible()
  await confirmBtn.click()

  // Confirm Modal
  await expect(
    page.getByRole('heading', { name: 'Xác nhận lịch hẹn khám' }),
  ).toBeVisible()
  const confirmSubmitBtn = page
    .getByRole('button', { name: 'Xác nhận lịch' })
    .last()
  await expect(confirmSubmitBtn).toBeVisible()
  await confirmSubmitBtn.click()

  // Check Feedback Banner
  await expect(
    page.getByText(/Đã xác nhận lịch hẹn .* thành công/i),
  ).toBeVisible({ timeout: 15_000 })

  // 4. Check-in Appointment Flow (CONFIRMED -> CHECKED_IN)
  const checkInBtn = page
    .getByRole('button', { name: 'Tiếp đón (Check-in)' })
    .first()
  await expect(checkInBtn).toBeVisible()
  await checkInBtn.click()

  // Check-in Modal
  await expect(
    page.getByRole('heading', { name: 'Tiếp đón bệnh nhân (Check-in)' }),
  ).toBeVisible()
  const checkInSubmitBtn = page.getByRole('button', {
    name: 'Xác nhận tiếp đón',
  })
  await expect(checkInSubmitBtn).toBeVisible()
  await checkInSubmitBtn.click()

  // Check Feedback Banner
  await expect(
    page.getByText(/Đã tiếp đón bệnh nhân .* thành công/i),
  ).toBeVisible({ timeout: 15_000 })

  // 5. Mark No-show Flow (NO_SHOW)
  const noShowBtn = page.getByRole('button', { name: 'Báo vắng mặt' }).first()
  if (await noShowBtn.isVisible()) {
    await noShowBtn.click()

    await expect(
      page.getByRole('heading', { name: 'Đánh dấu bệnh nhân vắng mặt' }),
    ).toBeVisible()
    const noShowSubmitBtn = page.getByRole('button', {
      name: 'Xác nhận vắng mặt',
    })
    await expect(noShowSubmitBtn).toBeVisible()
    await noShowSubmitBtn.click()

    await expect(page.getByText(/Đã đánh dấu vắng mặt lịch hẹn/i)).toBeVisible({
      timeout: 15_000,
    })
  }

  // 6. Responsive Check at 320px
  await page.setViewportSize({ width: 320, height: 600 })
  await expect(
    page.getByRole('heading', {
      name: 'Bàn tiếp đón & Điều phối lịch khám',
      level: 1,
    }),
  ).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 800 })

  // 7. Role Isolation: Check sidebar navigation for PATIENT
  await authenticateAs(page, 'PATIENT', '10', 'Bệnh nhân An', '/booking')
  await expect(page.getByRole('link', { name: 'Tiếp đón' })).not.toBeVisible()

  // 8. Role Isolation: Check sidebar navigation for DOCTOR
  await authenticateAs(page, 'DOCTOR', '1', 'BS. Mai', '/dashboard')
  await expect(page.getByRole('link', { name: 'Tiếp đón' })).not.toBeVisible()
})
