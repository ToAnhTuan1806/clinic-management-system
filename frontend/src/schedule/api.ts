import type { AxiosError, AxiosInstance } from 'axios'
import {
  ScheduleError,
  toUtcIso,
  validId,
  validateSchedule,
  type DoctorSchedule,
  type ScheduleDraft,
  type ScheduleGateway,
  type ScheduleQuery,
  type ScheduleSlot,
  type ScheduleStatus,
} from './model'

const invalid = (): never => {
  throw new ScheduleError('INVALID_SCHEDULE_RESPONSE')
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid()

const text = (value: unknown): string =>
  typeof value === 'string' ? value : invalid()

const nullable = (value: unknown): string | null =>
  value === null || value === undefined ? null : text(value)

const id = (value: unknown): string => (validId(value) ? value : invalid())

const data = (body: unknown): unknown => {
  if (body && typeof body === 'object' && 'data' in body) {
    return (body as Record<string, unknown>).data
  }
  return body
}

export function decodeSchedule(value: unknown): DoctorSchedule {
  const row = object(value)
  const rawStatus = String(row.status || '').toUpperCase()

  // Contract allows strictly ACTIVE and BLOCKED
  let status: ScheduleStatus = 'ACTIVE'
  if (rawStatus === 'BLOCKED') {
    status = 'BLOCKED'
  } else if (rawStatus === 'ACTIVE') {
    status = 'ACTIVE'
  } else {
    invalid()
  }

  const startIso = text(
    row.startAt || row.startsAt || row.start_at || row.starts_at,
  )
  const endIso = text(row.endAt || row.endsAt || row.end_at || row.ends_at)

  return {
    id: id(row.id),
    doctorId: id(row.doctorId || row.doctor_id),
    doctorName:
      typeof row.doctorName === 'string'
        ? row.doctorName
        : typeof row.doctorFullName === 'string'
          ? row.doctorFullName
          : typeof row.doctor_name === 'string'
            ? row.doctor_name
            : undefined,
    doctorCode:
      typeof row.doctorCode === 'string'
        ? row.doctorCode
        : typeof row.doctor_code === 'string'
          ? row.doctor_code
          : undefined,
    specialtyName:
      typeof row.specialtyName === 'string'
        ? row.specialtyName
        : typeof row.specialty_name === 'string'
          ? row.specialty_name
          : undefined,
    startsAt: startIso,
    endsAt: endIso,
    status,
    roomLabel: nullable(row.roomLabel ?? row.room_label),
    slotDurationMinutes:
      typeof row.slotMinutes === 'number'
        ? row.slotMinutes
        : typeof row.slot_minutes === 'number'
          ? row.slot_minutes
          : typeof row.slotDurationMinutes === 'number'
            ? row.slotDurationMinutes
            : 30,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : undefined,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : undefined,
  }
}

export function decodeSlot(value: unknown): ScheduleSlot {
  const row = object(value)
  const isAvail =
    typeof row.isAvailable === 'boolean'
      ? row.isAvailable
      : String(row.status || '').toUpperCase() === 'AVAILABLE'

  const startIso = text(
    row.startAt || row.startsAt || row.start_at || row.starts_at,
  )
  const endIso = text(row.endAt || row.endsAt || row.end_at || row.ends_at)
  const scheduleIdVal = id(row.scheduleId || row.schedule_id)
  const slotId = row.id ? id(row.id) : `${scheduleIdVal}-${startIso}`

  return {
    id: slotId,
    scheduleId: scheduleIdVal,
    doctorId: id(row.doctorId || row.doctor_id),
    doctorName: typeof row.doctorName === 'string' ? row.doctorName : undefined,
    startsAt: startIso,
    endsAt: endIso,
    status: isAvail ? 'AVAILABLE' : 'BOOKED',
    roomLabel: nullable(row.roomLabel ?? row.room_label),
  }
}

function handleScheduleError(error: unknown): never {
  const axiosErr = error as AxiosError<Record<string, unknown>>
  if (!axiosErr.response) {
    if (error instanceof ScheduleError) throw error
    throw new ScheduleError('UNKNOWN_SCHEDULE_ERROR', 500)
  }

  const { status, data: body } = axiosErr.response
  const problem = (body && typeof body === 'object' ? body : {}) as Record<
    string,
    unknown
  >
  const detail = typeof problem.detail === 'string' ? problem.detail : undefined
  const problemCode =
    typeof problem.code === 'string' ? problem.code : undefined

  if (status === 409) {
    if (problemCode === 'DOCTOR_INACTIVE') {
      throw new ScheduleError(
        'FORBIDDEN',
        409,
        detail || 'Bác sĩ không ở trạng thái hoạt động (DOCTOR_INACTIVE).',
      )
    }
    if (problemCode === 'USER_NOT_ACTIVE') {
      throw new ScheduleError(
        'FORBIDDEN',
        409,
        detail ||
          'Tài khoản người dùng liên kết với bác sĩ đang bị khóa (USER_NOT_ACTIVE).',
      )
    }
    throw new ScheduleError(
      'SCHEDULE_OVERLAP',
      409,
      detail ||
        'Ca làm việc bị trùng thời gian với ca khác của bác sĩ trong cùng khoảng thời gian (409 Conflict).',
    )
  }

  if (status === 403) {
    throw new ScheduleError(
      'FORBIDDEN',
      403,
      detail ||
        'Bạn không có quyền xem hoặc thực hiện thao tác trên ca làm việc này.',
    )
  }

  if (status === 401) {
    throw new ScheduleError('UNAUTHORIZED', 401, detail)
  }

  if (status === 404) {
    throw new ScheduleError('SCHEDULE_NOT_FOUND', 404, detail)
  }

  if (status === 400) {
    const fieldErrors = (
      problem.errors && typeof problem.errors === 'object' ? problem.errors : {}
    ) as Record<string, string>
    throw new ScheduleError(
      'VALIDATION_FAILED',
      400,
      detail || 'Thông tin ca làm việc không hợp lệ.',
      fieldErrors,
    )
  }

  throw new ScheduleError(
    problemCode === 'SCHEDULE_OVERLAP'
      ? 'SCHEDULE_OVERLAP'
      : 'UNKNOWN_SCHEDULE_ERROR',
    status,
    detail,
  )
}

export function createScheduleApi(client: AxiosInstance): ScheduleGateway {
  return {
    mode: 'real',

    async listSchedules(
      query: ScheduleQuery,
      signal?: AbortSignal,
    ): Promise<DoctorSchedule[]> {
      const params: Record<string, string | number> = {
        size: 100,
      }
      if (query.doctorId) params.doctorId = query.doctorId
      if (query.status && query.status !== 'ALL') params.status = query.status

      if (query.startDate && query.endDate) {
        if (query.startDate === query.endDate) {
          params.workDate = query.startDate
        } else {
          params.from = query.startDate
          params.to = query.endDate
        }
      } else if (query.startDate) {
        params.from = query.startDate
      }

      try {
        const res = await client.get('/api/v1/doctor-schedules', {
          params,
          signal,
        })
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
          return invalid()
        }

        return items.map(decodeSchedule)
      } catch (err) {
        handleScheduleError(err)
      }
    },

    async getSchedule(
      id: string,
      signal?: AbortSignal,
    ): Promise<DoctorSchedule> {
      if (!validId(id)) throw new ScheduleError('VALIDATION_FAILED', 400)
      try {
        const res = await client.get(`/api/v1/doctor-schedules/${id}`, {
          signal,
        })
        return decodeSchedule(data(res.data))
      } catch (err) {
        handleScheduleError(err)
      }
    },

    async createSchedule(
      draft: ScheduleDraft,
      signal?: AbortSignal,
    ): Promise<DoctorSchedule> {
      const errors = validateSchedule(draft)
      if (Object.keys(errors).length > 0) {
        throw new ScheduleError(
          'VALIDATION_FAILED',
          400,
          'Dữ liệu ca làm việc không hợp lệ.',
          errors,
        )
      }

      // Convert Vietnam time to UTC ISO-8601
      const startAt = toUtcIso(draft.date, draft.startTime)
      const endAt = toUtcIso(draft.date, draft.endTime)

      // Strictly adhere to Backend DTO: DoctorScheduleCreateRequest
      // Do NOT send roomLabel or reason!
      const payload = {
        doctorId: draft.doctorId,
        startAt,
        endAt,
        slotMinutes: draft.slotDurationMinutes,
        status: draft.status,
      }

      try {
        const res = await client.post('/api/v1/doctor-schedules', payload, {
          signal,
        })
        return decodeSchedule(data(res.data))
      } catch (err) {
        handleScheduleError(err)
      }
    },

    async updateSchedule(
      id: string,
      draft: Partial<ScheduleDraft>,
      signal?: AbortSignal,
    ): Promise<DoctorSchedule> {
      if (!validId(id)) throw new ScheduleError('VALIDATION_FAILED', 400)

      // Strictly adhere to Backend DTO: DoctorSchedulePatchRequest
      // Do NOT send doctorId, roomLabel, or reason!
      const payload: Record<string, unknown> = {}
      if (draft.date && draft.startTime && draft.endTime) {
        payload.startAt = toUtcIso(draft.date, draft.startTime)
        payload.endAt = toUtcIso(draft.date, draft.endTime)
      }
      if (draft.status) {
        payload.status = draft.status
      }
      if (draft.slotDurationMinutes) {
        payload.slotMinutes = draft.slotDurationMinutes
      }

      if (Object.keys(payload).length === 0) {
        throw new ScheduleError(
          'VALIDATION_FAILED',
          400,
          'Dữ liệu cập nhật không được rỗng.',
        )
      }

      try {
        const res = await client.patch(
          `/api/v1/doctor-schedules/${id}`,
          payload,
          { signal },
        )
        return decodeSchedule(data(res.data))
      } catch (err) {
        handleScheduleError(err)
      }
    },

    async blockSchedule(
      id: string,
      _reason?: string,
      signal?: AbortSignal,
    ): Promise<DoctorSchedule> {
      if (!validId(id)) throw new ScheduleError('VALIDATION_FAILED', 400)

      // Strictly send status BLOCKED (no reason parameter in Backend DTO)
      const payload = {
        status: 'BLOCKED',
      }

      try {
        const res = await client.patch(
          `/api/v1/doctor-schedules/${id}`,
          payload,
          { signal },
        )
        return decodeSchedule(data(res.data))
      } catch (err) {
        handleScheduleError(err)
      }
    },

    async listDoctorSlots(
      doctorId: string,
      date: string,
      signal?: AbortSignal,
    ): Promise<ScheduleSlot[]> {
      if (!validId(doctorId)) throw new ScheduleError('VALIDATION_FAILED', 400)

      try {
        const res = await client.get(
          `/api/v1/doctors/${doctorId}/schedule-slots`,
          {
            params: { date },
            signal,
          },
        )
        const payload = data(res.data)
        const list = Array.isArray(payload) ? payload : invalid()
        return list.map(decodeSlot)
      } catch (err) {
        handleScheduleError(err)
      }
    },
  }
}
