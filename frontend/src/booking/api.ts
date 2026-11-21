import type { AxiosError, AxiosInstance } from 'axios'
import { validId } from '@/schedule/model'
import {
  BookingError,
  validateBookingDraft,
  validateCancelDraft,
  validateChangeSlotDraft,
  type Appointment,
  type AppointmentPage,
  type AppointmentQuery,
  type AppointmentStatus,
  type BookingDraft,
  type BookingGateway,
  type CancelAppointmentDraft,
  type ChangeSlotDraft,
} from './model'

const invalid = (): never => {
  throw new BookingError(
    'UNKNOWN_ERROR',
    500,
    'Phản hồi từ máy chủ không hợp lệ.',
  )
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid()

const text = (value: unknown): string =>
  typeof value === 'string' ? value : invalid()

const nullable = (value: unknown): string | null =>
  value === null || value === undefined ? null : text(value)

const id = (value: unknown): string => {
  const str =
    typeof value === 'number' && Number.isInteger(value) && value > 0
      ? String(value)
      : value
  return validId(str) ? str : invalid()
}

const data = (body: unknown): unknown => {
  if (body && typeof body === 'object' && 'data' in body) {
    return (body as Record<string, unknown>).data
  }
  return body
}

export function decodeAppointment(value: unknown): Appointment {
  const row = object(value)
  const statusValues: AppointmentStatus[] = [
    'PENDING',
    'CONFIRMED',
    'CHECKED_IN',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED',
    'NO_SHOW',
  ]

  const rawStatus = String(row.status || '').toUpperCase() as AppointmentStatus
  const status = statusValues.includes(rawStatus) ? rawStatus : 'PENDING'

  const startIso = text(
    row.startAt || row.startsAt || row.start_at || row.starts_at,
  )
  const endIso = text(row.endAt || row.endsAt || row.end_at || row.ends_at)

  return {
    id: id(row.id),
    appointmentCode: text(
      row.appointmentCode || row.appointment_code || row.code,
    ),
    patientId: id(row.patientId || row.patient_id),
    patientCode:
      typeof row.patientCode === 'string'
        ? row.patientCode
        : typeof row.patient_code === 'string'
          ? row.patient_code
          : undefined,
    patientName:
      typeof row.patientFullName === 'string'
        ? row.patientFullName
        : typeof row.patient_full_name === 'string'
          ? row.patient_full_name
          : typeof row.patientName === 'string'
            ? row.patientName
            : typeof row.patient_name === 'string'
              ? row.patient_name
              : undefined,
    patientPhone:
      typeof row.patientPhone === 'string'
        ? row.patientPhone
        : typeof row.patient_phone === 'string'
          ? row.patient_phone
          : undefined,
    doctorId: id(row.doctorId || row.doctor_id),
    doctorCode:
      typeof row.doctorCode === 'string'
        ? row.doctorCode
        : typeof row.doctor_code === 'string'
          ? row.doctor_code
          : undefined,
    doctorName:
      typeof row.doctorFullName === 'string'
        ? row.doctorFullName
        : typeof row.doctor_full_name === 'string'
          ? row.doctor_full_name
          : typeof row.doctorName === 'string'
            ? row.doctorName
            : typeof row.doctor_name === 'string'
              ? row.doctor_name
              : undefined,
    specialtyName:
      typeof row.specialtyName === 'string'
        ? row.specialtyName
        : typeof row.specialty_name === 'string'
          ? row.specialty_name
          : undefined,
    scheduleId: id(row.scheduleId || row.schedule_id),
    startAt: startIso,
    endAt: endIso,
    status,
    reason: nullable(row.reason),
    cancellationReason: nullable(
      row.cancellationReason ??
        row.cancellation_reason ??
        row.cancelReason ??
        row.cancel_reason,
    ),
    cancelledAt:
      typeof row.cancelledAt === 'string'
        ? row.cancelledAt
        : typeof row.cancelled_at === 'string'
          ? row.cancelled_at
          : undefined,
    cancelledBy:
      typeof row.cancelledBy === 'string' || typeof row.cancelledBy === 'number'
        ? String(row.cancelledBy)
        : typeof row.cancelled_by === 'string' ||
            typeof row.cancelled_by === 'number'
          ? String(row.cancelled_by)
          : undefined,
    rescheduledAt:
      typeof row.rescheduledAt === 'string'
        ? row.rescheduledAt
        : typeof row.rescheduled_at === 'string'
          ? row.rescheduled_at
          : undefined,
    roomLabel: nullable(row.roomLabel ?? row.room_label),
    version:
      typeof row.version === 'number'
        ? row.version
        : typeof row.version === 'string' && !Number.isNaN(Number(row.version))
          ? Number(row.version)
          : 0,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : undefined,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : undefined,
  }
}

function handleBookingError(error: unknown): never {
  const axiosErr = error as AxiosError<Record<string, unknown>>
  if (!axiosErr.response) {
    if (error instanceof BookingError) throw error
    if (axiosErr.code === 'ERR_NETWORK' || !navigator.onLine) {
      throw new BookingError('NETWORK_ERROR', 0)
    }
    throw new BookingError('UNKNOWN_ERROR', 500)
  }

  const { status, data: body } = axiosErr.response
  const problem = (body && typeof body === 'object' ? body : {}) as Record<
    string,
    unknown
  >
  const detail = typeof problem.detail === 'string' ? problem.detail : undefined
  const codeStr = String(problem.code || '').toUpperCase()
  const detailStr = String(detail || '').toLowerCase()

  if (status === 409) {
    if (
      codeStr.includes('VERSION_CONFLICT') ||
      detailStr.includes('version') ||
      detailStr.includes('phiên bản')
    ) {
      throw new BookingError(
        'VERSION_CONFLICT',
        409,
        detail ||
          'Dữ liệu cuộc hẹn đã được cập nhật bởi một phiên khác. Vui lòng tải lại dữ liệu mới nhất (409 Conflict).',
      )
    }

    if (codeStr.includes('INVALID_STATE') || detailStr.includes('trạng thái')) {
      throw new BookingError(
        'INVALID_STATE_TRANSITION',
        409,
        detail ||
          'Không thể thay đổi hoặc hủy cuộc hẹn ở trạng thái hiện tại (409 Conflict).',
      )
    }

    if (codeStr.includes('PAST') || detailStr.includes('quá khứ')) {
      throw new BookingError(
        'APPOINTMENT_PAST',
        409,
        detail ||
          'Không thể thay đổi hoặc hủy cuộc hẹn đã bắt đầu hoặc đã qua thời gian khám.',
      )
    }

    throw new BookingError(
      'SLOT_UNAVAILABLE',
      409,
      detail ||
        'Khung giờ này vừa được người khác đặt trước hoặc không còn khả dụng. Vui lòng chọn khung giờ khác (409 Conflict).',
    )
  }

  if (status === 403) {
    throw new BookingError(
      'FORBIDDEN',
      403,
      detail || 'Bạn không có quyền thực hiện thao tác đặt lịch này.',
    )
  }

  if (status === 401) {
    throw new BookingError('UNAUTHORIZED', 401, detail)
  }

  if (status === 404) {
    throw new BookingError('NOT_FOUND', 404, detail)
  }

  if (status === 400) {
    const fieldErrors = (
      problem.errors && typeof problem.errors === 'object' ? problem.errors : {}
    ) as Record<string, string>
    throw new BookingError(
      'VALIDATION_FAILED',
      400,
      detail || 'Dữ liệu đặt lịch không hợp lệ.',
      fieldErrors,
    )
  }

  throw new BookingError('UNKNOWN_ERROR', status, detail)
}

export function createBookingApi(client: AxiosInstance): BookingGateway {
  return {
    mode: 'real',

    async bookAppointment(
      draft: BookingDraft,
      signal?: AbortSignal,
    ): Promise<Appointment> {
      const fieldErrors = validateBookingDraft(draft)
      if (Object.keys(fieldErrors).length > 0) {
        throw new BookingError(
          'VALIDATION_FAILED',
          400,
          'Dữ liệu đặt lịch không hợp lệ.',
          fieldErrors,
        )
      }

      // Strictly construct payload per contract
      const payload: Record<string, unknown> = {
        scheduleId: draft.slot.scheduleId,
        startAt: draft.slot.startsAt,
        requestKey: draft.requestKey,
      }

      if (draft.reason?.trim()) {
        payload.reason = draft.reason.trim()
      }

      // Only send patientId if explicitly provided (e.g. by RECEPTIONIST)
      if (draft.patientId) {
        payload.patientId = draft.patientId
      }

      try {
        const res = await client.post('/api/v1/appointments', payload, {
          signal,
        })
        return decodeAppointment(data(res.data))
      } catch (err) {
        handleBookingError(err)
      }
    },

    async getAppointment(
      idParam: string,
      signal?: AbortSignal,
    ): Promise<Appointment> {
      if (!validId(idParam)) throw new BookingError('VALIDATION_FAILED', 400)

      try {
        const res = await client.get(`/api/v1/appointments/${idParam}`, {
          signal,
        })
        return decodeAppointment(data(res.data))
      } catch (err) {
        handleBookingError(err)
      }
    },

    async listMyAppointments(signal?: AbortSignal): Promise<Appointment[]> {
      try {
        const res = await client.get('/api/v1/appointments', { signal })
        const payload = data(res.data)

        let items: unknown[]
        if (
          payload &&
          typeof payload === 'object' &&
          'items' in payload &&
          Array.isArray((payload as Record<string, unknown>).items)
        ) {
          items = (payload as Record<string, unknown>).items as unknown[]
        } else if (Array.isArray(payload)) {
          items = payload
        } else {
          return []
        }

        return items.map(decodeAppointment)
      } catch (err) {
        handleBookingError(err)
      }
    },

    async listAppointments(
      query?: AppointmentQuery,
      signal?: AbortSignal,
    ): Promise<AppointmentPage> {
      try {
        const params: Record<string, unknown> = {}
        if (query?.doctorId) params.doctorId = query.doctorId
        if (query?.patientId) params.patientId = query.patientId
        if (query?.date) params.date = query.date
        if (query?.status && query.status !== 'ALL')
          params.status = query.status
        if (query?.page !== undefined) params.page = query.page
        if (query?.pageSize !== undefined) params.size = query.pageSize

        const res = await client.get('/api/v1/appointments', {
          params,
          signal,
        })
        const payload = data(res.data)

        let items: unknown[] = []
        let total = 0
        let page = query?.page || 0
        let pageSize = query?.pageSize || 20

        if (payload && typeof payload === 'object') {
          const obj = payload as Record<string, unknown>
          if (Array.isArray(obj.items)) {
            items = obj.items
            total =
              typeof obj.total === 'number'
                ? obj.total
                : typeof obj.totalElements === 'number'
                  ? obj.totalElements
                  : items.length
            page = typeof obj.page === 'number' ? obj.page : page
            pageSize =
              typeof obj.pageSize === 'number'
                ? obj.pageSize
                : typeof obj.size === 'number'
                  ? obj.size
                  : pageSize
          } else if (Array.isArray(obj.content)) {
            items = obj.content
            total =
              typeof obj.totalElements === 'number'
                ? obj.totalElements
                : items.length
            page = typeof obj.number === 'number' ? obj.number : page
            pageSize = typeof obj.size === 'number' ? obj.size : pageSize
          }
        } else if (Array.isArray(payload)) {
          items = payload
          total = items.length
        }

        return {
          items: items.map(decodeAppointment),
          total,
          page,
          pageSize,
        }
      } catch (err) {
        handleBookingError(err)
      }
    },

    async changeSlot(
      draft: ChangeSlotDraft,
      signal?: AbortSignal,
    ): Promise<Appointment> {
      const fieldErrors = validateChangeSlotDraft(draft)
      if (Object.keys(fieldErrors).length > 0) {
        throw new BookingError(
          'VALIDATION_FAILED',
          400,
          'Dữ liệu đổi lịch không hợp lệ.',
          fieldErrors,
        )
      }

      try {
        const payload = {
          scheduleId: draft.scheduleId,
          startAt: draft.startAt,
          expectedVersion: draft.expectedVersion,
        }
        const res = await client.patch(
          `/api/v1/appointments/${draft.appointmentId}/slot`,
          payload,
          { signal },
        )
        return decodeAppointment(data(res.data))
      } catch (err) {
        handleBookingError(err)
      }
    },

    async cancelAppointment(
      draft: CancelAppointmentDraft,
      signal?: AbortSignal,
    ): Promise<Appointment> {
      const fieldErrors = validateCancelDraft(draft)
      if (Object.keys(fieldErrors).length > 0) {
        throw new BookingError(
          'VALIDATION_FAILED',
          400,
          'Dữ liệu hủy lịch không hợp lệ.',
          fieldErrors,
        )
      }

      try {
        const cancelReason = (
          draft.reason ??
          draft.cancellationReason ??
          ''
        ).trim()
        const payload = {
          reason: cancelReason,
          expectedVersion: draft.expectedVersion,
        }
        const res = await client.post(
          `/api/v1/appointments/${draft.appointmentId}/cancellation`,
          payload,
          { signal },
        )
        return decodeAppointment(data(res.data))
      } catch (err) {
        handleBookingError(err)
      }
    },
  }
}
