// MOCK ONLY: DTOs for isolated FE tests. These are NOT approved backend DTOs.
import { invalidAuthResponse } from '@/auth/errors'
import { roles, type AuthContract } from '@/auth/types'

function data(body: unknown): Record<string, unknown> {
  if (
    !body ||
    typeof body !== 'object' ||
    !('data' in body) ||
    !body.data ||
    typeof body.data !== 'object'
  )
    throw invalidAuthResponse()
  return body.data as Record<string, unknown>
}
export const mockAuthContract: AuthContract = {
  encodeLogin: ({ email, password }) => ({ email, password }),
  // No role input is accepted. The public registration contract must only create PATIENT.
  encodeRegister: ({ fullName, email, password }) => ({
    fullName,
    email,
    password,
  }),
  decodeAccessToken: (body) => {
    const token = data(body).accessToken
    if (typeof token !== 'string' || !token.trim()) throw invalidAuthResponse()
    return token
  },
  decodeUser: (body) => {
    const user = data(body)
    if (
      typeof user.id !== 'string' ||
      !user.id ||
      typeof user.fullName !== 'string' ||
      typeof user.email !== 'string' ||
      !roles.includes(user.role as (typeof roles)[number])
    )
      throw invalidAuthResponse()
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role as (typeof roles)[number],
    }
  },
  decodeRegistration: (body) => {
    const result = data(body)
    if (
      typeof result.id !== 'string' ||
      !result.id ||
      result.role !== 'PATIENT'
    )
      throw invalidAuthResponse()
  },
}
