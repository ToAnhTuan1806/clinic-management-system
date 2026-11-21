import { beforeEach, describe, expect, it } from 'vitest'
import {
  beginAuthentication,
  clearSession,
  establishSession,
} from '@/auth/session-store'
import type { Role } from '@/auth/types'
import { createScheduleMock } from '@/testing/schedule-mock'
import { getVnTodayString, ScheduleError } from '@/schedule/model'

function login(role: Role = 'ADMIN', id = '10', fullName?: string) {
  establishSession(beginAuthentication(), crypto.randomUUID(), {
    id,
    role,
    email: `${role.toLowerCase()}@clinic.test`,
    fullName: fullName || `User ${role}`,
  })
}

describe('Doctor Work Schedule Mock Gateway Tests (CL-D06-FE)', () => {
  const today = getVnTodayString()

  beforeEach(() => {
    clearSession()
  })

  describe('ADMIN & RECEPTIONIST Full Management', () => {
    it('allows ADMIN to list, create, update, and block schedules', async () => {
      login('ADMIN', '999', 'Admin User')

      const gateway = createScheduleMock()

      // List schedules
      const list = await gateway.listSchedules({})
      expect(list.length).toBeGreaterThan(0)

      // Create a new schedule for doctor 1 on a future date to avoid overlap
      const created = await gateway.createSchedule({
        doctorId: '1',
        date: '2026-12-15',
        startTime: '08:00',
        endTime: '11:00',
        slotDurationMinutes: 30,
        roomLabel: 'Phòng 105',
        status: 'ACTIVE',
      })

      expect(created.id).toBeDefined()
      expect(created.doctorId).toBe('1')
      expect(created.status).toBe('ACTIVE')
      expect(created.roomLabel).toBe('Phòng 105')

      // Update schedule
      const updated = await gateway.updateSchedule(created.id, {
        roomLabel: 'Phòng 105 - Cập nhật',
        slotDurationMinutes: 15,
      })
      expect(updated.roomLabel).toBe('Phòng 105 - Cập nhật')
      expect(updated.slotDurationMinutes).toBe(15)

      // Block schedule
      const blocked = await gateway.blockSchedule(
        created.id,
        'Khóa để kiểm thử',
      )
      expect(blocked.status).toBe('BLOCKED')

      // Verify blocked state in list
      const recheck = await gateway.getSchedule(created.id)
      expect(recheck.status).toBe('BLOCKED')
    })

    it('enforces 409 Conflict when creating an overlapping shift for the same doctor', async () => {
      login('RECEPTIONIST', '888', 'Receptionist User')

      const gateway = createScheduleMock()

      // Create initial shift: 2026-12-20 from 08:00 to 12:00
      await gateway.createSchedule({
        doctorId: '3',
        date: '2026-12-20',
        startTime: '08:00',
        endTime: '12:00',
        slotDurationMinutes: 30,
        status: 'ACTIVE',
      })

      // Try creating overlapping shift for doctor 3: 09:00 to 13:00 on 2026-12-20
      await expect(
        gateway.createSchedule({
          doctorId: '3',
          date: '2026-12-20',
          startTime: '09:00',
          endTime: '13:00',
          slotDurationMinutes: 30,
          status: 'ACTIVE',
        }),
      ).rejects.toThrow(
        /Ca làm việc bị trùng thời gian với ca khác của bác sĩ/i,
      )

      // However, creating a shift at the same time for a DIFFERENT doctor (e.g. doctor 4) is ALLOWED
      const diffDoctorShift = await gateway.createSchedule({
        doctorId: '4',
        date: '2026-12-20',
        startTime: '09:00',
        endTime: '13:00',
        slotDurationMinutes: 30,
        status: 'ACTIVE',
      })
      expect(diffDoctorShift.doctorId).toBe('4')
    })

    it('generates appointment slots (15/30/60m) correctly for a doctor on a given date', async () => {
      login('ADMIN', '999', 'Admin User')

      const gateway = createScheduleMock()

      // Create a 2-hour shift: 08:00 - 10:00 (120 mins) with 30-min slots -> exactly 4 slots
      await gateway.createSchedule({
        doctorId: '2',
        date: '2026-12-25',
        startTime: '08:00',
        endTime: '10:00',
        slotDurationMinutes: 30,
        status: 'ACTIVE',
      })

      const slots = await gateway.listDoctorSlots('2', '2026-12-25')
      expect(slots.length).toBe(4)
      expect(slots[0].doctorId).toBe('2')
      expect(slots[0].status).toBe('AVAILABLE')
    })
  })

  describe('DOCTOR Role Isolation', () => {
    it('restricts DOCTOR to viewing only their own schedules', async () => {
      // Doctor 1 is linked to userId '1001' in MOCK_DOCTORS
      login('DOCTOR', '1001', 'TS.BS Nguyễn Văn A')

      const gateway = createScheduleMock()

      // List all schedules - should ONLY return shifts belonging to doctor 1
      const list = await gateway.listSchedules({})
      expect(list.length).toBeGreaterThan(0)
      list.forEach((shift) => {
        expect(shift.doctorId).toBe('1')
      })

      // Attempting to view another doctor's shift directly throws 403
      // Shift 3 belongs to doctor 2
      await expect(gateway.getSchedule('3')).rejects.toThrow(ScheduleError)
    })

    it('forbids DOCTOR from creating or blocking shifts', async () => {
      login('DOCTOR', '1001', 'TS.BS Nguyễn Văn A')

      const gateway = createScheduleMock()

      await expect(
        gateway.createSchedule({
          doctorId: '1',
          date: '2026-12-30',
          startTime: '08:00',
          endTime: '12:00',
          slotDurationMinutes: 30,
          status: 'ACTIVE',
        }),
      ).rejects.toThrow(ScheduleError)

      await expect(gateway.blockSchedule('1')).rejects.toThrow(ScheduleError)
    })
  })

  describe('PATIENT Role Boundaries', () => {
    it('allows PATIENT to view doctor slots but forbids administrative write actions', async () => {
      login('PATIENT', '2001', 'Patient User')

      const gateway = createScheduleMock()

      // Patient can view doctor slots
      const slots = await gateway.listDoctorSlots('1', today)
      expect(Array.isArray(slots)).toBe(true)

      // Patient cannot create, update, or block schedules
      await expect(
        gateway.createSchedule({
          doctorId: '1',
          date: '2026-12-30',
          startTime: '08:00',
          endTime: '12:00',
          slotDurationMinutes: 30,
          status: 'ACTIVE',
        }),
      ).rejects.toThrow(ScheduleError)

      await expect(gateway.blockSchedule('1')).rejects.toThrow(ScheduleError)
    })
  })
})
