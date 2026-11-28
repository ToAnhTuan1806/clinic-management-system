import { getAuthSnapshot } from '@/auth/session-store'
import {
  canRelease,
  HistoryError,
  pageSize,
  type HistoryGateway,
  type HistoryItem,
  type HistoryQuery,
} from '@/history/model'

// Synthetic in-memory UI fixture only; no real API contract is implied.
export function createHistoryMock(): HistoryGateway {
  const rows: HistoryItem[] = Array.from({ length: 9 }, (_, index) => ({
    id: String(index + 1),
    patientId: '1',
    appointmentAt:
      '2026-11-' + String(20 - index).padStart(2, '0') + 'T02:00:00Z',
    doctorName: 'Bác sĩ DEMO',
    specialtyName: 'Chuyên khoa DEMO',
    status: index === 2 ? 'IN_PROGRESS' : 'COMPLETED',
    releasedAt: index % 2 ? '2026-11-21T02:00:00Z' : null,
    version: 0,
    assigned: index !== 4,
  }))
  function actor() {
    const state = getAuthSnapshot()
    if (state.status !== 'authenticated') throw new HistoryError(401)
    if (state.user?.role !== 'PATIENT' && state.user?.role !== 'DOCTOR')
      throw new HistoryError(403)
    return state
  }
  function allowed(patientId: string, signal: AbortSignal) {
    signal.throwIfAborted()
    const state = actor()
    if (patientId !== '1') throw new HistoryError(404)
    return state.user!.role
  }
  function item(patientId: string, id: string, signal: AbortSignal) {
    const role = allowed(patientId, signal)
    const found = rows.find((row) => row.id === id)
    if (
      !found ||
      (role === 'PATIENT' && !found.releasedAt) ||
      (role === 'DOCTOR' && !found.assigned)
    )
      throw new HistoryError(404)
    return found
  }
  return {
    mode: 'mock',
    async patients(signal) {
      signal.throwIfAborted()
      actor()
      return [{ id: '1', name: 'Bệnh nhân DEMO · Dữ liệu tổng hợp' }]
    },
    async list(patientId: string, query: HistoryQuery, signal: AbortSignal) {
      const role = allowed(patientId, signal)
      const filtered = rows.filter(
        (row) =>
          (role !== 'PATIENT' || row.releasedAt) &&
          (role !== 'DOCTOR' || row.assigned) &&
          (!query.from || row.appointmentAt.slice(0, 10) >= query.from) &&
          (!query.to || row.appointmentAt.slice(0, 10) <= query.to) &&
          (query.publication === 'ALL' ||
            (query.publication === 'RELEASED'
              ? row.releasedAt
              : !row.releasedAt)) &&
          (row.doctorName + ' ' + row.specialtyName)
            .toLocaleLowerCase('vi')
            .includes(query.search.trim().toLocaleLowerCase('vi')),
      )
      return {
        total: filtered.length,
        items: filtered
          .slice(query.page * pageSize, (query.page + 1) * pageSize)
          .map((row) => ({ ...row })),
      }
    },
    async detail(patientId, id, signal) {
      const row = item(patientId, id, signal)
      return {
        item: { ...row },
        symptoms: 'Triệu chứng DEMO',
        diagnosis: 'Chẩn đoán mô phỏng DEMO',
        notes: 'Ghi chú DEMO',
        conclusion: 'Kết luận DEMO',
      }
    },
    async release(patientId, id, expectedVersion, signal) {
      const role = allowed(patientId, signal)
      const row = item(patientId, id, signal)
      if (role !== 'DOCTOR') throw new HistoryError(403)
      if (
        !Number.isSafeInteger(expectedVersion) ||
        row.version !== expectedVersion ||
        !canRelease(role, row)
      )
        throw new HistoryError(409)
      row.releasedAt = new Date().toISOString()
      row.version++
    },
  }
}
