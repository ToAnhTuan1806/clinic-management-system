// API MOCK TESTS ONLY — isolated transport fixtures, no live backend requests.
import { afterEach, describe, expect, it } from 'vitest'
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { createAuthApi } from '../src/auth/api'
import { installAuthInterceptors } from '../src/auth/http'
import { normalizeAuthError } from '../src/auth/errors'
import {
  beginAuthentication,
  clearSession,
  establishSession,
  getAuthSnapshot,
} from '../src/auth/session-store'
import { mockAuthContract } from '../src/testing/mock-auth-contract'
import { canAccessPath, roleHome } from '../src/lib/navigation'
import {
  emailRules,
  nameRules,
  registerPasswordRules,
} from '../src/auth/validation'
import type { Role } from '../src/auth/types'

const user = (role: Role = 'PATIENT') => ({
  id: 'mock-user',
  fullName: 'DEMO',
  email: 'demo@clinic.test',
  role,
})
function authenticate(role: Role = 'PATIENT') {
  const version = beginAuthentication()
  establishSession(version, crypto.randomUUID(), user(role))
  return version
}
function mockClient(
  handler: (
    config: InternalAxiosRequestConfig,
  ) =>
    | { status?: number; body: unknown }
    | Promise<{ status?: number; body: unknown }>,
) {
  const client = axios.create({
    baseURL: 'https://api.clinic.test',
    adapter: async (config) => {
      const { status = 200, body } = await handler(config)
      const response = {
        status,
        statusText: 'MOCK',
        headers: {},
        config,
        data: body,
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
  return client
}
afterEach(() => clearSession())

describe('MOCK — auth API and transport', () => {
  it('uses the exact requested endpoints and data envelope; /me receives candidate Bearer', async () => {
    const seen: string[] = []
    const candidate = crypto.randomUUID()
    let bearerMatches = false
    const api = createAuthApi(
      mockClient((config) => {
        seen.push(`${config.method} ${config.url}`)
        if (config.url?.endsWith('/login'))
          return { body: { data: { accessToken: candidate } } }
        bearerMatches =
          config.headers.get('Authorization') === `Bearer ${candidate}`
        return { body: { data: user() } }
      }),
      mockAuthContract,
    )
    const token = await api.login({
      email: 'demo@clinic.test',
      password: 'DemoOnly123',
    })
    const result = await api.me(token)
    expect(seen).toEqual(['post /api/v1/auth/login', 'get /api/v1/auth/me'])
    expect(bearerMatches).toBe(true)
    expect(result.role).toBe('PATIENT')
    expect(getAuthSnapshot().status).toBe('anonymous')
  })
  it('public registration strips role, confirmation and arbitrary fields', async () => {
    let keys: string[] = []
    let bearerAbsent = false
    authenticate('ADMIN')
    const api = createAuthApi(
      mockClient((config) => {
        keys = Object.keys(JSON.parse(config.data))
        bearerAbsent = !config.headers.has('Authorization')
        expect(config.url).toBe('/api/v1/auth/register')
        return {
          status: 201,
          body: { data: { id: 'mock-patient', role: 'PATIENT' } },
        }
      }),
      mockAuthContract,
    )
    await api.register({
      fullName: 'DEMO',
      email: 'demo@clinic.test',
      password: 'DemoOnly123',
      ...{ role: 'ADMIN', confirmPassword: 'DemoOnly123' },
    })
    expect(keys.sort()).toEqual(['email', 'fullName', 'password'])
    expect(bearerAbsent).toBe(true)
  })
  it.each([
    { accessToken: 'outside-envelope' },
    { data: {} },
    { data: { accessToken: '' } },
  ])('rejects malformed login success', (body) => {
    expect(() => mockAuthContract.decodeAccessToken(body)).toThrow(
      'Phản hồi xác thực không hợp lệ',
    )
  })
  it('rejects unknown roles and elevated registration responses', () => {
    expect(() =>
      mockAuthContract.decodeUser({ data: { ...user(), role: 'SUPERUSER' } }),
    ).toThrow()
    expect(() =>
      mockAuthContract.decodeRegistration({
        data: { id: 'mock-id', role: 'ADMIN' },
      }),
    ).toThrow()
  })
  it('adds session Bearer and expires memory on 401', async () => {
    authenticate()
    let bearerPresent = false
    const client = mockClient((config) => {
      bearerPresent = config.headers.has('Authorization')
      return {
        status: 401,
        body: { status: 401, code: 'AUTHENTICATION_REQUIRED' },
      }
    })
    await expect(client.get('/api/v1/auth/me')).rejects.toMatchObject({
      status: 401,
    })
    expect(bearerPresent).toBe(true)
    expect(getAuthSnapshot()).toMatchObject({
      status: 'anonymous',
      user: null,
      accessToken: null,
      notice: 'expired',
    })
  })
  it('keeps session on 403 and exposes a permission notice', async () => {
    authenticate()
    const client = mockClient(() => ({
      status: 403,
      body: { status: 403, code: 'ACCESS_DENIED' },
    }))
    await expect(client.get('/api/v1/auth/me')).rejects.toMatchObject({
      status: 403,
    })
    expect(getAuthSnapshot()).toMatchObject({
      status: 'authenticated',
      notice: 'forbidden',
    })
  })
  it('ignores a stale 401 from a previous session', async () => {
    authenticate('PATIENT')
    let release!: () => void
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    const wait = new Promise<void>((resolve) => {
      release = resolve
    })
    const client = mockClient(async () => {
      started()
      await wait
      return {
        status: 401,
        body: { status: 401, code: 'AUTHENTICATION_REQUIRED' },
      }
    })
    const oldRequest = client.get('/api/v1/auth/me').catch(() => undefined)
    await ready
    clearSession()
    authenticate('DOCTOR')
    release()
    await oldRequest
    expect(getAuthSnapshot().user?.role).toBe('DOCTOR')
    expect(getAuthSnapshot().status).toBe('authenticated')
  })
  it('does not restore a session after logout during authentication', () => {
    const version = beginAuthentication()
    clearSession()
    expect(establishSession(version, crypto.randomUUID(), user())).toBe(false)
    expect(getAuthSnapshot().accessToken).toBeNull()
  })
  it('blocks Bearer forwarding to another origin', async () => {
    authenticate()
    let adapterCalled = false
    const client = mockClient(() => {
      adapterCalled = true
      return { body: {} }
    })
    await expect(
      client.get('https://other.clinic.test/api/v1/auth/me'),
    ).rejects.toMatchObject({ code: 'INVALID_API_TARGET' })
    expect(adapterCalled).toBe(false)
  })
  it('maps Problem Details without exposing raw values or Axios config', () => {
    const response = {
      status: 400,
      data: {
        status: 400,
        code: 'VALIDATION_FAILED',
        detail: 'private-raw-value',
        errors: [{ field: 'email', message: 'private-raw-value' }],
      },
    }
    const problem = normalizeAuthError(
      new AxiosError(
        'private-raw-value',
        undefined,
        undefined,
        undefined,
        response as never,
      ),
    )
    expect(problem.fields.email).toBeTruthy()
    expect(problem.message.includes('private-raw-value')).toBe(false)
    expect('config' in problem).toBe(false)
  })
  it('maps duplicate email, network, timeout and server errors safely', () => {
    expect(normalizeAuthError(new AxiosError('network')).message).toContain(
      'Kiểm tra mạng',
    )
    for (const status of [409, 429, 503]) {
      const error = new AxiosError('MOCK', undefined, undefined, undefined, {
        status,
        data: { status },
      } as never)
      expect(normalizeAuthError(error).status).toBe(status)
    }
  })
})

describe('MOCK — FE routing policy and D02 validation', () => {
  it('sends PATIENT to booking and staff to dashboard', () => {
    expect(roleHome('PATIENT')).toBe('/booking')
    for (const role of ['ADMIN', 'DOCTOR', 'RECEPTIONIST'] as const)
      expect(roleHome(role)).toBe('/dashboard')
  })
  it('guards direct URLs and rejects arbitrary return destinations', () => {
    expect(canAccessPath('PATIENT', '/dashboard')).toBe(false)
    expect(canAccessPath('PATIENT', '/patients')).toBe(false)
    expect(canAccessPath('DOCTOR', '/patients')).toBe(false)
    expect(canAccessPath('RECEPTIONIST', '/medical-records')).toBe(false)
    expect(canAccessPath('ADMIN', '/patients')).toBe(true)
    expect(canAccessPath('PATIENT', '//other.clinic.test')).toBe(false)
  })
  it('validates client fields against the D02 limits', () => {
    expect(emailRules.validate('invalid')).not.toBe(true)
    expect(emailRules.validate(' demo@clinic.test ')).toBe(true)
    expect(nameRules.validate('   ')).not.toBe(true)
    expect(registerPasswordRules.minLength.value).toBe(12)
  })
})
