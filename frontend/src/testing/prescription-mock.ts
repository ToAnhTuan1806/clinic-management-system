import { getAuthSnapshot } from '@/auth/session-store'
import {
  cleanItem,
  PrescriptionError,
  validatePrescription,
  type Prescription,
  type PrescriptionDraft,
  type PrescriptionGateway,
} from '@/prescription/model'

export function createPrescriptionMock(): PrescriptionGateway & {
  reset: () => void
  setMockRecordState: (
    recordId: string,
    state: { version: number; completed: boolean; released: boolean },
  ) => void
} {
  // Keyed by medicalRecordId
  const store = new Map<
    string,
    {
      prescription: Prescription
      completed: boolean
      released: boolean
    }
  >()

  function initDefaultFixtures() {
    store.clear()

    // Record '1': Completed & Released (Patient can see)
    store.set('1', {
      prescription: {
        id: '101',
        medicalRecordId: '1',
        recordVersion: 1,
        editable: false,
        simulation: true,
        items: [
          {
            id: '1',
            medicationName: 'Paracetamol 500mg',
            quantity: 10,
            dosage: '500mg (1 viên)',
            frequency: '2 lần/ngày sau khi ăn',
            durationDays: 5,
            instructions:
              'Uống với nhiều nước, cách nhau ít nhất 4-6 giờ khi sốt trên 38.5 độ',
          },
          {
            id: '2',
            medicationName: 'Vitamin C 500mg',
            quantity: 5,
            dosage: '1 viên',
            frequency: '1 lần/ngày vào buổi sáng',
            durationDays: 5,
            instructions: 'Uống sau bữa ăn sáng',
          },
        ],
      },
      completed: true,
      released: true,
    })

    // Record '2': Completed but NOT Released (Patient cannot see)
    store.set('2', {
      prescription: {
        id: '102',
        medicalRecordId: '2',
        recordVersion: 0,
        editable: false,
        simulation: true,
        items: [
          {
            id: '3',
            medicationName: 'Ibuprofen 400mg',
            quantity: 6,
            dosage: '1 viên',
            frequency: '2 lần/ngày khi đau',
            durationDays: 3,
            instructions: 'Không dùng khi đói',
          },
        ],
      },
      completed: true,
      released: false,
    })

    // Record '3': IN_PROGRESS (Doctor can edit)
    store.set('3', {
      prescription: {
        id: '103',
        medicalRecordId: '3',
        recordVersion: 0,
        editable: true,
        simulation: true,
        items: [],
      },
      completed: false,
      released: false,
    })

    // Record '4': Completed & Released (Patient can see in medical-history mock)
    store.set('4', {
      prescription: {
        id: '104',
        medicalRecordId: '4',
        recordVersion: 1,
        editable: false,
        simulation: true,
        items: [
          {
            id: '1',
            medicationName: 'Paracetamol 500mg',
            quantity: 10,
            dosage: '500mg (1 viên)',
            frequency: '2 lần/ngày sau khi ăn',
            durationDays: 5,
            instructions: 'Uống với nhiều nước khi sốt',
          },
          {
            id: '2',
            medicationName: 'Vitamin C 500mg',
            quantity: 5,
            dosage: '1 viên',
            frequency: '1 lần/ngày vào buổi sáng',
            durationDays: 5,
            instructions: 'Uống sau bữa ăn sáng',
          },
        ],
      },
      completed: true,
      released: true,
    })
  }

  initDefaultFixtures()

  function getAuthenticatedUser() {
    const session = getAuthSnapshot()
    if (session.status !== 'authenticated' || !session.user) {
      throw new PrescriptionError(401, 'Phiên đăng nhập đã hết hạn.')
    }
    return session.user
  }

  return {
    mode: 'mock',

    reset() {
      initDefaultFixtures()
    },

    setMockRecordState(
      recordId: string,
      state: { version: number; completed: boolean; released: boolean },
    ) {
      const entry = store.get(recordId)
      if (entry) {
        entry.prescription.recordVersion = state.version
        entry.completed = state.completed
        entry.released = state.released
        entry.prescription.editable = !state.completed
      } else {
        store.set(recordId, {
          prescription: {
            id: String(Date.now()),
            medicalRecordId: recordId,
            recordVersion: state.version,
            editable: !state.completed,
            simulation: true,
            items: [],
          },
          completed: state.completed,
          released: state.released,
        })
      }
    },

    async get(
      recordId: string,
      signal?: AbortSignal,
    ): Promise<Prescription | null> {
      signal?.throwIfAborted()
      const user = getAuthenticatedUser()

      // Privacy: ADMIN & RECEPTIONIST must not view clinical prescription content
      if (user.role === 'ADMIN' || user.role === 'RECEPTIONIST') {
        throw new PrescriptionError(
          403,
          'Không có quyền truy cập thông tin lâm sàng.',
        )
      }

      const entry = store.get(recordId)
      if (!entry) return null

      // Privacy: PATIENT cannot see prescription of unreleased records
      if (user.role === 'PATIENT' && (!entry.released || !entry.completed)) {
        throw new PrescriptionError(404, 'Hồ sơ chưa được công bố.')
      }

      return JSON.parse(JSON.stringify(entry.prescription))
    },

    async save(
      recordId: string,
      draft: PrescriptionDraft,
      expectedVersion: number,
      signal?: AbortSignal,
    ): Promise<Prescription> {
      signal?.throwIfAborted()
      const user = getAuthenticatedUser()

      if (user.role !== 'DOCTOR') {
        throw new PrescriptionError(
          403,
          'Chỉ bác sĩ mới có quyền chỉnh sửa đơn thuốc.',
        )
      }

      if (
        typeof expectedVersion !== 'number' ||
        !Number.isSafeInteger(expectedVersion) ||
        expectedVersion < 0
      ) {
        throw new PrescriptionError(400, 'Phiên bản hồ sơ không hợp lệ.')
      }

      const cleanedItems = (draft.items || []).map(cleanItem)
      const validation = validatePrescription(cleanedItems)
      if (!validation.isValid) {
        throw new PrescriptionError(
          400,
          validation.generalError || 'Thông tin đơn thuốc không hợp lệ.',
        )
      }

      const entry = store.get(recordId)
      const currentVersion = entry ? entry.prescription.recordVersion : 0

      // Read-only policy: completed record cannot be edited
      if (entry?.completed) {
        throw new PrescriptionError(
          403,
          'Hồ sơ đã hoàn tất không thể chỉnh sửa đơn thuốc.',
        )
      }

      // Optimistic concurrency check
      if (currentVersion !== expectedVersion) {
        throw new PrescriptionError(
          409,
          'Hồ sơ đã thay đổi (xung đột phiên bản). Vui lòng tải lại dữ liệu mới nhất.',
          'VERSION_CONFLICT',
        )
      }

      const newVersion = expectedVersion + 1
      const updated: Prescription = {
        id: entry?.prescription.id || String(Date.now()),
        medicalRecordId: recordId,
        recordVersion: newVersion,
        editable: true,
        simulation: true,
        items: cleanedItems.map((it, idx) => ({
          ...it,
          id: it.id || String(idx + 1),
        })),
      }

      store.set(recordId, {
        prescription: updated,
        completed: false,
        released: false,
      })

      return JSON.parse(JSON.stringify(updated))
    },
  }
}
