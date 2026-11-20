// Client safety checks only. Register lengths are provisional until BE D02 is merged.
export const registrationLimits = {
  nameMin: 2,
  nameMax: 100,
  passwordMin: 8,
  passwordMax: 128,
  emailMax: 254,
} as const
export const emailRules = {
  required: 'Vui lòng nhập email.',
  validate: (value: string) =>
    (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) &&
      value.trim().length <= registrationLimits.emailMax) ||
    'Vui lòng nhập email hợp lệ.',
}
export const loginPasswordRules = { required: 'Vui lòng nhập mật khẩu.' }
export const nameRules = {
  validate: (value: string) => {
    const name = value.trim()
    return (
      (name.length >= registrationLimits.nameMin &&
        name.length <= registrationLimits.nameMax) ||
      'Họ tên cần từ 2 đến 100 ký tự.'
    )
  },
}
export const registerPasswordRules = {
  required: 'Vui lòng nhập mật khẩu.',
  minLength: {
    value: registrationLimits.passwordMin,
    message: 'Mật khẩu cần ít nhất 8 ký tự.',
  },
  maxLength: {
    value: registrationLimits.passwordMax,
    message: 'Mật khẩu không vượt quá 128 ký tự.',
  },
}
