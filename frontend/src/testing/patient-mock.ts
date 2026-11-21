import { getAuthSnapshot } from '@/auth/session-store'
import {
  PatientError,
  validatePatient,
  type Page,
  type Patient,
  type PatientDraft,
  type PatientGateway,
  type PatientQuery,
} from '@/patient/model'

const INITIAL_PATIENTS: Patient[] = [
  {
    id: '1',
    patientCode: 'BN000001',
    fullName: 'Nguyễn Văn An',
    dateOfBirth: '1985-04-12',
    sex: 'MALE',
    phone: '0912345678',
    address: '123 Phố Huế, Hai Bà Trưng, Hà Nội',
    active: true,
    userId: '10', // linked to demo user
    createdAt: '2026-01-10T08:00:00Z',
    updatedAt: '2026-01-10T08:00:00Z',
  },
  {
    id: '2',
    patientCode: 'BN000002',
    fullName: 'Trần Thị Bình',
    dateOfBirth: '1992-09-25',
    sex: 'FEMALE',
    phone: '0987654321',
    address: '45 Đường Láng, Đống Đa, Hà Nội',
    active: true,
    userId: null,
    createdAt: '2026-01-15T09:30:00Z',
    updatedAt: '2026-01-15T09:30:00Z',
  },
  {
    id: '3',
    patientCode: 'BN000003',
    fullName: 'Lê Hoàng Cường',
    dateOfBirth: '1978-11-03',
    sex: 'MALE',
    phone: '0903112233',
    address: '78 Cầu Giấy, Cầu Giấy, Hà Nội',
    active: false,
    userId: null,
    createdAt: '2026-02-01T14:15:00Z',
    updatedAt: '2026-02-10T16:00:00Z',
  },
  {
    id: '4',
    patientCode: 'BN000004',
    fullName: 'Phạm Thu Dung',
    dateOfBirth: '2001-07-19',
    sex: 'FEMALE',
    phone: '0945678901',
    address: '12 Hoàng Hoa Thám, Ba Đình, Hà Nội',
    active: true,
    userId: null,
    createdAt: '2026-02-15T10:00:00Z',
    updatedAt: '2026-02-15T10:00:00Z',
  },
]

