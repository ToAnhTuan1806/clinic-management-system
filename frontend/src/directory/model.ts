import type { AuthUser } from '@/auth/types'

export interface Specialty {
  id: string
  code: string
  name: string
  description: string
  active: boolean
}
export interface Doctor {
  id: string
  doctorCode: string
  fullName: string
  specialtyId: string
  specialtyName: string
  biography: string
  active: boolean
  userId?: string
  userStatus?: 'ACTIVE' | 'DISABLED'
  licenseNumber?: string
  // Available in synthetic fixtures only. Real PATIENT visibility is scoped by Backend.
  specialtyActive?: boolean
}
export interface DoctorUser {
  id: string
  fullName: string
  email?: string
  role: 'DOCTOR'
  active: boolean
  linked: boolean
}
export interface Page<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages?: number
}
export interface DirectoryQuery {
  search: string
  page: number
  pageSize: number
  active: 'all' | 'active' | 'inactive'
  specialtyId: string
}
export type SpecialtyDraft = Pick<Specialty, 'code' | 'name' | 'description'>
export interface DoctorDraft {
  userId: string
  specialtyId: string
  doctorCode: string
  licenseNumber: string
  biography: string
}
export type DirectoryKind = 'doctors' | 'specialties'
export type DirectoryItem = Doctor | Specialty
export type FieldErrors = Partial<
  Record<keyof SpecialtyDraft | keyof DoctorDraft, string>
>
export interface DirectoryGateway {
  mode: 'pending' | 'mock' | 'real'
  listSpecialties(
    query: DirectoryQuery,
    signal: AbortSignal,
  ): Promise<Page<Specialty>>
  listDoctors(query: DirectoryQuery, signal: AbortSignal): Promise<Page<Doctor>>
  getSpecialty(id: string, signal: AbortSignal): Promise<Specialty>
  getDoctor(id: string, signal: AbortSignal): Promise<Doctor>
  specialtyOptions(
    signal: AbortSignal,
    activeOnly: boolean,
  ): Promise<Specialty[]>
  doctorUsers(
    signal: AbortSignal,
    query?: { search: string; page: number; pageSize: number },
  ): Promise<Page<DoctorUser>>
  saveSpecialty(
    id: string | undefined,
    draft: SpecialtyDraft,
    signal: AbortSignal,
  ): Promise<void>
  saveDoctor(
    id: string | undefined,
    draft: DoctorDraft,
    signal: AbortSignal,
  ): Promise<void>
  setActive(
    kind: DirectoryKind,
    id: string,
    active: boolean,
    signal: AbortSignal,
  ): Promise<void>
}
export const canManageDirectory = (user: AuthUser | null) =>
  user?.role === 'ADMIN'
export const visibleDoctor = (doctor: Doctor, user: AuthUser) =>
  user.role === 'PATIENT'
    ? doctor.active &&
      doctor.specialtyActive !== false &&
      (!doctor.userStatus || doctor.userStatus === 'ACTIVE')
    : user.role === 'DOCTOR'
      ? doctor.userId === user.id
      : true
export class DirectoryError extends Error {
  readonly fields: FieldErrors
  readonly code: string
  readonly status: number
  constructor(code: string, status = 0, fields: FieldErrors = {}) {
    super(code)
    this.code = code
    this.status = status
    this.fields = fields
  }
}
const conflicts: Record<
  string,
  [keyof SpecialtyDraft | keyof DoctorDraft | null, string]
