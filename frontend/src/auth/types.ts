export const roles = ['ADMIN', 'DOCTOR', 'RECEPTIONIST', 'PATIENT'] as const
export type Role = (typeof roles)[number]

// Internal FE models; the D02 wire DTO is checked by backend-contract.ts.
export interface AuthUser {
  id: string
  fullName: string
  email: string
  role: Role
}
export interface LoginInput {
  email: string
  password: string
}
export interface RegisterInput extends LoginInput {
  fullName: string
}

export interface AuthContract {
  encodeLogin: (input: LoginInput) => unknown
  encodeRegister: (input: RegisterInput) => unknown
  decodeAccessToken: (body: unknown) => string
  decodeUser: (body: unknown) => AuthUser
  decodeRegistration: (body: unknown) => void
}

export const roleLabels: Record<Role, string> = {
  ADMIN: 'Quản trị viên',
  DOCTOR: 'Bác sĩ',
  RECEPTIONIST: 'Lễ tân',
  PATIENT: 'Bệnh nhân',
}
