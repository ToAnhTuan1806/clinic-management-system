// DEMO / MOCK ONLY. No HTTP endpoints, no persistence, no real clinical information.
import {
  clearSession,
  getAuthSnapshot,
  markForbidden,
} from '@/auth/session-store'
import {
  DirectoryError,
  validateDoctor,
  validateSpecialty,
  visibleDoctor,
  type DirectoryGateway,
  type DirectoryQuery,
  type Doctor,
  type DoctorUser,
  type Specialty,
} from '@/directory/model'

export function createDirectoryMock({ latency = 160 } = {}): DirectoryGateway {
  const specialties: Specialty[] = Array.from({ length: 12 }, (_, i) => ({
    id: String(i + 1),
    code: `DEMO_SPEC_${i + 1}`,
    name: `DEMO · ${['Nội tổng quát', 'Tim mạch', 'Da liễu', 'Nhi khoa'][i % 4]} ${i + 1}`,
    description: 'DEMO · Dữ liệu tổng hợp chỉ dành cho kiểm thử giao diện.',
    active: i !== 2,
  }))
  const users: DoctorUser[] = Array.from({ length: 16 }, (_, i) => ({
    id: String(1001 + i),
    email: `demo-doctor-${i + 1}@example.invalid`,
    fullName: `DEMO · Bác sĩ ${String(i + 1).padStart(2, '0')}`,
    role: 'DOCTOR',
    active: i !== 15,
    linked: i < 12,
  }))
  const doctors: Doctor[] = users.slice(0, 12).map((user, i) => ({
    id: String(i + 1),
    doctorCode: `DEMO_DR_${i + 1}`,
    licenseNumber: `DEMO_LIC_${i + 1}`,
    userStatus: 'ACTIVE',
    userId: user.id,
    fullName: user.fullName,
    specialtyId: specialties[i % 4].id,
    specialtyName: specialties[i % 4].name,
    specialtyActive: specialties[i % 4].active,
    biography: 'DEMO · Hồ sơ tổng hợp, không đại diện cho bác sĩ thật.',
    active: i !== 1,
  }))
  let nextSpecialtyId = 1000
  let nextDoctorId = 1000
  const scopeDoctor = (doctor: Doctor, role: string): Doctor => {
    const result = { ...doctor }
    if (role === 'PATIENT' || role === 'RECEPTIONIST') {
      delete result.userId
      delete result.licenseNumber
    }
    if (role === 'PATIENT') delete result.userStatus
    return result
  }
  const copyDoctor = (doctor: Doctor): Doctor => {
    const specialty = specialties.find(
      (item) => item.id === doctor.specialtyId,
    )!
    return {
      ...doctor,
      specialtyName: specialty.name,
      specialtyActive: specialty.active,
    }
  }
  async function access(signal: AbortSignal, manage = false) {
    signal.throwIfAborted()
    const started = getAuthSnapshot()
    const gate =
      typeof window !== 'undefined' ? window.__directoryMockGate : undefined
    if (manage && gate) {
      gate.calls++
      await gate.wait
      signal.throwIfAborted()
    }
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort)
        resolve()
      }, latency)
      signal.addEventListener('abort', abort, { once: true })
    })
    signal.throwIfAborted()
    const state = getAuthSnapshot()
    if (
      !state.user ||
      state.status !== 'authenticated' ||
      started.version !== state.version
    )
      throw new DirectoryError('AUTHENTICATION_REQUIRED', 401)
    // Dev-only fault injection: never included in a production build.
    const fault =
      typeof window !== 'undefined' ? window.__directoryMockFault : undefined
    if (fault !== undefined) {
      delete window.__directoryMockFault
      if (fault === 401) clearSession('expired', state.version)
      if (fault === 403) markForbidden(state.version)
      throw new DirectoryError('MOCK_FAULT', fault)
    }
    if (manage && state.user.role !== 'ADMIN')
      throw new DirectoryError('ACCESS_DENIED', 403)
    return state.user
  }
  function paginate<
    T extends {
      code?: string
      doctorCode?: string
      name?: string
      fullName?: string
      email?: string
      active: boolean
    },
  >(items: T[], query: DirectoryQuery) {
    const search = query.search.trim().toLocaleLowerCase('vi')
    const filtered = items.filter(
      (item) =>
        [item.name, item.fullName, item.code, item.doctorCode, item.email]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase('vi')
          .includes(search) &&
        (query.active === 'all' || item.active === (query.active === 'active')),
    )
    return {
      items: filtered
        .slice(query.page * query.pageSize, (query.page + 1) * query.pageSize)
        .map((item) => ({ ...item })),
      page: query.page,
      pageSize: query.pageSize,
      total: filtered.length,
    }
  }
  return {
    mode: 'mock',
    async listSpecialties(query, signal) {
      const user = await access(signal)
      return paginate(
        specialties.filter(
          (item) => !['DOCTOR', 'PATIENT'].includes(user.role) || item.active,
        ),
        query,
      )
    },
    async listDoctors(query, signal) {
      const user = await access(signal)
      return paginate(
        doctors
          .map(copyDoctor)
          .filter(
            (item) =>
              visibleDoctor(item, user) &&
              (!query.specialtyId || item.specialtyId === query.specialtyId),
          )
          .map((item) => scopeDoctor(item, user.role)),
        query,
      )
    },
    async specialtyOptions(signal, activeOnly) {
      const user = await access(signal)
      return specialties
        .filter(
          (item) =>
            (!activeOnly && !['DOCTOR', 'PATIENT'].includes(user.role)) ||
            item.active,
        )
        .map((item) => ({ ...item }))
    },
    async getSpecialty(id, signal) {
      const user = await access(signal),
        item = specialties.find(
          (value) =>
            value.id === id &&
            (!['DOCTOR', 'PATIENT'].includes(user.role) || value.active),
        )
      if (!item) throw new DirectoryError('RESOURCE_NOT_FOUND', 404)
      return { ...item }
    },
    async getDoctor(id, signal) {
      const user = await access(signal),
        item = doctors
          .map(copyDoctor)
          .find((value) => value.id === id && visibleDoctor(value, user))
      if (!item) throw new DirectoryError('RESOURCE_NOT_FOUND', 404)
      return scopeDoctor(item, user.role)
    },
    async doctorUsers(signal, query = { search: '', page: 0, pageSize: 20 }) {
      await access(signal, true)
      return paginate(
        users.filter((item) => item.active && !item.linked),
        { ...query, active: 'all', specialtyId: '' },
      )
    },
    async saveSpecialty(id, draft, signal) {
      await access(signal, true)
      const fields = validateSpecialty(draft)
      if (Object.keys(fields).length)
        throw new DirectoryError('VALIDATION_FAILED', 400, fields)
      if (
        specialties.some(
          (item) =>
            item.id !== id &&
            item.name.toLocaleLowerCase('vi') ===
              draft.name.trim().toLocaleLowerCase('vi'),
        )
      )
        throw new DirectoryError('SPECIALTY_NAME_EXISTS', 409, {
          name: 'Tên chuyên khoa đã tồn tại.',
        })
      if (
        specialties.some(
          (item) =>
            item.id !== id && item.code === draft.code.trim().toUpperCase(),
        )
      )
        throw new DirectoryError('SPECIALTY_CODE_EXISTS', 409, {
          code: 'Mã chuyên khoa đã được sử dụng.',
        })
      const record = {
        code: draft.code.trim().toUpperCase(),
        name: draft.name.trim(),
        description: draft.description.trim(),
      }
      const existing = specialties.find((item) => item.id === id)
      if (id && !existing) throw new DirectoryError('NOT_FOUND', 404)
      if (existing) Object.assign(existing, record)
      else
        specialties.unshift({
          ...record,
          id: String(nextSpecialtyId++),
          active: true,
        })
    },
    async saveDoctor(id, draft, signal) {
      await access(signal, true)
      const fields = validateDoctor(draft, !!id)
      const existing = doctors.find((item) => item.id === id)
      if (id && !existing) throw new DirectoryError('NOT_FOUND', 404)
      const user = users.find((item) => item.id === draft.userId)
      const specialty = specialties.find(
        (item) =>
          item.id === draft.specialtyId &&
          (item.active || existing?.specialtyId === item.id),
      )
      if (!user?.active || (user.linked && existing?.userId !== user.id))
        fields.userId = 'Tài khoản bác sĩ không còn khả dụng.'
      if (!specialty)
        fields.specialtyId =
          'Chuyên khoa không còn hoạt động. Vui lòng chọn lại.'
      if (Object.keys(fields).length)
        throw new DirectoryError('VALIDATION_FAILED', 400, fields)
      if (
        doctors.some(
          (item) =>
            item.id !== id &&
            item.doctorCode === draft.doctorCode.trim().toUpperCase(),
        )
      )
        throw new DirectoryError('DOCTOR_CODE_EXISTS', 409, {
          doctorCode: 'Mã bác sĩ đã được sử dụng.',
        })
      if (
        draft.licenseNumber.trim() &&
        doctors.some(
          (item) =>
            item.id !== id &&
            item.licenseNumber === draft.licenseNumber.trim().toUpperCase(),
        )
      )
        throw new DirectoryError('LICENSE_NUMBER_EXISTS', 409, {
          licenseNumber: 'Số giấy phép đã được sử dụng.',
        })
      if (existing)
        Object.assign(existing, {
          doctorCode: draft.doctorCode.trim().toUpperCase(),
          licenseNumber: draft.licenseNumber.trim().toUpperCase(),
          specialtyId: draft.specialtyId,
          biography: draft.biography.trim(),
        })
      else {
        user!.linked = true
        doctors.unshift({
          id: String(nextDoctorId++),
          doctorCode: draft.doctorCode.trim().toUpperCase(),
          licenseNumber: draft.licenseNumber.trim().toUpperCase(),
          userStatus: 'ACTIVE',
          userId: user!.id,
          fullName: user!.fullName,
          specialtyId: specialty!.id,
          specialtyName: specialty!.name,
          specialtyActive: true,
          biography: draft.biography.trim(),
          active: true,
        })
      }
    },
    async setActive(kind, id, active, signal) {
      await access(signal, true)
      const item = (kind === 'doctors' ? doctors : specialties).find(
        (value) => value.id === id,
      )
      if (!item) throw new DirectoryError('NOT_FOUND', 404)
      if (
        kind === 'specialties' &&
        !active &&
        doctors.some((value) => value.specialtyId === id && value.active)
      )
        throw new DirectoryError('SPECIALTY_HAS_ACTIVE_DOCTORS', 409)
      if (kind === 'doctors' && active) {
        const doctor = item as Doctor
        if (
          !specialties.find((value) => value.id === doctor.specialtyId)?.active
        )
          throw new DirectoryError('SPECIALTY_INACTIVE', 409)
      }
      item.active = active
    },
  }
}
declare global {
  interface Window {
    __directoryMockFault?: 0 | 400 | 401 | 403 | 409 | 500
    __directoryMockGate?: { wait: Promise<void>; calls: number }
  }
}
