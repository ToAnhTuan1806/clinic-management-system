import type { AxiosInstance } from 'axios'
import { AuthApiError, normalizeAuthError } from '@/auth/errors'
import { getAuthSnapshot } from '@/auth/session-store'
import { apiClient } from '@/lib/api-client'
import { validId } from '@/schedule/model'
import type { Role } from '@/auth/types'
import type { AppointmentStatus } from '@/booking/model'
import {
  dateRangeError,
  decodeSummary,
  type DateRange,
  type Summary,
} from '@/operations/api'

// DTOs aligned with Backend API_CONTRACT §3.12 (D14).
export interface DailyVisitStat {
  date: string
  totalAppointments: number
  checkedInCount: number
  completedCount: number
  cancelledCount: number
  noShowCount: number
}

export interface DoctorVisitStat {
  doctorId: string
  doctorCode: string
  doctorName: string
  specialtyName: string
  totalAppointments: number
  checkedInCount: number
  completedCount: number
}

export interface SpecialtyVisitStat {
  specialtyId: string
  specialtyCode: string
  specialtyName: string
  totalAppointments: number
  checkedInCount: number
  completedCount: number
}

export interface VisitReport extends Summary {
  dailyVisits: DailyVisitStat[]
  byDoctor: DoctorVisitStat[]
  bySpecialty: SpecialtyVisitStat[]
}

export type AuditResult = 'SUCCESS' | 'DENIED' | 'FAILED'
export type AuditSort = 'occurredAt,desc' | 'occurredAt,asc'

export interface AuditLogItem {
  id: string
  actorUserId: string | null
  actorRole: string
  action: string
  entityType: string
  entityId: string | null
  result: AuditResult
  occurredAt: string
}

export interface AuditLogPage {
  items: AuditLogItem[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export interface AuditLogFilter {
  from: string
  to: string
  actorUserId: string
  action: string
  page: number
  size: number
  sort: AuditSort
}

export const auditActionLabels: Record<string, string> = {
  APPOINTMENT_BOOKED: 'Đặt lịch khám',
  APPOINTMENT_RESCHEDULED: 'Đổi giờ lịch khám',
  APPOINTMENT_CANCELLED: 'Hủy lịch khám',
  APPOINTMENT_CONFIRMED: 'Xác nhận lịch khám',
  APPOINTMENT_CHECKED_IN: 'Check-in bệnh nhân',
  APPOINTMENT_NO_SHOW: 'Đánh dấu vắng mặt',
  MEDICAL_RECORD_COMPLETED: 'Hoàn tất hồ sơ khám',
  MEDICAL_RECORD_RELEASED: 'Công bố hồ sơ khám',
  USER_REGISTERED: 'Đăng ký tài khoản',
  PROFILE_UPDATED: 'Cập nhật hồ sơ cá nhân',
}

export const auditResultLabels: Record<AuditResult, string> = {
  SUCCESS: 'Thành công',
  DENIED: 'Từ chối',
  FAILED: 'Thất bại',
}

export const entityTypeLabels: Record<string, string> = {
  APPOINTMENT: 'Lịch hẹn',
  MEDICAL_RECORD: 'Hồ sơ khám',
  USER: 'Tài khoản',
}

export const actorRoleLabels: Record<string, string> = {
  ADMIN: 'Quản trị viên',
  DOCTOR: 'Bác sĩ',
  RECEPTIONIST: 'Lễ tân',
  PATIENT: 'Bệnh nhân',
  SYSTEM: 'Hệ thống',
}

export const canViewReports = (role?: Role) => !!role && role !== 'PATIENT'
export const canViewAuditLogs = (role?: Role) => role === 'ADMIN'

export function optionalDateRangeError(from: string, to: string): string {
  const f = from.trim()
  const t = to.trim()
  if (!f && !t) return ''
  if (f && !t) {
    return dateRangeError({ from: f, to: f })
  }
  if (!f && t) {
    return dateRangeError({ from: t, to: t })
  }
  return dateRangeError({ from: f, to: t })
}

export function actorUserIdError(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return /^[1-9]\d{0,18}$/.test(trimmed)
    ? ''
    : 'Mã người thao tác phải là số nguyên dương.'
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value + 'T00:00:00Z')) &&
  new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value

const isInstant = (value: unknown): value is string =>
  typeof value === 'string' &&
  /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value))

