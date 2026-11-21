// Domain models and validation for Doctor Work Schedules (Sprint 2 - D06)
// Follows docs/API_CONTRACT.md and database/erd.mmd doctor_schedules table.

export type ScheduleStatus = 'ACTIVE' | 'BLOCKED'
export type BackendScheduleStatus = 'OPEN' | 'CLOSED' | 'ACTIVE' | 'BLOCKED'

export interface DoctorSchedule {
  id: string
  doctorId: string
  doctorName?: string
  doctorCode?: string
  specialtyName?: string
  startsAt: string // ISO-8601 UTC inclusive
  endsAt: string // ISO-8601 UTC exclusive
  status: ScheduleStatus
  roomLabel?: string | null
  slotDurationMinutes?: number
  createdAt?: string
  updatedAt?: string
}

export interface ScheduleSlot {
  id: string
  scheduleId: string
  doctorId: string
  doctorName?: string
  startsAt: string // ISO-8601 UTC
  endsAt: string // ISO-8601 UTC
  status: 'AVAILABLE' | 'BOOKED' | 'BLOCKED'
  roomLabel?: string | null
}

export interface ScheduleDraft {
  doctorId: string
  date: string // YYYY-MM-DD in Asia/Ho_Chi_Minh
  startTime: string // HH:mm in Asia/Ho_Chi_Minh
  endTime: string // HH:mm in Asia/Ho_Chi_Minh
  status: ScheduleStatus
  roomLabel?: string
  slotDurationMinutes: 15 | 30 | 60
}

export interface ScheduleQuery {
  doctorId?: string
  startDate?: string // YYYY-MM-DD in Asia/Ho_Chi_Minh or ISO string
  endDate?: string // YYYY-MM-DD in Asia/Ho_Chi_Minh or ISO string
  status?: 'ALL' | 'ACTIVE' | 'BLOCKED'
}

export interface ScheduleGateway {
  mode: 'pending' | 'mock' | 'real'
  listSchedules(
    query: ScheduleQuery,
    signal?: AbortSignal,
  ): Promise<DoctorSchedule[]>
  getSchedule(id: string, signal?: AbortSignal): Promise<DoctorSchedule>
  createSchedule(
    draft: ScheduleDraft,
    signal?: AbortSignal,
  ): Promise<DoctorSchedule>
  updateSchedule(
    id: string,
    draft: Partial<ScheduleDraft>,
    signal?: AbortSignal,
  ): Promise<DoctorSchedule>
  blockSchedule(
    id: string,
    reason?: string,
    signal?: AbortSignal,
  ): Promise<DoctorSchedule>
  listDoctorSlots(
    doctorId: string,
    date: string,
    signal?: AbortSignal,
  ): Promise<ScheduleSlot[]>
}

export type ScheduleErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'SCHEDULE_NOT_FOUND'
  | 'SCHEDULE_OVERLAP'
  | 'TIME_SLOT_CONFLICT'
  | 'API_NOT_CONFIGURED'
  | 'INVALID_SCHEDULE_RESPONSE'
  | 'UNKNOWN_SCHEDULE_ERROR'

export class ScheduleError extends Error {
  code: ScheduleErrorCode
  status: number
  fieldErrors?: Record<string, string>

  constructor(
    code: ScheduleErrorCode,
    status = 400,
    message?: string,
    fieldErrors?: Record<string, string>,
  ) {
    super(message || scheduleErrorMessage(code))
    this.name = 'ScheduleError'
    this.code = code
    this.status = status
    this.fieldErrors = fieldErrors
  }
}

export function scheduleErrorMessage(code: ScheduleErrorCode): string {
  switch (code) {
    case 'SCHEDULE_OVERLAP':
    case 'TIME_SLOT_CONFLICT':
      return 'Ca làm việc bị trùng thời gian với ca khác của bác sĩ trong cùng khoảng thời gian (409 Conflict).'
    case 'VALIDATION_FAILED':
      return 'Dữ liệu ca làm việc không hợp lệ. Vui lòng kiểm tra lại thông tin.'
    case 'UNAUTHORIZED':
      return 'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.'
    case 'FORBIDDEN':
      return 'Bạn không có quyền thực hiện thao tác quản lý ca làm việc này.'
    case 'SCHEDULE_NOT_FOUND':
      return 'Không tìm thấy ca làm việc yêu cầu.'
    case 'API_NOT_CONFIGURED':
      return 'Hệ thống chưa kết nối Backend D06. Đang hoạt động ở chế độ chờ (pending).'
    case 'INVALID_SCHEDULE_RESPONSE':
      return 'Phản hồi từ máy chủ không đúng định dạng chuẩn của hệ thống.'
    case 'UNKNOWN_SCHEDULE_ERROR':
    default:
      return 'Đã xảy ra lỗi khi xử lý ca làm việc. Vui lòng thử lại.'
  }
}

export function scheduleMessage(error: unknown): string {
  if (error instanceof ScheduleError) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message)
  }
  return 'Lỗi không xác định khi kết nối dịch vụ lịch làm việc.'
}

