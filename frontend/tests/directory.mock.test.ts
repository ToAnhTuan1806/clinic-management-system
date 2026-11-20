// MOCK / provisional FE model tests only, NOT D03 wire contract or real integration.
import { afterEach, describe, expect, it } from 'vitest'
import {
  beginAuthentication,
  clearSession,
  establishSession,
} from '../src/auth/session-store'
import type { Role } from '../src/auth/types'
import { pendingDirectoryGateway } from '../src/directory/gateway'
import { createDirectoryMock } from '../src/testing/directory-mock'
import {
  directoryMessage,
  validateDoctor,
  validateSpecialty,
  type DirectoryQuery,
} from '../src/directory/model'

const query: DirectoryQuery = {
  search: '',
  active: 'all',
  page: 0,
  pageSize: 50,
  specialtyId: '',
}
const signal = () => new AbortController().signal
function login(role: Role, id = 'demo-doctor-user-1') {
  establishSession(beginAuthentication(), crypto.randomUUID(), {
    id,
    role,
    fullName: 'DEMO QA',
    email: 'demo@example.invalid',
  })
}
afterEach(() => clearSession())

describe('D03 pending connection — no invented API contract', () => {
  it('blocks every operation without falling back to demo data', async () => {
    const gateway = pendingDirectoryGateway
    expect(gateway.mode).toBe('pending')
    for (const operation of [
      gateway.listDoctors(query, signal()),
      gateway.listSpecialties(query, signal()),
      gateway.specialtyOptions(signal(), true),
      gateway.doctorUsers(signal()),
      gateway.saveSpecialty(
        undefined,
        { name: 'DEMO', description: '' },
        signal(),
      ),
      gateway.saveDoctor(
        undefined,
        { userId: 'demo', specialtyId: 'demo', biography: '' },
        signal(),
      ),
      gateway.setActive('doctors', 'demo', false, signal()),
    ])
      await expect(operation).rejects.toMatchObject({
        code: 'D03_CONTRACT_PENDING',
      })
  })
})
describe('D03 MOCK — UI gateway behavior, not Backend permissions', () => {
  it('supports admin create/edit/status without hard delete and trims specialty inputs', async () => {
    login('ADMIN')
    const gateway = createDirectoryMock({ latency: 0 })
    await gateway.saveSpecialty(
      undefined,
      { name: ' DEMO QA new ', description: ' Test ' },
      signal(),
    )
    const created = (
      await gateway.listSpecialties(
        { ...query, search: 'DEMO QA new' },
        signal(),
      )
    ).items[0]
    expect(created).toMatchObject({
      name: 'DEMO QA new',
      description: 'Test',
      active: true,
    })
    await gateway.saveSpecialty(
      created.id,
      { name: 'DEMO QA edited', description: '' },
      signal(),
    )
    await gateway.setActive('specialties', created.id, false, signal())
    expect(
      (
        await gateway.listSpecialties(
          { ...query, search: 'DEMO QA edited' },
          signal(),
        )
      ).items[0].active,
    ).toBe(false)
    expect('delete' in gateway).toBe(false)
  })
  it('validates required names and duplicates on create and edit', async () => {
    login('ADMIN')
    const gateway = createDirectoryMock({ latency: 0 })
    expect(validateSpecialty({ name: '  ', description: '' }).name).toBeTruthy()
    await expect(
      gateway.saveSpecialty(
        undefined,
        { name: ' ', description: '' },
        signal(),
      ),
    ).rejects.toMatchObject({ status: 400 })
    const rows = (await gateway.listSpecialties(query, signal())).items
    await expect(
      gateway.saveSpecialty(
        undefined,
        { name: rows[0].name, description: '' },
        signal(),
      ),
    ).rejects.toMatchObject({ status: 409 })
    await expect(
      gateway.saveSpecialty(
        rows[1].id,
        { name: rows[0].name, description: '' },
        signal(),
      ),
    ).rejects.toMatchObject({ status: 409 })
  })
  it('searches, filters and paginates from the filtered total', async () => {
    login('ADMIN')
    const gateway = createDirectoryMock({ latency: 0 })
    const first = await gateway.listDoctors(
      { ...query, pageSize: 10 },
      signal(),
    )
    const second = await gateway.listDoctors(
      { ...query, pageSize: 10, page: 1 },
      signal(),
    )
    expect(first.items).toHaveLength(10)
    expect(second.items).toHaveLength(2)
    expect(second.total).toBe(12)
    expect(
      (await gateway.listDoctors({ ...query, search: 'bác sĩ 01' }, signal()))
        .items,
    ).toHaveLength(1)
    expect(
      (
        await gateway.listDoctors(
          { ...query, specialtyId: 'demo-specialty-1', active: 'active' },
          signal(),
        )
      ).items.every(
        (item) => item.active && item.specialtyId === 'demo-specialty-1',
      ),
    ).toBe(true)
  })
  it('offers only active unlinked DOCTOR users and active specialty choices for editing', async () => {
    login('ADMIN')
    const gateway = createDirectoryMock({ latency: 0 })
    const users = await gateway.doctorUsers(signal())
    expect(users).toHaveLength(3)
    expect(
      users.every(
        (item) => item.active && item.role === 'DOCTOR' && !item.linked,
      ),
    ).toBe(true)
    expect(
      (await gateway.specialtyOptions(signal(), true)).every(
        (item) => item.active,
      ),
    ).toBe(true)
    expect(
      (await gateway.specialtyOptions(signal(), false)).some(
        (item) => !item.active,
      ),
    ).toBe(true)
  })
  it('creates and edits a doctor using eligible user/specialty options, prevents duplicate linking', async () => {
    login('ADMIN')
    const gateway = createDirectoryMock({ latency: 0 })
    const user = (await gateway.doctorUsers(signal()))[0]
    const choices = await gateway.specialtyOptions(signal(), true)
    const draft = {
      userId: user.id,
      specialtyId: choices[0].id,
      biography: 'DEMO biography',
    }
    await gateway.saveDoctor(undefined, draft, signal())
    const doctor = (
      await gateway.listDoctors({ ...query, search: user.fullName }, signal())
    ).items[0]
    expect(doctor.userId).toBe(user.id)
    await gateway.saveDoctor(
      doctor.id,
      { ...draft, specialtyId: choices[1].id, biography: 'DEMO updated' },
      signal(),
    )
    await gateway.setActive('doctors', doctor.id, false, signal())
    expect(
      (await gateway.listDoctors({ ...query, search: user.fullName }, signal()))
        .items[0],
    ).toMatchObject({
      biography: 'DEMO updated',
      active: false,
      specialtyId: choices[1].id,
    })
    await expect(
      gateway.saveDoctor(undefined, draft, signal()),
    ).rejects.toMatchObject({ status: 400 })
  })
  it('rejects stale/inactive/unknown options and revalidates specialty on submit', async () => {
    login('ADMIN')
    const gateway = createDirectoryMock({ latency: 0 })
    expect(
      Object.keys(
        validateDoctor({ userId: '', specialtyId: '', biography: '' }),
      ),
    ).toHaveLength(2)
    await expect(
      gateway.saveDoctor(
        undefined,
        { userId: 'unknown', specialtyId: 'demo-specialty-3', biography: '' },
        signal(),
      ),
    ).rejects.toMatchObject({
      status: 400,
      fields: { userId: expect.any(String), specialtyId: expect.any(String) },
    })
    const specialty = (await gateway.specialtyOptions(signal(), true))[0]
    const user = (await gateway.doctorUsers(signal()))[0]
    await gateway.setActive('specialties', specialty.id, false, signal())
    await expect(
      gateway.saveDoctor(
        undefined,
        { userId: user.id, specialtyId: specialty.id, biography: '' },
        signal(),
      ),
    ).rejects.toMatchObject({ status: 400 })
  })
  it.each(['RECEPTIONIST', 'DOCTOR', 'PATIENT'] as Role[])(
    '%s cannot mutate even through the mock gateway directly',
    async (role) => {
      login(role)
      const gateway = createDirectoryMock({ latency: 0 })
      await expect(
        gateway.saveSpecialty(
          undefined,
          { name: 'DEMO', description: '' },
          signal(),
        ),
      ).rejects.toMatchObject({ status: 403 })
      await expect(
        gateway.saveDoctor(
          undefined,
          { userId: '', specialtyId: '', biography: '' },
          signal(),
        ),
      ).rejects.toMatchObject({ status: 403 })
      await expect(
        gateway.setActive('doctors', 'demo-doctor-1', false, signal()),
      ).rejects.toMatchObject({ status: 403 })
      await expect(gateway.doctorUsers(signal())).rejects.toMatchObject({
        status: 403,
      })
    },
  )
  it('receptionist reads the directory while doctor only sees their own linked profile', async () => {
    const gateway = createDirectoryMock({ latency: 0 })
    login('RECEPTIONIST')
    expect((await gateway.listDoctors(query, signal())).total).toBe(12)
    login('DOCTOR')
    expect(
      (await gateway.listDoctors(query, signal())).items.map(
        (item) => item.userId,
      ),
    ).toEqual(['demo-doctor-user-1'])
    login('DOCTOR', 'unlinked')
    expect((await gateway.listDoctors(query, signal())).total).toBe(0)
  })
  it('patient sees only active doctors whose specialties are active, including option lists', async () => {
    login('PATIENT')
    const gateway = createDirectoryMock({ latency: 0 })
    expect(
      (await gateway.listDoctors(query, signal())).items.every(
        (item) => item.active && item.specialtyActive,
      ),
    ).toBe(true)
    expect(
      (await gateway.listSpecialties(query, signal())).items.every(
        (item) => item.active,
      ),
    ).toBe(true)
    expect(
      (await gateway.specialtyOptions(signal(), false)).every(
        (item) => item.active,
      ),
    ).toBe(true)
  })
  it('does not apply delayed mutations after abort or logout', async () => {
    login('ADMIN')
    const gateway = createDirectoryMock({ latency: 20 })
    const controller = new AbortController()
    const aborted = gateway.saveSpecialty(
      undefined,
      { name: 'DEMO cancelled', description: '' },
      controller.signal,
    )
    controller.abort()
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' })
    const loggedOut = gateway.setActive(
      'doctors',
      'demo-doctor-1',
      false,
      signal(),
    )
    clearSession()
    await expect(loggedOut).rejects.toMatchObject({ status: 401 })
    login('ADMIN')
    expect((await gateway.listDoctors(query, signal())).items[0].active).toBe(
      true,
    )
    expect(
      (
        await gateway.listSpecialties(
          { ...query, search: 'cancelled' },
          signal(),
        )
      ).total,
    ).toBe(0)
  })
  it('returns safe errors without reflecting raw exceptions', () => {
    expect(directoryMessage(new Error('private server payload'))).not.toContain(
      'private',
    )
  })
})
