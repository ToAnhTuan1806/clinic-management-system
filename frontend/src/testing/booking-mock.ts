// Synthetic mock implementation for Patient Appointment Booking & Management (Sprint 2 - D07/D08)
// Runs in DEV and offline test mode. Enforces idempotency, slot collision detection, and optimistic locking.

import { getAuthSnapshot } from '@/auth/session-store'
import { fromUtcIsoToVnParts, getVnTodayString } from '@/schedule/model'
import { MOCK_DOCTORS } from '@/testing/schedule-mock'
import {
  BookingError,
  validateActionDraft,
  validateBookingDraft,
  validateCancelDraft,
  validateChangeSlotDraft,
  type Appointment,
  type AppointmentActionDraft,
  type AppointmentPage,
  type AppointmentQuery,
  type BookingDraft,
  type BookingGateway,
  type CancelAppointmentDraft,
  type ChangeSlotDraft,
} from '@/booking/model'

export function createBookingMock({ latency = 0 } = {}): BookingGateway {
  let nextAppointmentId = 500
  let codeSeq = 100

  // Track booked slots: key = `${scheduleId}_${startAt}`
  const bookedSlots = new Map<
    string,
    { appointmentId: string; requestKey: string }
  >()

  const todayStr = getVnTodayString()

  // In-memory appointments list
  const appointments: Appointment[] = [
    {
      id: '1',
      appointmentCode: 'APT_20291125_001',
      patientId: '10',
      patientCode: 'PAT001',
      patientName: 'DEMO · Bệnh nhân 01',
      patientPhone: '0901234567',
      doctorId: '1',
      doctorName: 'Nguyễn Văn A',
      doctorCode: 'DOC001',
      specialtyName: 'Nội tổng quát',
      scheduleId: '8',
      startAt: '2029-11-25T01:00:00.000Z',
      endAt: '2029-11-25T01:30:00.000Z',
      status: 'CONFIRMED',
      reason: 'Khám định kỳ',
      roomLabel: 'Phòng 101 - Khám nội',
      version: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: '2',
      appointmentCode: 'APT_20291126_002',
      patientId: '10',
      patientCode: 'PAT001',
      patientName: 'DEMO · Bệnh nhân 01',
      patientPhone: '0901234567',
      doctorId: '2',
      doctorName: 'Trần Thị B',
      doctorCode: 'DOC002',
      specialtyName: 'Tim mạch',
      scheduleId: '4',
      startAt: '2029-11-26T01:30:00.000Z',
      endAt: '2029-11-26T02:00:00.000Z',
      status: 'PENDING',
      reason: 'Khám tim mạch theo dõi',
      roomLabel: null,
      version: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: '3',
      appointmentCode: 'APT_20291120_003',
      patientId: '10',
      patientCode: 'PAT001',
      patientName: 'DEMO · Bệnh nhân 01',
      patientPhone: '0901234567',
      doctorId: '1',
      doctorName: 'Nguyễn Văn A',
      doctorCode: 'DOC001',
      specialtyName: 'Nội tổng quát',
      scheduleId: '1',
      startAt: '2029-11-20T02:00:00.000Z',
      endAt: '2029-11-20T02:30:00.000Z',
      status: 'CANCELLED',
      reason: 'Bận việc gia đình đột xuất',
      cancellationReason: 'Bận việc gia đình đột xuất',
      roomLabel: null,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: '4',
      appointmentCode: 'APT_20291128_004',
      patientId: '55',
      patientCode: 'PAT055',
      patientName: 'DEMO · Bệnh nhân 55',
      patientPhone: '0988776655',
      doctorId: '1',
      doctorName: 'Nguyễn Văn A',
      doctorCode: 'DOC001',
      specialtyName: 'Nội tổng quát',
      scheduleId: '8',
      startAt: '2029-11-28T02:00:00.000Z',
      endAt: '2029-11-28T02:30:00.000Z',
      status: 'PENDING',
      reason: 'Khám ho kéo dài',
      roomLabel: null,
      version: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    // Synthetic appointments for TODAY (CL-D09 Reception Desk)
    {
      id: '101',
      appointmentCode: `APT_${todayStr.replace(/-/g, '')}_101`,
      patientId: '10',
      patientCode: 'PAT001',
      patientName: 'Nguyễn An (Tiếp đón)',
      patientPhone: '0912345678',
      doctorId: '1',
      doctorName: 'Nguyễn Văn A',
      doctorCode: 'DOC001',
      specialtyName: 'Nội tổng quát',
      scheduleId: '10',
      startAt: `${todayStr}T08:00:00.000Z`,
      endAt: `${todayStr}T08:30:00.000Z`,
      status: 'PENDING',
      reason: 'Khám tổng quát định kỳ',
      roomLabel: 'Phòng 101 - Khám nội',
      version: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: '102',
      appointmentCode: `APT_${todayStr.replace(/-/g, '')}_102`,
      patientId: '11',
      patientCode: 'PAT011',
      patientName: 'Trần Bình (Đã xác nhận)',
      patientPhone: '0923456789',
      doctorId: '2',
      doctorName: 'Trần Thị B',
      doctorCode: 'DOC002',
      specialtyName: 'Tim mạch',
      scheduleId: '11',
      startAt: `${todayStr}T09:00:00.000Z`,
      endAt: `${todayStr}T09:30:00.000Z`,
      status: 'CONFIRMED',
      reason: 'Theo dõi nhịp tim',
      roomLabel: 'Phòng 202 - Tim mạch',
      version: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: '103',
      appointmentCode: `APT_${todayStr.replace(/-/g, '')}_103`,
      patientId: '12',
      patientCode: 'PAT012',
      patientName: 'Lê Cường (Quá giờ)',
      patientPhone: '0934567890',
      doctorId: '1',
      doctorName: 'Nguyễn Văn A',
      doctorCode: 'DOC001',
      specialtyName: 'Nội tổng quát',
      scheduleId: '10',
      startAt: `${todayStr}T01:00:00.000Z`,
      endAt: `${todayStr}T01:30:00.000Z`,
      status: 'CONFIRMED',
      reason: 'Khám huyết áp buổi sáng',
      roomLabel: 'Phòng 101 - Khám nội',
      version: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: '104',
      appointmentCode: `APT_${todayStr.replace(/-/g, '')}_104`,
      patientId: '13',
      patientCode: 'PAT013',
      patientName: 'Phạm Dũng (Đã check-in)',
      patientPhone: '0945678901',
      doctorId: '1',
      doctorName: 'Nguyễn Văn A',
      doctorCode: 'DOC001',
      specialtyName: 'Nội tổng quát',
      scheduleId: '10',
      startAt: `${todayStr}T02:00:00.000Z`,
      endAt: `${todayStr}T02:30:00.000Z`,
      status: 'CHECKED_IN',
      checkedInAt: new Date().toISOString(),
      checkedInBy: '200',
      reason: 'Kiểm tra vết thương',
      roomLabel: 'Phòng 101 - Khám nội',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ]

  // Record initial booked slots
  bookedSlots.set('8_2029-11-25T01:00:00.000Z', {
    appointmentId: '1',
    requestKey: 'initial_req_1',
  })
  bookedSlots.set('4_2029-11-26T01:30:00.000Z', {
    appointmentId: '2',
    requestKey: 'initial_req_2',
  })
  bookedSlots.set('8_2029-11-28T02:00:00.000Z', {
    appointmentId: '4',
    requestKey: 'initial_req_4',
  })
  bookedSlots.set(`10_${todayStr}T08:00:00.000Z`, {
    appointmentId: '101',
    requestKey: 'initial_req_101',
  })
  bookedSlots.set(`11_${todayStr}T09:00:00.000Z`, {
    appointmentId: '102',
    requestKey: 'initial_req_102',
  })
  bookedSlots.set(`10_${todayStr}T01:00:00.000Z`, {
    appointmentId: '103',
    requestKey: 'initial_req_103',
  })
  bookedSlots.set(`10_${todayStr}T02:00:00.000Z`, {
    appointmentId: '104',
    requestKey: 'initial_req_104',
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

    return { role, userId: user?.id, userName: user?.fullName }
  }

  return {
    mode: 'mock',

    async bookAppointment(draft: BookingDraft): Promise<Appointment> {
      await wait()
      const { role, userId, userName } = checkRoleAccess()

      if (role === 'DOCTOR') {
        throw new BookingError(
          'FORBIDDEN',
          403,
          'Bác sĩ không có quyền thực hiện đặt lịch thay cho bệnh nhân.',
        )
      }

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
        patientCode: `PAT${patientId.padStart(3, '0')}`,
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
        version: 0,
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
      const { role, userId } = checkRoleAccess()

      const found = appointments.find((a) => a.id === idParam)
      if (!found) {
        throw new BookingError(
          'NOT_FOUND',
          404,
          'Không tìm thấy thông tin lịch hẹn.',
        )
      }

      if (
        role === 'PATIENT' &&
        found.patientId !== userId &&
        found.patientId !== '10'
      ) {
        throw new BookingError(
          'FORBIDDEN',
          403,
          'Bạn không có quyền xem thông tin lịch hẹn của bệnh nhân khác.',
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

    async listAppointments(query?: AppointmentQuery): Promise<AppointmentPage> {
      await wait()
      const { role, userId } = checkRoleAccess()

      let filtered = [...appointments]

      // Role boundary filtering
      if (role === 'PATIENT') {
        filtered = filtered.filter(
          (a) => a.patientId === userId || a.patientId === '10',
        )
      } else if (role === 'DOCTOR') {
        filtered = filtered.filter((a) => a.doctorId === userId)
      }

      // Query parameter filtering
      if (query?.doctorId) {
        filtered = filtered.filter((a) => a.doctorId === query.doctorId)
      }
      if (query?.patientId) {
        filtered = filtered.filter((a) => a.patientId === query.patientId)
      }
      if (query?.date) {
        filtered = filtered.filter((a) => {
          const parts = fromUtcIsoToVnParts(a.startAt)
          return parts.date === query.date
        })
      }
      if (query?.status && query.status !== 'ALL') {
        filtered = filtered.filter((a) => a.status === query.status)
      }

      // Sort newest start time first
      filtered.sort((a, b) => b.startAt.localeCompare(a.startAt))

      const page = query?.page || 0
      const pageSize = query?.pageSize || 20
      const startIdx = page * pageSize
      const paginated = filtered.slice(startIdx, startIdx + pageSize)

      return {
        items: paginated.map((a) => ({ ...a })),
        total: filtered.length,
        page,
        pageSize,
      }
    },

    async changeSlot(draft: ChangeSlotDraft): Promise<Appointment> {
      await wait()
      const { role, userId } = checkRoleAccess()

      // Only PATIENT and RECEPTIONIST can change slot
      if (role !== 'PATIENT' && role !== 'RECEPTIONIST') {
        throw new BookingError(
          'FORBIDDEN',
          403,
          'Bạn không có quyền thực hiện thao tác đổi lịch khám này.',
        )
      }

      const errors = validateChangeSlotDraft(draft)
      if (Object.keys(errors).length > 0) {
        throw new BookingError(
          'VALIDATION_FAILED',
          400,
          'Dữ liệu đổi lịch không hợp lệ.',
          errors,
        )
      }

      const app = appointments.find((a) => a.id === draft.appointmentId)
      if (!app) {
        throw new BookingError(
          'NOT_FOUND',
          404,
          'Không tìm thấy lịch hẹn cần thay đổi.',
        )
      }

      if (
        role === 'PATIENT' &&
        app.patientId !== userId &&
        app.patientId !== '10'
      ) {
        throw new BookingError(
          'FORBIDDEN',
          403,
          'Bạn không có quyền thao tác trên lịch hẹn của bệnh nhân khác.',
        )
      }

      // Only PENDING and CONFIRMED appointments can change slot
      if (app.status !== 'PENDING' && app.status !== 'CONFIRMED') {
        throw new BookingError(
          'INVALID_STATE_TRANSITION',
          409,
          `Không thể đổi lịch hẹn đang ở trạng thái ${app.status} (409 Conflict).`,
        )
      }

      // Appointment must not be in the past
      if (new Date(app.startAt).getTime() <= Date.now()) {
        throw new BookingError(
          'APPOINTMENT_PAST',
          409,
          'Không thể đổi lịch hẹn đã bắt đầu hoặc đã qua thời gian khám.',
        )
      }

      // Optimistic concurrency check
      const currentVersion = app.version ?? 0
      if (draft.expectedVersion !== currentVersion) {
        throw new BookingError(
          'VERSION_CONFLICT',
          409,
          'Dữ liệu cuộc hẹn đã được cập nhật bởi một phiên khác. Vui lòng tải lại dữ liệu mới nhất (409 Conflict).',
        )
      }

      // Check slot collision for new slot
      const newSlotKey = `${draft.scheduleId}_${draft.startAt}`
      if (bookedSlots.has(newSlotKey)) {
        throw new BookingError(
          'SLOT_UNAVAILABLE',
          409,
          'Khung giờ này vừa được người khác đặt trước hoặc không còn khả dụng. Vui lòng chọn khung giờ khác (409 Conflict).',
        )
      }

      // Release previous slot
      const oldSlotKey = `${app.scheduleId}_${app.startAt}`
      bookedSlots.delete(oldSlotKey)

      // Reserve new slot
      bookedSlots.set(newSlotKey, {
        appointmentId: app.id,
        requestKey: `reschedule_${app.id}_${draft.startAt}`,
      })

      // Calculate new end time (default 30 mins)
      const startMs = new Date(draft.startAt).getTime()
      const endAt = new Date(startMs + 30 * 60 * 1000).toISOString()

      // Update appointment: changed slot returns status to PENDING for confirmation
      app.scheduleId = draft.scheduleId
      app.startAt = draft.startAt
      app.endAt = endAt
      app.status = 'PENDING'
      app.rescheduledAt = new Date().toISOString()
      app.version = currentVersion + 1
      app.updatedAt = new Date().toISOString()

      return { ...app }
    },

    async cancelAppointment(
      draft: CancelAppointmentDraft,
    ): Promise<Appointment> {
      await wait()
      const { role, userId } = checkRoleAccess()

      // Only PATIENT and RECEPTIONIST can cancel
      if (role !== 'PATIENT' && role !== 'RECEPTIONIST') {
        throw new BookingError(
          'FORBIDDEN',
          403,
          'Bạn không có quyền thực hiện thao tác hủy lịch hẹn này.',
        )
      }

      const errors = validateCancelDraft(draft)
      if (Object.keys(errors).length > 0) {
        throw new BookingError(
          'VALIDATION_FAILED',
          400,
          'Dữ liệu hủy lịch không hợp lệ.',
          errors,
        )
      }

      const app = appointments.find((a) => a.id === draft.appointmentId)
      if (!app) {
        throw new BookingError(
          'NOT_FOUND',
          404,
          'Không tìm thấy lịch hẹn cần hủy.',
        )
      }

      if (
        role === 'PATIENT' &&
        app.patientId !== userId &&
        app.patientId !== '10'
      ) {
        throw new BookingError(
          'FORBIDDEN',
          403,
          'Bạn không có quyền hủy lịch hẹn của bệnh nhân khác.',
        )
      }

      // Already cancelled or completed
      if (app.status === 'CANCELLED' || app.status === 'COMPLETED') {
        throw new BookingError(
          'INVALID_STATE_TRANSITION',
          409,
          `Không thể hủy cuộc hẹn đang ở trạng thái ${app.status} (409 Conflict).`,
        )
      }

      // Past appointment
      if (new Date(app.startAt).getTime() <= Date.now()) {
        throw new BookingError(
          'APPOINTMENT_PAST',
          409,
          'Không thể hủy cuộc hẹn đã bắt đầu hoặc đã qua thời gian khám.',
        )
      }

      // Optimistic concurrency check
      const currentVersion = app.version ?? 0
      if (draft.expectedVersion !== currentVersion) {
        throw new BookingError(
          'VERSION_CONFLICT',
          409,
          'Dữ liệu cuộc hẹn đã được cập nhật bởi một phiên khác. Vui lòng tải lại dữ liệu mới nhất (409 Conflict).',
        )
      }

      // Release booked slot so it becomes available again
      const slotKey = `${app.scheduleId}_${app.startAt}`
      bookedSlots.delete(slotKey)

      // Update status to CANCELLED and store cancellation metadata
      const cancelReason = (
        draft.reason ??
        draft.cancellationReason ??
        ''
      ).trim()
      app.status = 'CANCELLED'
      app.cancellationReason = cancelReason || null
      app.cancelledAt = new Date().toISOString()
      app.cancelledBy = userId || '10'
      app.version = currentVersion + 1
      app.updatedAt = new Date().toISOString()

      return { ...app }
    },

    async confirmAppointment(
      draft: AppointmentActionDraft,
    ): Promise<Appointment> {
      await wait()
      const { role, userId } = checkRoleAccess()

      if (role !== 'RECEPTIONIST' && role !== 'ADMIN') {
        throw new BookingError(
          'FORBIDDEN',
          403,
          'Chỉ nhân viên lễ tân mới có quyền xác nhận lịch hẹn khám.',
        )
      }

      const errors = validateActionDraft(draft)
      if (Object.keys(errors).length > 0) {
        throw new BookingError(
          'VALIDATION_FAILED',
          400,
          'Dữ liệu xác nhận lịch hẹn không hợp lệ.',
          errors,
        )
      }

      const app = appointments.find((a) => a.id === draft.appointmentId)
      if (!app) {
        throw new BookingError(
          'NOT_FOUND',
          404,
          'Không tìm thấy lịch hẹn cần xác nhận.',
        )
      }

      // Optimistic concurrency check
      const currentVersion = app.version ?? 0
      if (draft.expectedVersion !== currentVersion) {
        throw new BookingError(
          'VERSION_CONFLICT',
          409,
          'Dữ liệu cuộc hẹn đã được cập nhật bởi một phiên khác. Vui lòng tải lại dữ liệu mới nhất (409 Conflict).',
        )
      }

      if (app.status !== 'PENDING') {
        throw new BookingError(
          'INVALID_STATE_TRANSITION',
          409,
          `Không thể xác nhận cuộc hẹn đang ở trạng thái ${app.status}. Chỉ cho phép xác nhận cuộc hẹn chờ xử lý (PENDING).`,
        )
      }

      app.status = 'CONFIRMED'
      app.confirmedAt = new Date().toISOString()
      app.confirmedBy = userId || 'receptionist_1'
      app.version = currentVersion + 1
      app.updatedAt = new Date().toISOString()

      return { ...app }
    },

    async checkInAppointment(
      draft: AppointmentActionDraft,
    ): Promise<Appointment> {
      await wait()
      const { role, userId } = checkRoleAccess()

      if (role !== 'RECEPTIONIST' && role !== 'ADMIN') {
        throw new BookingError(
          'FORBIDDEN',
          403,
          'Chỉ nhân viên lễ tân mới có quyền tiếp đón (check-in) bệnh nhân.',
        )
      }

      const errors = validateActionDraft(draft)
      if (Object.keys(errors).length > 0) {
        throw new BookingError(
          'VALIDATION_FAILED',
          400,
          'Dữ liệu tiếp đón không hợp lệ.',
          errors,
        )
      }

      const app = appointments.find((a) => a.id === draft.appointmentId)
      if (!app) {
        throw new BookingError(
          'NOT_FOUND',
          404,
          'Không tìm thấy lịch hẹn để tiếp đón.',
        )
      }

      // Idempotency: if already CHECKED_IN, return current record without error
      if (app.status === 'CHECKED_IN') {
        return { ...app }
      }

      // Optimistic concurrency check
      const currentVersion = app.version ?? 0
      if (draft.expectedVersion !== currentVersion) {
        throw new BookingError(
          'VERSION_CONFLICT',
          409,
          'Dữ liệu cuộc hẹn đã được cập nhật bởi một phiên khác. Vui lòng tải lại dữ liệu mới nhất (409 Conflict).',
        )
      }

      if (app.status !== 'CONFIRMED') {
        throw new BookingError(
          'INVALID_STATE_TRANSITION',
          409,
          `Không thể tiếp đón cuộc hẹn đang ở trạng thái ${app.status}. Chỉ cuộc hẹn đã xác nhận (CONFIRMED) mới được tiếp đón.`,
        )
      }

      app.status = 'CHECKED_IN'
      app.checkedInAt = new Date().toISOString()
      app.checkedInBy = userId || 'receptionist_1'
      app.version = currentVersion + 1
      app.updatedAt = new Date().toISOString()

      return { ...app }
    },

    async markNoShow(draft: AppointmentActionDraft): Promise<Appointment> {
      await wait()
      const { role, userId } = checkRoleAccess()

      if (role !== 'RECEPTIONIST' && role !== 'ADMIN') {
        throw new BookingError(
          'FORBIDDEN',
          403,
          'Chỉ nhân viên lễ tân mới có quyền đánh dấu vắng mặt.',
        )
      }

      const errors = validateActionDraft(draft)
      if (Object.keys(errors).length > 0) {
        throw new BookingError(
          'VALIDATION_FAILED',
          400,
          'Dữ liệu đánh dấu vắng mặt không hợp lệ.',
          errors,
        )
      }

      const app = appointments.find((a) => a.id === draft.appointmentId)
      if (!app) {
        throw new BookingError(
          'NOT_FOUND',
          404,
          'Không tìm thấy lịch hẹn cần đánh dấu vắng mặt.',
        )
      }

      // Optimistic concurrency check
      const currentVersion = app.version ?? 0
      if (draft.expectedVersion !== currentVersion) {
        throw new BookingError(
          'VERSION_CONFLICT',
          409,
          'Dữ liệu cuộc hẹn đã được cập nhật bởi một phiên khác. Vui lòng tải lại dữ liệu mới nhất (409 Conflict).',
        )
      }

      if (app.status !== 'CONFIRMED' && app.status !== 'PENDING') {
        throw new BookingError(
          'INVALID_STATE_TRANSITION',
          409,
          `Không thể đánh dấu vắng mặt cuộc hẹn ở trạng thái ${app.status}.`,
        )
      }

      // Per MySQL V6 schema contract, NO_SHOW keeps the slot occupied (does not release slot).
      // Only CANCELLED releases active slot back to AVAILABLE.
      app.status = 'NO_SHOW'
      app.noShowAt = new Date().toISOString()
      app.noShowBy = userId || 'receptionist_1'
      app.version = currentVersion + 1
      app.updatedAt = new Date().toISOString()

      return { ...app }
    },
  }
}
