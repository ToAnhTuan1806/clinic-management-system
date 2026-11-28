// Matches D02 RegisterRequest/LoginRequest and the BCrypt UTF-8 limit.
export const registrationLimits = {
  nameMin: 1,
  nameMax: 120,
  passwordMin: 12,
  passwordMax: 72,
  emailMax: 254,
} as const
export const emailRules = {
  required: 'Vui lòng nhập email.',
  validate: (value: string) =>
    (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) &&
      value.trim().length <= registrationLimits.emailMax) ||
    'Vui lòng nhập email hợp lệ.',
}
const passwordSafety = (value: string) => {
  if (!value.trim()) return 'Vui lòng nhập mật khẩu.'
  return (
    new TextEncoder().encode(value).byteLength <= 72 ||
    'Mật khẩu quá dài, vui lòng rút ngắn lại.'
  )
}
export const loginPasswordRules = {
  required: 'Vui lòng nhập mật khẩu.',
  validate: passwordSafety,
}
export const nameRules = {
  validate: (value: string) => {
    const name = value.trim()
    return (
      (name.length >= registrationLimits.nameMin &&
        name.length <= registrationLimits.nameMax) ||
      'Vui lòng nhập họ tên, tối đa 120 ký tự.'
    )
  },
}
export const registerPasswordRules = {
  required: 'Vui lòng nhập mật khẩu.',
  minLength: {
    value: registrationLimits.passwordMin,
    message: 'Mật khẩu cần ít nhất 12 ký tự.',
  },
  maxLength: {
    value: registrationLimits.passwordMax,
    message: 'Mật khẩu không vượt quá 72 ký tự.',
  },
  validate: passwordSafety,
}
