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
})