const isNonEmptyString = (value: unknown, max = 200): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max

function invalid(): never {
  throw new AuthApiError(
    'Dữ liệu phản hồi không hợp lệ. Vui lòng thử lại.',
    0,
    'INVALID_REPORTS_RESPONSE',
  )
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid()
  return value as Record<string, unknown>
}

export function decodeVisitReport(value: unknown): VisitReport {
  const row = asObject(value)
  const summary = decodeSummary(row)
  if (
    !Array.isArray(row.dailyVisits) ||
    !Array.isArray(row.byDoctor) ||
    !Array.isArray(row.bySpecialty)
  ) {
    return invalid()
  }

  const dailyVisits: DailyVisitStat[] = row.dailyVisits.map((entry) => {
    const item = asObject(entry)
    if (
      !isIsoDate(item.date) ||
      !isCount(item.totalAppointments) ||
      !isCount(item.checkedInCount) ||
      !isCount(item.completedCount) ||
      !isCount(item.cancelledCount) ||
      !isCount(item.noShowCount)
    ) {
      return invalid()
    }
    return {
      date: item.date,
      totalAppointments: item.totalAppointments,
      checkedInCount: item.checkedInCount,
      completedCount: item.completedCount,
      cancelledCount: item.cancelledCount,
      noShowCount: item.noShowCount,
    }
  })

  const byDoctor: DoctorVisitStat[] = row.byDoctor.map((entry) => {
    const item = asObject(entry)
    if (
      !validId(item.doctorId) ||
      !isNonEmptyString(item.doctorCode, 64) ||
      !isNonEmptyString(item.doctorName, 160) ||
      !isNonEmptyString(item.specialtyName, 160) ||
      !isCount(item.totalAppointments) ||
      !isCount(item.checkedInCount) ||
      !isCount(item.completedCount)
    ) {
      return invalid()
    }
    return {
      doctorId: item.doctorId,
      doctorCode: item.doctorCode,
      doctorName: item.doctorName,
      specialtyName: item.specialtyName,
      totalAppointments: item.totalAppointments,
      checkedInCount: item.checkedInCount,
      completedCount: item.completedCount,
    }
  })

  const bySpecialty: SpecialtyVisitStat[] = row.bySpecialty.map((entry) => {
    const item = asObject(entry)
    if (
      !validId(item.specialtyId) ||
      !isNonEmptyString(item.specialtyCode, 64) ||
      !isNonEmptyString(item.specialtyName, 160) ||
      !isCount(item.totalAppointments) ||
      !isCount(item.checkedInCount) ||
      !isCount(item.completedCount)
    ) {
      return invalid()
    }
    return {
      specialtyId: item.specialtyId,
      specialtyCode: item.specialtyCode,
      specialtyName: item.specialtyName,
      totalAppointments: item.totalAppointments,
      checkedInCount: item.checkedInCount,
      completedCount: item.completedCount,
    }
  })

  return {
    ...summary,
    dailyVisits,
    byDoctor,
    bySpecialty,
  }
}

export function decodeAuditLogPage(
  value: unknown,
  expectedPage: number,
  expectedSize: number,
): AuditLogPage {
  const row = asObject(value)
  if (
    ![row.page, row.size, row.totalElements, row.totalPages].every(isCount) ||
    row.page !== expectedPage ||
    row.size !== expectedSize ||
    !Array.isArray(row.items) ||
    row.items.length > expectedSize
  ) {
    return invalid()
  }

  const items: AuditLogItem[] = row.items.map((entry) => {
    const item = asObject(entry)
    const result = item.result
    if (
      !validId(item.id) ||
      (item.actorUserId !== null && !validId(item.actorUserId)) ||
      !isNonEmptyString(item.actorRole, 32) ||
      !isNonEmptyString(item.action, 64) ||
      !isNonEmptyString(item.entityType, 64) ||
      (item.entityId !== null && !validId(item.entityId)) ||
      (result !== 'SUCCESS' && result !== 'DENIED' && result !== 'FAILED') ||
      !isInstant(item.occurredAt)
    ) {
      return invalid()
    }
    // Never surface raw metadata/correlation strings that might contain untrusted content.
    return {
      id: item.id,
      actorUserId: item.actorUserId,
      actorRole: item.actorRole,
      action: item.action,
      entityType: item.entityType,
      entityId: item.entityId,
      result,
      occurredAt: item.occurredAt,
    }
  })

  return {
    items,
    page: row.page as number,
    size: row.size as number,
    totalElements: row.totalElements as number,
    totalPages: row.totalPages as number,
  }
}

