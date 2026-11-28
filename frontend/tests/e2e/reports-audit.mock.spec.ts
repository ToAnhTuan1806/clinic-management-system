import { expect, test } from '@playwright/test'

// HTTP MOCK ONLY: verifies D14 Reports & Audit Logs UI, RBAC, filters, error/retry, and responsive layout.
test('D14 Reports & Audit Logs mock flow, RBAC, filters, retry, and 320px responsive', async ({
  page,
}) => {
  let reportFault = false
  let auditFault = false

  await page.route('**/api/v1/auth/login', async (route) => {
    return route.fulfill({
      json: { data: { accessToken: 'mock-admin-token' } },
    })
  })

  await page.route('**/api/v1/auth/me', async (route) => {
    return route.fulfill({
      json: {
        data: {
          id: '1',
          fullName: 'Quản trị viên',
          email: 'admin@clinic.local',
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      },
    })
  })

  await page.route('**/api/v1/dashboard/summary*', async (route) => {
    const url = new URL(route.request().url())
    return route.fulfill({
      json: {
        data: {
          from: url.searchParams.get('from') ?? '2026-11-01',
          to: url.searchParams.get('to') ?? '2026-11-28',
          timezone: 'Asia/Ho_Chi_Minh',
          totalAppointments: 12,
          appointmentsByStatus: {
            PENDING: 2,
            CONFIRMED: 3,
            CHECKED_IN: 1,
            IN_PROGRESS: 1,
            COMPLETED: 4,
            CANCELLED: 1,
            NO_SHOW: 0,
          },
          checkedInCount: 6,
          completedCount: 4,
          uniquePatients: 9,
        },
      },
    })
  })

  await page.route('**/api/v1/notifications*', async (route) => {
    return route.fulfill({
      json: {
        data: {
          items: [],
          page: 0,
          size: 20,
          totalElements: 0,
          totalPages: 0,
          unreadCount: 0,
        },
      },
    })
  })

  await page.route('**/api/v1/reports/visits*', async (route) => {
    const url = new URL(route.request().url())
    if (reportFault) {
      reportFault = false
      return route.fulfill({
        status: 500,
        json: { status: 500, code: 'INTERNAL_ERROR', detail: 'Error' },
      })
    }
    const empty = url.searchParams.get('from') === '2020-01-01'
    return route.fulfill({
      json: {
        data: {
          from: url.searchParams.get('from') ?? '2026-11-01',
          to: url.searchParams.get('to') ?? '2026-11-28',
          timezone: 'Asia/Ho_Chi_Minh',
          totalAppointments: empty ? 0 : 12,
          appointmentsByStatus: {
            PENDING: empty ? 0 : 2,
            CONFIRMED: empty ? 0 : 3,
            CHECKED_IN: empty ? 0 : 1,
            IN_PROGRESS: empty ? 0 : 1,
            COMPLETED: empty ? 0 : 4,
            CANCELLED: empty ? 0 : 1,
            NO_SHOW: 0,
          },
          checkedInCount: empty ? 0 : 6,
          completedCount: empty ? 0 : 4,
          uniquePatients: empty ? 0 : 9,
          dailyVisits: empty
            ? []
            : [
                {
                  date: '2026-11-22',
                  totalAppointments: 5,
                  checkedInCount: 3,
                  completedCount: 2,
                  cancelledCount: 0,
                  noShowCount: 0,
                },
                {
                  date: '2026-11-28',
                  totalAppointments: 7,
                  checkedInCount: 3,
                  completedCount: 2,
                  cancelledCount: 1,
                  noShowCount: 0,
                },
              ],
          byDoctor: empty
            ? []
            : [
                {
                  doctorId: '2',
                  doctorCode: 'DOC-01',
                  doctorName: 'BS. Nguyễn Minh',
                  specialtyName: 'Tim mạch',
                  totalAppointments: 12,
                  checkedInCount: 6,
                  completedCount: 4,
                },
              ],
          bySpecialty: empty
            ? []
            : [
                {
                  specialtyId: '1',
                  specialtyCode: 'CARD',
                  specialtyName: 'Tim mạch',
                  totalAppointments: 12,
                  checkedInCount: 6,
                  completedCount: 4,
                },
              ],
        },
      },
    })
  })

  await page.route('**/api/v1/audit-logs*', async (route) => {
    const url = new URL(route.request().url())
    if (auditFault) {
      auditFault = false
      return route.fulfill({
        status: 500,
        json: { status: 500, code: 'INTERNAL_ERROR', detail: 'Error' },
      })
    }
    const pageNum = Number(url.searchParams.get('page') ?? '0')
    const action = url.searchParams.get('action') ?? ''
    const items = [
      {
        id: pageNum === 0 ? '101' : '102',
        actorUserId: '8',
        actorRole: 'RECEPTIONIST',
        action: action || 'APPOINTMENT_CHECKED_IN',
        entityType: 'APPOINTMENT',
        entityId: '50',
        result: 'SUCCESS',
        metadata: 'DO_NOT_DISPLAY_SECRET',
        occurredAt: '2026-11-28T03:15:00Z',
      },
    ]
    return route.fulfill({
      json: {
        data: {
          items,
          page: pageNum,
          size: 20,
          totalElements: 25,
          totalPages: 2,
        },
      },
    })
  })

  // Login as ADMIN in mock auth mode
  await page.goto('/login')
  await page.getByLabel('Email').fill('admin@clinic.local')
  await page.getByRole('textbox', { name: 'Mật khẩu' }).fill('DemoPass123!')
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  await page.waitForURL('**/dashboard')

  // Navigate to /reports via sidebar
  await page.getByRole('link', { name: 'Báo cáo' }).click()
  await page.waitForURL('**/reports')
  await expect(
    page.getByRole('heading', { name: 'Báo cáo lượt khám' }),
  ).toBeVisible()
  await expect(page.getByText('BS. Nguyễn Minh')).toBeVisible()
  await expect(page.getByText('Tim mạch').first()).toBeVisible()

  // Trigger error & verify Retry recovers
  reportFault = true
  await page.getByRole('button', { name: 'Làm mới' }).click()
  await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible()
  await page.getByRole('button', { name: 'Thử lại' }).click()
  await expect(page.getByText('BS. Nguyễn Minh')).toBeVisible()

  // Navigate to /audit-logs (ADMIN only)
  await page.getByRole('link', { name: 'Nhật ký kiểm toán' }).click()
  await page.waitForURL('**/audit-logs')
  await expect(
    page.getByRole('heading', { name: 'Nhật ký kiểm toán' }),
  ).toBeVisible()
  await expect(
    page.locator('tbody').getByText('Check-in bệnh nhân'),
  ).toBeVisible()
  await expect(page.getByText('DO_NOT_DISPLAY_SECRET')).toHaveCount(0)

  // Verify pagination & no edit/delete controls
  await expect(page.getByRole('button', { name: /Xóa|Sửa/i })).toHaveCount(0)
  await page.getByRole('button', { name: 'Trang sau' }).click()
  await expect(page.getByText('Trang 2 / 2')).toBeVisible()

  // Verify Audit error + retry
  auditFault = true
  await page.getByRole('button', { name: 'Làm mới' }).click()
  await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible()
  await page.getByRole('button', { name: 'Thử lại' }).click()
  await expect(page.getByText('Danh sách bản ghi')).toBeVisible()

  // Responsive check at 320px mobile width without losing in-memory session
  await page.setViewportSize({ width: 320, height: 640 })
  await page.evaluate(() => {
    history.pushState(null, '', '/reports')
    dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(
    page.getByRole('heading', { name: 'Báo cáo lượt khám' }),
  ).toBeVisible()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  )
  expect(overflow).toBe(false)
})
