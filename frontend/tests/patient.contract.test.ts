import { afterEach, describe, expect, it } from 'vitest'
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { createPatientApi, decodePage, decodePatient } from '../src/patient/api'
import {
  patientCodeRule,
  patientDobRule,
  patientFullNameRule,
  patientPhoneRule,
  validId,
  validatePatient,
} from '../src/patient/model'
import { installAuthInterceptors } from '../src/auth/http'
import {
  beginAuthentication,
  clearSession,
  establishSession,
} from '../src/auth/session-store'
import type { Role } from '../src/auth/types'

const signal = () => new AbortController().signal

const samplePatient = {
  id: '9223372036854775807',
  patientCode: 'BN001',
  fullName: 'Nguyễn Văn An',
  dateOfBirth: '1990-05-15',
  sex: 'MALE',
  phone: '0912345678',
  address: '123 Phố Huế, Hà Nội',
  isActive: true,
  userId: '10',
}

const pageOf = (
  items: unknown[],
  page = 0,
  size = 10,
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
    email: 'admin@clinic.test',
    fullName: 'Admin User',
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

describe('Patient Contract — Models & Validation', () => {
  afterEach(() => {
    clearSession()
  })

  it('validates signed BIGINT strings properly', () => {
    expect(validId('1')).toBe(true)
    expect(validId('9223372036854775807')).toBe(true)
    expect(validId('0')).toBe(false)
    expect(validId('-5')).toBe(false)
    expect(validId('9223372036854775808')).toBe(false)
    expect(validId('abc')).toBe(false)
  })

  it('validates patientCode format rules', () => {
    expect(patientCodeRule('BN001')).toBe(true)
    expect(patientCodeRule('PATIENT_123-X')).toBe(true)
    expect(patientCodeRule('')).not.toBe(true)
    expect(patientCodeRule('_BN001')).not.toBe(true)
    expect(patientCodeRule('A'.repeat(33))).not.toBe(true)
  })

  it('validates patient full name', () => {
    expect(patientFullNameRule('Nguyễn Văn An')).toBe(true)
    expect(patientFullNameRule('   ')).not.toBe(true)
    expect(patientFullNameRule('A'.repeat(121))).not.toBe(true)
  })

  it('validates date of birth format and future constraint', () => {
    expect(patientDobRule('1990-05-15')).toBe(true)
    expect(patientDobRule('')).toBe(true)
    expect(patientDobRule('15-05-1990')).not.toBe(true)
    expect(patientDobRule('2099-01-01')).not.toBe(true)
  })

  it('validates phone and address', () => {
    expect(patientPhoneRule('0912345678')).toBe(true)
    expect(patientPhoneRule('+84 (912) 345-678')).toBe(true)
    expect(patientPhoneRule('abc')).not.toBe(true)
  })

  it('runs complete draft validation', () => {
    const validDraft = {
      patientCode: 'BN001',
      fullName: 'Trần Văn Bình',
      dateOfBirth: '1985-04-12',
      sex: 'MALE' as const,
      phone: '0901234567',
      address: '100 Giải Phóng',
    }
    expect(validatePatient(validDraft)).toEqual({})

    const invalidDraft = {
      ...validDraft,
      patientCode: '',
      fullName: '',
      dateOfBirth: '2099-01-01',
      phone: 'invalid-phone-letters',
      userId: 'not-an-id',
    }
    const errors = validatePatient(invalidDraft)
    expect(errors.patientCode).toBeDefined()
    expect(errors.fullName).toBeDefined()
    expect(errors.dateOfBirth).toBeDefined()
    expect(errors.phone).toBeDefined()
    expect(errors.userId).toBeDefined()
  })

  it('decodes patient correctly and handles null fields', () => {
    const decoded = decodePatient(samplePatient)
    expect(decoded.id).toBe('9223372036854775807')
    expect(decoded.patientCode).toBe('BN001')
    expect(decoded.fullName).toBe('Nguyễn Văn An')
    expect(decoded.sex).toBe('MALE')
    expect(decoded.active).toBe(true)
    expect(decoded.userId).toBe('10')

    const minimal = decodePatient({
      id: '2',
      patientCode: 'BN002',
      fullName: 'Lê Thị C',
      dateOfBirth: null,
      sex: 'FEMALE',
      phone: null,
      address: null,
      isActive: false,
      userId: null,
    })
    expect(minimal.dateOfBirth).toBe('')
    expect(minimal.phone).toBe('')
    expect(minimal.address).toBe('')
    expect(minimal.active).toBe(false)
    expect(minimal.userId).toBeNull()
  })

  it('decodes paginated response correctly', () => {
    const body = pageOf([samplePatient], 0, 10, 1)
    const page = decodePage(body, decodePatient, { page: 0, pageSize: 10 })
    expect(page.items).toHaveLength(1)
    expect(page.page).toBe(0)
    expect(page.pageSize).toBe(10)
    expect(page.total).toBe(1)
    expect(page.totalPages).toBe(1)
  })
})

describe('Patient API — HTTP Endpoints & Problem Details', () => {
  afterEach(() => {
    clearSession()
  })

  it('lists patients with search and filter parameters', async () => {
    login('ADMIN')
    const { client, seen } = mockClient((config) => {
      expect(config.url).toBe('/api/v1/patients')
      expect(config.headers?.Authorization).toMatch(/^Bearer /)
      expect(config.params).toEqual({
        q: 'Nguyen',
        page: 0,
        size: 10,
        isActive: true,
      })
      return { body: pageOf([samplePatient], 0, 10, 1) }
    })

    const api = createPatientApi(client)
    const result = await api.listPatients(
      { search: 'Nguyen', page: 0, pageSize: 10, active: 'active' },
      signal(),
    )

    expect(seen).toHaveLength(1)
    expect(result.items).toHaveLength(1)
    expect(result.items[0].fullName).toBe('Nguyễn Văn An')
  })

  it('gets patient by id', async () => {
    login('RECEPTIONIST')
    const { client } = mockClient((config) => {
      expect(config.url).toBe('/api/v1/patients/1')
      return { body: { data: samplePatient } }
    })

    const api = createPatientApi(client)
    const patient = await api.getPatient('1', signal())
    expect(patient.patientCode).toBe('BN001')
  })

  it('gets patient own profile at /me/patient-profile', async () => {
    login('PATIENT')
    const { client } = mockClient((config) => {
      expect(config.url).toBe('/api/v1/me/patient-profile')
      return { body: { data: samplePatient } }
    })

    const api = createPatientApi(client)
    const patient = await api.getMePatientProfile(signal())
    expect(patient.fullName).toBe('Nguyễn Văn An')
  })

  it('creates a patient with POST /api/v1/patients', async () => {
    login('ADMIN')
    const { client, seen } = mockClient((config) => {
      expect(config.method).toBe('post')
      expect(config.url).toBe('/api/v1/patients')
      const payload =
        typeof config.data === 'string' ? JSON.parse(config.data) : config.data
      expect(payload).toEqual({
        patientCode: 'BN001',
        fullName: 'Nguyễn Văn An',
        dateOfBirth: '1990-05-15',
        sex: 'MALE',
        phone: '0912345678',
        address: '123 Phố Huế, Hà Nội',
        userId: '10',
      })
      return { body: { data: samplePatient }, status: 201 }
    })

    const api = createPatientApi(client)
    const created = await api.savePatient(
      undefined,
      {
        patientCode: 'bn001',
        fullName: '  Nguyễn Văn An  ',
        dateOfBirth: '1990-05-15',
        sex: 'MALE',
        phone: '0912345678',
        address: '123 Phố Huế, Hà Nội',
        userId: '10',
      },
      signal(),
    )

    expect(seen).toHaveLength(1)
    expect(created.patientCode).toBe('BN001')
  })

  it('updates a patient with PATCH /api/v1/patients/{id}', async () => {
    login('RECEPTIONIST')
    const { client } = mockClient((config) => {
      expect(config.method).toBe('patch')
      expect(config.url).toBe('/api/v1/patients/1')
      return { body: { data: samplePatient }, status: 200 }
    })

    const api = createPatientApi(client)
    const updated = await api.savePatient(
      '1',
      {
        patientCode: 'BN001',
        fullName: 'Nguyễn Văn An',
        dateOfBirth: '1990-05-15',
        sex: 'MALE',
        phone: '0912345678',
        address: '123 Phố Huế, Hà Nội',
      },
      signal(),
    )

    expect(updated.fullName).toBe('Nguyễn Văn An')
  })

  it('toggles patient active state without DELETE (no hard delete)', async () => {
    login('ADMIN')
    const { client, seen } = mockClient((config) => {
      expect(config.method).toBe('patch')
      expect(config.url).toBe('/api/v1/patients/1')
      const payload =
        typeof config.data === 'string' ? JSON.parse(config.data) : config.data
      expect(payload).toEqual({ isActive: false })
      return {
        body: { data: { ...samplePatient, isActive: false } },
        status: 200,
      }
    })

    const api = createPatientApi(client)
    await api.setActive('1', false, signal())
    expect(seen).toHaveLength(1)
  })

  it('handles 409 PATIENT_CODE_EXISTS problem details', async () => {
    login('ADMIN')
    const { client } = mockClient(() => ({
      status: 409,
      body: {
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: 'Patient code already exists.',
        instance: '/api/v1/patients',
        code: 'PATIENT_CODE_EXISTS',
      },
    }))

    const api = createPatientApi(client)
    await expect(
      api.savePatient(
        undefined,
        {
          patientCode: 'BN001',
          fullName: 'Nguyễn Văn An',
          dateOfBirth: '1990-05-15',
          sex: 'MALE',
          phone: '',
          address: '',
        },
        signal(),
      ),
    ).rejects.toMatchObject({
      code: 'PATIENT_CODE_EXISTS',
      status: 409,
      fields: { patientCode: 'Mã bệnh nhân đã tồn tại trong hệ thống.' },
    })
  })
})
