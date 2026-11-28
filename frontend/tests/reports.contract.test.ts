import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AxiosInstance } from 'axios'
import {
  beginAuthentication,
  clearSession,
  establishSession,
} from '@/auth/session-store'
import { AuthApiError } from '@/auth/errors'
import type { Role } from '@/auth/types'
import { statuses } from '@/operations/api'
import {
  actorUserIdError,
  canViewAuditLogs,
  canViewReports,
  createReportsApi,
  decodeAuditLogPage,
  decodeVisitReport,
  optionalDateRangeError,
  reportsMessage,
} from '@/reports/api'

const range = { from: '2026-11-22', to: '2026-11-28' }

const validReportPayload = {
  ...range,
  timezone: 'Asia/Ho_Chi_Minh',
  totalAppointments: 7,
  checkedInCount: 3,
  completedCount: 2,
  uniquePatients: 5,
  appointmentsByStatus: Object.fromEntries(statuses.map((s) => [s, 1])),
  dailyVisits: [
    {
      date: '2026-11-22',
      totalAppointments: 4,
      checkedInCount: 2,
      completedCount: 1,
      cancelledCount: 1,
      noShowCount: 0,
    },
    {
      date: '2026-11-28',
      totalAppointments: 3,
      checkedInCount: 1,
      completedCount: 1,
      cancelledCount: 0,
      noShowCount: 1,
    },
  ],
  byDoctor: [
    {
      doctorId: '2',
      doctorCode: 'DOC-01',
      doctorName: 'Dr. Nguyen',
      specialtyName: 'Cardiology',
      totalAppointments: 7,
      checkedInCount: 3,
      completedCount: 2,
    },
  ],
  bySpecialty: [
    {
      specialtyId: '1',
      specialtyCode: 'CARD',
      specialtyName: 'Cardiology',
      totalAppointments: 7,
      checkedInCount: 3,
      completedCount: 2,
    },
  ],
}

const validAuditPagePayload = {
  items: [
    {
      id: '101',
      actorUserId: '8',
      actorRole: 'RECEPTIONIST',
      action: 'APPOINTMENT_CHECKED_IN',
      entityType: 'APPOINTMENT',
      entityId: '50',
      result: 'SUCCESS',
      correlationId: 'corr-1',
      metadata: '{"secret":"should-not-be-returned"}',
      occurredAt: '2026-11-28T03:00:00Z',
    },
  ],
  page: 0,
  size: 20,
  totalElements: 1,
  totalPages: 1,
}

function signIn(role: Role, id = '1') {
  const attempt = beginAuthentication()
  establishSession(attempt, 'test-token', {
    id,
    email: `${role.toLowerCase()}@clinic.test`,
    fullName: `User ${role}`,
    role,
    status: 'ACTIVE',
  })
}

afterEach(() => {
  clearSession()
})

