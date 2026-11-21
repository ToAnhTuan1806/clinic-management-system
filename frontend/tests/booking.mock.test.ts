import { beforeEach, describe, expect, it } from 'vitest'
import {
  beginAuthentication,
  clearSession,
  establishSession,
} from '@/auth/session-store'
import type { Role } from '@/auth/types'
import type { BookingDraft } from '@/booking/model'
import { createBookingMock } from '@/testing/booking-mock'

function login(
  role: Role = 'PATIENT',
  id = '10',
  fullName = 'Nguyễn Văn Bệnh Nhân',
) {
  establishSession(beginAuthentication(), crypto.randomUUID(), {
    id,
    role,
    email: `${role.toLowerCase()}@clinic.test`,
    fullName,
  })
}

describe('Patient Appointment Booking Mock Gateway Tests (Sprint 2 - D07)', () => {
  const futureDate = '2029-11-25'
  const futureSlot1 = {
    scheduleId: '101',
    startsAt: '2029-11-25T01:00:00.000Z',
    endsAt: '2029-11-25T01:30:00.000Z',
    isAvailable: true,
    roomLabel: 'Phòng 101 - Khám nội',
  }
  const futureSlot2 = {
    scheduleId: '101',
    startsAt: '2029-11-25T01:30:00.000Z',
    endsAt: '2029-11-25T02:00:00.000Z',
    isAvailable: true,
    roomLabel: 'Phòng 101 - Khám nội',
  }

  const validDraft: BookingDraft = {
    specialtyId: '1',
    doctorId: '1',
    date: futureDate,
    slot: futureSlot1,
    reason: 'Đau đầu, muốn kiểm tra định kỳ',
    requestKey: 'req_pat_test_001',
  }

  beforeEach(() => {
    clearSession()
  })

  describe('PATIENT Booking Flow', () => {
    it('allows authenticated PATIENT to successfully book an appointment', async () => {
      login('PATIENT', '10', 'Bệnh Nhân A')
      const gateway = createBookingMock()

      const result = await gateway.bookAppointment(validDraft)

      expect(result).toBeDefined()
      expect(result.id).toBeDefined()
      expect(typeof result.id).toBe('string')
      expect(result.appointmentCode).toMatch(/^APT_20291125_\d+$/)
      expect(result.patientId).toBe('10')
      expect(result.patientName).toBe('Bệnh Nhân A')
      expect(result.doctorId).toBe('1')
      expect(result.status).toBe('PENDING')
      expect(result.startAt).toBe(futureSlot1.startsAt)
      expect(result.endAt).toBe(futureSlot1.endsAt)
      expect(result.reason).toBe('Đau đầu, muốn kiểm tra định kỳ')
      expect(result.roomLabel).toBe('Phòng 101 - Khám nội')
    })

    it('can retrieve the created appointment by ID', async () => {
      login('PATIENT', '10', 'Bệnh Nhân A')
      const gateway = createBookingMock()

      const created = await gateway.bookAppointment(validDraft)
      const fetched = await gateway.getAppointment(created.id)

      expect(fetched.id).toBe(created.id)
      expect(fetched.appointmentCode).toBe(created.appointmentCode)
      expect(fetched.patientId).toBe('10')
      expect(fetched.doctorId).toBe('1')
    })

    it('lists appointments belonging to the patient', async () => {
      login('PATIENT', '10', 'Bệnh Nhân A')
      const gateway = createBookingMock()

      await gateway.bookAppointment(validDraft)
      const list = await gateway.listMyAppointments()

      expect(list.length).toBeGreaterThanOrEqual(1)
      expect(list.some((a) => a.scheduleId === '101')).toBe(true)
    })
  })

  describe('RECEPTIONIST Booking on Behalf of Patient', () => {
    it('allows RECEPTIONIST to book for a patient using patientId', async () => {
      login('RECEPTIONIST', '200', 'Lễ Tân 01')
      const gateway = createBookingMock()

      const receptionistDraft: BookingDraft = {
        ...validDraft,
        slot: futureSlot2,
        patientId: '77',
        requestKey: 'req_rec_test_002',
        reason: 'Đặt lịch qua điện thoại tại quầy',
      }

      const result = await gateway.bookAppointment(receptionistDraft)

      expect(result.patientId).toBe('77')
      expect(result.doctorId).toBe('1')
      expect(result.reason).toBe('Đặt lịch qua điện thoại tại quầy')
    })
  })

  describe('Role Authorization Restrictions', () => {
    it('strictly forbids DOCTOR role from booking appointments (403)', async () => {
      login('DOCTOR', '300', 'Bác sĩ A')
      const gateway = createBookingMock()

      await expect(gateway.bookAppointment(validDraft)).rejects.toMatchObject({
        name: 'BookingError',
        code: 'FORBIDDEN',
        status: 403,
      })
    })
  })

  describe('Slot Collision Detection (409 Conflict)', () => {
    it('rejects a second booking on the same slot with 409 Conflict', async () => {
      login('PATIENT', '10', 'Bệnh nhân 01')
      const gateway = createBookingMock()

      // First booking succeeds
      const first = await gateway.bookAppointment(validDraft)
      expect(first.id).toBeDefined()

      // Second user attempts to book the same slot with different requestKey
      login('PATIENT', '20', 'Bệnh nhân 02')
      const collisionDraft: BookingDraft = {
        ...validDraft,
        requestKey: 'req_different_user_999',
      }

      await expect(
        gateway.bookAppointment(collisionDraft),
      ).rejects.toMatchObject({
        name: 'BookingError',
        code: 'SLOT_UNAVAILABLE',
        status: 409,
        message: expect.stringContaining('409 Conflict'),
      })
    })
  })

  describe('Idempotency Handling', () => {
    it('returns the existing appointment on identical requestKey retry without duplicate creation', async () => {
      login('PATIENT', '10', 'Bệnh nhân 01')
      const gateway = createBookingMock()

      const firstCall = await gateway.bookAppointment(validDraft)

      // Same requestKey retried (e.g. client timeout or double-click retry)
      const secondCall = await gateway.bookAppointment(validDraft)

      expect(secondCall.id).toBe(firstCall.id)
      expect(secondCall.appointmentCode).toBe(firstCall.appointmentCode)
    })
  })

  describe('Error handling & Not Found', () => {
    it('throws 404 NOT_FOUND for non-existent appointment ID', async () => {
      login('PATIENT', '10')
      const gateway = createBookingMock()

      await expect(gateway.getAppointment('999999')).rejects.toMatchObject({
        name: 'BookingError',
        code: 'NOT_FOUND',
        status: 404,
      })
    })
  })

  describe('Sprint 2 D08 — List Appointments & Filtering', () => {
    it('PATIENT sees only own linked appointments in listAppointments', async () => {
      login('PATIENT', '10', 'Bệnh nhân 10')
      const gateway = createBookingMock()

      const res = await gateway.listAppointments()
      expect(res.items.length).toBeGreaterThanOrEqual(1)
      expect(res.items.every((a) => a.patientId === '10')).toBe(true)
    })

    it('RECEPTIONIST sees clinic-wide appointments and can filter by status', async () => {
      login('RECEPTIONIST', '200', 'Lễ Tân')
      const gateway = createBookingMock()

      const allRes = await gateway.listAppointments()
      expect(allRes.items.length).toBeGreaterThan(1)

      const confirmedRes = await gateway.listAppointments({
        status: 'CONFIRMED',
      })
      expect(confirmedRes.items.every((a) => a.status === 'CONFIRMED')).toBe(
        true,
      )
    })

    it('DOCTOR only sees appointments assigned to their doctorId', async () => {
      login('DOCTOR', '1', 'Bác sĩ Lê Thị Mai')
      const gateway = createBookingMock()

      const docRes = await gateway.listAppointments()
      expect(docRes.items.every((a) => a.doctorId === '1')).toBe(true)
    })
  })

  describe('Sprint 2 D08 — Change Slot Flow & Optimistic Concurrency', () => {
    it('PATIENT changes slot for future appointment, returning PENDING with incremented version', async () => {
      login('PATIENT', '10', 'Bệnh nhân A')
      const gateway = createBookingMock()

      // Book a future appointment
      const app = await gateway.bookAppointment(validDraft)
      expect(app.version).toBe(0)

      const newStartAt = '2029-11-25T03:00:00.000Z'
      const updated = await gateway.changeSlot({
        appointmentId: app.id,
        scheduleId: '101',
        startAt: newStartAt,
        expectedVersion: 0,
      })

      expect(updated.id).toBe(app.id)
      expect(updated.startAt).toBe(newStartAt)
      expect(updated.status).toBe('PENDING')
      expect(updated.version).toBe(1)
      expect(updated.rescheduledAt).toBeDefined()
    })

    it('rejects changeSlot when target slot is already occupied (409 SLOT_UNAVAILABLE)', async () => {
      login('PATIENT', '10', 'Bệnh nhân A')
      const gateway = createBookingMock()

      // Book slot 1
      const app1 = await gateway.bookAppointment(validDraft)

      // Book slot 2 with a different requestKey
      const draft2: BookingDraft = {
        ...validDraft,
        slot: futureSlot2,
        requestKey: 'req_pat_test_002',
      }
      await gateway.bookAppointment(draft2)

      // App 1 tries to change into slot 2 (already booked)
      await expect(
        gateway.changeSlot({
          appointmentId: app1.id,
          scheduleId: futureSlot2.scheduleId,
          startAt: futureSlot2.startsAt,
          expectedVersion: 0,
        }),
      ).rejects.toMatchObject({
        name: 'BookingError',
        code: 'SLOT_UNAVAILABLE',
        status: 409,
      })
    })

    it('rejects changeSlot with stale expectedVersion (409 VERSION_CONFLICT)', async () => {
      login('PATIENT', '10', 'Bệnh nhân A')
      const gateway = createBookingMock()

      const app = await gateway.bookAppointment(validDraft)

      await expect(
        gateway.changeSlot({
          appointmentId: app.id,
          scheduleId: '101',
          startAt: '2029-11-25T04:00:00.000Z',
          expectedVersion: 99, // Stale version
        }),
      ).rejects.toMatchObject({
        name: 'BookingError',
        code: 'VERSION_CONFLICT',
        status: 409,
      })
    })

    it('rejects changeSlot when appointment is CANCELLED (409 INVALID_STATE_TRANSITION)', async () => {
      login('PATIENT', '10', 'Bệnh nhân A')
      const gateway = createBookingMock()

      // Initial mock data has app '3' with status CANCELLED
      await expect(
        gateway.changeSlot({
          appointmentId: '3',
          scheduleId: '101',
          startAt: '2029-11-25T05:00:00.000Z',
          expectedVersion: 1,
        }),
      ).rejects.toMatchObject({
        name: 'BookingError',
        code: 'INVALID_STATE_TRANSITION',
        status: 409,
      })
    })

    it('forbids DOCTOR role from calling changeSlot (403 FORBIDDEN)', async () => {
      login('DOCTOR', '1', 'Bác sĩ Mai')
      const gateway = createBookingMock()

      await expect(
        gateway.changeSlot({
          appointmentId: '1',
          scheduleId: '101',
          startAt: '2029-11-25T06:00:00.000Z',
          expectedVersion: 0,
        }),
      ).rejects.toMatchObject({
        name: 'BookingError',
        code: 'FORBIDDEN',
        status: 403,
      })
    })
  })

  describe('Sprint 2 D08 — Cancel Appointment Flow', () => {
    it('PATIENT can cancel future appointment with reason <= 255 chars, preserving booking reason and releasing slot', async () => {
      login('PATIENT', '10', 'Bệnh nhân A')
      const gateway = createBookingMock()

      const app = await gateway.bookAppointment(validDraft)
      expect(app.reason).toBe('Đau đầu, muốn kiểm tra định kỳ')

      const cancelled = await gateway.cancelAppointment({
        appointmentId: app.id,
        reason: 'Bận công tác đột xuất vào ngày này',
        expectedVersion: 0,
      })

      expect(cancelled.status).toBe('CANCELLED')
      expect(cancelled.version).toBe(1)
      expect(cancelled.reason).toBe('Đau đầu, muốn kiểm tra định kỳ') // Booking reason preserved!
      expect(cancelled.cancellationReason).toBe(
        'Bận công tác đột xuất vào ngày này',
      ) // Cancellation reason
      expect(cancelled.cancelledAt).toBeDefined()
      expect(cancelled.cancelledBy).toBe('10')

      // Released slot can now be booked by another user!
      login('PATIENT', '20', 'Bệnh nhân B')
      const anotherBooking = await gateway.bookAppointment({
        ...validDraft,
        requestKey: 'req_pat_test_003',
      })
      expect(anotherBooking.id).toBeDefined()
    })

    it('rejects cancelAppointment when cancellation reason exceeds 255 characters (400 VALIDATION_FAILED)', async () => {
      login('PATIENT', '10', 'Bệnh nhân A')
      const gateway = createBookingMock()

      const app = await gateway.bookAppointment(validDraft)

      await expect(
        gateway.cancelAppointment({
          appointmentId: app.id,
          reason: 'C'.repeat(256),
          expectedVersion: 0,
        }),
      ).rejects.toMatchObject({
        name: 'BookingError',
        code: 'VALIDATION_FAILED',
        status: 400,
      })
    })

    it('rejects cancelAppointment when cancellation reason is empty (400 VALIDATION_FAILED)', async () => {
      login('PATIENT', '10', 'Bệnh nhân A')
      const gateway = createBookingMock()

      const app = await gateway.bookAppointment(validDraft)

      await expect(
        gateway.cancelAppointment({
          appointmentId: app.id,
          reason: '',
          expectedVersion: 0,
        }),
      ).rejects.toMatchObject({
        name: 'BookingError',
        code: 'VALIDATION_FAILED',
        status: 400,
      })
    })

    it('rejects cancelAppointment with stale expectedVersion (409 VERSION_CONFLICT)', async () => {
      login('PATIENT', '10', 'Bệnh nhân A')
      const gateway = createBookingMock()

      const app = await gateway.bookAppointment(validDraft)

      await expect(
        gateway.cancelAppointment({
          appointmentId: app.id,
          reason: 'Hủy lịch',
          expectedVersion: 88, // Stale
        }),
      ).rejects.toMatchObject({
        name: 'BookingError',
        code: 'VERSION_CONFLICT',
        status: 409,
      })
    })

    it('rejects cancelAppointment when appointment is already CANCELLED (409 INVALID_STATE_TRANSITION)', async () => {
      login('PATIENT', '10', 'Bệnh nhân A')
      const gateway = createBookingMock()

      await expect(
        gateway.cancelAppointment({
          appointmentId: '3', // initial mock data has app 3 cancelled
          reason: 'Hủy lại lần nữa',
          expectedVersion: 1,
        }),
      ).rejects.toMatchObject({
        name: 'BookingError',
        code: 'INVALID_STATE_TRANSITION',
        status: 409,
      })
    })

    it('allows RECEPTIONIST to cancel appointment on behalf of patient', async () => {
      login('RECEPTIONIST', '200', 'Lễ Tân')
      const gateway = createBookingMock()

      const cancelled = await gateway.cancelAppointment({
        appointmentId: '1',
        reason: 'Bệnh nhân gọi điện nhờ hủy',
        expectedVersion: 0,
      })

      expect(cancelled.status).toBe('CANCELLED')
    })

    it('forbids DOCTOR role from calling cancelAppointment (403 FORBIDDEN)', async () => {
      login('DOCTOR', '1', 'Bác sĩ Mai')
      const gateway = createBookingMock()

      await expect(
        gateway.cancelAppointment({
          appointmentId: '1',
          reason: 'Bác sĩ tự hủy',
          expectedVersion: 0,
        }),
      ).rejects.toMatchObject({
        name: 'BookingError',
        code: 'FORBIDDEN',
        status: 403,
      })
    })
  })
})