> = {
  SPECIALTY_CODE_EXISTS: ['code', 'Mã chuyên khoa đã được sử dụng.'],
  SPECIALTY_NAME_EXISTS: ['name', 'Tên chuyên khoa đã tồn tại.'],
  DOCTOR_CODE_EXISTS: ['doctorCode', 'Mã bác sĩ đã được sử dụng.'],
  LICENSE_NUMBER_EXISTS: ['licenseNumber', 'Số giấy phép đã được sử dụng.'],
  USER_ALREADY_LINKED: [
    'userId',
    'Tài khoản đã có hồ sơ bác sĩ. Vui lòng tải lại lựa chọn.',
  ],
  USER_NOT_ELIGIBLE: [
    'userId',
    'Tài khoản không còn đủ điều kiện. Vui lòng chọn lại.',
  ],
  SPECIALTY_INACTIVE: [
    'specialtyId',
    'Chuyên khoa đã ngừng hoạt động. Vui lòng chọn lại.',
  ],
  SPECIALTY_HAS_ACTIVE_DOCTORS: [
    null,
    'Chuyên khoa còn bác sĩ đang hoạt động. Hãy ngừng hoạt động các hồ sơ đó trước.',
  ],
  SPECIALTY_CONFLICT: [
    null,
    'Chuyên khoa xung đột với dữ liệu hiện có. Vui lòng kiểm tra mã và tên.',
  ],
  DOCTOR_CONFLICT: [
    null,
    'Hồ sơ xung đột với dữ liệu hiện có. Vui lòng kiểm tra mã, giấy phép và tài khoản.',
  ],
  DOCTOR_CONCURRENT_UPDATE: [
    null,
    'Hồ sơ vừa được thay đổi. Vui lòng tải lại trước khi lưu.',
  ],
}
export function conflictFields(code: string): FieldErrors {
  const value = conflicts[code]
  return value?.[0] ? { [value[0]]: value[1] } : {}
}
export function directoryMessage(error: unknown) {
  if (error instanceof DirectoryError) {
    if (conflicts[error.code]) return conflicts[error.code][1]
    if (
      error.code === 'D03_CONTRACT_PENDING' ||
      error.code === 'API_NOT_CONFIGURED'
    )
      return 'Danh mục chưa được kết nối. Vui lòng quay lại sau.'
    if (error.code === 'INVALID_CATALOG_RESPONSE')
      return 'Phản hồi danh mục không hợp lệ. Vui lòng thử lại sau.'
    if (error.status === 403)
      return 'Bạn không có quyền thực hiện thao tác này.'
    if (error.status === 401)
      return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
    if (error.status === 409)
      return 'Thông tin đã tồn tại hoặc vừa thay đổi. Vui lòng kiểm tra lại.'
    if (error.status === 400)
      return 'Vui lòng kiểm tra các trường được đánh dấu.'
    if (error.status === 404)
      return 'Thông tin không còn tồn tại hoặc ngoài phạm vi được xem.'
  }
  return 'Không thể kết nối danh mục. Vui lòng thử lại.'
}
export const validId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[1-9]\d*$/.test(value) &&
  value.length <= 19 &&
  BigInt(value) <= 9223372036854775807n
export const codeRule = (value: string) =>
  /^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(value.trim().toUpperCase()) ||
  'Mã gồm 1–32 ký tự A–Z, 0–9, _ hoặc -; bắt đầu bằng chữ hoặc số.'
export const nameRule = (value: string) =>
  (!!value.trim() && value.trim().length <= 120) ||
  'Vui lòng nhập tên chuyên khoa, tối đa 120 ký tự.'
export function validateSpecialty(draft: SpecialtyDraft): FieldErrors {
  return {
    ...(codeRule(draft.code) !== true
      ? { code: String(codeRule(draft.code)) }
      : {}),
    ...(nameRule(draft.name) !== true
      ? { name: String(nameRule(draft.name)) }
      : {}),
    ...(draft.description.length > 5000
      ? { description: 'Mô tả tối đa 5000 ký tự.' }
      : {}),
  }
}
export function validateDoctor(
  draft: DoctorDraft,
  editing = false,
): FieldErrors {
  return {
    ...(!editing && !validId(draft.userId)
      ? { userId: 'Vui lòng chọn tài khoản bác sĩ hợp lệ.' }
      : {}),
    ...(!validId(draft.specialtyId)
      ? { specialtyId: 'Vui lòng chọn chuyên khoa hợp lệ.' }
      : {}),
    ...(codeRule(draft.doctorCode) !== true
      ? { doctorCode: String(codeRule(draft.doctorCode)) }
      : {}),
    ...(draft.licenseNumber.length > 100
      ? { licenseNumber: 'Số giấy phép tối đa 100 ký tự.' }
      : {}),
    ...(draft.biography.length > 5000
      ? { biography: 'Giới thiệu tối đa 5000 ký tự.' }
      : {}),
  }
}
