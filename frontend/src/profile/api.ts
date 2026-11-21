import type { AxiosInstance } from 'axios'
import { getAuthSnapshot } from '@/auth/session-store'
import { normalizeAuthError } from '@/auth/errors'
import { validId } from '@/patient/model'
import {
  ProfileError,
  validateProfile,
  type ProfileGateway,
  type UserProfile,
} from './model'
import type { Role } from '@/auth/types'

const invalid = (): never => {
  throw new ProfileError('INVALID_PROFILE_RESPONSE')
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid()

const text = (value: unknown): string =>
  typeof value === 'string' ? value : invalid()

const nullable = (value: unknown): string => (value === null ? '' : text(value))

const id = (value: unknown): string => (validId(value) ? value : invalid())

const data = (body: unknown): unknown => object(body).data

export function decodeUserProfile(value: unknown): UserProfile {
  const row = object(value)
  const allowedRoles: Role[] = ['ADMIN', 'DOCTOR', 'RECEPTIONIST', 'PATIENT']
  const role = text(row.role) as Role
  if (!allowedRoles.includes(role)) invalid()

  const status = text(row.status)
  if (status !== 'ACTIVE' && status !== 'DISABLED') invalid()

  return {
    id: id(row.id),
    email: text(row.email),
    fullName: text(row.fullName),
    role,
    status: status as 'ACTIVE' | 'DISABLED',
    phone: row.phone !== undefined ? nullable(row.phone) : '',
    address: row.address !== undefined ? nullable(row.address) : '',
  }
}

export function createProfileApi(client: AxiosInstance): ProfileGateway {
  async function request<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action()
    } catch (error) {
      if (
        error instanceof ProfileError ||
        (error instanceof DOMException && error.name === 'AbortError')
      )
        throw error

      const problem = normalizeAuthError(error)
      const allowedFields = ['fullName', 'phone', 'address']
      const fields = Object.fromEntries(
        Object.entries(problem.fields).filter(([key]) =>
          allowedFields.includes(key),
        ),
      )
      throw new ProfileError(problem.code, problem.status, fields)
    }
  }

  const actor = () => {
    const state = getAuthSnapshot()
    if (!state.user || state.status !== 'authenticated')
      throw new ProfileError('AUTHENTICATION_REQUIRED', 401)
    return { user: state.user, version: state.version }
  }

  const unchanged = (version: number, signal: AbortSignal) => {
    signal.throwIfAborted()
    if (getAuthSnapshot().version !== version)
      throw new DOMException('Stale session', 'AbortError')
  }

  const check = (fields: Record<string, string | undefined>) => {
    if (Object.keys(fields).length)
      throw new ProfileError('VALIDATION_FAILED', 400, fields)
  }

  const gateway: ProfileGateway = {
    mode: 'real',

    getProfile: (signal) =>
      request(async () => {
        const current = actor()
        const response = await client.get('/api/v1/me/profile', { signal })
        unchanged(current.version, signal)
        if (response.status !== 200) invalid()
        return decodeUserProfile(data(response.data))
      }),

    updateProfile: (draft, signal) =>
      request(async () => {
        check(validateProfile(draft))
        const current = actor()
        const body = {
          fullName: draft.fullName.trim(),
          phone: draft.phone.trim() || null,
          address: draft.address.trim() || null,
        }

        const response = await client.patch('/api/v1/me/profile', body, {
          signal,
        })
        unchanged(current.version, signal)
        if (response.status !== 200) invalid()
        return decodeUserProfile(data(response.data))
      }),
  }

  return gateway
}
