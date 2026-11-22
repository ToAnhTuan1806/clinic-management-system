import type { AxiosInstance } from 'axios'
import { AuthApiError, normalizeAuthError } from '@/auth/errors'
import { getAuthSnapshot } from '@/auth/session-store'
import { apiClient } from '@/lib/api-client'
import { validId, getVnTodayString } from '@/schedule/model'
import type { Role } from '@/auth/types'
import type { AppointmentStatus } from '@/booking/model'

// DTOs aligned with Backend workspace API_CONTRACT §3.11 and D13 controllers.
// MySQL V12 verified. D13 is enabled unless deliberately disabled for maintenance.
export const statuses: AppointmentStatus[] = [
  'PENDING',
  'CONFIRMED',
  'CHECKED_IN',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
]
export interface Summary {
  from: string
  to: string
  timezone: 'Asia/Ho_Chi_Minh'
  totalAppointments: number
  appointmentsByStatus: Record<AppointmentStatus, number>
  checkedInCount: number
  completedCount: number
  uniquePatients: number
}
export interface DateRange {
  from: string
  to: string
}
export const notificationLabels = {
  APPOINTMENT_CREATED: 'Lịch khám mới được tạo',
  APPOINTMENT_RESCHEDULED: 'Lịch khám đã được đổi giờ',
  APPOINTMENT_CANCELLED: 'Lịch khám đã được hủy',
  APPOINTMENT_CONFIRMED: 'Lịch khám đã được xác nhận',
} as const
export interface Notification {
  id: string
  eventType: keyof typeof notificationLabels
  appointmentId: string | null
  appointmentCode: string | null
  createdAt: string
  readAt: string | null
}
export interface NotificationPage {
  items: Notification[]
  page: number
  size: number
  totalElements: number
  totalPages: number
  unreadCount: number
}
export const canViewDashboard = (role?: Role) => !!role && role !== 'PATIENT'
export function dateRangeError(range: DateRange): string {
  for (const value of [range.from, range.to]) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value + 'T00:00:00Z')) ||
      new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value
    )
      return 'Chọn ngày bắt đầu và kết thúc hợp lệ.'
  }
  if (range.from < '1000-01-02' || range.to > '9999-12-31')
    return 'Ngày phải từ 02/01/1000 đến 31/12/9999.'
  if (
    (Date.parse(range.to + 'T00:00:00Z') -
      Date.parse(range.from + 'T00:00:00Z')) /
      86400000 >=
    366
  )
    return 'Khoảng thống kê tối đa 366 ngày, tính cả ngày bắt đầu và kết thúc.'
  return range.from > range.to
    ? 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.'
    : ''
}
export function defaultDateRange(): DateRange {
  const today = getVnTodayString()
  return { from: today.slice(0, 8) + '01', to: today }
}
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const instant = (value: unknown): value is string =>
  typeof value === 'string' &&
  /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value))
