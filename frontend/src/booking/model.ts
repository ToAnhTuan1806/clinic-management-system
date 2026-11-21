// Domain models and validation for Patient Appointment Booking (Sprint 2 - D07)
// Follows docs/API_CONTRACT.md and database/erd.mmd appointments table.

import {
  fromUtcIsoToVnParts,
  getVnTodayString,
  validId,
  type ScheduleSlot,
} from '@/schedule/model'

export type AppointmentStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW'

export interface Appointment {
  id: string // BIGINT string
  appointmentCode: string // e.g. APT_20261125_001
  patientId: string
  patientCode?: string
  patientName?: string
  patientPhone?: string
  doctorId: string
  doctorCode?: string
  doctorName?: string
  specialtyName?: string
  scheduleId: string
  startAt: string // ISO-8601 UTC inclusive
  endAt: string // ISO-8601 UTC exclusive
  status: AppointmentStatus
  reason?: string | null
  roomLabel?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface BookingDraft {
  specialtyId: string
  doctorId: string
  date: string // YYYY-MM-DD in Asia/Ho_Chi_Minh
  slot: ScheduleSlot
  reason?: string
  patientId?: string // Required only when RECEPTIONIST is booking for a patient; omitted for PATIENT
  requestKey: string // Idempotency key
}

export interface BookingGateway {
  mode: 'pending' | 'mock' | 'real'
  bookAppointment(
    draft: BookingDraft,
    signal?: AbortSignal,
  ): Promise<Appointment>
  getAppointment(id: string, signal?: AbortSignal): Promise<Appointment>
  listMyAppointments(signal?: AbortSignal): Promise<Appointment[]>
}

export type BookingErrorCode =
  | 'VALIDATION_FAILED'
  | 'SLOT_UNAVAILABLE'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'API_NOT_CONFIGURED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR'

export class BookingError extends Error {
  code: BookingErrorCode
  status: number
  fieldErrors?: Record<string, string>

  constructor(
    code: BookingErrorCode,
    status = 400,
    message?: string,
    fieldErrors?: Record<string, string>,
  ) {
    super(message || bookingErrorMessage(code))
    this.name = 'BookingError'
    this.code = code
    this.status = status
    this.fieldErrors = fieldErrors
  }
}

export function bookingErrorMessage(code: BookingErrorCode): string {
  switch (code) {
    case 'SLOT_UNAVAILABLE':
      return 'Khung giờ này vừa được người khác đặt trước hoặc không còn khả dụng. Vui lòng chọn khung giờ khác (409 Conflict).'
    case 'VALIDATION_FAILED':
      return 'Thông tin đặt lịch không hợp lệ. Vui lòng kiểm tra lại.'
    case 'UNAUTHORIZED':
      return 'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.'
    case 'FORBIDDEN':
      return 'Bạn không có quyền thực hiện thao tác đặt lịch khám này.'
    case 'NOT_FOUND':
      return 'Không tìm thấy hồ sơ bác sĩ, ca trực hoặc khung giờ khám phù hợp.'
    case 'API_NOT_CONFIGURED':
      return 'Dịch vụ đặt lịch khám chưa được kết nối Backend D07 (chế độ chờ - pending).'
    case 'NETWORK_ERROR':
      return 'Không thể kết nối đến máy chủ phòng khám. Vui lòng kiểm tra kết nối mạng và thử lại.'
    case 'UNKNOWN_ERROR':
    default:
      return 'Đã xảy ra lỗi khi xử lý đặt lịch khám. Vui lòng thử lại.'
  }
}

export function bookingMessage(error: unknown): string {
  if (error instanceof BookingError) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message)
  }
  return 'Lỗi không xác định khi xử lý đặt lịch khám.'
}

export const appointmentStatusLabels: Record<AppointmentStatus, string> = {
  PENDING: 'Chờ xác nhận',
  CONFIRMED: 'Đã xác nhận',
  CHECKED_IN: 'Đã tiếp đón',
  IN_PROGRESS: 'Đang khám',
  COMPLETED: 'Hoàn thành',
  CANCELLED: 'Đã hủy',
  NO_SHOW: 'Vắng mặt',
}

/**
 * Generates an idempotency request key.
 */
export function generateRequestKey(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return `req_${crypto.randomUUID().replace(/-/g, '')}`
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Validates a BookingDraft before submission.
 */
export function validateBookingDraft(
  draft: Partial<BookingDraft>,
): Record<string, string> {
  const errors: Record<string, string> = {}

  if (!draft.specialtyId || !validId(draft.specialtyId)) {
    errors.specialtyId = 'Vui lòng chọn chuyên khoa cần khám.'
  }

  if (!draft.doctorId || !validId(draft.doctorId)) {
    errors.doctorId = 'Vui lòng chọn bác sĩ phụ trách.'
  }

  const todayStr = getVnTodayString()
  if (!draft.date || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) {
    errors.date = 'Vui lòng chọn ngày khám hợp lệ (YYYY-MM-DD).'
  } else if (draft.date < todayStr) {
    errors.date = 'Không thể chọn ngày khám trong quá khứ.'
  }

  if (!draft.slot || !draft.slot.startsAt || !draft.slot.endsAt) {
    errors.slot = 'Vui lòng chọn khung giờ khám còn trống.'
  } else {
    // If appointment is today, slot must start after current time
    const slotVn = fromUtcIsoToVnParts(draft.slot.startsAt)
    const now = new Date()
    const slotTime = new Date(draft.slot.startsAt)
    if (slotVn.date === todayStr && slotTime.getTime() <= now.getTime()) {
      errors.slot = 'Khung giờ này đã trôi qua. Vui lòng chọn khung giờ khác.'
    }
  }

  if (draft.reason && draft.reason.length > 500) {
    errors.reason = 'Lý do khám không được vượt quá 500 ký tự.'
  }

  if (!draft.requestKey || !draft.requestKey.trim()) {
    errors.requestKey = 'Khóa định danh yêu cầu (requestKey) không hợp lệ.'
  }

  return errors
}
