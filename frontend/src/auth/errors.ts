import axios from 'axios'

export type AuthField =
  | 'fullName'
  | 'email'
  | 'password'
  | 'confirmPassword'
  | 'code'
  | 'name'
  | 'description'
  | 'doctorCode'
  | 'licenseNumber'
  | 'biography'
  | 'userId'
  | 'specialtyId'
const fieldMessages: Record<AuthField, string> = {
  fullName: 'Họ tên không đáp ứng yêu cầu. Vui lòng kiểm tra lại.',
  email: 'Email không hợp lệ hoặc không đáp ứng yêu cầu.',
  password: 'Mật khẩu không đáp ứng yêu cầu.',
  confirmPassword: 'Xác nhận mật khẩu không khớp.',
  code: 'Mã chuyên khoa không hợp lệ.',
  name: 'Tên chuyên khoa không hợp lệ.',
  description: 'Mô tả không hợp lệ.',
  doctorCode: 'Mã bác sĩ không hợp lệ.',
  licenseNumber: 'Số giấy phép không hợp lệ.',
  biography: 'Giới thiệu không hợp lệ.',
  userId: 'Tài khoản bác sĩ không hợp lệ.',
  specialtyId: 'Chuyên khoa không hợp lệ.',
}
export class AuthApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: Partial<Record<AuthField, string>>
  constructor(
    message: string,
    status = 0,
    code = 'NETWORK_ERROR',
    fields: Partial<Record<AuthField, string>> = {},
  ) {
    super(message)
    this.name = 'AuthApiError'
    this.status = status
    this.code = code
    this.fields = fields
  }
}
export const invalidAuthResponse = () =>
  new AuthApiError(
    'Phản hồi xác thực không hợp lệ. Vui lòng thử lại sau.',
    0,
    'INVALID_AUTH_RESPONSE',
  )

// Never expose Axios config, credentials, tokens, raw detail or rejected values to UI/logs.
export function normalizeAuthError(error: unknown): AuthApiError {
  if (error instanceof AuthApiError) return error
  if (!axios.isAxiosError(error))
    return new AuthApiError(
      'Không thể hoàn tất yêu cầu. Vui lòng thử lại.',
      0,
      'REQUEST_FAILED',
    )
  if (axios.isCancel(error))
    return new AuthApiError('Yêu cầu đã được hủy.', 0, 'REQUEST_CANCELLED')
  const status = error.response?.status ?? 0
  const body: unknown = error.response?.data
  const problem =
    body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const code =
    typeof problem.code === 'string' &&
    /^[A-Z][A-Z0-9_]{0,79}$/.test(problem.code)
      ? problem.code
      : `HTTP_${status}`
  const fields: Partial<Record<AuthField, string>> = {}
  if (Array.isArray(problem.errors))
    for (const item of problem.errors) {
      if (
        item &&
        typeof item === 'object' &&
        typeof item.field === 'string' &&
        Object.hasOwn(fieldMessages, item.field)
      ) {
        const field = item.field as AuthField
        fields[field] = fieldMessages[field]
      }
    }
  if (status === 409 && code === 'EMAIL_ALREADY_EXISTS') {
    fields.email = 'Email này đã được sử dụng. Vui lòng dùng email khác.'
    return new AuthApiError(fields.email, status, code, fields)
  }
  const message =
    status === 401
      ? 'Email hoặc mật khẩu không đúng.'
      : status === 403
        ? 'Bạn không có quyền thực hiện thao tác này.'
        : status === 400 || status === 422
          ? 'Thông tin chưa hợp lệ. Vui lòng kiểm tra các trường và thử lại.'
          : status === 429
            ? 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.'
            : status >= 500
              ? 'Dịch vụ đang gặp sự cố. Vui lòng thử lại sau.'
              : status === 0
                ? 'Không thể kết nối dịch vụ. Kiểm tra mạng và thử lại.'
                : 'Không thể hoàn tất yêu cầu. Vui lòng thử lại sau.'
  return new AuthApiError(message, status, code, fields)
}
