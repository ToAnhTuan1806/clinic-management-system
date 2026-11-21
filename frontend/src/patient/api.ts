import type { AxiosInstance } from 'axios'
import { getAuthSnapshot } from '@/auth/session-store'
import { normalizeAuthError } from '@/auth/errors'
import {
  PatientError,
  patientConflictFields,
  validId,
  validatePatient,
  type Page,
  type Patient,
  type PatientGateway,
  type PatientQuery,
  type Sex,
} from './model'

const invalid = (): never => {
  throw new PatientError('INVALID_PATIENT_RESPONSE')
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid()

const text = (value: unknown): string =>
  typeof value === 'string' ? value : invalid()

const nullable = (value: unknown): string => (value === null ? '' : text(value))

const id = (value: unknown): string => (validId(value) ? value : invalid())

const boolean = (value: unknown): boolean =>
  typeof value === 'boolean' ? value : invalid()

const data = (body: unknown): unknown => object(body).data

export function decodePatient(value: unknown): Patient {
  const row = object(value)
  const sexValues: Sex[] = ['FEMALE', 'MALE', 'OTHER', 'UNKNOWN']
  const sex = (row.sex ? text(row.sex) : 'UNKNOWN') as Sex
  if (!sexValues.includes(sex)) invalid()

  return {
    id: id(row.id),
    patientCode: text(row.patientCode),
    fullName: text(row.fullName),
    dateOfBirth: nullable(row.dateOfBirth),
    sex,
    phone: nullable(row.phone),
    address: nullable(row.address),
    active:
      row.isActive !== undefined ? boolean(row.isActive) : boolean(row.active),
    userId: row.userId ? id(row.userId) : null,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : undefined,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : undefined,
  }
}

export function decodePage<T>(
  body: unknown,
  decode: (item: unknown) => T,
  requested: { page: number; pageSize: number },
): Page<T> {
  const row = object(data(body))
  const integer = (value: unknown) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      ? value
      : invalid()

  const page = integer(row.page)
  const size = integer(row.size)
  const total = integer(row.totalElements)
  const totalPages = integer(row.totalPages)

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
  if (!validId(value)) throw new PatientError('VALIDATION_FAILED', 400)
  return value
}

function queryParams(query: PatientQuery) {
  if (
    query.search.trim().length > 120 ||
    !Number.isInteger(query.page) ||
    query.page < 0 ||
    !Number.isInteger(query.pageSize) ||
    query.pageSize < 1 ||
    query.pageSize > 100
  )
    throw new PatientError('VALIDATION_FAILED', 400)

  return {
    q: query.search.trim(),
    page: query.page,
    size: query.pageSize,
    ...(query.active !== 'all' ? { isActive: query.active === 'active' } : {}),
  }
}

export function createPatientApi(client: AxiosInstance): PatientGateway {
  async function request<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action()
    } catch (error) {
      if (
        error instanceof PatientError ||
        (error instanceof DOMException && error.name === 'AbortError')
      )
        throw error

      const problem = normalizeAuthError(error)
      const allowedFields = [
        'patientCode',
        'fullName',
        'dateOfBirth',
        'sex',
        'phone',
        'address',
        'userId',
      ]
      const fields = Object.fromEntries(
        Object.entries(problem.fields).filter(([key]) =>
          allowedFields.includes(key),
        ),
      )
      throw new PatientError(problem.code, problem.status, {
        ...fields,
        ...patientConflictFields(problem.code),
      })
    }
  }

  const actor = () => {
    const state = getAuthSnapshot()
    if (!state.user || state.status !== 'authenticated')
      throw new PatientError('AUTHENTICATION_REQUIRED', 401)
    return { user: state.user, version: state.version }
  }

  const unchanged = (version: number, signal: AbortSignal) => {
    signal.throwIfAborted()
    if (getAuthSnapshot().version !== version)
      throw new DOMException('Stale session', 'AbortError')
  }

  const check = (fields: Record<string, string | undefined>) => {
    if (Object.keys(fields).length)
      throw new PatientError('VALIDATION_FAILED', 400, fields)
  }

  const gateway: PatientGateway = {
    mode: 'real',

    listPatients: (query, signal) =>
      request(async () => {
        const current = actor()
        const response = await client.get('/api/v1/patients', {
          params: queryParams(query),
          signal,
        })
        unchanged(current.version, signal)
        if (response.status !== 200) invalid()
        return decodePage(response.data, decodePatient, query)
      }),

    getPatient: (value, signal) =>
      request(async () => {
        const current = actor()
        const response = await client.get('/api/v1/patients/' + pathId(value), {
          signal,
        })
        unchanged(current.version, signal)
        if (response.status !== 200) invalid()
        return decodePatient(data(response.data))
      }),

    getMePatientProfile: (signal) =>
      request(async () => {
        const current = actor()
        const response = await client.get('/api/v1/me/patient-profile', {
          signal,
        })
        unchanged(current.version, signal)
        if (response.status !== 200) invalid()
        return decodePatient(data(response.data))
      }),

    savePatient: (value, draft, signal) =>
      request(async () => {
        check(validatePatient(draft))
        const current = actor()
        const body = {
          patientCode: draft.patientCode.trim().toUpperCase(),
          fullName: draft.fullName.trim(),
          dateOfBirth: draft.dateOfBirth.trim() || null,
          sex: draft.sex,
          phone: draft.phone.trim() || null,
          address: draft.address.trim() || null,
          ...(draft.userId ? { userId: pathId(draft.userId) } : {}),
        }

        const response = value
          ? await client.patch('/api/v1/patients/' + pathId(value), body, {
              signal,
            })
          : await client.post('/api/v1/patients', body, { signal })

        unchanged(current.version, signal)
        const expectedStatus = value ? 200 : 201
        if (response.status !== expectedStatus) invalid()
        return decodePatient(data(response.data))
      }),

    setActive: (value, active, signal) =>
      request(async () => {
        const current = actor()
        const response = await client.patch(
          '/api/v1/patients/' + pathId(value),
          { isActive: active },
          { signal },
        )
        unchanged(current.version, signal)
        if (response.status !== 200) invalid()
      }),
  }

  return gateway
}
