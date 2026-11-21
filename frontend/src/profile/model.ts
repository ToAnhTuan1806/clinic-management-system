import type { Role } from '@/auth/types'

export interface UserProfile {
  id: string
  email: string
  fullName: string
  role: Role
  status: 'ACTIVE' | 'DISABLED'
  phone: string
  address: string
}

export interface ProfileDraft {
  fullName: string
  phone: string
  address: string
}

export type ProfileFieldErrors = Partial<Record<keyof ProfileDraft, string>>

export interface ProfileGateway {
  mode: 'pending' | 'mock' | 'real'
  getProfile(signal: AbortSignal): Promise<UserProfile>
  updateProfile(draft: ProfileDraft, signal: AbortSignal): Promise<UserProfile>
}

export class ProfileError extends Error {
  readonly fields: ProfileFieldErrors
  readonly code: string
  readonly status: number
  constructor(code: string, status = 0, fields: ProfileFieldErrors = {}) {
    super(code)
    this.code = code
    this.status = status
    this.fields = fields
  }
}

export function profileMessage(error: unknown): string {
  if (error instanceof ProfileError) {
    if (
      error.code === 'D04_CONTRACT_PENDING' ||
      error.code === 'API_NOT_CONFIGURED'
    )
      return 'Dịch vụ hồ sơ cá nhân chưa được kết nối. Vui lòng thử lại sau.'
    if (error.code === 'INVALID_PROFILE_RESPONSE')
      return 'Phản hồi thông tin hồ sơ không hợp lệ.'
    if (error.status === 403)
      return 'Bạn không có quyền thực hiện thao tác trên hồ sơ này.'
    if (error.status === 401)
      return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
    if (error.status === 404) return 'Không tìm thấy hồ sơ người dùng.'
    if (error.status === 409)
      return 'Thông tin cá nhân xung đột hoặc vừa được cập nhật.'
    if (error.status === 400)
      return 'Vui lòng kiểm tra lại các trường thông tin được đánh dấu.'
  }
  return 'Không thể kết nối hồ sơ cá nhân. Vui lòng thử lại.'
}

export const profileFullNameRule = (value: string) =>
  (!!value.trim() && value.trim().length <= 120) ||
  'Vui lòng nhập họ và tên, tối đa 120 ký tự.'

export const profilePhoneRule = (value: string) => {
  const trimmed = value.trim()
  if (trimmed.length > 24) return 'Số điện thoại tối đa 24 ký tự.'
  return true
}

export const profileAddressRule = (value: string) =>
  value.length <= 255 || 'Địa chỉ tối đa 255 ký tự.'

export function validateProfile(draft: ProfileDraft): ProfileFieldErrors {
  const errors: ProfileFieldErrors = {}

  const nameCheck = profileFullNameRule(draft.fullName)
  if (nameCheck !== true) errors.fullName = String(nameCheck)

  const phoneCheck = profilePhoneRule(draft.phone)
  if (phoneCheck !== true) errors.phone = String(phoneCheck)

  const addressCheck = profileAddressRule(draft.address)
  if (addressCheck !== true) errors.address = String(addressCheck)

  return errors
}
