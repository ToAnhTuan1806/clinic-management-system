// Synthetic mock implementation for Doctor Work Schedules (Sprint 2 - D06).
// Runs in DEV and offline test mode. Enforces role-based permissions and overlap validation.

import { getAuthSnapshot } from '@/auth/session-store'
import {
  areIntervalsOverlapping,
  fromUtcIsoToVnParts,
  getVnTodayString,
  ScheduleError,
  toUtcIso,
  validId,
  validateSchedule,
  type DoctorSchedule,
  type ScheduleDraft,
  type ScheduleGateway,
  type ScheduleQuery,
  type ScheduleSlot,
} from '@/schedule/model'

export interface MockDoctorRef {
  id: string
  doctorCode: string
  fullName: string
  specialtyName: string
  userId?: string
}

export const MOCK_DOCTORS: MockDoctorRef[] = [
  {
    id: '1',
    doctorCode: 'DOC001',
    fullName: 'TS.BS Nguyễn Văn A',
    specialtyName: 'Nội tổng quát',
    userId: '1001',
  },
  {
    id: '2',
    doctorCode: 'DOC002',
    fullName: 'ThS.BS Trần Thị B',
    specialtyName: 'Tim mạch',
    userId: '1002',
  },
  {
    id: '3',
    doctorCode: 'DOC003',
    fullName: 'BSCKI Lê Hoàng C',
    specialtyName: 'Da liễu',
    userId: '1003',
  },
  {
    id: '4',
    doctorCode: 'DOC004',
    fullName: 'BSCKII Phạm Minh D',
    specialtyName: 'Nhi khoa',
    userId: '1004',
  },
]

