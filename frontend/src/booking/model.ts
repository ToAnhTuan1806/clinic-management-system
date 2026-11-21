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
  reason?: string | null // Booking reason (D07, max 500 chars)
  cancellationReason?: string | null // Cancellation reason (D08 / schema V7, max 255 chars)
  cancelledAt?: string | null // ISO-8601 UTC timestamp
  cancelledBy?: string | null // User ID who cancelled
  rescheduledAt?: string | null // ISO-8601 UTC timestamp
  roomLabel?: string | null
  version?: number // Optimistic locking version
  createdAt?: string
  updatedAt?: string
}

export interface BookingDraft {
  specialtyId: string
  doctorId: string
  date: string // YYYY-MM-DD in Asia/Ho_Chi_Minh
  slot: ScheduleSlot
  reason?: string // Max 500 characters
  patientId?: string // Required only when RECEPTIONIST is booking for a patient; omitted for PATIENT
  requestKey: string // Idempotency key
}

export interface ChangeSlotDraft {
  appointmentId: string
  scheduleId: string
  startAt: string // ISO-8601 UTC
  expectedVersion: number
}

export interface CancelAppointmentDraft {
  appointmentId: string
  reason?: string // Cancellation reason (max 255 chars)
  cancellationReason?: string // Alias for schema V7
  expectedVersion: number
}

export interface AppointmentQuery {
  doctorId?: string
  patientId?: string
  date?: string // YYYY-MM-DD in Asia/Ho_Chi_Minh
  status?: AppointmentStatus | 'ALL'
  page?: number
  pageSize?: number
}

export interface AppointmentPage {
  items: Appointment[]
  total: number
  page: number
  pageSize: number
}

export interface BookingGateway {
  mode: 'pending' | 'mock' | 'real'
  bookAppointment(
    draft: BookingDraft,
    signal?: AbortSignal,
  ): Promise<Appointment>
  getAppointment(id: string, signal?: AbortSignal): Promise<Appointment>
  listMyAppointments(signal?: AbortSignal): Promise<Appointment[]>
  listAppointments(
    query?: AppointmentQuery,
    signal?: AbortSignal,
  ): Promise<AppointmentPage>
  changeSlot(draft: ChangeSlotDraft, signal?: AbortSignal): Promise<Appointment>
  cancelAppointment(
    draft: CancelAppointmentDraft,
    signal?: AbortSignal,
  ): Promise<Appointment>
}

export type BookingErrorCode =
  | 'VALIDATION_FAILED'
  | 'SLOT_UNAVAILABLE'
  | 'VERSION_CONFLICT'
  | 'INVALID_STATE_TRANSITION'
  | 'APPOINTMENT_PAST'
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
    case 'VERSION_CONFLICT':
      return 'Dữ liệu cuộc hẹn đã được cập nhật bởi một phiên khác. Vui lòng tải lại dữ liệu mới nhất (409 Conflict).'
    case 'INVALID_STATE_TRANSITION':
      return 'Không thể thay đổi hoặc hủy cuộc hẹn ở trạng thái hiện tại (409 Conflict).'
    case 'APPOINTMENT_PAST':
      return 'Không thể thay đổi hoặc hủy cuộc hẹn đã bắt đầu hoặc đã qua thời gian khám.'
    case 'VALIDATION_FAILED':
      return 'Thông tin đặt lịch không hợp lệ. Vui lòng kiểm tra lại.'
    case 'UNAUTHORIZED':
      return 'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.'
    case 'FORBIDDEN':
      return 'Bạn không có quyền thực hiện thao tác đặt lịch khám này.'
    case 'NOT_FOUND':
      return 'Không tìm thấy hồ sơ bác sĩ, ca trực hoặc khung giờ khám phù hợp.'
    case 'API_NOT_CONFIGURED':
      return 'Dịch vụ lịch hẹn chưa được kết nối Backend D07/D08 (chế độ chờ - pending).'
    case 'NETWORK_ERROR':
      return 'Không thể kết nối đến máy chủ phòng khám. Vui lòng kiểm tra kết nối mạng và thử lại.'
    case 'UNKNOWN_ERROR':
    default:
      return 'Đã xảy ra lỗi khi xử lý lịch hẹn. Vui lòng thử lại.'
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

/**
 * Validates a ChangeSlotDraft before submission.
 */
export function validateChangeSlotDraft(
  draft: Partial<ChangeSlotDraft>,
): Record<string, string> {
  const errors: Record<string, string> = {}

  if (!draft.appointmentId || !validId(draft.appointmentId)) {
    errors.appointmentId = 'Mã cuộc hẹn không hợp lệ.'
  }

  if (!draft.scheduleId || !validId(draft.scheduleId)) {
    errors.scheduleId = 'Mã ca làm việc không hợp lệ.'
  }

  if (!draft.startAt) {
    errors.startAt = 'Vui lòng chọn khung giờ khám mới.'
  } else {
    const slotTime = new Date(draft.startAt).getTime()
    if (slotTime <= Date.now()) {
      errors.startAt = 'Không thể chọn khung giờ trong quá khứ.'
    }
  }

  if (draft.expectedVersion === undefined || draft.expectedVersion < 0) {
    errors.expectedVersion = 'Phiên bản dữ liệu (version) không hợp lệ.'
  }

  return errors
}

/**
 * Validates a CancelAppointmentDraft before submission.
 * Enforces 1–255 characters for cancellation reason according to schema V7.
 */
export function validateCancelDraft(
  draft: Partial<CancelAppointmentDraft>,
): Record<string, string> {
  const errors: Record<string, string> = {}

  if (!draft.appointmentId || !validId(draft.appointmentId)) {
    errors.appointmentId = 'Mã cuộc hẹn không hợp lệ.'
  }

  const cancelReason = (draft.reason ?? draft.cancellationReason ?? '').trim()
  if (!cancelReason) {
    errors.reason = 'Vui lòng nhập lý do hủy lịch khám (1-255 ký tự).'
  } else if (cancelReason.length > 255) {
    errors.reason = 'Lý do hủy lịch không được vượt quá 255 ký tự.'
  }

  if (draft.expectedVersion === undefined || draft.expectedVersion < 0) {
    errors.expectedVersion = 'Phiên bản dữ liệu (version) không hợp lệ.'
  }

  return errors
}

/**
 * Determines whether the user with the given role can change or cancel the appointment.
 */
export function canChangeOrCancelAppointment(
  appointment: Appointment,
  role: string,
): { canChange: boolean; canCancel: boolean; reason?: string } {
  // Only PATIENT and RECEPTIONIST can change or cancel appointments
  if (role !== 'PATIENT' && role !== 'RECEPTIONIST') {
    return {
      canChange: false,
      canCancel: false,
      reason: 'Vai trò hiện tại không có quyền thay đổi hoặc hủy lịch hẹn.',
    }
  }

  // Only PENDING and CONFIRMED appointments can be modified
  if (appointment.status !== 'PENDING' && appointment.status !== 'CONFIRMED') {
    return {
      canChange: false,
      canCancel: false,
      reason: `Cuộc hẹn đang ở trạng thái "${appointmentStatusLabels[appointment.status] || appointment.status}", không thể thay đổi hoặc hủy.`,
    }
  }

  // Appointment must be in the future
  const startTime = new Date(appointment.startAt).getTime()
  if (startTime <= Date.now()) {
    return {
      canChange: false,
      canCancel: false,
      reason: 'Cuộc hẹn đã bắt đầu hoặc đã qua thời gian khám.',
    }
  }

  return { canChange: true, canCancel: true }
}