export function formatVnDateTime(isoUtc: string): string {
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(isoUtc))
  } catch {
    return isoUtc
  }
}

export function formatVnDateLabel(isoDate: string): string {
  const parts = isoDate.split('-')
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : isoDate
}

export function createReportsApi(client: AxiosInstance) {
  async function request<T>(
    signal: AbortSignal | undefined,
    task: () => Promise<T>,
  ): Promise<T> {
    signal?.throwIfAborted()
    const session = getAuthSnapshot()
    if (session.status !== 'authenticated') {
      throw new AuthApiError('Vui lòng đăng nhập lại.', 401, 'UNAUTHENTICATED')
    }
    try {
      const result = await task()
      signal?.throwIfAborted()
      if (
        getAuthSnapshot().version !== session.version ||
        getAuthSnapshot().user?.id !== session.user?.id
      ) {
        throw new DOMException('Session changed', 'AbortError')
      }
      return result
    } catch (error) {
      if (signal?.aborted || error instanceof DOMException) throw error
      throw normalizeAuthError(error)
    }
  }

  return {
    visitReport(range: DateRange, signal?: AbortSignal) {
      return request(signal, async () => {
        if (!canViewReports(getAuthSnapshot().user?.role)) {
          throw new AuthApiError(
            'Bạn không có quyền xem báo cáo lượt khám.',
            403,
            'ACCESS_DENIED',
          )
        }
        const problem = dateRangeError(range)
        if (problem) throw new AuthApiError(problem, 400, 'VALIDATION_FAILED')
        const response = await client.get('/api/v1/reports/visits', {
          params: { from: range.from, to: range.to },
          signal,
        })
        const result = decodeVisitReport(response.data?.data)
        if (result.from !== range.from || result.to !== range.to) {
          return invalid()
        }
        return result
      })
    },

    auditLogs(filter: AuditLogFilter, signal?: AbortSignal) {
      return request(signal, async () => {
        if (!canViewAuditLogs(getAuthSnapshot().user?.role)) {
          throw new AuthApiError(
            'Chỉ quản trị viên mới có quyền xem nhật ký kiểm toán.',
            403,
            'ACCESS_DENIED',
          )
        }
        const dateProblem = optionalDateRangeError(filter.from, filter.to)
        if (dateProblem) {
          throw new AuthApiError(dateProblem, 400, 'VALIDATION_FAILED')
        }
        const actorProblem = actorUserIdError(filter.actorUserId)
        if (actorProblem) {
          throw new AuthApiError(actorProblem, 400, 'VALIDATION_FAILED')
        }
        const params: Record<string, string | number> = {
          page: filter.page,
          size: filter.size,
          sort: filter.sort,
        }
        if (filter.from.trim()) params.from = filter.from.trim()
        if (filter.to.trim()) params.to = filter.to.trim()
        if (filter.actorUserId.trim()) {
          params.actorUserId = Number(filter.actorUserId.trim())
        }
        if (filter.action.trim()) params.action = filter.action.trim()

        const response = await client.get('/api/v1/audit-logs', {
          params,
          signal,
        })
        return decodeAuditLogPage(response.data?.data, filter.page, filter.size)
      })
    },
  }
}

export const reportsApi = createReportsApi(apiClient)

export function reportsMessage(error: unknown): string {
  const { status } = normalizeAuthError(error)
  if (status === 401)
    return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
  if (status === 403) return 'Bạn không có quyền truy cập dữ liệu này.'
  if (status === 400) return 'Tham số lọc không hợp lệ. Vui lòng kiểm tra lại.'
  return 'Không thể tải dữ liệu báo cáo. Vui lòng thử lại.'
}

export const statusBarOrder: AppointmentStatus[] = [
  'COMPLETED',
  'IN_PROGRESS',
  'CHECKED_IN',
  'CONFIRMED',
  'PENDING',
  'CANCELLED',
  'NO_SHOW',
]