export const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9]\d*$/.test(value)

// Vietnam Timezone Constants (UTC+7, no DST)
const VN_OFFSET_HOURS = 7
const VN_OFFSET_MS = VN_OFFSET_HOURS * 60 * 60 * 1000

/**
 * Converts a Vietnam date (YYYY-MM-DD) and Vietnam time (HH:mm) into an ISO-8601 UTC string.
 * Example: toUtcIso('2026-11-23', '08:00') => '2026-11-23T01:00:00.000Z'
 */
export function toUtcIso(dateVN: string, timeVN: string): string {
  const [yearStr, monthStr, dayStr] = dateVN.split('-')
  const [hourStr, minStr] = timeVN.split(':')
  const year = parseInt(yearStr, 10)
  const month = parseInt(monthStr, 10) - 1
  const day = parseInt(dayStr, 10)
  const hour = parseInt(hourStr, 10)
  const min = parseInt(minStr, 10)

  // Construct UTC timestamp by subtracting 7 hours from the local VN time representation
  const utcMs = Date.UTC(year, month, day, hour, min, 0, 0) - VN_OFFSET_MS
  return new Date(utcMs).toISOString()
}

/**
 * Decomposes an ISO-8601 UTC string into Vietnam date (YYYY-MM-DD) and Vietnam time (HH:mm).
 * Example: fromUtcIsoToVnParts('2026-11-23T01:00:00.000Z') => { date: '2026-11-23', time: '08:00' }
 */
