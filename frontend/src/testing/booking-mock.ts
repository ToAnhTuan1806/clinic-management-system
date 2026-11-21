// Synthetic mock implementation for Patient Appointment Booking (Sprint 2 - D07)
// Runs in DEV and offline test mode. Enforces idempotency and slot collision detection.

import { getAuthSnapshot } from '@/auth/session-store'
import { fromUtcIsoToVnParts } from '@/schedule/model'
import { MOCK_DOCTORS } from '@/testing/schedule-mock'
import {
  BookingError,
  validateBookingDraft,
  type Appointment,
  type BookingDraft,
  type BookingGateway,
} from '@/booking/model'

export function createBookingMock({ latency = 0 } = {}): BookingGateway {
  let nextAppointmentId = 500
  let codeSeq = 100

  // Track booked slots: key = `${scheduleId}_${startAt}`
  const bookedSlots = new Map<
    string,
    { appointmentId: string; requestKey: string }
  >()

  // In-memory appointments list
  const appointments: Appointment[] = [
    {
      id: '1',
      appointmentCode: 'APT_20261121_001',
      patientId: '10',
      patientName: 'DEMO · Bệnh nhân 01',
      patientPhone: '0901234567',
      doctorId: '1',
      doctorName: 'TS.BS Nguyễn Văn A',
      doctorCode: 'DOC001',
      specialtyName: 'Nội tổng quát',
      scheduleId: '1',
      startAt: '2026-11-25T01:00:00.000Z',
      endAt: '2026-11-25T01:30:00.000Z',
      status: 'CONFIRMED',
      reason: 'Khám định kỳ',
      roomLabel: 'Phòng 101 - Khám nội',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ]

  // Record initial booked slot
  bookedSlots.set('1_2026-11-25T01:00:00.000Z', {
    appointmentId: '1',
    requestKey: 'initial_req_1',
  })

  const wait = () =>
    latency > 0 ? new Promise((r) => setTimeout(r, latency)) : Promise.resolve()

  const checkRoleAccess = (): {
    role: string
    userId?: string
    userName?: string
  } => {
    const auth = getAuthSnapshot()
    const user = auth.user
    const role = user?.role || 'PATIENT'

    if (role === 'DOCTOR') {
      throw new BookingError(
        'FORBIDDEN',
        403,
        'Bác sĩ không có quyền thực hiện đặt lịch thay cho bệnh nhân.',
      )
    }

    return { role, userId: user?.id, userName: user?.fullName }
  }

  return {
    mode: 'mock',

    async bookAppointment(draft: BookingDraft): Promise<Appointment> {
      await wait()
      const { role, userId, userName } = checkRoleAccess()

      const errors = validateBookingDraft(draft)
      if (Object.keys(errors).length > 0) {
        throw new BookingError(
          'VALIDATION_FAILED',
          400,
          'Dữ liệu đặt lịch không hợp lệ.',
          errors,
        )
      }

      const slotKey = `${draft.slot.scheduleId}_${draft.slot.startsAt}`

      // Check slot collision and idempotency
      if (bookedSlots.has(slotKey)) {
        const existing = bookedSlots.get(slotKey)!
        // If same requestKey is retried, return the existing appointment idempotently!
        if (existing.requestKey === draft.requestKey) {
          const app = appointments.find((a) => a.id === existing.appointmentId)
          if (app) return { ...app }
        }

        // Different requestKey trying to book an already-booked slot -> 409 Conflict!
        throw new BookingError(
          'SLOT_UNAVAILABLE',
          409,
          'Khung giờ này vừa được người khác đặt trước hoặc không còn khả dụng. Vui lòng chọn khung giờ khác (409 Conflict).',
        )
      }

      // Resolve doctor details
      const doctor = MOCK_DOCTORS.find((d) => d.id === draft.doctorId)

      // Format appointment code: APT_YYYYMMDD_SEQ
      const dateParts = fromUtcIsoToVnParts(draft.slot.startsAt)
      const cleanDate = dateParts.date.replace(/-/g, '')
      const appointmentCode = `APT_${cleanDate}_${codeSeq++}`

      const patientId =
        role === 'PATIENT' ? userId || '10' : draft.patientId || '10'
      const patientName =
        role === 'PATIENT' ? userName || 'Bệnh nhân' : `Bệnh nhân ${patientId}`

      const newAppointment: Appointment = {
        id: String(nextAppointmentId++),
        appointmentCode,
        patientId,
        patientName,
        doctorId: draft.doctorId,
        doctorName: doctor?.fullName || `Bác sĩ ${draft.doctorId}`,
        doctorCode: doctor?.doctorCode || `DOC_${draft.doctorId}`,
        specialtyName: doctor?.specialtyName || 'Chuyên khoa',
        scheduleId: draft.slot.scheduleId,
        startAt: draft.slot.startsAt,
        endAt: draft.slot.endsAt,
        status: 'PENDING',
        reason: draft.reason?.trim() || null,
        roomLabel: draft.slot.roomLabel || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      appointments.push(newAppointment)
      bookedSlots.set(slotKey, {
        appointmentId: newAppointment.id,
        requestKey: draft.requestKey,
      })

      return { ...newAppointment }
    },

    async getAppointment(idParam: string): Promise<Appointment> {
      await wait()
      checkRoleAccess()

      const found = appointments.find((a) => a.id === idParam)
      if (!found) {
        throw new BookingError(
          'NOT_FOUND',
          404,
          'Không tìm thấy thông tin lịch hẹn.',
        )
      }

      return { ...found }
    },

    async listMyAppointments(): Promise<Appointment[]> {
      await wait()
      const { role, userId } = checkRoleAccess()

      if (role === 'PATIENT') {
        return appointments
          .filter((a) => a.patientId === userId || a.patientId === '10')
          .sort((a, b) => b.startAt.localeCompare(a.startAt))
      }

      return [...appointments].sort((a, b) =>
        b.startAt.localeCompare(a.startAt),
      )
    },
  }
}
