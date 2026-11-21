import { describe, expect, it } from 'vitest'
import type { AxiosInstance } from 'axios'
import {
  areIntervalsOverlapping,
  formatVnDateFull,
  formatVnDateShort,
  formatVnTime,
  formatVnTimeRange,
  fromUtcIsoToVnParts,
  getWeekDaysForDate,
  ScheduleError,
  toUtcIso,
  validId,
  validateSchedule,
  type ScheduleDraft,
} from '@/schedule/model'
import { createScheduleApi, decodeSchedule, decodeSlot } from '@/schedule/api'

describe('Doctor Work Schedule Contract & Domain Unit Tests (Sprint 2 - D06)', () => {
  describe('Vietnam Timezone (Asia/Ho_Chi_Minh, UTC+7) & ISO UTC Conversion', () => {
    it('correctly converts Vietnam date & time to ISO UTC string (subtracts 7 hours)', () => {
      // 08:00 VN on 2026-11-23 is 01:00 UTC on 2026-11-23
      const utcIso = toUtcIso('2026-11-23', '08:00')
      expect(utcIso).toBe('2026-11-23T01:00:00.000Z')

      // 14:30 VN on 2026-11-23 is 07:30 UTC on 2026-11-23
      expect(toUtcIso('2026-11-23', '14:30')).toBe('2026-11-23T07:30:00.000Z')
    })

    it('correctly handles day-boundary rollback when VN time is early morning (< 07:00)', () => {
      // 06:00 VN on 2026-11-23 is 23:00 UTC on 2026-11-22
      const utcIso = toUtcIso('2026-11-23', '06:00')
      expect(utcIso).toBe('2026-11-22T23:00:00.000Z')
    })

    it('correctly decomposes ISO UTC string back to Vietnam date and time parts', () => {
      const parts = fromUtcIsoToVnParts('2026-11-23T01:00:00.000Z')
      expect(parts.date).toBe('2026-11-23')
      expect(parts.time).toBe('08:00')

      // Cross-day check
      const partsEarly = fromUtcIsoToVnParts('2026-11-22T23:30:00.000Z')
      expect(partsEarly.date).toBe('2026-11-23')
      expect(partsEarly.time).toBe('06:30')
    })

    it('formats Vietnam time and time ranges accurately', () => {
      const startIso = '2026-11-23T01:00:00.000Z' // 08:00 VN
      const endIso = '2026-11-23T05:00:00.000Z' // 12:00 VN

      expect(formatVnTime(startIso)).toBe('08:00')
      expect(formatVnTime(endIso)).toBe('12:00')
      expect(formatVnTimeRange(startIso, endIso)).toBe('08:00 - 12:00')
      expect(formatVnDateShort(startIso)).toBe('23/11/2026')
      expect(formatVnDateFull(startIso)).toContain('23/11/2026')
    })

    it('generates 7 week days starting Monday to Sunday for any VN date', () => {
      // 2026-11-23 is a Monday
      const week = getWeekDaysForDate('2026-11-23')
      expect(week).toHaveLength(7)
      expect(week[0].dayLabel).toBe('Thứ 2')
      expect(week[0].dateStr).toBe('2026-11-23')
      expect(week[6].dayLabel).toBe('Chủ Nhật')
      expect(week[6].dateStr).toBe('2026-11-29')

      // Check Wednesday inside that week
      const midWeek = getWeekDaysForDate('2026-11-25')
      expect(midWeek[0].dateStr).toBe('2026-11-23')
      expect(midWeek[6].dateStr).toBe('2026-11-29')
    })
  })

  describe('Form & Schedule Validation (validateSchedule)', () => {
    const validDraft: ScheduleDraft = {
      doctorId: '101',
      date: '2026-11-25',
      startTime: '08:00',
      endTime: '12:00',
      slotDurationMinutes: 30,
      roomLabel: 'Phòng 101',
      status: 'ACTIVE',
    }

    it('passes a fully valid schedule draft with zero errors', () => {
      const errors = validateSchedule(validDraft)
      expect(Object.keys(errors)).toHaveLength(0)
    })

    it('requires a valid numeric string doctor ID', () => {
      expect(
        validateSchedule({ ...validDraft, doctorId: '' }).doctorId,
      ).toBeDefined()
      expect(
        validateSchedule({ ...validDraft, doctorId: 'doc_abc' }).doctorId,
      ).toBeDefined()
      expect(validId('101')).toBe(true)
      expect(validId('0')).toBe(false)
      expect(validId('-5')).toBe(false)
      expect(validId('abc')).toBe(false)
    })

    it('validates date format YYYY-MM-DD', () => {
      expect(
        validateSchedule({ ...validDraft, date: 'invalid-date' }).date,
      ).toBeDefined()
      expect(
        validateSchedule({ ...validDraft, date: '25/11/2026' }).date,
      ).toBeDefined()
    })

    it('rejects start time >= end time', () => {
      const errorsEqual = validateSchedule({
        ...validDraft,
        startTime: '09:00',
        endTime: '09:00',
      })
      expect(errorsEqual.endTime).toContain('phải sau giờ bắt đầu')

      const errorsBefore = validateSchedule({
        ...validDraft,
        startTime: '14:00',
        endTime: '13:00',
      })
      expect(errorsBefore.endTime).toContain('phải sau giờ bắt đầu')
    })

    it('enforces slot duration to be 15, 30, or 60 minutes', () => {
      // @ts-expect-error test invalid slot duration
      const errors = validateSchedule({
        ...validDraft,
        slotDurationMinutes: 45,
      })
      expect(errors.slotDurationMinutes).toContain(
        'phải là 15, 30 hoặc 60 phút',
      )
    })

    it('enforces total shift duration to be at least one slot duration', () => {
      const errors = validateSchedule({
        ...validDraft,
        startTime: '08:00',
        endTime: '08:15',
        slotDurationMinutes: 30,
      })
      expect(errors.endTime).toContain('tối thiểu phải bằng một slot (30 phút)')
    })

    it('enforces total shift duration to be evenly divisible by slot duration', () => {
      // 08:00 - 08:50 is 50 mins, not divisible by 30 mins
      const errors = validateSchedule({
        ...validDraft,
        startTime: '08:00',
        endTime: '08:50',
        slotDurationMinutes: 30,
      })
      expect(errors.slotDurationMinutes).toContain('phải chia hết')
    })

    it('rejects room label longer than 64 characters', () => {
      const longRoom = 'A'.repeat(65)
      const errors = validateSchedule({ ...validDraft, roomLabel: longRoom })
      expect(errors.roomLabel).toContain('không được vượt quá 64 ký tự')
    })
  })

  describe('Time Interval Overlap Checking (areIntervalsOverlapping)', () => {
    const shiftStart = '2026-11-23T01:00:00.000Z' // 08:00 VN
    const shiftEnd = '2026-11-23T05:00:00.000Z' // 12:00 VN

    it('returns false for non-overlapping intervals (before or after)', () => {
      // 06:00 - 07:30 VN (completely before)
      expect(
        areIntervalsOverlapping(
          '2026-11-22T23:00:00.000Z',
          '2026-11-23T00:30:00.000Z',
          shiftStart,
          shiftEnd,
        ),
      ).toBe(false)

      // 13:00 - 17:00 VN (completely after)
      expect(
        areIntervalsOverlapping(
          '2026-11-23T06:00:00.000Z',
          '2026-11-23T10:00:00.000Z',
          shiftStart,
          shiftEnd,
        ),
      ).toBe(false)
    })

    it('returns false for adjacent back-to-back intervals (exclusive end boundary)', () => {
      // Exactly ending at 08:00 VN
      expect(
        areIntervalsOverlapping(
          '2026-11-22T23:00:00.000Z',
          shiftStart,
          shiftStart,
          shiftEnd,
        ),
      ).toBe(false)

      // Exactly starting at 12:00 VN
      expect(
        areIntervalsOverlapping(
          shiftEnd,
          '2026-11-23T09:00:00.000Z',
          shiftStart,
          shiftEnd,
        ),
      ).toBe(false)
    })

    it('returns true for overlapping intervals (overlap, subset, superset)', () => {
      // 07:30 - 09:30 VN (overlaps beginning)
      expect(
        areIntervalsOverlapping(
          '2026-11-23T00:30:00.000Z',
          '2026-11-23T02:30:00.000Z',
          shiftStart,
          shiftEnd,
        ),
      ).toBe(true)

      // 11:30 - 13:00 VN (overlaps end)
      expect(
        areIntervalsOverlapping(
          '2026-11-23T04:30:00.000Z',
          '2026-11-23T06:00:00.000Z',
          shiftStart,
          shiftEnd,
        ),
      ).toBe(true)

      // 09:00 - 11:00 VN (strictly inside)
      expect(
        areIntervalsOverlapping(
          '2026-11-23T02:00:00.000Z',
          '2026-11-23T04:00:00.000Z',
          shiftStart,
          shiftEnd,
        ),
      ).toBe(true)

      // 07:00 - 13:00 VN (enclosing)
      expect(
        areIntervalsOverlapping(
          '2026-11-23T00:00:00.000Z',
          '2026-11-23T06:00:00.000Z',
          shiftStart,
          shiftEnd,
        ),
      ).toBe(true)
    })
  })

  describe('Response Decoding (decodeSchedule, decodeSlot)', () => {
    it('decodes backend ACTIVE and BLOCKED statuses', () => {
      const activeRaw = {
        id: '12',
        doctorId: '5',
        doctorName: 'BS A',
        startAt: '2026-11-25T01:00:00.000Z',
        endAt: '2026-11-25T05:00:00.000Z',
        status: 'ACTIVE',
        slotMinutes: 30,
      }
      const decodedActive = decodeSchedule(activeRaw)
      expect(decodedActive.status).toBe('ACTIVE')
      expect(decodedActive.id).toBe('12')
      expect(decodedActive.doctorId).toBe('5')

      const blockedRaw = {
        ...activeRaw,
        id: '13',
        status: 'BLOCKED',
      }
      const decodedBlocked = decodeSchedule(blockedRaw)
      expect(decodedBlocked.status).toBe('BLOCKED')

      expect(() => decodeSchedule({ ...activeRaw, status: 'INVALID' })).toThrow(
        ScheduleError,
      )
    })

    it('decodes snake_case backend keys gracefully', () => {
      const snakeRaw = {
        id: '99',
        doctor_id: '8',
        doctor_name: 'BS B',
        start_at: '2026-11-25T01:00:00.000Z',
        end_at: '2026-11-25T05:00:00.000Z',
        status: 'ACTIVE',
        room_label: 'Phòng 202',
        slot_minutes: 15,
      }
      const decoded = decodeSchedule(snakeRaw)
      expect(decoded.id).toBe('99')
      expect(decoded.doctorId).toBe('8')
      expect(decoded.doctorName).toBe('BS B')
      expect(decoded.roomLabel).toBe('Phòng 202')
      expect(decoded.slotDurationMinutes).toBe(15)
    })

    it('decodes schedule slots with isAvailable boolean and string IDs', () => {
      const slotRaw = {
        scheduleId: '12',
        doctorId: '5',
        date: '2026-11-25',
        startAt: '2026-11-25T01:00:00.000Z',
        endAt: '2026-11-25T01:30:00.000Z',
        isAvailable: true,
      }
      const slot = decodeSlot(slotRaw)
      expect(slot.scheduleId).toBe('12')
      expect(slot.doctorId).toBe('5')
      expect(slot.status).toBe('AVAILABLE')

      const booked = decodeSlot({ ...slotRaw, isAvailable: false })
      expect(booked.status).toBe('BOOKED')
    })

    it('throws ScheduleError on invalid response payload', () => {
      expect(() => decodeSchedule(null)).toThrow(ScheduleError)
      expect(() => decodeSchedule('not-an-object')).toThrow(ScheduleError)
      expect(() => decodeSchedule({ id: '0' })).toThrow(ScheduleError)
    })
  })

  describe('ScheduleError & 409 Conflict Mapping', () => {
    it('maps 409 Conflict code to clear message detailing shift overlap', () => {
      const err = new ScheduleError('SCHEDULE_OVERLAP', 409)
      expect(err.code).toBe('SCHEDULE_OVERLAP')
      expect(err.status).toBe(409)
      expect(err.message).toContain('bị trùng thời gian với ca khác')
      expect(err.message).toContain('409 Conflict')
    })
  })

  describe('Schedule API Client (createScheduleApi)', () => {
    it('sends POST /api/v1/doctor-schedules with exact contract fields (no roomLabel, no reason)', async () => {
      let capturedUrl = ''
      let capturedBody: any = null
      const mockClient = {
        post: async (url: string, body: any) => {
          capturedUrl = url
          capturedBody = body
          return {
            data: {
              data: {
                id: '100',
                doctorId: '1',
                startAt: body.startAt,
                endAt: body.endAt,
                slotMinutes: body.slotMinutes,
                status: 'ACTIVE',
              },
            },
          }
        },
      } as unknown as AxiosInstance

      const api = createScheduleApi(mockClient)
      const res = await api.createSchedule({
        doctorId: '1',
        date: '2026-11-25',
        startTime: '08:00',
        endTime: '12:00',
        slotDurationMinutes: 30,
        roomLabel: 'Phòng 101', // FE UI has roomLabel, but API must omit it
        status: 'ACTIVE',
      })

      expect(capturedUrl).toBe('/api/v1/doctor-schedules')
      expect(capturedBody).toEqual({
        doctorId: '1',
        startAt: '2026-11-25T01:00:00.000Z',
        endAt: '2026-11-25T05:00:00.000Z',
        slotMinutes: 30,
        status: 'ACTIVE',
      })
      expect(capturedBody.roomLabel).toBeUndefined()
      expect(capturedBody.reason).toBeUndefined()
      expect(res.id).toBe('100')
      expect(res.status).toBe('ACTIVE')
    })

    it('sends PATCH /api/v1/doctor-schedules/{id} without doctorId or roomLabel', async () => {
      let capturedUrl = ''
      let capturedBody: any = null
      const mockClient = {
        patch: async (url: string, body: any) => {
          capturedUrl = url
          capturedBody = body
          return {
            data: {
              data: {
                id: '100',
                doctorId: '1',
                startAt: body.startAt || '2026-11-25T01:00:00.000Z',
                endAt: body.endAt || '2026-11-25T05:00:00.000Z',
                slotMinutes: body.slotMinutes || 30,
                status: body.status || 'ACTIVE',
              },
            },
          }
        },
      } as unknown as AxiosInstance

      const api = createScheduleApi(mockClient)
      await api.updateSchedule('100', {
        slotDurationMinutes: 15,
        status: 'ACTIVE',
      })

      expect(capturedUrl).toBe('/api/v1/doctor-schedules/100')
      expect(capturedBody).toEqual({
        slotMinutes: 15,
        status: 'ACTIVE',
      })
      expect(capturedBody.doctorId).toBeUndefined()
      expect(capturedBody.roomLabel).toBeUndefined()
    })

    it('sends PATCH /api/v1/doctor-schedules/{id} with status BLOCKED and no reason parameter', async () => {
      let capturedUrl = ''
      let capturedBody: any = null
      const mockClient = {
        patch: async (url: string, body: any) => {
          capturedUrl = url
          capturedBody = body
          return {
            data: {
              data: {
                id: '100',
                doctorId: '1',
                startAt: '2026-11-25T01:00:00.000Z',
                endAt: '2026-11-25T05:00:00.000Z',
                slotMinutes: 30,
                status: 'BLOCKED',
              },
            },
          }
        },
      } as unknown as AxiosInstance

      const api = createScheduleApi(mockClient)
      const res = await api.blockSchedule('100', 'Bác sĩ bận việc')

      expect(capturedUrl).toBe('/api/v1/doctor-schedules/100')
      expect(capturedBody).toEqual({
        status: 'BLOCKED',
      })
      expect(capturedBody.reason).toBeUndefined()
      expect(res.status).toBe('BLOCKED')
    })

    it('unpacks PageResponse from GET /api/v1/doctor-schedules with items array', async () => {
      let capturedUrl = ''
      let capturedParams: any = null
      const mockClient = {
        get: async (url: string, config: any) => {
          capturedUrl = url
          capturedParams = config?.params
          return {
            data: {
              data: {
                items: [
                  {
                    id: '101',
                    doctorId: '1',
                    doctorName: 'BS A',
                    startAt: '2026-11-25T01:00:00.000Z',
                    endAt: '2026-11-25T05:00:00.000Z',
                    slotMinutes: 30,
                    status: 'ACTIVE',
                  },
                ],
                page: 0,
                size: 100,
                totalElements: 1,
                totalPages: 1,
              },
            },
          }
        },
      } as unknown as AxiosInstance

      const api = createScheduleApi(mockClient)
      const list = await api.listSchedules({
        doctorId: '1',
        startDate: '2026-11-25',
        endDate: '2026-11-25',
        status: 'ACTIVE',
      })

      expect(capturedUrl).toBe('/api/v1/doctor-schedules')
      expect(capturedParams.doctorId).toBe('1')
      expect(capturedParams.workDate).toBe('2026-11-25')
      expect(capturedParams.status).toBe('ACTIVE')
      expect(list).toHaveLength(1)
      expect(list[0].id).toBe('101')
      expect(list[0].status).toBe('ACTIVE')
    })

    it('translates 409 Conflict with Problem Details into ScheduleError with clear overlap message', async () => {
      const mockClient = {
        post: async () => {
          const err = new Error('Request failed with status code 409') as any
          err.response = {
            status: 409,
            data: {
              code: 'SCHEDULE_OVERLAP',
              detail:
                'Bác sĩ đã có ca làm việc khác trong khoảng thời gian này.',
            },
          }
          throw err
        },
      } as unknown as AxiosInstance

      const api = createScheduleApi(mockClient)
      await expect(
        api.createSchedule({
          doctorId: '1',
          date: '2026-11-25',
          startTime: '08:00',
          endTime: '12:00',
          slotDurationMinutes: 30,
          status: 'ACTIVE',
        }),
      ).rejects.toThrow(
        /Bác sĩ đã có ca làm việc khác trong khoảng thời gian này/i,
      )
    })
  })
})
