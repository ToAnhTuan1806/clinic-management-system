import type { AuthUser } from '@/auth/types'

export type Sex = 'FEMALE' | 'MALE' | 'OTHER' | 'UNKNOWN'

export const sexLabels: Record<Sex, string> = {
  FEMALE: 'Nữ',
  MALE: 'Nam',
  OTHER: 'Khác',
  UNKNOWN: 'Chưa rõ',
}

export interface Patient {
  id: string
  patientCode: string
  fullName: string
  dateOfBirth: string
  sex: Sex
  phone: string
  address: string
  active: boolean
  userId?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface PatientDraft {
  patientCode: string
  fullName: string
  dateOfBirth: string
  sex: Sex
  phone: string
  address: string
  userId?: string
}

export interface PatientQuery {
  search: string
  page: number
  pageSize: number
  active: 'all' | 'active' | 'inactive'
}

export interface Page<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages?: number
}

export type PatientFieldErrors = Partial<Record<keyof PatientDraft, string>>

export interface PatientGateway {
  mode: 'pending' | 'mock' | 'real'
  listPatients(query: PatientQuery, signal: AbortSignal): Promise<Page<Patient>>
  getPatient(id: string, signal: AbortSignal): Promise<Patient>
  getMePatientProfile(signal: AbortSignal): Promise<Patient>
  savePatient(
    id: string | undefined,
    draft: PatientDraft,
    signal: AbortSignal,
  ): Promise<Patient>
  setActive(id: string, active: boolean, signal: AbortSignal): Promise<void>
}

export const canManagePatients = (user: AuthUser | null) =>
  user?.role === 'ADMIN' || user?.role === 'RECEPTIONIST'

export class PatientError extends Error {
  readonly fields: PatientFieldErrors
  readonly code: string
  readonly status: number
  constructor(code: string, status = 0, fields: PatientFieldErrors = {}) {
    super(code)
    this.code = code
    this.status = status
    this.fields = fields
  }
}

const patientConflicts: Record<string, [keyof PatientDraft | null, string]> = {
  PATIENT_CODE_EXISTS: [
    'patientCode',
    'Mã bệnh nhân đã tồn tại trong hệ thống.',
  ],
  USER_ALREADY_LINKED: [
    'userId',
    'Tài khoản người dùng đã được liên kết với một hồ sơ bệnh nhân khác.',
  ],
  USER_NOT_ELIGIBLE: [
    'userId',
    'Tài khoản không đủ điều kiện (phải có vai trò PATIENT).',
  ],
  USER_NOT_ACTIVE: [
    'userId',
    'Tài khoản người dùng liên kết đang bị khóa (DISABLED).',
  ],
  PATIENT_CONFLICT: [
    null,
    'Hồ sơ xung đột với dữ liệu hiện có. Vui lòng kiểm tra mã và thông tin liên kết.',
  ],
  RESOURCE_NOT_FOUND: [
    null,
    'Hồ sơ bệnh nhân không tồn tại hoặc ngoài phạm vi được xem.',
  ],
}

export function patientConflictFields(code: string): PatientFieldErrors {
  const value = patientConflicts[code]
  return value?.[0] ? { [value[0]]: value[1] } : {}
}

export function patientMessage(error: unknown): string {
  if (error instanceof PatientError) {
    if (patientConflicts[error.code]) return patientConflicts[error.code][1]
    if (
      error.code === 'D04_CONTRACT_PENDING' ||
      error.code === 'API_NOT_CONFIGURED'
    )
      return 'Dịch vụ hồ sơ bệnh nhân chưa được kết nối. Vui lòng quay lại sau.'
    if (error.code === 'INVALID_PATIENT_RESPONSE')
      return 'Phản hồi dữ liệu bệnh nhân không hợp lệ. Vui lòng thử lại sau.'
    if (error.status === 403)
      return 'Bạn không có quyền thực hiện thao tác trên hồ sơ bệnh nhân.'
    if (error.status === 401)
      return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
    if (error.status === 404)
      return 'Không tìm thấy hồ sơ bệnh nhân hoặc chưa có hồ sơ liên kết.'
    if (error.status === 409)
      return 'Thông tin bệnh nhân đã tồn tại hoặc vừa được cập nhật.'
    if (error.status === 400)
      return 'Vui lòng kiểm tra lại các trường thông tin được đánh dấu.'
  }
  return 'Không thể kết nối hồ sơ bệnh nhân. Vui lòng thử lại.'
}

export const validId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[1-9]\d*$/.test(value) &&
  value.length <= 19 &&
  BigInt(value) <= 9223372036854775807n

export const patientCodeRule = (value: string) =>
  /^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(value.trim().toUpperCase()) ||
  'Mã gồm 1–32 ký tự A–Z, 0–9, _ hoặc -; bắt đầu bằng chữ hoặc số.'

export const patientFullNameRule = (value: string) =>
  (!!value.trim() && value.trim().length <= 120) ||
  'Vui lòng nhập họ và tên bệnh nhân, tối đa 120 ký tự.'

export const patientDobRule = (value: string) => {
  if (!value) return true // optional in schema
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    return 'Ngày sinh phải có định dạng YYYY-MM-DD.'
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  )
    return 'Ngày sinh không hợp lệ.'
  const today = new Date()
  today.setHours(23, 59, 59, 999)
  if (date > today) return 'Ngày sinh không được vượt quá ngày hiện tại.'
  return true
}

export const patientPhoneRule = (value: string) => {
  const trimmed = value.trim()
  if (trimmed.length > 24) return 'Số điện thoại tối đa 24 ký tự.'
  return true
}

export const patientAddressRule = (value: string) =>
  value.length <= 255 || 'Địa chỉ tối đa 255 ký tự.'

export function validatePatient(draft: PatientDraft): PatientFieldErrors {
  const errors: PatientFieldErrors = {}
  const codeCheck = patientCodeRule(draft.patientCode)
  if (codeCheck !== true) errors.patientCode = String(codeCheck)

  const nameCheck = patientFullNameRule(draft.fullName)
  if (nameCheck !== true) errors.fullName = String(nameCheck)

  const dobCheck = patientDobRule(draft.dateOfBirth)
  if (dobCheck !== true) errors.dateOfBirth = String(dobCheck)

  const phoneCheck = patientPhoneRule(draft.phone)
  if (phoneCheck !== true) errors.phone = String(phoneCheck)

  const addressCheck = patientAddressRule(draft.address)
  if (addressCheck !== true) errors.address = String(addressCheck)

  if (draft.userId && !validId(draft.userId)) {
    errors.userId = 'Mã tài khoản người dùng liên kết không hợp lệ.'
  }

  return errors
}