export function createPatientMock(
  initialData: Patient[] = INITIAL_PATIENTS,
): PatientGateway {
  let patients: Patient[] = initialData.map((p) => ({ ...p }))
  let nextId = 100

  const getActor = () => {
    const session = getAuthSnapshot()
    if (!session.user || session.status !== 'authenticated') {
      throw new PatientError('AUTHENTICATION_REQUIRED', 401)
    }
    return session.user
  }

  return {
    mode: 'mock',

    async listPatients(
      query: PatientQuery,
      signal: AbortSignal,
    ): Promise<Page<Patient>> {
      signal.throwIfAborted()
      const user = getActor()
      if (user.role === 'DOCTOR') {
        throw new PatientError('ACCESS_DENIED', 403)
      }
      if (user.role === 'PATIENT') {
        throw new PatientError('ACCESS_DENIED', 403)
      }

      let filtered = [...patients]

      if (query.active === 'active') {
        filtered = filtered.filter((p) => p.active)
      } else if (query.active === 'inactive') {
        filtered = filtered.filter((p) => !p.active)
      }

      const q = query.search.trim().toLowerCase()
      if (q) {
        filtered = filtered.filter(
          (p) =>
            p.patientCode.toLowerCase().includes(q) ||
            p.fullName.toLowerCase().includes(q) ||
            p.phone.includes(q),
        )
      }

      const total = filtered.length
      const pageSize = Math.max(1, query.pageSize || 10)
      const page = Math.max(0, query.page || 0)
      const totalPages = Math.ceil(total / pageSize)
      const items = filtered.slice(page * pageSize, (page + 1) * pageSize)

      return {
        items,
        page,
        pageSize,
        total,
        totalPages,
      }
    },

    async getPatient(id: string, signal: AbortSignal): Promise<Patient> {
      signal.throwIfAborted()
      const user = getActor()
      const found = patients.find((p) => p.id === id)
      if (!found) {
        throw new PatientError('RESOURCE_NOT_FOUND', 404)
      }

      if (user.role === 'PATIENT') {
        if (found.userId !== user.id) {
          throw new PatientError('RESOURCE_NOT_FOUND', 404)
        }
      } else if (user.role === 'DOCTOR') {
        throw new PatientError('ACCESS_DENIED', 403)
      }

      return { ...found }
    },

    async getMePatientProfile(signal: AbortSignal): Promise<Patient> {
      signal.throwIfAborted()
      const user = getActor()
      if (user.role !== 'PATIENT') {
        throw new PatientError('ACCESS_DENIED', 403)
      }
      const found = patients.find((p) => p.userId === user.id)
      if (!found) {
        throw new PatientError('RESOURCE_NOT_FOUND', 404)
      }
      return { ...found }
    },

    async savePatient(
      id: string | undefined,
      draft: PatientDraft,
      signal: AbortSignal,
    ): Promise<Patient> {
      signal.throwIfAborted()
      const user = getActor()
      if (user.role !== 'ADMIN' && user.role !== 'RECEPTIONIST') {
        throw new PatientError('ACCESS_DENIED', 403)
      }

      const errors = validatePatient(draft)
      if (Object.keys(errors).length > 0) {
        throw new PatientError('VALIDATION_FAILED', 400, errors)
      }

      const codeUpper = draft.patientCode.trim().toUpperCase()

      // Duplicate patientCode check
      const duplicateCode = patients.find(
        (p) => p.id !== id && p.patientCode.toUpperCase() === codeUpper,
      )
      if (duplicateCode) {
        throw new PatientError('PATIENT_CODE_EXISTS', 409, {
          patientCode: 'Mã bệnh nhân đã tồn tại trong hệ thống.',
        })
      }

      // Duplicate userId check
      if (draft.userId) {
        const duplicateUser = patients.find(
          (p) => p.id !== id && p.userId === draft.userId,
        )
        if (duplicateUser) {
          throw new PatientError('USER_ALREADY_LINKED', 409, {
            userId:
              'Tài khoản người dùng đã được liên kết với một hồ sơ bệnh nhân khác.',
          })
        }
      }

      const now = new Date().toISOString()

      if (id) {
        const index = patients.findIndex((p) => p.id === id)
        if (index === -1) {
          throw new PatientError('RESOURCE_NOT_FOUND', 404)
        }
        const updated: Patient = {
          ...patients[index],
          patientCode: codeUpper,
          fullName: draft.fullName.trim(),
          dateOfBirth: draft.dateOfBirth.trim(),
          sex: draft.sex,
          phone: draft.phone.trim(),
          address: draft.address.trim(),
          userId: draft.userId ? draft.userId : null,
          updatedAt: now,
        }
        patients[index] = updated
        return { ...updated }
      } else {
        const created: Patient = {
          id: String(++nextId),
          patientCode: codeUpper,
          fullName: draft.fullName.trim(),
          dateOfBirth: draft.dateOfBirth.trim(),
          sex: draft.sex,
          phone: draft.phone.trim(),
          address: draft.address.trim(),
          active: true,
          userId: draft.userId ? draft.userId : null,
          createdAt: now,
          updatedAt: now,
        }
        patients.unshift(created)
        return { ...created }
      }
    },

    async setActive(
      id: string,
      active: boolean,
      signal: AbortSignal,
    ): Promise<void> {
      signal.throwIfAborted()
      const user = getActor()
      if (user.role !== 'ADMIN' && user.role !== 'RECEPTIONIST') {
        throw new PatientError('ACCESS_DENIED', 403)
      }
      const index = patients.findIndex((p) => p.id === id)
      if (index === -1) {
        throw new PatientError('RESOURCE_NOT_FOUND', 404)
      }
      patients[index] = {
        ...patients[index],
        active,
        updatedAt: new Date().toISOString(),
      }
    },
  }
}