function invalid(): never {
  throw new AuthApiError(
    'Dữ liệu phản hồi không hợp lệ. Vui lòng thử lại.',
    0,
    'INVALID_OPERATIONS_RESPONSE',
  )
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid()
  return value as Record<string, unknown>
}
export function decodeSummary(value: unknown): Summary {
  const row = object(value),
    distribution = object(row.appointmentsByStatus)
  if (
    typeof row.from !== 'string' ||
    typeof row.to !== 'string' ||
    dateRangeError({ from: row.from, to: row.to }) ||
    row.timezone !== 'Asia/Ho_Chi_Minh'
  )
    return invalid()
  if (
    ![
      row.totalAppointments,
      row.checkedInCount,
      row.completedCount,
      row.uniquePatients,
    ].every(count) ||
    statuses.some((status) => !count(distribution[status]))
  )
    return invalid()
  return {
    from: row.from,
    to: row.to,
    timezone: row.timezone,
    totalAppointments: row.totalAppointments as number,
    checkedInCount: row.checkedInCount as number,
    completedCount: row.completedCount as number,
    uniquePatients: row.uniquePatients as number,
    appointmentsByStatus: Object.fromEntries(
      statuses.map((s) => [s, distribution[s]]),
    ) as Summary['appointmentsByStatus'],
  }
}
export function decodeNotificationPage(
  value: unknown,
  expectedPage: number,
): NotificationPage {
  const row = object(value)
  if (
    ![row.page, row.totalElements, row.totalPages, row.unreadCount].every(
      count,
    ) ||
    row.page !== expectedPage ||
    row.size !== 20 ||
    !Array.isArray(row.items) ||
    row.items.length > 20 ||
    row.totalPages !== Math.ceil((row.totalElements as number) / 20)
  )
    return invalid()
  const items = row.items.map((value) => {
    const item = object(value)
    if (
      !validId(item.id) ||
      typeof item.eventType !== 'string' ||
      !Object.hasOwn(notificationLabels, item.eventType) ||
      !instant(item.createdAt) ||
      (item.readAt !== null && !instant(item.readAt)) ||
      (item.appointmentId !== null && !validId(item.appointmentId)) ||
      (item.appointmentCode !== null &&
        (typeof item.appointmentCode !== 'string' ||
          item.appointmentCode.length > 100))
    )
      return invalid()
    // Never render arbitrary title/body/URL or clinical fields from a notification payload.
    return {
      id: item.id,
      eventType: item.eventType,
      appointmentId: item.appointmentId,
      appointmentCode: item.appointmentCode,
      createdAt: item.createdAt,
      readAt: item.readAt,
    } as Notification
  })
  if (new Set(items.map((item) => item.id)).size !== items.length)
    return invalid()
  return {
    items,
    page: row.page as number,
    size: 20,
    totalElements: row.totalElements as number,
    totalPages: row.totalPages as number,
    unreadCount: row.unreadCount as number,
  }
}
export function mergeNotifications(
  previous: Notification[],
  incoming: Notification[],
): Notification[] {
  return [
    ...new Map(
      [...previous, ...incoming].map((item) => [item.id, item]),
    ).values(),
  ]
}
export function createOperationsApi(client: AxiosInstance, ready = true) {
  async function request<T>(
    signal: AbortSignal | undefined,
    task: () => Promise<T>,
  ): Promise<T> {
    signal?.throwIfAborted()
    if (!ready)
      throw new AuthApiError(
        'Dịch vụ D13 chưa sẵn sàng.',
        503,
        'D13_API_PENDING',
      )
    const session = getAuthSnapshot()
    if (session.status !== 'authenticated')
      throw new AuthApiError('Vui lòng đăng nhập lại.', 401, 'UNAUTHENTICATED')
    try {
      const result = await task()
      signal?.throwIfAborted()
      if (
        getAuthSnapshot().version !== session.version ||
        getAuthSnapshot().user?.id !== session.user?.id
      )
        throw new DOMException('Session changed', 'AbortError')
      return result
    } catch (error) {
      if (signal?.aborted || error instanceof DOMException) throw error
      throw normalizeAuthError(error)
    }
  }
  return {
    ready,
    summary(range: DateRange, signal?: AbortSignal) {
      return request(signal, async () => {
        if (!canViewDashboard(getAuthSnapshot().user?.role))
          throw new AuthApiError(
            'Bạn không có quyền xem Dashboard quản trị.',
            403,
            'ACCESS_DENIED',
          )
        const problem = dateRangeError(range)
        if (problem) throw new AuthApiError(problem, 400, 'VALIDATION_FAILED')
        const response = await client.get('/api/v1/dashboard/summary', {
          params: { from: range.from, to: range.to },
          signal,
        })
        const result = decodeSummary(response.data?.data)
        if (result.from !== range.from || result.to !== range.to)
          return invalid()
        return result
      })
    },
    notifications(page = 0, signal?: AbortSignal) {
      return request(signal, async () => {
        if (!count(page))
          throw new AuthApiError(
            'Trang không hợp lệ.',
            400,
            'VALIDATION_FAILED',
          )
        const response = await client.get('/api/v1/notifications', {
          params: { page, size: 20 },
          signal,
        })
        return decodeNotificationPage(response.data?.data, page)
      })
    },
    markRead(id: string, signal?: AbortSignal) {
      return request(signal, async () => {
        if (!validId(id))
          throw new AuthApiError(
            'Mã thông báo không hợp lệ.',
            400,
            'VALIDATION_FAILED',
          )
        // Accept both 200 and 204, including repeated idempotent reads; refetch counts afterwards.
        await client.patch('/api/v1/notifications/' + id + '/read', undefined, {
          signal,
        })
      })
    },
  }
}
export const operationsReady = (setting?: string) =>
  setting?.trim().toLowerCase() !== 'false'
export const operationsApi = createOperationsApi(
  apiClient,
  operationsReady(import.meta.env.VITE_D13_API_READY),
)
export function operationsMessage(error: unknown): string {
  const { status, code } = normalizeAuthError(error)
  if (code === 'D13_API_PENDING')
    return 'Dịch vụ này chưa sẵn sàng. Vui lòng thử lại sau.'
  if (status === 401)
    return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
  if (status === 403) return 'Bạn không có quyền truy cập dữ liệu này.'
  if (status === 404) return 'Không tìm thấy dữ liệu trong phạm vi được phép.'
  return 'Không thể tải hoặc cập nhật dữ liệu. Vui lòng thử lại.'
}