describe('D14 Reports & Audit Logs contract', () => {
  it('enforces RBAC helper predicates', () => {
    expect(canViewReports('ADMIN')).toBe(true)
    expect(canViewReports('RECEPTIONIST')).toBe(true)
    expect(canViewReports('DOCTOR')).toBe(true)
    expect(canViewReports('PATIENT')).toBe(false)
    expect(canViewReports(undefined)).toBe(false)

    expect(canViewAuditLogs('ADMIN')).toBe(true)
    expect(canViewAuditLogs('RECEPTIONIST')).toBe(false)
    expect(canViewAuditLogs('DOCTOR')).toBe(false)
    expect(canViewAuditLogs('PATIENT')).toBe(false)
  })

  it('validates optional date range and actorUserId filters', () => {
    expect(optionalDateRangeError('', '')).toBe('')
    expect(optionalDateRangeError('2026-11-22', '2026-11-28')).toBe('')
    expect(optionalDateRangeError('2026-11-29', '2026-11-28')).not.toBe('')
    expect(actorUserIdError('')).toBe('')
    expect(actorUserIdError('12')).toBe('')
    expect(actorUserIdError('0')).not.toBe('')
    expect(actorUserIdError('abc')).not.toBe('')
  })

  it('decodes VisitReport and rejects malformed payloads', () => {
    const decoded = decodeVisitReport(validReportPayload)
    expect(decoded.totalAppointments).toBe(7)
    expect(decoded.dailyVisits).toHaveLength(2)
    expect(decoded.byDoctor[0]?.doctorId).toBe('2')
    expect(decoded.bySpecialty[0]?.specialtyCode).toBe('CARD')

    expect(() =>
      decodeVisitReport({ ...validReportPayload, dailyVisits: 'bad' }),
    ).toThrow(AuthApiError)
  })

  it('decodes AuditLogPage and strips raw metadata/correlation fields', () => {
    const decoded = decodeAuditLogPage(validAuditPagePayload, 0, 20)
    expect(decoded.items).toHaveLength(1)
    expect(decoded.items[0]?.action).toBe('APPOINTMENT_CHECKED_IN')
    expect('metadata' in decoded.items[0]!).toBe(false)
    expect('correlationId' in decoded.items[0]!).toBe(false)

    expect(() =>
      decodeAuditLogPage(
        {
          ...validAuditPagePayload,
          items: [{ ...validAuditPagePayload.items[0], result: 'UNKNOWN' }],
        },
        0,
        20,
      ),
    ).toThrow(AuthApiError)
  })

  it('calls GET /api/v1/reports/visits for staff and blocks PATIENT', async () => {
    const get = vi
      .fn()
      .mockResolvedValue({ data: { data: validReportPayload } })
    const api = createReportsApi({ get } as unknown as AxiosInstance)

    signIn('PATIENT', '9')
    await expect(api.visitReport(range)).rejects.toMatchObject({ status: 403 })
    expect(get).not.toHaveBeenCalled()

    signIn('DOCTOR', '2')
    const result = await api.visitReport(range)
    expect(result.totalAppointments).toBe(7)
    expect(get).toHaveBeenCalledWith(
      '/api/v1/reports/visits',
      expect.objectContaining({ params: range }),
    )
  })

  it('calls GET /api/v1/audit-logs for ADMIN only and aborts on session switch', async () => {
    const get = vi
      .fn()
      .mockResolvedValue({ data: { data: validAuditPagePayload } })
    const api = createReportsApi({ get } as unknown as AxiosInstance)

    signIn('RECEPTIONIST', '3')
    await expect(
      api.auditLogs({
        from: '',
        to: '',
        actorUserId: '',
        action: '',
        page: 0,
        size: 20,
        sort: 'occurredAt,desc',
      }),
    ).rejects.toMatchObject({ status: 403 })

    signIn('ADMIN', '1')
    const page = await api.auditLogs({
      from: '2026-11-22',
      to: '2026-11-28',
      actorUserId: '8',
      action: 'APPOINTMENT_CHECKED_IN',
      page: 0,
      size: 20,
      sort: 'occurredAt,desc',
    })
    expect(page.totalElements).toBe(1)
    expect(get).toHaveBeenCalledWith(
      '/api/v1/audit-logs',
      expect.objectContaining({
        params: {
          page: 0,
          size: 20,
          sort: 'occurredAt,desc',
          from: '2026-11-22',
          to: '2026-11-28',
          actorUserId: 8,
          action: 'APPOINTMENT_CHECKED_IN',
        },
      }),
    )

    // Session switch during inflight request must abort instead of leaking previous data.
    const slowGet = vi.fn().mockImplementation(async () => {
      signIn('DOCTOR', '2')
      return { data: { data: validAuditPagePayload } }
    })
    const slowApi = createReportsApi({
      get: slowGet,
    } as unknown as AxiosInstance)
    signIn('ADMIN', '1')
    await expect(
      slowApi.auditLogs({
        from: '',
        to: '',
        actorUserId: '',
        action: '',
        page: 0,
        size: 20,
        sort: 'occurredAt,desc',
      }),
    ).rejects.toThrow('Session changed')
  })

  it('maps error statuses to safe Vietnamese messages', () => {
    expect(reportsMessage(new AuthApiError('x', 401, 'UNAUTH'))).toContain(
      'đăng nhập',
    )
    expect(reportsMessage(new AuthApiError('x', 403, 'DENIED'))).toContain(
      'không có quyền',
    )
    expect(reportsMessage(new AuthApiError('x', 500, 'ERR'))).toContain(
      'Không thể tải',
    )
  })
})
