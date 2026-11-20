// Official D03 DTO/HTTP contract tested through MOCK Axios transport; not real integration.
import { afterEach, describe, expect, it } from 'vitest'
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import {
  createDirectoryApi,
  decodeDoctor,
  decodeEligibleUser,
  decodePage,
  decodeSpecialty,
} from '../src/directory/api'
import {
  codeRule,
  directoryMessage,
  validId,
  validateDoctor,
  validateSpecialty,
} from '../src/directory/model'
import { installAuthInterceptors } from '../src/auth/http'
import {
  beginAuthentication,
  clearSession,
  establishSession,
  getAuthSnapshot,
} from '../src/auth/session-store'
import type { Role } from '../src/auth/types'

const query = {
  search: '',
  page: 0,
  pageSize: 20,
  active: 'all' as const,
  specialtyId: '',
}
const signal = () => new AbortController().signal
const specialty = {
  id: '9223372036854775807',
  code: 'ENT',
  name: 'DEMO specialty',
  description: null,
  isActive: true,
}
const publicDoctor = {
  id: '2',
  doctorCode: 'DR_02',
  fullName: 'DEMO doctor',
  specialtyId: specialty.id,
  specialtyName: specialty.name,
  biography: null,
  isActive: true,
}
const doctor = {
  ...publicDoctor,
  userId: '10',
  userStatus: 'ACTIVE',
  licenseNumber: null,
}
const pageOf = (
  items: unknown[],
  page = 0,
  size = 20,
  total = items.length,
) => ({
  data: {
    items,
    page,
    size,
    totalElements: total,
    totalPages: Math.ceil(total / size),
  },
})
function login(role: Role = 'ADMIN') {
  establishSession(beginAuthentication(), crypto.randomUUID(), {
    id: '10',
    role,
    email: 'demo@example.invalid',
    fullName: 'DEMO',
  })
}
function factory(
  handler: (
    config: InternalAxiosRequestConfig,
  ) =>
    | { body: unknown; status?: number }
    | Promise<{ body: unknown; status?: number }>,
) {
  const seen: InternalAxiosRequestConfig[] = []
  const client = axios.create({
    baseURL: 'https://catalog.example.invalid',
    adapter: async (config) => {
      seen.push(config)
      const { body, status = 200 } = await handler(config)
      const response = {
        data: body,
        status,
        statusText: 'MOCK',
        headers: {},
        config,
      }
      if (status >= 400)
        throw new AxiosError(
          'MOCK HTTP failure',
          undefined,
          config,
          undefined,
          response,
        )
      return response
    },
  })
  installAuthInterceptors(client, () => true)
  return { api: createDirectoryApi(client), seen }
}
afterEach(() => clearSession())
describe('D03 official contract — MOCK transport', () => {
  it('does not announce success for unexpected 2xx mutation statuses', async () => {
    login()
    const wrongCreate = factory(() => ({
      status: 200,
      body: { data: specialty },
    }))
    await expect(
      wrongCreate.api.saveSpecialty(
        undefined,
        { code: 'ENT', name: 'DEMO', description: '' },
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CATALOG_RESPONSE' })
    const wrongPatch = factory(() => ({ status: 201, body: { data: doctor } }))
    await expect(
      wrongPatch.api.saveDoctor(
        '2',
        {
          userId: '10',
          specialtyId: '1',
          doctorCode: 'DR_02',
          licenseNumber: '',
          biography: '',
        },
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CATALOG_RESPONSE' })
  })
  it('preserves BIGINT strings, nullable text, page/size/count/pages; rejects malformed envelopes', () => {
    expect(decodeSpecialty(specialty)).toMatchObject({
      id: '9223372036854775807',
      description: '',
    })
    expect(
      decodePage(pageOf([specialty]), decodeSpecialty, query),
    ).toMatchObject({ pageSize: 20, total: 1, totalPages: 1 })
    for (const id of [
      '0',
      '-1',
      '1.0',
      '9223372036854775808',
      9007199254740992,
    ])
      expect(validId(id)).toBe(false)
    expect(() => decodeSpecialty({ ...specialty, id: 42 })).toThrow()
    expect(() =>
      decodePage({ items: [specialty] }, decodeSpecialty, query),
    ).toThrow()
    expect(() =>
      decodePage(
        {
          data: {
            items: [],
            page: 0,
            size: 20,
            totalElements: 1,
            totalPages: 0,
          },
        },
        decodeSpecialty,
        query,
      ),
    ).toThrow()
  })
  it('enforces exact role-specific doctor projections and DOCTOR ownership', () => {
    expect(decodeDoctor(publicDoctor, 'PATIENT', '10')).not.toHaveProperty(
      'userId',
    )
    expect(
      decodeDoctor(
        { ...publicDoctor, userStatus: 'ACTIVE' },
        'RECEPTIONIST',
        '10',
      ),
    ).not.toHaveProperty('licenseNumber')
    expect(decodeDoctor(doctor, 'DOCTOR', '10').userId).toBe('10')
    expect(() => decodeDoctor(doctor, 'DOCTOR', '11')).toThrow()
    expect(() => decodeDoctor(doctor, 'PATIENT', '10')).toThrow()
    expect(() =>
      decodeDoctor({ ...publicDoctor, isActive: false }, 'PATIENT', '10'),
    ).toThrow()
    expect(() =>
      decodeDoctor({ ...publicDoctor, email: 'hidden' }, 'PATIENT', '10'),
    ).toThrow()
  })
  it('accepts only the eligible-users three-field projection', () => {
    expect(
      decodeEligibleUser({
        id: '21',
        fullName: 'DEMO',
        email: 'demo@example.invalid',
      }),
    ).toMatchObject({ id: '21', role: 'DOCTOR', active: true, linked: false })
    expect(() =>
      decodeEligibleUser({
        id: '21',
        fullName: 'DEMO',
        email: 'demo@example.invalid',
        passwordHash: 'private',
      }),
    ).toThrow()
  })
  it('encodes only q/isActive/specialtyId/page/size, includes Bearer through D02 interceptor', async () => {
    login()
    const { api, seen } = factory(() => ({ body: pageOf([doctor], 2, 10, 21) }))
    await api.listDoctors(
      {
        ...query,
        search: '  a%_  ',
        page: 2,
        pageSize: 10,
        active: 'inactive',
        specialtyId: '1',
      },
      signal(),
    )
    expect(seen[0].url).toBe('/api/v1/doctors')
    expect(seen[0].params).toEqual({
      q: 'a%_',
      page: 2,
      size: 10,
      isActive: false,
      specialtyId: '1',
    })
    expect(seen[0].headers.has('Authorization')).toBe(true)
    expect(seen[0].params).not.toHaveProperty('sort')
  })
  it('calls exact detail paths and rejects unsafe or overflowing IDs before HTTP', async () => {
    login()
    const { api, seen } = factory((config) => ({
      body: { data: config.url?.includes('specialties') ? specialty : doctor },
    }))
    await api.getDoctor('2', signal())
    await api.getSpecialty(specialty.id, signal())
    expect(seen.map((item) => item.url)).toEqual([
      '/api/v1/doctors/2',
      '/api/v1/specialties/9223372036854775807',
    ])
    await expect(api.getDoctor('../users', signal())).rejects.toMatchObject({
      status: 400,
    })
    await expect(
      api.getSpecialty('9223372036854775808', signal()),
    ).rejects.toMatchObject({ status: 400 })
    expect(seen).toHaveLength(2)
  })
  it('serializes specialty create/edit and status PATCH whitelists with canonical code/name', async () => {
    login()
    const { api, seen } = factory((config) => ({
      status: config.method === 'post' ? 201 : 200,
      body: { data: specialty },
    }))
    const draft = { code: ' ent ', name: ' DEMO ', description: '' }
    await api.saveSpecialty(undefined, draft, signal())
    await api.saveSpecialty('1', draft, signal())
    await api.setActive('specialties', '1', false, signal())
    expect(JSON.parse(seen[0].data)).toEqual({
      code: 'ENT',
      name: 'DEMO',
      description: '',
    })
    expect(seen.map((item) => item.method)).toEqual(['post', 'patch', 'patch'])
    expect(JSON.parse(seen[2].data)).toEqual({ isActive: false })
  })
  it('POST doctor includes string userId; PATCH excludes immutable and unapproved fields, blank clears optional text', async () => {
    login()
    const { api, seen } = factory((config) => ({
      status: config.method === 'post' ? 201 : 200,
      body: { data: doctor },
    }))
    const draft = {
      userId: '21',
      specialtyId: '1',
      doctorCode: ' dr_02 ',
      licenseNumber: ' lic-2 ',
      biography: '',
      role: 'ADMIN',
      status: 'ACTIVE',
      fullName: 'forged',
    }
    await api.saveDoctor(undefined, draft, signal())
    await api.saveDoctor('2', draft, signal())
    expect(JSON.parse(seen[0].data)).toEqual({
      userId: '21',
      specialtyId: '1',
      doctorCode: 'DR_02',
      licenseNumber: 'LIC-2',
      biography: '',
    })
    expect(JSON.parse(seen[1].data)).toEqual({
      specialtyId: '1',
      doctorCode: 'DR_02',
      licenseNumber: 'LIC-2',
      biography: '',
    })
    expect(seen.every((item) => item.method !== 'delete')).toBe(true)
  })
  it('paginates/searches eligible-users at the approved endpoint without role/status filters', async () => {
    login()
    const { api, seen } = factory(() => ({
      body: pageOf(
        [{ id: '21', fullName: 'DEMO', email: 'demo@example.invalid' }],
        1,
        10,
        11,
      ),
    }))
    const result = await api.doctorUsers(signal(), {
      search: ' demo ',
      page: 1,
      pageSize: 10,
    })
    expect(seen[0].url).toBe('/api/v1/doctors/eligible-users')
    expect(seen[0].params).toEqual({ q: 'demo', page: 1, size: 10 })
    expect(result).toMatchObject({ total: 11, page: 1, totalPages: 2 })
  })
  it('collects all pages for active specialty options, not just the first 20/100', async () => {
    login()
    const { api, seen } = factory((config) => ({
      body: pageOf(
        Array.from({ length: config.params.page === 0 ? 100 : 1 }, (_, i) => ({
          ...specialty,
          id: String(config.params.page * 100 + i + 1),
        })),
        config.params.page,
        100,
        101,
      ),
    }))
    expect(await api.specialtyOptions(signal(), true)).toHaveLength(101)
    expect(seen.map((item) => item.params.page)).toEqual([0, 1])
    expect(seen.every((item) => item.params.isActive === true)).toBe(true)
  })
  it('validates official code/name/text limits and query limits before transport', async () => {
    expect(codeRule(' a_b-1 ')).toBe(true)
    for (const value of ['', '-BAD', 'á', 'A'.repeat(33)])
      expect(codeRule(value)).not.toBe(true)
    expect(
      validateSpecialty({
        code: 'ENT',
        name: 'A'.repeat(121),
        description: 'x'.repeat(5001),
      }),
    ).toHaveProperty('name')
    expect(
      validateDoctor({
        userId: '21',
        specialtyId: '1',
        doctorCode: 'DR',
        licenseNumber: 'x'.repeat(101),
        biography: 'x'.repeat(5001),
      }),
    ).toHaveProperty('licenseNumber')
    login()
    const { api, seen } = factory(() => ({ body: pageOf([]) }))
    await expect(
      api.listDoctors({ ...query, search: 'x'.repeat(121) }, signal()),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      api.listSpecialties({ ...query, pageSize: 101 }, signal()),
    ).rejects.toMatchObject({ status: 400 })
    expect(seen).toHaveLength(0)
  })
  it.each([
    'SPECIALTY_CODE_EXISTS',
    'SPECIALTY_NAME_EXISTS',
    'DOCTOR_CODE_EXISTS',
    'LICENSE_NUMBER_EXISTS',
    'USER_ALREADY_LINKED',
    'USER_NOT_ELIGIBLE',
    'SPECIALTY_INACTIVE',
    'SPECIALTY_HAS_ACTIVE_DOCTORS',
    'SPECIALTY_CONFLICT',
    'DOCTOR_CONFLICT',
    'DOCTOR_CONCURRENT_UPDATE',
  ])('maps 409 %s safely without raw detail', async (code) => {
    login()
    const { api } = factory(() => ({
      status: 409,
      body: { status: 409, code, detail: 'private rejected value' },
    }))
    const failure = await api
      .setActive('doctors', '2', true, signal())
      .catch((error) => error)
    expect(failure).toMatchObject({ status: 409, code })
    expect(directoryMessage(failure)).not.toContain('private')
    expect(failure.fields).not.toHaveProperty('email')
  })
  it('preserves safe catalog field errors from Problem Details and maps 404', async () => {
    login()
    const { api } = factory(() => ({
      status: 400,
      body: {
        status: 400,
        code: 'VALIDATION_FAILED',
        errors: [
          { field: 'doctorCode', message: 'secret' },
          { field: 'password', message: 'secret' },
        ],
      },
    }))
    const failure = await api
      .setActive('doctors', '2', true, signal())
      .catch((error) => error)
    expect(failure.fields.doctorCode).toBeTruthy()
    expect(failure.fields).not.toHaveProperty('password')
    const notFound = factory(() => ({
      status: 404,
      body: { status: 404, code: 'RESOURCE_NOT_FOUND' },
    }))
    await expect(notFound.api.getDoctor('2', signal())).rejects.toMatchObject({
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
    })
  })
  it('uses D02 session handling: 403 keeps auth, 401 clears auth', async () => {
    login()
    const denied = factory(() => ({
      status: 403,
      body: { status: 403, code: 'ACCESS_DENIED' },
    }))
    await expect(denied.api.doctorUsers(signal())).rejects.toMatchObject({
      status: 403,
    })
    expect(getAuthSnapshot().status).toBe('authenticated')
    const expired = factory(() => ({
      status: 401,
      body: { status: 401, code: 'INVALID_ACCESS_TOKEN' },
    }))
    await expect(expired.api.getDoctor('2', signal())).rejects.toMatchObject({
      status: 401,
    })
    expect(getAuthSnapshot()).toMatchObject({
      status: 'anonymous',
      user: null,
      accessToken: null,
    })
  })
  it('discards a response from an old session instead of exposing previous role data', async () => {
    login()
    const { api } = factory(async () => {
      clearSession()
      login('PATIENT')
      return { body: pageOf([doctor]) }
    })
    await expect(api.listDoctors(query, signal())).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})