export function createScheduleMock({ latency = 0 } = {}): ScheduleGateway {
  let nextScheduleId = 100

  const todayStr = getVnTodayString()
  const [yearStr, monthStr, dayStr] = todayStr.split('-')
  const y = parseInt(yearStr, 10)
  const m = parseInt(monthStr, 10) - 1
  const d = parseInt(dayStr, 10)

  // Generate date offset helper (in VN days)
  const getOffsetVnDate = (offsetDays: number): string => {
    const curMs = Date.UTC(y, m, d) + offsetDays * 24 * 60 * 60 * 1000
    const cur = new Date(curMs)
    const curYear = cur.getUTCFullYear()
    const curMonth = String(cur.getUTCMonth() + 1).padStart(2, '0')
    const curDay = String(cur.getUTCDate()).padStart(2, '0')
    return `${curYear}-${curMonth}-${curDay}`
  }

  // Pre-seed realistic shifts for testing
  const schedules: DoctorSchedule[] = [
    // Doctor 1 - Today morning ACTIVE (08:00 - 12:00)
    {
      id: '1',
      doctorId: '1',
      doctorName: 'TS.BS Nguyễn Văn A',
      doctorCode: 'DOC001',
      specialtyName: 'Nội tổng quát',
      startsAt: toUtcIso(getOffsetVnDate(0), '08:00'),
      endsAt: toUtcIso(getOffsetVnDate(0), '12:00'),
      status: 'ACTIVE',
      roomLabel: 'Phòng 101 - Khám nội',
      slotDurationMinutes: 30,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    // Doctor 1 - Today afternoon ACTIVE (13:30 - 17:30)
    {
      id: '2',
      doctorId: '1',
      doctorName: 'TS.BS Nguyễn Văn A',
      doctorCode: 'DOC001',
      specialtyName: 'Nội tổng quát',
      startsAt: toUtcIso(getOffsetVnDate(0), '13:30'),
      endsAt: toUtcIso(getOffsetVnDate(0), '17:30'),
      status: 'ACTIVE',
      roomLabel: 'Phòng 101 - Khám nội',
      slotDurationMinutes: 30,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    // Doctor 1 - Tomorrow morning ACTIVE (08:00 - 12:00)
    {
      id: '8',
      doctorId: '1',
      doctorName: 'TS.BS Nguyễn Văn A',
      doctorCode: 'DOC001',
      specialtyName: 'Nội tổng quát',
      startsAt: toUtcIso(getOffsetVnDate(1), '08:00'),
      endsAt: toUtcIso(getOffsetVnDate(1), '12:00'),
      status: 'ACTIVE',
      roomLabel: 'Phòng 101 - Khám nội',
      slotDurationMinutes: 30,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    // Doctor 1 - Day after tomorrow morning ACTIVE (08:00 - 12:00)
    {
      id: '9',
      doctorId: '1',
      doctorName: 'TS.BS Nguyễn Văn A',
      doctorCode: 'DOC001',
      specialtyName: 'Nội tổng quát',
      startsAt: toUtcIso(getOffsetVnDate(2), '08:00'),
      endsAt: toUtcIso(getOffsetVnDate(2), '12:00'),
      status: 'ACTIVE',
      roomLabel: 'Phòng 101 - Khám nội',
      slotDurationMinutes: 30,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    // Doctor 2 - Today morning BLOCKED (08:30 - 11:30)
    {
      id: '3',
      doctorId: '2',
      doctorName: 'ThS.BS Trần Thị B',
      doctorCode: 'DOC002',
      specialtyName: 'Tim mạch',
      startsAt: toUtcIso(getOffsetVnDate(0), '08:30'),
      endsAt: toUtcIso(getOffsetVnDate(0), '11:30'),
      status: 'BLOCKED',
      roomLabel: 'Phòng 202 - Tim mạch',
      slotDurationMinutes: 30,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    // Doctor 2 - Tomorrow morning ACTIVE (08:00 - 12:00)
    {
      id: '4',
      doctorId: '2',
      doctorName: 'ThS.BS Trần Thị B',
      doctorCode: 'DOC002',
      specialtyName: 'Tim mạch',
      startsAt: toUtcIso(getOffsetVnDate(1), '08:00'),
      endsAt: toUtcIso(getOffsetVnDate(1), '12:00'),
      status: 'ACTIVE',
      roomLabel: 'Phòng 202 - Tim mạch',
      slotDurationMinutes: 15,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    // Doctor 3 - Yesterday morning ACTIVE (08:00 - 12:00)
    {
      id: '5',
      doctorId: '3',
      doctorName: 'BSCKI Lê Hoàng C',
      doctorCode: 'DOC003',
      specialtyName: 'Da liễu',
      startsAt: toUtcIso(getOffsetVnDate(-1), '08:00'),
      endsAt: toUtcIso(getOffsetVnDate(-1), '12:00'),
      status: 'ACTIVE',
      roomLabel: 'Phòng 301 - Da liễu',
      slotDurationMinutes: 30,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    // Doctor 3 - Day after tomorrow afternoon ACTIVE (13:00 - 17:00)
    {
      id: '6',
      doctorId: '3',
      doctorName: 'BSCKI Lê Hoàng C',
      doctorCode: 'DOC003',
      specialtyName: 'Da liễu',
      startsAt: toUtcIso(getOffsetVnDate(2), '13:00'),
      endsAt: toUtcIso(getOffsetVnDate(2), '17:00'),
      status: 'ACTIVE',
      roomLabel: 'Phòng 301 - Da liễu',
      slotDurationMinutes: 60,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    // Doctor 4 - Tomorrow afternoon ACTIVE (14:00 - 18:00)
    {
      id: '7',
      doctorId: '4',
      doctorName: 'BSCKII Phạm Minh D',
      doctorCode: 'DOC004',
      specialtyName: 'Nhi khoa',
      startsAt: toUtcIso(getOffsetVnDate(1), '14:00'),
      endsAt: toUtcIso(getOffsetVnDate(1), '18:00'),
      status: 'ACTIVE',
      roomLabel: 'Phòng 105 - Nhi khoa',
      slotDurationMinutes: 30,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ]

  const wait = () =>
    latency > 0 ? new Promise((r) => setTimeout(r, latency)) : Promise.resolve()

  const checkRoleAccess = (
    operation: 'read' | 'write' | 'block',
  ): { role: string; userId?: string } => {
    const auth = getAuthSnapshot()
    const user = auth.user
    const role = user?.role || 'PATIENT'

    if (operation === 'write' || operation === 'block') {
      if (role !== 'ADMIN' && role !== 'RECEPTIONIST') {
        throw new ScheduleError('FORBIDDEN', 403)
      }
    }
    return { role, userId: user?.id }
  }

  return {
    mode: 'mock',

    async listSchedules(query: ScheduleQuery): Promise<DoctorSchedule[]> {
      await wait()
      const { role, userId } = checkRoleAccess('read')

      let filtered = [...schedules]

      // DOCTOR role: can ONLY view own schedule
      if (role === 'DOCTOR') {
        const myDoctor = MOCK_DOCTORS.find((d) => d.userId === userId)
        if (myDoctor) {
          filtered = filtered.filter((s) => s.doctorId === myDoctor.id)
        } else {
          // If logged-in user is DOCTOR but has no assigned doctor record, return empty list
          return []
        }
      } else if (query.doctorId) {
        filtered = filtered.filter((s) => s.doctorId === query.doctorId)
      }

      // Filter by status if specified
      if (query.status && query.status !== 'ALL') {
        filtered = filtered.filter((s) => s.status === query.status)
      }

      // Filter by date range (VN date YYYY-MM-DD or ISO)
      if (query.startDate) {
        const startDay = query.startDate.slice(0, 10)
        filtered = filtered.filter((s) => {
          const { date } = fromUtcIsoToVnParts(s.startsAt)
          return date >= startDay
        })
      }
      if (query.endDate) {
        const endDay = query.endDate.slice(0, 10)
        filtered = filtered.filter((s) => {
          const { date } = fromUtcIsoToVnParts(s.endsAt)
          return date <= endDay
        })
      }

      // Sort by startsAt ascending
      return filtered.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    },

    async getSchedule(id: string): Promise<DoctorSchedule> {
      await wait()
      if (!validId(id)) throw new ScheduleError('VALIDATION_FAILED', 400)

      const found = schedules.find((s) => s.id === id)
      if (!found) throw new ScheduleError('SCHEDULE_NOT_FOUND', 404)

      const { role, userId } = checkRoleAccess('read')
      if (role === 'DOCTOR') {
        const myDoctor = MOCK_DOCTORS.find((d) => d.userId === userId)
        if (!myDoctor || found.doctorId !== myDoctor.id) {
          throw new ScheduleError('FORBIDDEN', 403)
        }
      }

      return { ...found }
    },

    async createSchedule(draft: ScheduleDraft): Promise<DoctorSchedule> {
      await wait()
      checkRoleAccess('write')

      const errors = validateSchedule(draft)
      if (Object.keys(errors).length > 0) {
        throw new ScheduleError(
          'VALIDATION_FAILED',
          400,
          'Dữ liệu ca làm việc không hợp lệ.',
          errors,
        )
      }

      const startsAt = toUtcIso(draft.date, draft.startTime)
      const endsAt = toUtcIso(draft.date, draft.endTime)

      // Overlap checking: doctor cannot have overlapping ACTIVE or BLOCKED shift
      const overlap = schedules.some((s) => {
        if (s.doctorId !== draft.doctorId) return false
        return areIntervalsOverlapping(startsAt, endsAt, s.startsAt, s.endsAt)
      })

      if (overlap) {
        throw new ScheduleError(
          'SCHEDULE_OVERLAP',
          409,
          'Ca làm việc bị trùng thời gian với ca khác của bác sĩ trong cùng khoảng thời gian (409 Conflict).',
        )
      }

      const doctor = MOCK_DOCTORS.find((d) => d.id === draft.doctorId)
      const newSchedule: DoctorSchedule = {
        id: String(nextScheduleId++),
        doctorId: draft.doctorId,
        doctorName: doctor?.fullName || `Bác sĩ ${draft.doctorId}`,
        doctorCode: doctor?.doctorCode || `DOC_${draft.doctorId}`,
        specialtyName: doctor?.specialtyName || 'Chuyên khoa',
        startsAt,
        endsAt,
        status: draft.status || 'ACTIVE',
        roomLabel: draft.roomLabel?.trim() || null,
        slotDurationMinutes: draft.slotDurationMinutes || 30,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      schedules.push(newSchedule)
      return { ...newSchedule }
    },

    async updateSchedule(
      id: string,
      draft: Partial<ScheduleDraft>,
    ): Promise<DoctorSchedule> {
      await wait()
      checkRoleAccess('write')
      if (!validId(id)) throw new ScheduleError('VALIDATION_FAILED', 400)

      const index = schedules.findIndex((s) => s.id === id)
      if (index === -1) throw new ScheduleError('SCHEDULE_NOT_FOUND', 404)

      const current = schedules[index]

      // Merge current values with draft
      const currentParts = fromUtcIsoToVnParts(current.startsAt)
      const currentEndParts = fromUtcIsoToVnParts(current.endsAt)

      const fullDraft: ScheduleDraft = {
        doctorId: draft.doctorId || current.doctorId,
        date: draft.date || currentParts.date,
        startTime: draft.startTime || currentParts.time,
        endTime: draft.endTime || currentEndParts.time,
        status: draft.status || current.status,
        roomLabel:
          draft.roomLabel !== undefined
            ? draft.roomLabel
            : current.roomLabel || '',
        slotDurationMinutes:
          draft.slotDurationMinutes ||
          (current.slotDurationMinutes as 15 | 30 | 60) ||
          30,
      }

      const errors = validateSchedule(fullDraft)
      if (Object.keys(errors).length > 0) {
        throw new ScheduleError(
          'VALIDATION_FAILED',
          400,
          'Dữ liệu chỉnh sửa ca làm việc không hợp lệ.',
          errors,
        )
      }

      const startsAt = toUtcIso(fullDraft.date, fullDraft.startTime)
      const endsAt = toUtcIso(fullDraft.date, fullDraft.endTime)

      // Check overlap with other schedules of this doctor
      const overlap = schedules.some((s) => {
        if (s.id === id || s.doctorId !== fullDraft.doctorId) return false
        return areIntervalsOverlapping(startsAt, endsAt, s.startsAt, s.endsAt)
      })

      if (overlap) {
        throw new ScheduleError(
          'SCHEDULE_OVERLAP',
          409,
          'Ca làm việc bị trùng thời gian với ca khác của bác sĩ trong cùng khoảng thời gian (409 Conflict).',
        )
      }

      const doctor = MOCK_DOCTORS.find((d) => d.id === fullDraft.doctorId)
      const updated: DoctorSchedule = {
        ...current,
        doctorId: fullDraft.doctorId,
        doctorName: doctor?.fullName || current.doctorName,
        doctorCode: doctor?.doctorCode || current.doctorCode,
        specialtyName: doctor?.specialtyName || current.specialtyName,
        startsAt,
        endsAt,
        status: fullDraft.status,
        roomLabel: fullDraft.roomLabel?.trim() || null,
        slotDurationMinutes: fullDraft.slotDurationMinutes,
        updatedAt: new Date().toISOString(),
      }

      schedules[index] = updated
      return { ...updated }
    },

    async blockSchedule(id: string, _reason?: string): Promise<DoctorSchedule> {
      await wait()
      checkRoleAccess('block')
      if (!validId(id)) throw new ScheduleError('VALIDATION_FAILED', 400)

      const index = schedules.findIndex((s) => s.id === id)
      if (index === -1) throw new ScheduleError('SCHEDULE_NOT_FOUND', 404)

      const current = schedules[index]
      const updated: DoctorSchedule = {
        ...current,
        status: 'BLOCKED',
        updatedAt: new Date().toISOString(),
      }

      schedules[index] = updated
      return { ...updated }
    },

    async listDoctorSlots(
      doctorId: string,
      date: string,
    ): Promise<ScheduleSlot[]> {
      await wait()
      if (!validId(doctorId)) throw new ScheduleError('VALIDATION_FAILED', 400)

      const doctorSchedules = schedules.filter((s) => {
        if (s.doctorId !== doctorId) return false
        const { date: shiftDate } = fromUtcIsoToVnParts(s.startsAt)
        return shiftDate === date
      })

      const slots: ScheduleSlot[] = []
      let slotCounter = 1

      for (const shift of doctorSchedules) {
        const slotMinutes = shift.slotDurationMinutes || 30
        const shiftStartMs = new Date(shift.startsAt).getTime()
        const shiftEndMs = new Date(shift.endsAt).getTime()
        const slotMs = slotMinutes * 60 * 1000

        for (
          let cur = shiftStartMs;
          cur + slotMs <= shiftEndMs;
          cur += slotMs
        ) {
          const slotStart = new Date(cur).toISOString()
          const slotEnd = new Date(cur + slotMs).toISOString()

          let slotStatus: 'AVAILABLE' | 'BOOKED' | 'BLOCKED' = 'AVAILABLE'
          if (shift.status === 'BLOCKED') {
            slotStatus = 'BLOCKED'
          } else if (slotCounter % 4 === 0) {
            // Seed a few booked slots for realism
            slotStatus = 'BOOKED'
          }

          slots.push({
            id: `${shift.id}-${slotCounter++}`,
            scheduleId: shift.id,
            doctorId: shift.doctorId,
            doctorName: shift.doctorName,
            startsAt: slotStart,
            endsAt: slotEnd,
            status: slotStatus,
            roomLabel: shift.roomLabel,
          })
        }
      }

      return slots
    },
  }
}
