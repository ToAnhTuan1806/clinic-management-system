import { afterEach, describe, expect, it } from 'vitest'
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { createProfileApi, decodeUserProfile } from '../src/profile/api'
import {
  profileFullNameRule,
  profilePhoneRule,
  validateProfile,
  type ProfileDraft,
} from '../src/profile/model'
import { installAuthInterceptors } from '../src/auth/http'
import {
  beginAuthentication,
  clearSession,
  establishSession,
} from '../src/auth/session-store'
import type { Role } from '../src/auth/types'

const signal = () => new AbortController().signal

const sampleProfile = {
  id: '10',
  email: 'doctor@clinic.test',
  fullName: 'Bác Sĩ Nguyễn',
  role: 'DOCTOR',
  status: 'ACTIVE',
  phone: '0912345678',
  address: '123 Giải Phóng, Hà Nội',
}

function login(role: Role = 'DOCTOR', id = '10') {
  establishSession(beginAuthentication(), crypto.randomUUID(), {
    id,
    role,
    email: `${role.toLowerCase()}@clinic.test`,
    fullName: `User ${role}`,
  })
}

function mockClient(
  handler: (
    config: InternalAxiosRequestConfig,
  ) =>
    | { body: unknown; status?: number }
    | Promise<{ body: unknown; status?: number }>,
) {
  const seen: InternalAxiosRequestConfig[] = []
  const client = axios.create({
    baseURL: 'https://api.clinic.test',
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
      if (status >= 400) {
        throw new AxiosError(
          'HTTP Error',
          undefined,
          config,
          undefined,
          response,
        )
      }
      return response
    },
  })
  installAuthInterceptors(client, () => true)
  return { client, seen }
}

describe('Personal Profile — Models & Validation (FR-02)', () => {
  it('validates full name requirement', () => {
    expect(profileFullNameRule('Nguyễn Văn B')).toBe(true)
    expect(profileFullNameRule('   ')).not.toBe(true)
    expect(profileFullNameRule('A'.repeat(121))).not.toBe(true)
  })

  it('validates phone format', () => {
    expect(profilePhoneRule('')).toBe(true)
    expect(profilePhoneRule('0987654321')).toBe(true)
    expect(profilePhoneRule('invalid-phone')).not.toBe(true)
    expect(profilePhoneRule('0'.repeat(25))).not.toBe(true)
  })

  it('validates profile draft', () => {
    const valid: ProfileDraft = {
      fullName: 'Trần Thị Mai',
      phone: '0912345678',
      address: 'Hà Nội',
    }
    expect(validateProfile(valid)).toEqual({})

    const invalid: ProfileDraft = {
      fullName: '',
      phone: 'bad-phone',
      address: 'A'.repeat(256),
    }
    const errors = validateProfile(invalid)
    expect(errors.fullName).toBeDefined()
    expect(errors.phone).toBeDefined()
    expect(errors.address).toBeDefined()
  })

  it('decodes user profile correctly with read-only fields intact', () => {
    const decoded = decodeUserProfile(sampleProfile)
    expect(decoded.id).toBe('10')
    expect(decoded.email).toBe('doctor@clinic.test')
    expect(decoded.fullName).toBe('Bác Sĩ Nguyễn')
    expect(decoded.role).toBe('DOCTOR')
    expect(decoded.status).toBe('ACTIVE')
    expect(decoded.phone).toBe('0912345678')
    expect(decoded.address).toBe('123 Giải Phóng, Hà Nội')
  })
})

describe('Personal Profile — HTTP Transport (FR-02)', () => {
  afterEach(() => {
    clearSession()
  })

  it('gets profile with GET /api/v1/me/profile', async () => {
    login('DOCTOR')
    const { client, seen } = mockClient((config) => {
      expect(config.url).toBe('/api/v1/me/profile')
      expect(config.headers?.Authorization).toMatch(/^Bearer /)
      return { body: { data: sampleProfile } }
    })

    const api = createProfileApi(client)
    const profile = await api.getProfile(signal())
    expect(seen).toHaveLength(1)
    expect(profile.fullName).toBe('Bác Sĩ Nguyễn')
    expect(profile.email).toBe('doctor@clinic.test')
  })

  it('updates profile with PATCH /api/v1/me/profile and never sends password or read-only role/email/status', async () => {
    login('DOCTOR')
    const { client, seen } = mockClient((config) => {
      expect(config.method).toBe('patch')
      expect(config.url).toBe('/api/v1/me/profile')
      const payload =
        typeof config.data === 'string' ? JSON.parse(config.data) : config.data
      // Ensure only allowed contact fields are sent
      expect(payload).toEqual({
        fullName: 'Bác Sĩ Nguyễn Văn',
        phone: '0988776655',
        address: 'Hà Nội Mới',
      })
      expect(payload.password).toBeUndefined()
      expect(payload.role).toBeUndefined()
      expect(payload.email).toBeUndefined()
      expect(payload.status).toBeUndefined()
      return {
        body: {
          data: {
            ...sampleProfile,
            fullName: 'Bác Sĩ Nguyễn Văn',
            phone: '0988776655',
            address: 'Hà Nội Mới',
          },
        },
        status: 200,
      }
    })

    const api = createProfileApi(client)
    const updated = await api.updateProfile(
      {
        fullName: '  Bác Sĩ Nguyễn Văn  ',
        phone: '0988776655',
        address: 'Hà Nội Mới',
      },
      signal(),
    )

    expect(seen).toHaveLength(1)
    expect(updated.fullName).toBe('Bác Sĩ Nguyễn Văn')
    expect(updated.phone).toBe('0988776655')
  })

  it('parses Problem Details errors on profile update failure', async () => {
    login('DOCTOR')
    const { client } = mockClient(() => ({
      status: 400,
      body: {
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        detail: 'Validation failed',
        instance: '/api/v1/me/profile',
        code: 'VALIDATION_FAILED',
        fields: {
          fullName: 'Họ và tên không hợp lệ.',
        },
      },
    }))

    const api = createProfileApi(client)
    await expect(
      api.updateProfile(
        {
          fullName: 'Bác Sĩ',
          phone: '',
          address: '',
        },
        signal(),
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    })
  })
})