export function fromUtcIsoToVnParts(utcIso: string): {
  date: string
  time: string
} {
  const d = new Date(utcIso)
  if (isNaN(d.getTime())) return { date: '', time: '' }

  const vnMs = d.getTime() + VN_OFFSET_MS
  const vnDate = new Date(vnMs)

  const year = vnDate.getUTCFullYear()
  const month = String(vnDate.getUTCMonth() + 1).padStart(2, '0')
  const day = String(vnDate.getUTCDate()).padStart(2, '0')
  const hour = String(vnDate.getUTCHours()).padStart(2, '0')
  const min = String(vnDate.getUTCMinutes()).padStart(2, '0')

  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${min}`,
  }
}

/**
 * Formats an ISO-8601 UTC string to a human-friendly Vietnam date (e.g., "Thứ Hai, 23/11/2026").
 */
export function formatVnDateFull(utcIso: string): string {
  const d = new Date(utcIso)
  if (isNaN(d.getTime())) return ''
  const vnMs = d.getTime() + VN_OFFSET_MS
  const vnDate = new Date(vnMs)

  const dayOfWeekNames = [
    'Chủ Nhật',
    'Thứ Hai',
    'Thứ Ba',
    'Thứ Tư',
    'Thứ Năm',
    'Thứ Sáu',
    'Thứ Bảy',
  ]
  const dayName = dayOfWeekNames[vnDate.getUTCDay()]
  const day = String(vnDate.getUTCDate()).padStart(2, '0')
  const month = String(vnDate.getUTCMonth() + 1).padStart(2, '0')
  const year = vnDate.getUTCFullYear()

  return `${dayName}, ${day}/${month}/${year}`
}

/**
 * Formats an ISO-8601 UTC string to DD/MM/YYYY Vietnam date.
 */
export function formatVnDateShort(utcIso: string): string {
  const { date } = fromUtcIsoToVnParts(utcIso)
  if (!date) return ''
  const [year, month, day] = date.split('-')
  return `${day}/${month}/${year}`
}

/**
 * Formats an ISO-8601 UTC string to HH:mm Vietnam time.
 */
export function formatVnTime(utcIso: string): string {
  const { time } = fromUtcIsoToVnParts(utcIso)
  return time
}

/**
 * Formats a start and end ISO-8601 UTC string into a Vietnam time range (e.g. "08:00 - 12:00").
 */
export function formatVnTimeRange(startsAt: string, endsAt: string): string {
  const startTime = formatVnTime(startsAt)
  const endTime = formatVnTime(endsAt)
  return `${startTime} - ${endTime}`
}

/**
 * Returns today's date string in Asia/Ho_Chi_Minh (YYYY-MM-DD).
 */
export function getVnTodayString(): string {
  const now = new Date()
  const vnMs = now.getTime() + VN_OFFSET_MS
  const vnDate = new Date(vnMs)
  const year = vnDate.getUTCFullYear()
  const month = String(vnDate.getUTCMonth() + 1).padStart(2, '0')
  const day = String(vnDate.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export interface WeekDayInfo {
  dateStr: string // YYYY-MM-DD
  dayLabel: string // Thứ 2, Thứ 3, ...
  displayDate: string // 23/11
  isToday: boolean
}

/**
 * Calculates the 7 days of the week containing the given date string (Monday to Sunday) in VN time.
 */
export function getWeekDaysForDate(vnDateStr: string): WeekDayInfo[] {
  const [yearStr, monthStr, dayStr] = vnDateStr.split('-')
  const year = parseInt(yearStr, 10)
  const month = parseInt(monthStr, 10) - 1
  const day = parseInt(dayStr, 10)

  // Use UTC math to avoid browser local timezone discrepancies
  const targetUtcMs = Date.UTC(year, month, day)
  const targetDate = new Date(targetUtcMs)
  const dayOfWeek = targetDate.getUTCDay() // 0 = Sunday, 1 = Monday, ...

  // In Vietnam, week starts on Monday (1). Sunday is index 7.
  const distanceToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const mondayUtcMs = targetUtcMs + distanceToMonday * 24 * 60 * 60 * 1000

  const todayStr = getVnTodayString()
  const dayNames = [
    'Thứ 2',
    'Thứ 3',
    'Thứ 4',
    'Thứ 5',
    'Thứ 6',
    'Thứ 7',
    'Chủ Nhật',
  ]

  const week: WeekDayInfo[] = []
  for (let i = 0; i < 7; i++) {
    const curMs = mondayUtcMs + i * 24 * 60 * 60 * 1000
    const curDate = new Date(curMs)
    const y = curDate.getUTCFullYear()
    const m = String(curDate.getUTCMonth() + 1).padStart(2, '0')
    const dStr = String(curDate.getUTCDate()).padStart(2, '0')
    const dateStr = `${y}-${m}-${dStr}`

    week.push({
      dateStr,
      dayLabel: dayNames[i],
      displayDate: `${dStr}/${m}`,
      isToday: dateStr === todayStr,
    })
  }

  return week
}

/**
 * Validates a ScheduleDraft. Returns an object mapping invalid field names to error messages.
 */
export function validateSchedule(
  draft: Partial<ScheduleDraft>,
): Record<string, string> {
  const errors: Record<string, string> = {}

  if (!draft.doctorId || !validId(draft.doctorId)) {
    errors.doctorId = 'Vui lòng chọn bác sĩ phụ trách ca làm việc.'
  }

  if (
    !draft.date ||
    !/^\d{4}-\d{2}-\d{2}$/.test(draft.date) ||
    isNaN(new Date(draft.date).getTime())
  ) {
    errors.date = 'Ngày làm việc không hợp lệ (định dạng YYYY-MM-DD).'
  }

  const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/
  if (!draft.startTime || !timeRegex.test(draft.startTime)) {
    errors.startTime = 'Giờ bắt đầu không đúng định dạng (HH:mm).'
  }

  if (!draft.endTime || !timeRegex.test(draft.endTime)) {
    errors.endTime = 'Giờ kết thúc không đúng định dạng (HH:mm).'
  }

  const validSlotDurations = [15, 30, 60]
  if (
    !draft.slotDurationMinutes ||
    !validSlotDurations.includes(draft.slotDurationMinutes)
  ) {
    errors.slotDurationMinutes = 'Thời lượng slot phải là 15, 30 hoặc 60 phút.'
  }

  if (
    draft.startTime &&
    draft.endTime &&
    timeRegex.test(draft.startTime) &&
    timeRegex.test(draft.endTime)
  ) {
    const [startH, startM] = draft.startTime.split(':').map(Number)
    const [endH, endM] = draft.endTime.split(':').map(Number)
    const startTotalMin = startH * 60 + startM
    const endTotalMin = endH * 60 + endM

    if (startTotalMin >= endTotalMin) {
      errors.endTime = 'Giờ kết thúc phải sau giờ bắt đầu.'
    } else {
      const durationMin = endTotalMin - startTotalMin
      const slotDuration = draft.slotDurationMinutes || 30
      if (durationMin < slotDuration) {
        errors.endTime = `Thời lượng ca làm việc tối thiểu phải bằng một slot (${slotDuration} phút).`
      } else if (
        !errors.slotDurationMinutes &&
        durationMin % slotDuration !== 0
      ) {
        errors.slotDurationMinutes = `Thời lượng ca (${durationMin} phút) phải chia hết cho thời lượng mỗi slot (${slotDuration} phút).`
      }
    }
  }

  if (draft.roomLabel && draft.roomLabel.length > 64) {
    errors.roomLabel = 'Tên phòng khám không được vượt quá 64 ký tự.'
  }

  return errors
}

/**
 * Checks if two time intervals overlap.
 * Both start and end must be ISO strings or epoch ms.
 * Overlap condition: start1 < end2 && start2 < end1
 */
export function areIntervalsOverlapping(
  start1: string | number,
  end1: string | number,
  start2: string | number,
  end2: string | number,
): boolean {
  const s1 = typeof start1 === 'string' ? new Date(start1).getTime() : start1
  const e1 = typeof end1 === 'string' ? new Date(end1).getTime() : end1
  const s2 = typeof start2 === 'string' ? new Date(start2).getTime() : start2
  const e2 = typeof end2 === 'string' ? new Date(end2).getTime() : end2

  return s1 < e2 && s2 < e1
}
