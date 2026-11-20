import type { AuthUser } from '@/auth/types'

// Internal FE view models, NOT D03 wire DTOs. No unapproved HTTP endpoints.
export interface Specialty {
  id: string
  name: string
  description: string
  active: boolean
}
export interface Doctor {
  id: string
  userId: string
  fullName: string
  specialtyId: string
  specialtyName: string
  specialtyActive: boolean
  biography: string
  active: boolean
}
export interface DoctorUser {
  id: string
  fullName: string
  role: 'DOCTOR'
  active: boolean
  linked: boolean
}
export interface Page<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
}
export interface DirectoryQuery {
  search: string
  page: number
  pageSize: number
  active: 'all' | 'active' | 'inactive'
  specialtyId: string
}
export type SpecialtyDraft = Pick<Specialty, 'name' | 'description'>
export type DoctorDraft = Pick<Doctor, 'userId' | 'specialtyId' | 'biography'>
export type DirectoryKind = 'doctors' | 'specialties'
export type DirectoryItem = Doctor | Specialty
export type FieldErrors = Partial<
  Record<keyof SpecialtyDraft | keyof DoctorDraft, string>
>
export interface DirectoryGateway {
  mode: 'pending' | 'mock'
  listSpecialties(
    query: DirectoryQuery,
    signal: AbortSignal,
  ): Promise<Page<Specialty>>
  listDoctors(query: DirectoryQuery, signal: AbortSignal): Promise<Page<Doctor>>
  specialtyOptions(
    signal: AbortSignal,
    activeOnly: boolean,
  ): Promise<Specialty[]>
  doctorUsers(signal: AbortSignal): Promise<DoctorUser[]>
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
    ? doctor.active && doctor.specialtyActive
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
export function directoryMessage(error: unknown) {
  if (error instanceof DirectoryError) {
    if (error.code === 'D03_CONTRACT_PENDING')
      return 'Danh mục chưa được kết nối. Vui lòng quay lại sau.'
    if (error.status === 403)
      return 'Bạn không có quyền thực hiện thao tác này.'
    if (error.status === 401)
      return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
    if (error.status === 409)
      return 'Thông tin đã tồn tại hoặc vừa thay đổi. Vui lòng kiểm tra lại.'
    if (error.status === 400)
      return 'Vui lòng kiểm tra các trường được đánh dấu.'
    if (error.status === 404)
      return 'Thông tin không còn tồn tại. Vui lòng tải lại danh mục.'
  }
  return 'Không thể kết nối danh mục. Vui lòng thử lại.'
}
// Minimal provisional UI checks only; certify limits after D03 contract is provided.
export const validateSpecialty = (draft: SpecialtyDraft): FieldErrors =>
  draft.name.trim() ? {} : { name: 'Vui lòng nhập tên chuyên khoa.' }
export const validateDoctor = (draft: DoctorDraft): FieldErrors => ({
  ...(!draft.userId
    ? { userId: 'Vui lòng chọn tài khoản bác sĩ hợp lệ.' }
    : {}),
  ...(!draft.specialtyId
    ? { specialtyId: 'Vui lòng chọn chuyên khoa đang hoạt động.' }
    : {}),
})
