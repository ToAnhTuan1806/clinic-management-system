import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AxiosInstance } from 'axios'
import {
  beginAuthentication,
  establishSession,
  clearSession,
} from '@/auth/session-store'
import { AuthApiError } from '@/auth/errors'
import type { Role } from '@/auth/types'
import {
  canViewDashboard,
  createOperationsApi,
  dateRangeError,
  decodeNotificationPage,
  decodeSummary,
  defaultDateRange,
  mergeNotifications,
  notificationLabels,
  operationsMessage,
  operationsReady,
  statuses,
} from '@/operations/api'

// DTOs aligned with Backend API_CONTRACT §3.11. Mock transport, not live API evidence.
const range = { from: '2026-11-01', to: '2026-11-22' }
const summary = {
  ...range,
  timezone: 'Asia/Ho_Chi_Minh',
  totalAppointments: 7,
  checkedInCount: 2,
  completedCount: 1,
  uniquePatients: 4,
  appointmentsByStatus: Object.fromEntries(
    statuses.map((status) => [status, 1]),
  ),
}
const item = {
  id: '9007199254740993123',
  eventType: 'APPOINTMENT_CREATED',
  appointmentId: '9007199254740993999',
  appointmentCode: 'SYNTHETIC-1',
  createdAt: '2026-11-21T18:00:00Z',
  readAt: null,
}
const page = {
  items: [item],
  page: 0,
  size: 20,
  totalElements: 1,
  totalPages: 1,
  unreadCount: 1,
}
function session(role: Role = 'ADMIN', id = '1') {
  establishSession(beginAuthentication(), 'synthetic-unit-only', {
    id,
    role,
    email: 'synthetic@example.test',
    fullName: 'Synthetic unit',
  })
}
function setup(role: Role = 'ADMIN', ready = true) {
  session(role)
  const client = { get: vi.fn(), patch: vi.fn() }
  return {
    client,
    api: createOperationsApi(client as unknown as AxiosInstance, ready),
  }
}
afterEach(() => {
  clearSession()
  vi.useRealTimers()
})
describe('D13 candidate Dashboard and notifications contract — mocked transport', () => {
  it.each(['ADMIN', 'RECEPTIONIST', 'DOCTOR'] as Role[])(
    'allows %s summary without client-selected ownership',
    async (role) => {
      const { client, api } = setup(role)
      client.get.mockResolvedValue({ data: { data: summary } })
      expect(canViewDashboard(role)).toBe(true)
      expect(await api.summary(range)).toEqual(summary)
      expect(client.get).toHaveBeenCalledWith('/api/v1/dashboard/summary', {
        params: range,
        signal: undefined,
      })
    },
  )
  it('blocks PATIENT dashboard without sending a request', async () => {
    const { api, client } = setup('PATIENT')
    expect(canViewDashboard('PATIENT')).toBe(false)
    expect(canViewDashboard()).toBe(false)
    await expect(api.summary(range)).rejects.toMatchObject({ status: 403 })
    expect(client.get).not.toHaveBeenCalled()
  })
  it.each([
    [undefined, true],
    ['', true],
    ['true', true],
    ['false', false],
    [' FALSE ', false],
  ])('D13 production configuration %s resolves to %s', (setting, ready) => {
    expect(operationsReady(setting)).toBe(ready)
  })
  it('supports explicit maintenance disable without fixture fallback', async () => {
    const { client } = setup()
    const api = createOperationsApi(client as unknown as AxiosInstance, false)
    await expect(api.summary(range)).rejects.toMatchObject({
      code: 'D13_API_PENDING',
    })
    await expect(api.notifications()).rejects.toMatchObject({
      code: 'D13_API_PENDING',
    })
    await expect(api.markRead('1')).rejects.toMatchObject({
      code: 'D13_API_PENDING',
    })
    expect(client.get).not.toHaveBeenCalled()
    expect(client.patch).not.toHaveBeenCalled()
  })
  it('uses Vietnamese calendar dates around UTC midnight', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-21T18:00:00Z'))
    try {
      expect(defaultDateRange()).toEqual({
        from: '2026-11-01',
        to: '2026-11-22',
      })
    } finally {
      vi.useRealTimers()
    }
  })
  it.each([
    [{ from: '', to: '2026-11-22' }, true],
    [{ from: '2026-02-30', to: '2026-11-22' }, true],
    [{ from: '2026-11-23', to: '2026-11-22' }, true],
    [{ from: '2026-11-22T00:00:00Z', to: '2026-11-22' }, true],
    [{ from: '2026-11-22', to: '2026-11-22' }, false],
    [{ from: '2024-02-29', to: '2024-03-01' }, false],
    [{ from: '2026-01-01', to: '2027-01-01' }, false],
    [{ from: '2026-01-01', to: '2027-01-02' }, true],
    [{ from: '0999-01-01', to: '0999-01-01' }, true],
    [{ from: '9999-12-31', to: '9999-12-31' }, false],
    [{ from: '1000-01-01', to: '1000-01-01' }, true],
    [{ from: '1000-01-02', to: '1000-01-02' }, false],
  ])('validates date-only range %j', (range, invalid) =>
    expect(!!dateRangeError(range)).toBe(invalid),
  )
  it('rejects invalid filters before transport', async () => {
    const { api, client } = setup()
    await expect(
      api.summary({ from: '2026-11-23', to: '2026-11-22' }),
    ).rejects.toMatchObject({ status: 400 })
    expect(client.get).not.toHaveBeenCalled()
  })
  it('rejects a response for another date range or timezone', async () => {
    const { api, client } = setup()
    client.get.mockResolvedValueOnce({
      data: { data: { ...summary, from: '2026-11-02' } },
    })
    await expect(api.summary(range)).rejects.toMatchObject({
      code: 'INVALID_OPERATIONS_RESPONSE',
    })
    expect(() => decodeSummary({ ...summary, timezone: 'UTC' })).toThrow()
  })
  it('accepts a genuine zero summary and strips clinical/financial fields', () => {
    const empty = {
      ...summary,
      totalAppointments: 0,
      uniquePatients: 0,
      completedCount: 0,
      checkedInCount: 0,
      appointmentsByStatus: Object.fromEntries(statuses.map((s) => [s, 0])),
    }
    expect(
      decodeSummary({ ...empty, clinical: 'PRIVATE', revenue: 99 }),
    ).toEqual(empty)
  })
  it.each([
    null,
    {},
    { ...summary, uniquePatients: -1 },
    { ...summary, totalAppointments: 1.5 },
    { ...summary, appointmentsByStatus: {} },
  ])('rejects malformed summary %j', (value) => {
    expect(() => decodeSummary(value)).toThrow()
  })
  it('preserves string BIGINT ids, metadata and administrative fields only', async () => {
    const { api, client } = setup('PATIENT')
    client.get.mockResolvedValue({
      data: {
        data: {
          ...page,
          items: [
            {
              ...item,
              body: 'PRIVATE CLINICAL',
              href: 'https://invalid.example',
            },
          ],
        },
      },
    })
    const result = await api.notifications()
    expect(result.items[0]).toEqual(item)
    expect(result.unreadCount).toBe(1)
    expect(client.get).toHaveBeenCalledWith('/api/v1/notifications', {
      params: { page: 0, size: 20 },
      signal: undefined,
    })
  })
  it('uses real page metadata and merges overlapping pages without duplicate rows', async () => {
    const { api, client } = setup()
    client.get.mockResolvedValue({
      data: {
        data: {
          ...page,
          page: 1,
          totalElements: 21,
          totalPages: 2,
          unreadCount: 9,
        },
      },
    })
    const result = await api.notifications(1)
    expect(result.totalPages).toBe(2)
    expect(result.unreadCount).toBe(9)
    expect(
      mergeNotifications(
        [{ ...item, eventType: 'APPOINTMENT_CREATED' } as any],
        result.items,
      ),
    ).toEqual(result.items)
  })
  it('accepts a real empty inbox without inventing unread notifications', () => {
    expect(
      decodeNotificationPage(
        { ...page, items: [], totalElements: 0, totalPages: 0, unreadCount: 0 },
        0,
      ),
    ).toEqual({
      items: [],
      page: 0,
      size: 20,
      totalElements: 0,
      totalPages: 0,
      unreadCount: 0,
    })
  })
  it.each([
    { ...page, totalPages: 2 },
    { ...page, page: -1 },
    { ...page, unreadCount: -1 },
    { ...page, items: [item, item] },
    { ...page, items: [{ ...item, id: 10 }] },
    { ...page, items: [{ ...item, eventType: 'CLINICAL_UPDATED' }] },
    { ...page, items: [{ ...item, createdAt: '2026-11-22T00:00:00' }] },
    { ...page, items: [{ ...item, appointmentId: '../../patients/1' }] },
  ])('fails closed for malformed inbox data %j', (value) =>
    expect(() => decodeNotificationPage(value, 0)).toThrow(),
  )
  it('accepts repeated mark-read responses with no body and refetches exact unread count', async () => {
    const { api, client } = setup('PATIENT')
    client.patch.mockResolvedValue({ status: 204 })
    await api.markRead(item.id)
    await api.markRead(item.id)
    client.get.mockResolvedValue({
      data: {
        data: {
          ...page,
          unreadCount: 7,
          items: [{ ...item, readAt: '2026-11-22T01:00:00Z' }],
        },
      },
    })
    expect((await api.notifications()).unreadCount).toBe(7)
    expect(client.patch).toHaveBeenCalledTimes(2)
    expect(client.patch).toHaveBeenCalledWith(
      '/api/v1/notifications/' + item.id + '/read',
      undefined,
      { signal: undefined },
    )
  })
  it.each([401, 403, 404])(
    'preserves normalized HTTP %s without exposing detail',
    async (status) => {
      const { api, client } = setup()
      client.get.mockRejectedValue(
        new AuthApiError('safe', status, 'HTTP_' + status),
      )
      await expect(api.notifications()).rejects.toMatchObject({ status })
      client.patch.mockRejectedValue({
        isAxiosError: true,
        response: {
          status,
          data: { detail: 'PRIVATE', code: 'HTTP_' + status },
        },
      })
      await expect(api.markRead('1')).rejects.toMatchObject({ status })
      expect(
        operationsMessage(new AuthApiError('PRIVATE', status)),
      ).not.toContain('PRIVATE')
    },
  )
  it('rejects network failures without fake data', async () => {
    const { api, client } = setup()
    client.get.mockRejectedValue(new Error('offline'))
    await expect(api.notifications()).rejects.toMatchObject({ status: 0 })
  })
  it('rejects late responses from a previous authenticated account', async () => {
    const { api, client } = setup()
    const response = Promise.withResolvers<any>()
    client.get.mockReturnValue(response.promise)
    const pending = api.notifications()
    session('PATIENT', '2')
    response.resolve({ data: { data: page } })
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('requires authentication for every inbox action', async () => {
    const { api, client } = setup()
    clearSession()
    await expect(api.notifications()).rejects.toMatchObject({ status: 401 })
    await expect(api.markRead('1')).rejects.toMatchObject({ status: 401 })
    expect(client.get).not.toHaveBeenCalled()
    expect(client.patch).not.toHaveBeenCalled()
  })
  it('does not issue requests after abort or for invalid ids/pages', async () => {
    const { api, client } = setup()
    const controller = new AbortController()
    controller.abort()
    await expect(api.notifications(0, controller.signal)).rejects.toMatchObject(
      { name: 'AbortError' },
    )
    await expect(api.notifications(-1)).rejects.toMatchObject({ status: 400 })
    await expect(api.markRead('../users')).rejects.toMatchObject({
      status: 400,
    })
    expect(client.get).not.toHaveBeenCalled()
    expect(client.patch).not.toHaveBeenCalled()
  })
  it('defines only administrative notification labels', () => {
    expect(Object.keys(notificationLabels)).toEqual([
      'APPOINTMENT_CREATED',
      'APPOINTMENT_RESCHEDULED',
      'APPOINTMENT_CANCELLED',
      'APPOINTMENT_CONFIRMED',
    ])
  })
})
