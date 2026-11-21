import { describe, expect, it } from 'vitest'
import type { AxiosInstance } from 'axios'
import {
  BookingError,
  appointmentStatusLabels,
  bookingErrorMessage,
  bookingMessage,
  canChangeOrCancelAppointment,
  generateRequestKey,
  validateBookingDraft,
  validateCancelDraft,
  validateChangeSlotDraft,
  type Appointment,
  type BookingDraft,
  type CancelAppointmentDraft,
  type ChangeSlotDraft,
} from '@/booking/model'
import { createBookingApi, decodeAppointment } from '@/booking/api'
import { getVnTodayString } from '@/schedule/model'

describe('Patient Appointment Booking Contract & Domain Unit Tests (Sprint 2 - D07)', () => {
  const futureDate = '2029-12-25'
  const validSlot = {
    scheduleId: '100',
    startsAt: '2029-12-25T01:00:00.000Z',
    endsAt: '2029-12-25T01:30:00.000Z',
    isAvailable: true,
    roomLabel: 'Phòng 201',
  }

  const baseValidDraft: BookingDraft = {
    specialtyId: '1',
    doctorId: '10',
    date: futureDate,
    slot: validSlot,
    reason: 'Khám kiểm tra sức khỏe tổng quát',
    requestKey: 'req_test_key_12345',
  }

  describe('Draft Validation (validateBookingDraft)', () => {
    it('returns empty error map for a valid booking draft', () => {
      const errors = validateBookingDraft(baseValidDraft)
      expect(Object.keys(errors)).toHaveLength(0)
    })

    it('validates specialtyId requirement and numeric validity', () => {
      expect(
        validateBookingDraft({ ...baseValidDraft, specialtyId: '' })
          .specialtyId,
      ).toBe('Vui lòng chọn chuyên khoa cần khám.')

      expect(
        validateBookingDraft({ ...baseValidDraft, specialtyId: 'abc' })
          .specialtyId,
      ).toBe('Vui lòng chọn chuyên khoa cần khám.')

      expect(
        validateBookingDraft({ ...baseValidDraft, specialtyId: '0' })
          .specialtyId,
      ).toBe('Vui lòng chọn chuyên khoa cần khám.')
    })

    it('validates doctorId requirement and numeric validity', () => {
      expect(
        validateBookingDraft({ ...baseValidDraft, doctorId: '' }).doctorId,
      ).toBe('Vui lòng chọn bác sĩ phụ trách.')

      expect(
        validateBookingDraft({ ...baseValidDraft, doctorId: 'doc-invalid' })
          .doctorId,
      ).toBe('Vui lòng chọn bác sĩ phụ trách.')
    })

    it('validates appointment date: format, missing, and past dates', () => {
      expect(validateBookingDraft({ ...baseValidDraft, date: '' }).date).toBe(
        'Vui lòng chọn ngày khám hợp lệ (YYYY-MM-DD).',
      )

      expect(
        validateBookingDraft({ ...baseValidDraft, date: '25/12/2026' }).date,
      ).toBe('Vui lòng chọn ngày khám hợp lệ (YYYY-MM-DD).')

      expect(
        validateBookingDraft({ ...baseValidDraft, date: '2020-01-01' }).date,
      ).toBe('Không thể chọn ngày khám trong quá khứ.')
    })

    it('validates slot availability and past slots on current day', () => {
      const noSlot = { ...baseValidDraft }
      delete (noSlot as Partial<BookingDraft>).slot
      expect(validateBookingDraft(noSlot).slot).toBe(
        'Vui lòng chọn khung giờ khám còn trống.',
      )

      // Past slot on current day
      const todayStr = getVnTodayString()
      const pastTimeTodayIso = new Date(Date.now() - 3600000).toISOString()
      const pastSlot = {
        scheduleId: '100',
        startsAt: pastTimeTodayIso,
        endsAt: new Date(Date.now() - 1800000).toISOString(),
        isAvailable: true,
      }

      const todayPastDraft: BookingDraft = {
        ...baseValidDraft,
        date: todayStr,
        slot: pastSlot,
      }
      expect(validateBookingDraft(todayPastDraft).slot).toBe(
        'Khung giờ này đã trôi qua. Vui lòng chọn khung giờ khác.',
      )
    })

    it('validates reason length constraint (max 500 characters)', () => {
      const valid500 = 'A'.repeat(500)
      expect(
        validateBookingDraft({ ...baseValidDraft, reason: valid500 }).reason,
      ).toBeUndefined()

      const invalid501 = 'A'.repeat(501)
      expect(
        validateBookingDraft({ ...baseValidDraft, reason: invalid501 }).reason,
      ).toBe('Lý do khám không được vượt quá 500 ký tự.')
    })

    it('validates idempotency requestKey presence', () => {
      expect(
        validateBookingDraft({ ...baseValidDraft, requestKey: '' }).requestKey,
      ).toBe('Khóa định danh yêu cầu (requestKey) không hợp lệ.')

      expect(
        validateBookingDraft({ ...baseValidDraft, requestKey: '   ' })
          .requestKey,
      ).toBe('Khóa định danh yêu cầu (requestKey) không hợp lệ.')
    })
  })

  describe('Idempotency Key Generator (generateRequestKey)', () => {
    it('generates non-empty string starting with req_', () => {
      const key = generateRequestKey()
      expect(key).toMatch(/^req_[a-zA-Z0-9_-]+$/)
    })

    it('generates distinct keys across multiple calls', () => {
      const keys = new Set(
        Array.from({ length: 50 }, () => generateRequestKey()),
      )
      expect(keys.size).toBe(50)
    })
  })

  describe('Appointment Status Labels & Messages', () => {
    it('maps all standard appointment statuses to Vietnamese human-readable labels', () => {
      expect(appointmentStatusLabels.PENDING).toBe('Chờ xác nhận')
      expect(appointmentStatusLabels.CONFIRMED).toBe('Đã xác nhận')
      expect(appointmentStatusLabels.CHECKED_IN).toBe('Đã tiếp đón')
      expect(appointmentStatusLabels.IN_PROGRESS).toBe('Đang khám')
      expect(appointmentStatusLabels.COMPLETED).toBe('Hoàn thành')
      expect(appointmentStatusLabels.CANCELLED).toBe('Đã hủy')
      expect(appointmentStatusLabels.NO_SHOW).toBe('Vắng mặt')
    })

    it('produces descriptive Vietnamese error messages for BookingErrorCode', () => {
      expect(bookingErrorMessage('SLOT_UNAVAILABLE')).toContain('409 Conflict')
      expect(bookingErrorMessage('VALIDATION_FAILED')).toContain('không hợp lệ')
      expect(bookingErrorMessage('UNAUTHORIZED')).toContain('hết hạn')
      expect(bookingErrorMessage('FORBIDDEN')).toContain('không có quyền')
      expect(bookingErrorMessage('NOT_FOUND')).toContain('Không tìm thấy')
      expect(bookingErrorMessage('API_NOT_CONFIGURED')).toContain(
        'chưa được kết nối Backend D07',
      )
    })

    it('correctly extracts message via bookingMessage helper', () => {
      const bookingErr = new BookingError('SLOT_UNAVAILABLE', 409)
      expect(bookingMessage(bookingErr)).toContain('409 Conflict')

      const genericErr = new Error('Custom failure')
      expect(bookingMessage(genericErr)).toBe('Custom failure')

      expect(bookingMessage(null)).toBe(
        'Lỗi không xác định khi xử lý đặt lịch khám.',
      )
    })
  })

  describe('Response Decoder (decodeAppointment)', () => {
    it('correctly decodes standard Backend AppointmentResponse DTO with patientFullName and doctorFullName', () => {
      const raw = {
        id: '501',
        appointmentCode: 'APT_20261125_001',
        patientId: '10',
        patientCode: 'PAT001',
        patientFullName: 'Nguyễn Văn Bệnh Nhân',
        patientPhone: '0901234567',
        doctorId: '2',
        doctorCode: 'DOC002',
        doctorFullName: 'Lê Thị B',
        specialtyName: 'Tim mạch',
        scheduleId: '100',
        startAt: '2026-11-25T01:00:00.000Z',
        endAt: '2026-11-25T01:30:00.000Z',
        status: 'CONFIRMED',
        reason: 'Khám tim định kỳ',
        roomLabel: null,
        createdAt: '2026-11-20T10:00:00Z',
        updatedAt: '2026-11-20T10:00:00Z',
      }

      const decoded = decodeAppointment(raw)
      expect(decoded.id).toBe('501')
      expect(decoded.appointmentCode).toBe('APT_20261125_001')
      expect(decoded.patientId).toBe('10')
      expect(decoded.patientCode).toBe('PAT001')
      expect(decoded.patientName).toBe('Nguyễn Văn Bệnh Nhân')
      expect(decoded.doctorId).toBe('2')
      expect(decoded.doctorCode).toBe('DOC002')
      expect(decoded.doctorName).toBe('Lê Thị B')
      expect(decoded.status).toBe('CONFIRMED')
      expect(decoded.roomLabel).toBeNull()
    })

    it('correctly decodes snake_case and alternative property names from backend', () => {
      const rawSnake = {
        id: 700,
        appointment_code: 'APT_20261125_002',
        patient_id: 15,
        patient_name: 'Trần Văn C',
        doctor_id: 3,
        doctor_name: 'TS.BS Phạm Văn C',
        doctor_code: 'DOC003',
        specialty_name: 'Nhi khoa',
        schedule_id: 105,
        starts_at: '2026-11-25T02:00:00.000Z',
        ends_at: '2026-11-25T02:30:00.000Z',
        status: 'pending',
        reason: null,
        room_label: null,
      }

      const decoded = decodeAppointment(rawSnake)
      expect(decoded.id).toBe('700')
      expect(decoded.appointmentCode).toBe('APT_20261125_002')
      expect(decoded.patientId).toBe('15')
      expect(decoded.doctorId).toBe('3')
      expect(decoded.status).toBe('PENDING')
      expect(decoded.reason).toBeNull()
      expect(decoded.roomLabel).toBeNull()
    })

    it('falls back to PENDING if status is unknown or unrecognized', () => {
      const raw = {
        id: '800',
        appointmentCode: 'APT_800',
        patientId: '10',
        doctorId: '2',
        scheduleId: '100',
        startAt: '2026-11-25T01:00:00.000Z',
        endAt: '2026-11-25T01:30:00.000Z',
        status: 'SOME_WEIRD_STATE',
      }
      expect(decodeAppointment(raw).status).toBe('PENDING')
    })

    it('throws BookingError when non-object or missing id is passed', () => {
      expect(() => decodeAppointment(null)).toThrow(BookingError)
      expect(() => decodeAppointment({})).toThrow(BookingError)
      expect(() => decodeAppointment({ id: 'invalid-id' })).toThrow(
        BookingError,
      )
    })

    it('correctly decodes cancellation and rescheduling metadata according to schema V7', () => {
      const rawWithCancel = {
        id: '800',
        appointmentCode: 'APT_20261125_008',
        patientId: '10',
        doctorId: '2',
        scheduleId: '100',
        startAt: '2026-11-25T01:00:00.000Z',
        endAt: '2026-11-25T01:30:00.000Z',
        status: 'CANCELLED',
        reason: 'Khám định kỳ ban đầu (tối đa 500 ký tự)',
        cancellationReason: 'Bận đột xuất (tối đa 255 ký tự)',
        cancelledAt: '2026-11-24T10:00:00.000Z',
        cancelledBy: '10',
        rescheduledAt: '2026-11-23T08:00:00.000Z',
        version: 3,
      }

      const decoded = decodeAppointment(rawWithCancel)
      expect(decoded.id).toBe('800')
      expect(decoded.status).toBe('CANCELLED')
      expect(decoded.reason).toBe('Khám định kỳ ban đầu (tối đa 500 ký tự)')
      expect(decoded.cancellationReason).toBe('Bận đột xuất (tối đa 255 ký tự)')
      expect(decoded.cancelledAt).toBe('2026-11-24T10:00:00.000Z')
      expect(decoded.cancelledBy).toBe('10')
      expect(decoded.rescheduledAt).toBe('2026-11-23T08:00:00.000Z')
      expect(decoded.version).toBe(3)
    })
  })

  describe('API Client Layer (createBookingApi)', () => {
    it('sends correct payload with requestKey in JSON body and no Idempotency-Key header', async () => {
      let capturedUrl = ''
      let capturedPayload: unknown = null
      let capturedHeaders: Record<string, string> = {}

      const fakeClient = {
        post: async (
          url: string,
          payload: unknown,
          config?: { headers?: Record<string, string> },
        ) => {
          capturedUrl = url
          capturedPayload = payload
          capturedHeaders = config?.headers || {}
          return {
            data: {
              data: {
                id: '999',
                appointmentCode: 'APT_20291225_001',
                patientId: '10',
                doctorId: '10',
                scheduleId: '100',
                startAt: '2029-12-25T01:00:00.000Z',
                endAt: '2029-12-25T01:30:00.000Z',
                status: 'PENDING',
              },
            },
          }
        },
      } as unknown as AxiosInstance

      const api = createBookingApi(fakeClient)
      const res = await api.bookAppointment(baseValidDraft)

      expect(capturedUrl).toBe('/api/v1/appointments')
      expect(capturedHeaders['Idempotency-Key']).toBeUndefined()
      expect(capturedPayload).toEqual({
        scheduleId: '100',
        startAt: '2029-12-25T01:00:00.000Z',
        requestKey: baseValidDraft.requestKey,
        reason: 'Khám kiểm tra sức khỏe tổng quát',
      })
      expect(res.id).toBe('999')
      expect(res.appointmentCode).toBe('APT_20291225_001')
    })

    it('includes patientId in payload when provided (RECEPTIONIST booking on behalf)', async () => {
      let capturedPayload: Record<string, unknown> = {}
      const fakeClient = {
        post: async (_url: string, payload: unknown) => {
          capturedPayload = payload as Record<string, unknown>
          return {
            data: {
              data: {
                id: '1000',
                appointmentCode: 'APT_1000',
                patientId: '55',
                doctorId: '10',
                scheduleId: '100',
                startAt: '2029-12-25T01:00:00.000Z',
                endAt: '2029-12-25T01:30:00.000Z',
                status: 'PENDING',
              },
            },
          }
        },
      } as unknown as AxiosInstance

      const api = createBookingApi(fakeClient)
      await api.bookAppointment({
        ...baseValidDraft,
        patientId: '55',
      })

      expect(capturedPayload.patientId).toBe('55')
    })

    it('translates 409 Conflict from backend into SLOT_UNAVAILABLE BookingError', async () => {
      const fakeClient = {
        post: async () => {
          const err = new Error('Slot booked') as unknown as {
            response: { status: number; data: unknown }
          }
          err.response = {
            status: 409,
            data: {
              title: 'Conflict',
              status: 409,
              detail: 'Khung giờ này đã được người khác đặt trước.',
            },
          }
          throw err
        },
      } as unknown as AxiosInstance

      const api = createBookingApi(fakeClient)
      await expect(api.bookAppointment(baseValidDraft)).rejects.toMatchObject({
        name: 'BookingError',
        code: 'SLOT_UNAVAILABLE',
        status: 409,
        message: 'Khung giờ này đã được người khác đặt trước.',
      })
    })

    it('translates 403 Forbidden into FORBIDDEN BookingError', async () => {
      const fakeClient = {
        post: async () => {
          const err = new Error('Forbidden') as unknown as {
            response: { status: number; data: unknown }
          }
          err.response = {
            status: 403,
            data: {
              detail: 'Bác sĩ không thể đặt lịch khám.',
            },
          }
          throw err
        },
      } as unknown as AxiosInstance

      const api = createBookingApi(fakeClient)
      await expect(api.bookAppointment(baseValidDraft)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        status: 403,
      })
    })

    it('translates 400 Bad Request with field errors into VALIDATION_FAILED', async () => {
      const fakeClient = {
        post: async () => {
          const err = new Error('Bad request') as unknown as {
            response: { status: number; data: unknown }
          }
          err.response = {
            status: 400,
            data: {
              detail: 'Dữ liệu không hợp lệ.',
              errors: {
                startAt: 'startAt không hợp lệ',
              },
            },
          }
          throw err
        },
      } as unknown as AxiosInstance

      const api = createBookingApi(fakeClient)
      await expect(api.bookAppointment(baseValidDraft)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        status: 400,
        fieldErrors: {
          startAt: 'startAt không hợp lệ',
        },
      })
    })

    it('translates network disconnection into NETWORK_ERROR', async () => {
      const fakeClient = {
        post: async () => {
          const err = new Error('Network error') as unknown as {
            code: string
          }
          err.code = 'ERR_NETWORK'
          throw err
        },
      } as unknown as AxiosInstance

      const api = createBookingApi(fakeClient)
      await expect(api.bookAppointment(baseValidDraft)).rejects.toMatchObject({
        code: 'NETWORK_ERROR',
        status: 0,
      })
    })
  })

  describe('D08 Change Slot & Cancellation Domain Validation', () => {
    const validChangeDraft: ChangeSlotDraft = {
      appointmentId: '10',
      scheduleId: '5',
      startAt: '2029-12-28T02:00:00.000Z',
      expectedVersion: 0,
    }

    const validCancelDraft: CancelAppointmentDraft = {
      appointmentId: '10',
      reason: 'Bận việc gia đình đột xuất',
      expectedVersion: 0,
    }

    it('validates ChangeSlotDraft: appointmentId, scheduleId, future startAt, expectedVersion', () => {
      expect(
        Object.keys(validateChangeSlotDraft(validChangeDraft)),
      ).toHaveLength(0)

      expect(
        validateChangeSlotDraft({ ...validChangeDraft, appointmentId: '' })
          .appointmentId,
      ).toBe('Mã cuộc hẹn không hợp lệ.')

      expect(
        validateChangeSlotDraft({ ...validChangeDraft, scheduleId: 'invalid' })
          .scheduleId,
      ).toBe('Mã ca làm việc không hợp lệ.')

      expect(
        validateChangeSlotDraft({ ...validChangeDraft, startAt: '' }).startAt,
      ).toBe('Vui lòng chọn khung giờ khám mới.')

      expect(
        validateChangeSlotDraft({
          ...validChangeDraft,
          startAt: '2020-01-01T00:00:00.000Z',
        }).startAt,
      ).toBe('Không thể chọn khung giờ trong quá khứ.')

      expect(
        validateChangeSlotDraft({ ...validChangeDraft, expectedVersion: -1 })
          .expectedVersion,
      ).toBe('Phiên bản dữ liệu (version) không hợp lệ.')
    })

    it('validates CancelAppointmentDraft: appointmentId, reason 1-255 chars (schema V7), expectedVersion', () => {
      expect(Object.keys(validateCancelDraft(validCancelDraft))).toHaveLength(0)

      expect(
        validateCancelDraft({ ...validCancelDraft, appointmentId: '0' })
          .appointmentId,
      ).toBe('Mã cuộc hẹn không hợp lệ.')

      // Empty or whitespace reason is rejected (must be 1-255 characters)
      expect(
        validateCancelDraft({ ...validCancelDraft, reason: '' }).reason,
      ).toBe('Vui lòng nhập lý do hủy lịch khám (1-255 ký tự).')

      expect(
        validateCancelDraft({ ...validCancelDraft, reason: '   ' }).reason,
      ).toBe('Vui lòng nhập lý do hủy lịch khám (1-255 ký tự).')

      // Minimum 1 character
      expect(
        validateCancelDraft({ ...validCancelDraft, reason: 'X' }).reason,
      ).toBeUndefined()

      // Maximum 255 characters
      const valid255 = 'B'.repeat(255)
      expect(
        validateCancelDraft({ ...validCancelDraft, reason: valid255 }).reason,
      ).toBeUndefined()

      const longReason = 'B'.repeat(256)
      expect(
        validateCancelDraft({ ...validCancelDraft, reason: longReason }).reason,
      ).toBe('Lý do hủy lịch không được vượt quá 255 ký tự.')

      // Also checks cancellationReason alias
      expect(
        validateCancelDraft({
          ...validCancelDraft,
          reason: undefined,
          cancellationReason: longReason,
        }).reason,
      ).toBe('Lý do hủy lịch không được vượt quá 255 ký tự.')

      expect(
        validateCancelDraft({ ...validCancelDraft, expectedVersion: -1 })
          .expectedVersion,
      ).toBe('Phiên bản dữ liệu (version) không hợp lệ.')
    })

    it('canChangeOrCancelAppointment enforces role, status, and future date constraints', () => {
      const futureStart = '2029-12-28T02:00:00.000Z'
      const pastStart = '2020-01-01T02:00:00.000Z'

      const futurePendingApp: Appointment = {
        id: '10',
        appointmentCode: 'APT_10',
        patientId: '1',
        doctorId: '2',
        scheduleId: '3',
        startAt: futureStart,
        endAt: '2029-12-28T02:30:00.000Z',
        status: 'PENDING',
        version: 0,
      }

      // PATIENT with future PENDING -> Allowed
      expect(canChangeOrCancelAppointment(futurePendingApp, 'PATIENT')).toEqual(
        { canChange: true, canCancel: true },
      )

      // RECEPTIONIST with future CONFIRMED -> Allowed
      expect(
        canChangeOrCancelAppointment(
          { ...futurePendingApp, status: 'CONFIRMED' },
          'RECEPTIONIST',
        ),
      ).toEqual({ canChange: true, canCancel: true })

      // DOCTOR and ADMIN -> Forbidden
      expect(
        canChangeOrCancelAppointment(futurePendingApp, 'DOCTOR').canChange,
      ).toBe(false)
      expect(
        canChangeOrCancelAppointment(futurePendingApp, 'ADMIN').canCancel,
      ).toBe(false)

      // Past appointment -> Forbidden
      expect(
        canChangeOrCancelAppointment(
          { ...futurePendingApp, startAt: pastStart },
          'PATIENT',
        ).canChange,
      ).toBe(false)

      // CANCELLED or COMPLETED appointment -> Forbidden
      expect(
        canChangeOrCancelAppointment(
          { ...futurePendingApp, status: 'CANCELLED' },
          'PATIENT',
        ).canCancel,
      ).toBe(false)
      expect(
        canChangeOrCancelAppointment(
          { ...futurePendingApp, status: 'COMPLETED' },
          'PATIENT',
        ).canChange,
      ).toBe(false)
    })
  })

  describe('D08 API Client Change Slot, Cancellation & Optimistic Locking', () => {
    it('calls PATCH /api/v1/appointments/{id}/slot with expectedVersion and returns updated appointment', async () => {
      let capturedUrl = ''
      let capturedPayload: unknown = null

      const fakeClient = {
        patch: async (url: string, payload: unknown) => {
          capturedUrl = url
          capturedPayload = payload
          return {
            data: {
              data: {
                id: '10',
                appointmentCode: 'APT_10',
                patientId: '1',
                doctorId: '2',
                scheduleId: '5',
                startAt: '2029-12-28T02:00:00.000Z',
                endAt: '2029-12-28T02:30:00.000Z',
                status: 'PENDING',
                version: 1,
              },
            },
          }
        },
      } as unknown as AxiosInstance

      const api = createBookingApi(fakeClient)
      const res = await api.changeSlot({
        appointmentId: '10',
        scheduleId: '5',
        startAt: '2029-12-28T02:00:00.000Z',
        expectedVersion: 0,
      })

      expect(capturedUrl).toBe('/api/v1/appointments/10/slot')
      expect(capturedPayload).toEqual({
        scheduleId: '5',
        startAt: '2029-12-28T02:00:00.000Z',
        expectedVersion: 0,
      })
      expect(res.version).toBe(1)
      expect(res.status).toBe('PENDING')
    })

    it('calls POST /api/v1/appointments/{id}/cancellation with reason and expectedVersion', async () => {
      let capturedUrl = ''
      let capturedPayload: unknown = null

      const fakeClient = {
        post: async (url: string, payload: unknown) => {
          capturedUrl = url
          capturedPayload = payload
          return {
            data: {
              data: {
                id: '10',
                appointmentCode: 'APT_10',
                patientId: '1',
                doctorId: '2',
                scheduleId: '5',
                startAt: '2029-12-28T02:00:00.000Z',
                endAt: '2029-12-28T02:30:00.000Z',
                status: 'CANCELLED',
                reason: 'Lý do bận việc',
                version: 2,
              },
            },
          }
        },
      } as unknown as AxiosInstance

      const api = createBookingApi(fakeClient)
      const res = await api.cancelAppointment({
        appointmentId: '10',
        reason: 'Lý do bận việc',
        expectedVersion: 1,
      })

      expect(capturedUrl).toBe('/api/v1/appointments/10/cancellation')
      expect(capturedPayload).toEqual({
        reason: 'Lý do bận việc',
        expectedVersion: 1,
      })
      // Strictly verify payload has ONLY reason and expectedVersion (no cancellationReason)
      expect(
        Object.keys(capturedPayload as Record<string, unknown>).sort(),
      ).toEqual(['expectedVersion', 'reason'])
      expect(capturedPayload).not.toHaveProperty('cancellationReason')
      expect(res.status).toBe('CANCELLED')
      expect(res.version).toBe(2)
    })

    it('translates 409 Conflict with VERSION_CONFLICT to BookingError code VERSION_CONFLICT', async () => {
      const fakeClient = {
        patch: async () => {
          const err = new Error('Stale version') as unknown as {
            response: { status: number; data: unknown }
          }
          err.response = {
            status: 409,
            data: {
              code: 'VERSION_CONFLICT',
              detail: 'Dữ liệu đã bị thay đổi bởi phiên khác.',
            },
          }
          throw err
        },
      } as unknown as AxiosInstance

      const api = createBookingApi(fakeClient)
      await expect(
        api.changeSlot({
          appointmentId: '10',
          scheduleId: '5',
          startAt: '2029-12-28T02:00:00.000Z',
          expectedVersion: 0,
        }),
      ).rejects.toMatchObject({
        name: 'BookingError',
        code: 'VERSION_CONFLICT',
        status: 409,
      })
    })

    it('translates 409 Conflict with INVALID_STATE_TRANSITION to BookingError code INVALID_STATE_TRANSITION', async () => {
      const fakeClient = {
        post: async () => {
          const err = new Error('Invalid state') as unknown as {
            response: { status: number; data: unknown }
          }
          err.response = {
            status: 409,
            data: {
              code: 'INVALID_STATE_TRANSITION',
              detail: 'Không thể chuyển đổi trạng thái này.',
            },
          }
          throw err
        },
      } as unknown as AxiosInstance

      const api = createBookingApi(fakeClient)
      await expect(
        api.cancelAppointment({
          appointmentId: '10',
          reason: 'Bận việc cá nhân',
          expectedVersion: 0,
        }),
      ).rejects.toMatchObject({
        name: 'BookingError',
        code: 'INVALID_STATE_TRANSITION',
        status: 409,
      })
    })
  })
})
