import { afterEach, describe, expect, it } from 'vitest'
import { createPatientMock } from '../src/testing/patient-mock'
import {
  beginAuthentication,
  clearSession,
  establishSession,
} from '../src/auth/session-store'
import type { Role } from '../src/auth/types'

const signal = () => new AbortController().signal

function login(role: Role = 'ADMIN', id = '10') {
  establishSession(beginAuthentication(), crypto.randomUUID(), {
    id,
    role,
    email: `${role.toLowerCase()}@clinic.test`,
    fullName: `User ${role}`,
  })
}

describe('Patient Mock Gateway — Role Scoping & Operations', () => {
  afterEach(() => {
    clearSession()
  })

  it('allows ADMIN and RECEPTIONIST to list patients', async () => {
    const mock = createPatientMock()

    login('ADMIN')
    const adminResult = await mock.listPatients(
      { search: '', page: 0, pageSize: 10, active: 'all' },
      signal(),
    )
    expect(adminResult.items.length).toBeGreaterThan(0)

    login('RECEPTIONIST')
    const recepResult = await mock.listPatients(
      { search: '', page: 0, pageSize: 10, active: 'all' },
      signal(),
    )
    expect(recepResult.items.length).toBeGreaterThan(0)
  })

  it('rejects DOCTOR from listing all patients with 403', async () => {
    const mock = createPatientMock()
    login('DOCTOR')
    await expect(
      mock.listPatients(
        { search: '', page: 0, pageSize: 10, active: 'all' },
        signal(),
      ),
    ).rejects.toMatchObject({
      code: 'ACCESS_DENIED',
      status: 403,
    })
  })

  it('rejects PATIENT from listing all patients with 403', async () => {
    const mock = createPatientMock()
    login('PATIENT')
    await expect(
      mock.listPatients(
        { search: '', page: 0, pageSize: 10, active: 'all' },
        signal(),
      ),
    ).rejects.toMatchObject({
      code: 'ACCESS_DENIED',
      status: 403,
    })
  })

  it('filters patients by active status', async () => {
    const mock = createPatientMock()
    login('ADMIN')

    const activeList = await mock.listPatients(
      { search: '', page: 0, pageSize: 10, active: 'active' },
      signal(),
    )
    expect(activeList.items.every((p) => p.active)).toBe(true)

    const inactiveList = await mock.listPatients(
      { search: '', page: 0, pageSize: 10, active: 'inactive' },
      signal(),
    )
    expect(inactiveList.items.every((p) => !p.active)).toBe(true)
  })

  it('searches patients by patientCode, name, or phone', async () => {
    const mock = createPatientMock()
    login('ADMIN')

    const byCode = await mock.listPatients(
      { search: 'BN000001', page: 0, pageSize: 10, active: 'all' },
      signal(),
    )
    expect(byCode.items).toHaveLength(1)
    expect(byCode.items[0].patientCode).toBe('BN000001')

    const byName = await mock.listPatients(
      { search: 'Bình', page: 0, pageSize: 10, active: 'all' },
      signal(),
    )
    expect(byName.items.some((p) => p.fullName.includes('Bình'))).toBe(true)

    const byPhone = await mock.listPatients(
      { search: '0912345678', page: 0, pageSize: 10, active: 'all' },
      signal(),
    )
    expect(byPhone.items).toHaveLength(1)
  })

  it('supports pagination', async () => {
    const mock = createPatientMock()
    login('ADMIN')

    const page1 = await mock.listPatients(
      { search: '', page: 0, pageSize: 2, active: 'all' },
      signal(),
    )
    expect(page1.items).toHaveLength(2)
    expect(page1.totalPages).toBeGreaterThan(1)

    const page2 = await mock.listPatients(
      { search: '', page: 1, pageSize: 2, active: 'all' },
      signal(),
    )
    expect(page2.items).toHaveLength(2)
    expect(page2.items[0].id).not.toBe(page1.items[0].id)
  })

  it('retrieves patient by id and enforces 404 for missing', async () => {
    const mock = createPatientMock()
    login('ADMIN')

    const patient = await mock.getPatient('1', signal())
    expect(patient.id).toBe('1')

    await expect(mock.getPatient('9999', signal())).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      status: 404,
    })
  })

  it('allows PATIENT to get their own linked profile via getMePatientProfile', async () => {
    const mock = createPatientMock()
    login('PATIENT', '10') // initial data has patient linked to userId 10

    const profile = await mock.getMePatientProfile(signal())
    expect(profile.userId).toBe('10')
    expect(profile.patientCode).toBe('BN000001')
  })

  it('returns 404 when PATIENT has no linked patient profile', async () => {
    const mock = createPatientMock()
    login('PATIENT', '999') // unlinked user

    await expect(mock.getMePatientProfile(signal())).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      status: 404,
    })
  })

  it('creates patient and prevents duplicate patientCode with 409', async () => {
    const mock = createPatientMock()
    login('RECEPTIONIST')

    const created = await mock.savePatient(
      undefined,
      {
        patientCode: 'BN999999',
        fullName: 'Hoàng Văn Mới',
        dateOfBirth: '1995-12-01',
        sex: 'MALE',
        phone: '0977889900',
        address: 'Hà Nội',
      },
      signal(),
    )
    expect(created.patientCode).toBe('BN999999')
    expect(created.active).toBe(true)

    // Attempt duplicate creation
    await expect(
      mock.savePatient(
        undefined,
        {
          patientCode: 'bn999999',
          fullName: 'Người Trùng Mã',
          dateOfBirth: '1990-01-01',
          sex: 'FEMALE',
          phone: '0988112233',
          address: 'Hải Phòng',
        },
        signal(),
      ),
    ).rejects.toMatchObject({
      code: 'PATIENT_CODE_EXISTS',
      status: 409,
    })
  })

  it('updates patient information', async () => {
    const mock = createPatientMock()
    login('ADMIN')

    const updated = await mock.savePatient(
      '1',
      {
        patientCode: 'BN000001',
        fullName: 'Nguyễn Văn An Cập Nhật',
        dateOfBirth: '1985-04-12',
        sex: 'MALE',
        phone: '0999888777',
        address: 'Địa chỉ mới',
      },
      signal(),
    )

    expect(updated.fullName).toBe('Nguyễn Văn An Cập Nhật')
    expect(updated.phone).toBe('0999888777')
  })

  it('toggles patient active state without hard delete', async () => {
    const mock = createPatientMock()
    login('ADMIN')

    await mock.setActive('1', false, signal())
    const patient = await mock.getPatient('1', signal())
    expect(patient.active).toBe(false)

    await mock.setActive('1', true, signal())
    const reactivated = await mock.getPatient('1', signal())
    expect(reactivated.active).toBe(true)
  })
})
