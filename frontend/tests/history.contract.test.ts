import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AxiosInstance } from 'axios'
import {
  beginAuthentication,
  clearSession,
  establishSession,
} from '@/auth/session-store'
import type { Role } from '@/auth/types'
import { createHistoryApi } from '@/history/api'

const signal = () => new AbortController().signal

function login(role: Role) {
  establishSession(beginAuthentication(), 'mock-token', {
    id: '50',
    fullName: 'Test User',
    email: 'test@example.com',
    role,
  })
}

function createAxiosError(status: number, message = 'Request failed') {
  const error = new Error(message) as any
  error.isAxiosError = true
  error.response = { status, data: { status, message } }
  return error
}

describe('D11 Real Medical History & Release Contract API', () => {
  it('filters calendar dates in Vietnam rather than UTC', async () => {
    login('DOCTOR')
    const client = { get: vi.fn(), post: vi.fn() }
    client.get.mockImplementation(async (url: string) => ({
      data: {
        data: url.includes('/medical-history')
          ? {
              items: [
                {
                  id: '1',
                  appointmentId: '1',
                  completedAt: '2026-11-22T01:00:00Z',
                  version: 1,
                },
              ],
              totalElements: 1,
            }
          : {
              doctorFullName: 'Synthetic doctor',
              startAt: '2026-11-21T20:00:00Z',
            },
      },
    }))
    const result = await createHistoryApi(
      client as unknown as AxiosInstance,
    ).list(
      '1',
      {
        page: 0,
        search: '',
        from: '2026-11-22',
        to: '2026-11-22',
        publication: 'ALL',
      },
      signal(),
    )
    expect(result.items).toHaveLength(1)
  })

  it('reuses metadata only within the current authenticated session', async () => {
    login('DOCTOR')
    let calls = 0
    const client = { get: vi.fn(), post: vi.fn() }
    client.get.mockImplementation(async (url: string) => ({
      data: {
        data: url.includes('/medical-history')
          ? {
              items: [
                {
                  id: '1',
                  appointmentId: '1',
                  doctorId: '2',
                  completedAt: '2026-11-22T01:00:00Z',
                  releasedAt: '2026-11-22T02:00:00Z',
                  version: 1,
                },
              ],
              totalElements: 1,
            }
          : {
              doctorFullName: 'Synthetic ' + ++calls,
              startAt: '2026-11-22T01:00:00Z',
            },
      },
    }))
    const api = createHistoryApi(client as unknown as AxiosInstance)
    const query = {
      page: 0,
      search: '',
      from: '',
      to: '',
      publication: 'ALL' as const,
    }
    await api.list('1', query, signal())
    await api.list('1', query, signal())
    expect(calls).toBe(1)
    login('PATIENT')
    expect((await api.list('1', query, signal())).items[0].doctorName).toBe(
      'Synthetic 2',
    )
  })
  it('discovers patients beyond appointment 100 and filters history beyond row 100', async () => {
    login('DOCTOR')
    const client = { get: vi.fn(), post: vi.fn() }
    client.get.mockImplementation(async (url: string, config: any) => {
      if (url === '/api/v1/appointments')
        return {
          data: {
            data: {
              items:
                config.params.page === 1
                  ? [{ patientId: '202', patientFullName: 'Last patient' }]
                  : Array.from({ length: 100 }, () => ({
                      patientId: '201',
                      patientFullName: 'First patient',
                    })),
              totalElements: 101,
            },
          },
        }
      if (url.includes('/medical-history'))
        return {
          data: {
            data: {
              items:
                config.params.page === 1
                  ? [
                      {
                        id: '101',
                        appointmentId: '101',
                        doctorId: '2',
                        completedAt: '2026-11-20T00:00:00Z',
                        version: 1,
                        releasedAt: null,
                      },
                    ]
                  : Array.from({ length: 100 }, (_, i) => ({
                      id: String(i + 1),
                      appointmentId: String(i + 1),
                      doctorId: '2',
                      completedAt: '2026-11-21T00:00:00Z',
                      version: 1,
                      releasedAt: '2026-11-22T00:00:00Z',
                    })),
              totalElements: 101,
              page: config.params.page,
              size: 100,
              totalPages: 2,
            },
          },
        }
      return {
        data: {
          data: {
            doctorFullName: 'Synthetic doctor',
            specialtyName: 'Synthetic specialty',
            startAt: '2026-11-20T00:00:00Z',
          },
        },
      }
    })
    const api = createHistoryApi(client as unknown as AxiosInstance)
    expect(await api.patients(signal())).toHaveLength(2)
    const result = await api.list(
      '201',
      { page: 0, search: '', from: '', to: '', publication: 'UNRELEASED' },
      signal(),
    )
    expect(result.total).toBe(1)
    expect(result.items[0].id).toBe('101')
  })

  it('does not synthesize history when enrichment returns 404 or normalized auth error', async () => {
    login('DOCTOR')
    const client = { get: vi.fn(), post: vi.fn() }
    client.get.mockResolvedValueOnce({
      data: {
        data: {
          items: [
            {
              id: '1',
              appointmentId: '1',
              completedAt: '2026-11-20T00:00:00Z',
              version: 1,
            },
          ],
          totalElements: 1,
        },
      },
    })
    client.get.mockRejectedValueOnce(createAxiosError(404))
    const api = createHistoryApi(client as unknown as AxiosInstance)
    await expect(
      api.list(
        '1',
        { page: 0, search: '', from: '', to: '', publication: 'ALL' },
        signal(),
      ),
    ).rejects.toMatchObject({ status: 404 })
  })
  afterEach(() => {
    clearSession()
    vi.restoreAllMocks()
  })

  function setup() {
    const client = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
    }
    const api = createHistoryApi(client as unknown as AxiosInstance)
    return { client, api }
  }

  describe('patients discovery', () => {
    it('returns linked patient profile for PATIENT role', async () => {
      login('PATIENT')
      const { api, client } = setup()

      client.get.mockResolvedValueOnce({
        data: {
          data: {
            id: '101',
            fullName: 'Nguyễn Văn A',
          },
        },
      })

      const result = await api.patients(signal())
      expect(result).toEqual([{ id: '101', name: 'Nguyễn Văn A' }])
      expect(client.get).toHaveBeenCalledWith('/api/v1/me/patient-profile', {
        signal: expect.any(Object),
      })
    })

    it('extracts unique patients from appointments for DOCTOR role', async () => {
      login('DOCTOR')
      const { api, client } = setup()

      client.get.mockResolvedValueOnce({
        data: {
          data: {
            items: [
              {
                id: '1',
                patientId: '201',
                patientFullName: 'Bệnh nhân Một',
              },
              {
                id: '2',
                patientId: '202',
                patientCode: 'BN-002',
                patientFullName: null,
              },
              {
                id: '3',
                patientId: '201',
                patientFullName: 'Bệnh nhân Một',
              },
            ],
          },
        },
      })

      const result = await api.patients(signal())
      expect(result).toEqual([
        { id: '201', name: 'Bệnh nhân Một' },
        { id: '202', name: 'BN-002' },
      ])
      expect(client.get).toHaveBeenCalledWith('/api/v1/appointments', {
        params: { size: 100 },
        signal: expect.any(Object),
      })
    })

    it('rejects unauthenticated caller with 401', async () => {
      clearSession()
      const { api } = setup()
      await expect(api.patients(signal())).rejects.toMatchObject({
        status: 401,
      })
    })

    it.each(['ADMIN', 'RECEPTIONIST'] as const)(
      'rejects non-clinical role %s with 403',
      async (role) => {
        login(role)
        const { api } = setup()
        await expect(api.patients(signal())).rejects.toMatchObject({
          status: 403,
        })
      },
    )

    it('maps network or 500 error to HistoryError', async () => {
      login('PATIENT')
      const { api, client } = setup()
      client.get.mockRejectedValueOnce(createAxiosError(500))
      await expect(api.patients(signal())).rejects.toMatchObject({
        status: 500,
      })
    })
  })

  describe('list medical history', () => {
    const rawBackendItems = [
      {
        id: '10',
        appointmentId: '100',
        doctorId: '2',
        completedAt: '2026-11-22T03:00:00Z',
        releasedAt: '2026-11-22T04:00:00Z',
        version: 2,
      },
      {
        id: '9',
        appointmentId: '90',
        doctorId: '2',
        completedAt: '2026-11-20T03:00:00Z',
        releasedAt: null,
        version: 1,
      },
    ]

    it('calls GET /api/v1/patients/{id}/medical-history with page and size', async () => {
      login('DOCTOR')
      const { api, client } = setup()

      client.get.mockImplementation(async (url: string) => {
        if (url.includes('/medical-history')) {
          return {
            data: {
              data: {
                items: rawBackendItems,
                page: 0,
                size: 5,
                totalElements: 2,
                totalPages: 1,
              },
            },
          }
        }
        if (url.includes('/appointments/100')) {
          return {
            data: {
              data: {
                doctorFullName: 'Bác sĩ Trần',
                specialtyName: 'Tim mạch',
                startAt: '2026-11-22T02:30:00Z',
              },
            },
          }
        }
        return { data: { data: null } }
      })

      const query = {
        page: 0,
        search: '',
        from: '',
        to: '',
        publication: 'ALL' as const,
      }
      const page = await api.list('201', query, signal())

      expect(page.total).toBe(2)
      expect(page.items).toHaveLength(2)
      expect(page.items[0]).toMatchObject({
        id: '10',
        patientId: '201',
        doctorName: 'Bác sĩ Trần',
        specialtyName: 'Tim mạch',
        appointmentAt: '2026-11-22T02:30:00Z',
        status: 'COMPLETED',
        releasedAt: '2026-11-22T04:00:00Z',
        version: 2,
        assigned: true,
      })
      // Item 2 without appointment details falls back safely
      expect(page.items[1]).toMatchObject({
        id: '9',
        patientId: '201',
        doctorName: 'Bác sĩ #2',
        specialtyName: 'Chuyên khoa',
        releasedAt: null,
        version: 1,
      })
    })

    it('filters client-side when search query or publication filter is provided', async () => {
      login('DOCTOR')
      const { api, client } = setup()

      client.get.mockImplementation(async (url: string) => {
        if (url.includes('/medical-history')) {
          return {
            data: {
              data: {
                items: rawBackendItems,
                page: 0,
                size: 100,
                totalElements: 2,
                totalPages: 1,
              },
            },
          }
        }
        return { data: { data: null } }
      })

      // Search only released
      const page = await api.list(
        '201',
        {
          page: 0,
          search: '',
          from: '',
          to: '',
          publication: 'RELEASED',
        },
        signal(),
      )
      expect(page.total).toBe(1)
      expect(page.items[0].id).toBe('10')

      // Search only unreleased
      const unreleased = await api.list(
        '201',
        {
          page: 0,
          search: '',
          from: '',
          to: '',
          publication: 'UNRELEASED',
        },
        signal(),
      )
      expect(unreleased.total).toBe(1)
      expect(unreleased.items[0].id).toBe('9')
    })

    it('maps 404 and 403 errors correctly', async () => {
      login('DOCTOR')
      const { api, client } = setup()

      client.get.mockRejectedValueOnce(createAxiosError(404))
      await expect(
        api.list(
          '999',
          { page: 0, search: '', from: '', to: '', publication: 'ALL' },
          signal(),
        ),
      ).rejects.toMatchObject({ status: 404 })

      client.get.mockRejectedValueOnce(createAxiosError(403))
      await expect(
        api.list(
          '201',
          { page: 0, search: '', from: '', to: '', publication: 'ALL' },
          signal(),
        ),
      ).rejects.toMatchObject({ status: 403 })
    })
  })

  describe('detail medical record', () => {
    it('returns clinical details for authorized viewer', async () => {
      login('DOCTOR')
      const { api, client } = setup()

      client.get.mockImplementation(async (url: string) => {
        if (url === '/api/v1/medical-records/10') {
          return {
            data: {
              data: {
                id: '10',
                appointmentId: '100',
                doctorId: '2',
                patientId: '3',
                status: 'COMPLETED',
                version: 2,
                completedAt: '2026-11-22T03:00:00Z',
                releasedAt: '2026-11-22T04:00:00Z',
                releasedBy: '8',
                symptoms: 'Đau đầu, sốt nhẹ',
                diagnosis: 'Cảm cúm thông thường',
                notes: 'Uống nhiều nước',
                conclusion: 'Nghỉ ngơi 3 ngày',
              },
            },
          }
        }
        if (url === '/api/v1/appointments/100') {
          return {
            data: {
              data: {
                doctorFullName: 'Bác sĩ Tuấn',
                specialtyName: 'Khoa Nội',
                startAt: '2026-11-22T02:00:00Z',
              },
            },
          }
        }
        return { data: { data: null } }
      })

      const detail = await api.detail('3', '10', signal())
      expect(detail.item.id).toBe('10')
      expect(detail.item.doctorName).toBe('Bác sĩ Tuấn')
      expect(detail.item.releasedAt).toBe('2026-11-22T04:00:00Z')
      expect(detail.symptoms).toBe('Đau đầu, sốt nhẹ')
      expect(detail.diagnosis).toBe('Cảm cúm thông thường')
      expect(detail.conclusion).toBe('Nghỉ ngơi 3 ngày')
    })

    it('redacts clinical fields when backend returns metadata only', async () => {
      login('DOCTOR')
      const { api, client } = setup()

      client.get.mockResolvedValueOnce({
        data: {
          data: {
            id: '10',
            appointmentId: '100',
            doctorId: '2',
            patientId: '3',
            status: 'COMPLETED',
            version: 2,
            completedAt: '2026-11-22T03:00:00Z',
            releasedAt: null,
            releasedBy: null,
            // Clinical fields undefined
          },
        },
      })

      client.get.mockResolvedValueOnce({ data: { data: null } })
      const detail = await api.detail('3', '10', signal())
      expect(detail.symptoms).toBe('')
      expect(detail.diagnosis).toBe('')
      expect(detail.notes).toBe('')
      expect(detail.conclusion).toBe('')
    })

    it('maps 404 for unreleased record accessed by PATIENT', async () => {
      login('PATIENT')
      const { api, client } = setup()
      client.get.mockRejectedValueOnce(createAxiosError(404))
      await expect(api.detail('3', '10', signal())).rejects.toMatchObject({
        status: 404,
      })
    })
  })

  describe('release medical record', () => {
    it('submits POST /api/v1/medical-records/{id}/release with expectedVersion', async () => {
      login('DOCTOR')
      const { api, client } = setup()

      client.post.mockResolvedValueOnce({
        data: {
          data: {
            id: '10',
            version: 3,
            releasedAt: '2026-11-22T05:00:00Z',
          },
        },
      })

      await api.release('3', '10', 2, signal())
      expect(client.post).toHaveBeenCalledWith(
        '/api/v1/medical-records/10/release',
        { expectedVersion: 2 },
        { signal: expect.any(Object) },
      )
    })

    it('rejects release attempt from PATIENT role with 403', async () => {
      login('PATIENT')
      const { api, client } = setup()
      await expect(api.release('3', '10', 2, signal())).rejects.toMatchObject({
        status: 403,
      })
      expect(client.post).not.toHaveBeenCalled()
    })

    it('rejects invalid expectedVersion with 400', async () => {
      login('DOCTOR')
      const { api, client } = setup()
      await expect(api.release('3', '10', -1, signal())).rejects.toMatchObject({
        status: 400,
      })
      await expect(api.release('3', '10', 1.5, signal())).rejects.toMatchObject(
        {
          status: 400,
        },
      )
      expect(client.post).not.toHaveBeenCalled()
    })

    it('maps 409 conflict when version does not match', async () => {
      login('DOCTOR')
      const { api, client } = setup()
      client.post.mockRejectedValueOnce(
        createAxiosError(409, 'VERSION_CONFLICT'),
      )
      await expect(api.release('3', '10', 1, signal())).rejects.toMatchObject({
        status: 409,
      })
    })
  })

  describe('abortion & signal handling', () => {
    it('throws DOMException when signal is already aborted', async () => {
      login('DOCTOR')
      const { api } = setup()
      const controller = new AbortController()
      controller.abort()

      await expect(api.patients(controller.signal)).rejects.toBeInstanceOf(
        DOMException,
      )
      await expect(
        api.list(
          '1',
          { page: 0, search: '', from: '', to: '', publication: 'ALL' },
          controller.signal,
        ),
      ).rejects.toBeInstanceOf(DOMException)
      await expect(
        api.detail('1', '1', controller.signal),
      ).rejects.toBeInstanceOf(DOMException)
      await expect(
        api.release('1', '1', 1, controller.signal),
      ).rejects.toBeInstanceOf(DOMException)
    })
  })
})
