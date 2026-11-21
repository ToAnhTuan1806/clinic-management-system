import { invalidAuthResponse } from './errors'
import { roles, type AuthContract, type AuthUser } from './types'

// docs/API_CONTRACT.md section 3.1, IMPLEMENTED D02. No inferred DTO variants.
function data(body: unknown): Record<string, unknown> {
  if (
    !body ||
    typeof body !== 'object' ||
    !('data' in body) ||
    !body.data ||
    typeof body.data !== 'object' ||
    Array.isArray(body.data)
  )
    throw invalidAuthResponse()
  return body.data as Record<string, unknown>
}
function readUser(value: unknown): AuthUser {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalidAuthResponse()
  const user = value as Record<string, unknown>
  if (
    typeof user.id !== 'string' ||
    !/^[1-9]\d*$/.test(user.id) ||
    typeof user.email !== 'string' ||
    !user.email ||
    typeof user.fullName !== 'string' ||
    !user.fullName.trim() ||
    !roles.includes(user.role as (typeof roles)[number]) ||
    user.status !== 'ACTIVE'
  )
    throw invalidAuthResponse()
  // Only retain the public fields needed by the FE; never propagate raw responses.
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role as (typeof roles)[number],
  }
}
export const backendAuthContract: AuthContract = {
  encodeLogin: ({ email, password }) => ({
    email: email.trim().toLowerCase(),
    password,
  }),
  encodeRegister: ({ fullName, email, password }) => ({
    fullName: fullName.trim(),
    email: email.trim().toLowerCase(),
    password,
  }),
  decodeAccessToken: (body) => {
    const login = data(body)
    if (
      typeof login.accessToken !== 'string' ||
      !login.accessToken.trim() ||
      login.tokenType !== 'Bearer' ||
      login.expiresIn !== 1800
    )
      throw invalidAuthResponse()
    readUser(login.user)
    return login.accessToken
  },
  decodeUser: (body) => readUser(data(body)),
  decodeRegistration: (body) => {
    if (readUser(data(body)).role !== 'PATIENT') throw invalidAuthResponse()
  },
}
