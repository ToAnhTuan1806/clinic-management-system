import type { AxiosInstance } from 'axios'
import { getAuthSnapshot } from '@/auth/session-store'
import { normalizeAuthError } from '@/auth/errors'
import type { Role } from '@/auth/types'
import {
  DirectoryError,
  conflictFields,
  validId,
  validateDoctor,
  validateSpecialty,
  type DirectoryGateway,
  type DirectoryQuery,
  type Doctor,
  type DoctorUser,
  type Page,
  type Specialty,
} from './model'

const invalid = (): never => {
  throw new DirectoryError('INVALID_CATALOG_RESPONSE')
}
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid()
const text = (value: unknown) => (typeof value === 'string' ? value : invalid())
const nullable = (value: unknown) => (value === null ? '' : text(value))
const id = (value: unknown) => (validId(value) ? value : invalid())
const boolean = (value: unknown) =>
  typeof value === 'boolean' ? value : invalid()
const data = (body: unknown) => object(body).data
const exact = (value: Record<string, unknown>, fields: string[]) => {
  if (Object.keys(value).sort().join(',') !== fields.sort().join(',')) invalid()
}
export function decodeSpecialty(value: unknown): Specialty {
  const row = object(value)
  exact(row, ['id', 'code', 'name', 'description', 'isActive'])
  return {
    id: id(row.id),
    code: text(row.code),
    name: text(row.name),
    description: nullable(row.description),
    active: boolean(row.isActive),
  }
}
export function decodeDoctor(
  value: unknown,
  role: Role,
  ownId: string,
): Doctor {
  const row = object(value)
  const fields = [
    'id',
    'doctorCode',
    'fullName',
    'specialtyId',
    'specialtyName',
    'biography',
    'isActive',
  ]
  if (role !== 'PATIENT') fields.push('userStatus')
  if (role === 'ADMIN' || role === 'DOCTOR')
    fields.push('userId', 'licenseNumber')
  exact(row, fields)
  const result: Doctor = {
    id: id(row.id),
    doctorCode: text(row.doctorCode),
    fullName: text(row.fullName),
    specialtyId: id(row.specialtyId),
    specialtyName: text(row.specialtyName),
    biography: nullable(row.biography),
    active: boolean(row.isActive),
  }
  if (role !== 'PATIENT') {
    if (row.userStatus !== 'ACTIVE' && row.userStatus !== 'DISABLED') invalid()
    result.userStatus = row.userStatus as 'ACTIVE' | 'DISABLED'
  }
  if (role === 'ADMIN' || role === 'DOCTOR') {
    result.userId = id(row.userId)
    result.licenseNumber = nullable(row.licenseNumber)
  }
  if (role === 'DOCTOR' && result.userId !== ownId) invalid()
  if (role === 'PATIENT' && !result.active) invalid()
  return result
}
export function decodeEligibleUser(value: unknown): DoctorUser {
  const row = object(value)
  exact(row, ['id', 'fullName', 'email'])
  return {
    id: id(row.id),
    fullName: text(row.fullName),
    email: text(row.email),
    role: 'DOCTOR',
    active: true,
    linked: false,
  }
}
export function decodePage<T>(
  body: unknown,
  decode: (item: unknown) => T,
  requested: { page: number; pageSize: number },
): Page<T> {
  const row = object(data(body))
  exact(row, ['items', 'page', 'size', 'totalElements', 'totalPages'])
  const integer = (value: unknown) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      ? value
      : invalid()
  const page = integer(row.page),
    size = integer(row.size),
    total = integer(row.totalElements),
    totalPages = integer(row.totalPages)
  if (
    !Array.isArray(row.items) ||
    size < 1 ||
    size > 100 ||
    row.items.length > size ||
    page !== requested.page ||
    size !== requested.pageSize ||
    totalPages !== Math.ceil(total / size)
  )
    invalid()
  return {
    items: (row.items as unknown[]).map(decode),
    page,
    pageSize: size,
    total,
    totalPages,
  }
}
function pathId(value: string) {
  if (!validId(value)) throw new DirectoryError('VALIDATION_FAILED', 400)
  return value
}
function params(query: { search: string; page: number; pageSize: number }) {
  if (
    query.search.trim().length > 120 ||
    !Number.isInteger(query.page) ||
    query.page < 0 ||
    !Number.isInteger(query.pageSize) ||
    query.pageSize < 1 ||
    query.pageSize > 100
  )
    throw new DirectoryError('VALIDATION_FAILED', 400)
  return { q: query.search.trim(), page: query.page, size: query.pageSize }
}
export function createDirectoryApi(client: AxiosInstance): DirectoryGateway {
  async function request<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action()
    } catch (error) {
      if (
        error instanceof DirectoryError ||
        (error instanceof DOMException && error.name === 'AbortError')
      )
        throw error
      const problem = normalizeAuthError(error)
      const fields = Object.fromEntries(
        Object.entries(problem.fields).filter(([key]) =>
          [
            'code',
            'name',
            'description',
            'doctorCode',
            'licenseNumber',
            'biography',
            'userId',
            'specialtyId',
          ].includes(key),
        ),
      )
      throw new DirectoryError(problem.code, problem.status, {
        ...fields,
        ...conflictFields(problem.code),
      })
    }
  }
  const actor = () => {
    const state = getAuthSnapshot()
    if (!state.user || state.status !== 'authenticated')
      throw new DirectoryError('AUTHENTICATION_REQUIRED', 401)
    return { user: state.user, version: state.version }
  }
  const unchanged = (version: number, signal: AbortSignal) => {
    signal.throwIfAborted()
    if (getAuthSnapshot().version !== version)
      throw new DOMException('Stale session', 'AbortError')
  }
  const check = (fields: Record<string, string | undefined>) => {
    if (Object.keys(fields).length)
      throw new DirectoryError('VALIDATION_FAILED', 400, fields)
  }
  const listParams = (query: DirectoryQuery, doctors = false) => ({
    ...params(query),
    ...(query.active !== 'all' ? { isActive: query.active === 'active' } : {}),
    ...(doctors && query.specialtyId
      ? { specialtyId: pathId(query.specialtyId) }
      : {}),
  })
  const gateway: DirectoryGateway = {
    mode: 'real',
    listSpecialties: (query, signal) =>
      request(async () => {
        const current = actor(),
          response = await client.get('/api/v1/specialties', {
            params: listParams(query),
            signal,
          })
        unchanged(current.version, signal)
        const result = decodePage(response.data, decodeSpecialty, query)
        if (response.status !== 200) invalid()
        if (
          ['DOCTOR', 'PATIENT'].includes(current.user.role) &&
          result.items.some((item) => !item.active)
        )
          invalid()
        return result
      }),
    listDoctors: (query, signal) =>
      request(async () => {
        const current = actor(),
          response = await client.get('/api/v1/doctors', {
            params: listParams(query, true),
            signal,
          })
        unchanged(current.version, signal)
        if (response.status !== 200) invalid()
        return decodePage(
          response.data,
          (value) => decodeDoctor(value, current.user.role, current.user.id),
          query,
        )
      }),
    getSpecialty: (value, signal) =>
      request(async () => {
        const current = actor(),
          response = await client.get('/api/v1/specialties/' + pathId(value), {
            signal,
          })
        unchanged(current.version, signal)
        const result = decodeSpecialty(data(response.data))
        if (response.status !== 200) invalid()
        if (['DOCTOR', 'PATIENT'].includes(current.user.role) && !result.active)
          invalid()
        return result
      }),
    getDoctor: (value, signal) =>
      request(async () => {
        const current = actor(),
          response = await client.get('/api/v1/doctors/' + pathId(value), {
            signal,
          })
        unchanged(current.version, signal)
        if (response.status !== 200) invalid()
        return decodeDoctor(
          data(response.data),
          current.user.role,
          current.user.id,
        )
      }),
    specialtyOptions: async (signal, activeOnly) => {
      const result: Specialty[] = []
      for (let page = 0; ; page++) {
        const batch = await gateway.listSpecialties(
          {
            search: '',
            page,
            pageSize: 100,
            active: activeOnly ? 'active' : 'all',
            specialtyId: '',
          },
          signal,
        )
        result.push(...batch.items)
        if (page + 1 >= (batch.totalPages ?? 0)) return result
      }
    },
    doctorUsers: (signal, query = { search: '', page: 0, pageSize: 20 }) =>
      request(async () => {
        const current = actor(),
          response = await client.get('/api/v1/doctors/eligible-users', {
            params: params(query),
            signal,
          })
        unchanged(current.version, signal)
        if (response.status !== 200) invalid()
        return decodePage(response.data, decodeEligibleUser, query)
      }),
    saveSpecialty: (value, draft, signal) =>
      request(async () => {
        check(validateSpecialty(draft))
        const current = actor(),
          body = {
            code: draft.code.trim().toUpperCase(),
            name: draft.name.trim(),
            description: draft.description,
          }
        const response = value
          ? await client.patch('/api/v1/specialties/' + pathId(value), body, {
              signal,
            })
          : await client.post('/api/v1/specialties', body, { signal })
        unchanged(current.version, signal)
        decodeSpecialty(data(response.data))
        if (response.status !== (value ? 200 : 201)) invalid()
      }),
    saveDoctor: (value, draft, signal) =>
      request(async () => {
        check(validateDoctor(draft, !!value))
        const current = actor(),
          body = {
            specialtyId: pathId(draft.specialtyId),
            doctorCode: draft.doctorCode.trim().toUpperCase(),
            licenseNumber: draft.licenseNumber.trim().toUpperCase(),
            biography: draft.biography,
          }
        const response = value
          ? await client.patch('/api/v1/doctors/' + pathId(value), body, {
              signal,
            })
          : await client.post(
              '/api/v1/doctors',
              { ...body, userId: pathId(draft.userId) },
              { signal },
            )
        unchanged(current.version, signal)
        decodeDoctor(data(response.data), current.user.role, current.user.id)
        if (response.status !== (value ? 200 : 201)) invalid()
      }),
    setActive: (kind, value, active, signal) =>
      request(async () => {
        const current = actor(),
          response = await client.patch(
            '/api/v1/' + kind + '/' + pathId(value),
            { isActive: active },
            { signal },
          )
        unchanged(current.version, signal)
        if (response.status !== 200) invalid()
        if (kind === 'doctors')
          decodeDoctor(data(response.data), current.user.role, current.user.id)
        else decodeSpecialty(data(response.data))
      }),
  }
  return gateway
}
