export type HistoryActor = 'DOCTOR' | 'PATIENT'
export interface HistoryItem {
  id: string
  patientId: string
  appointmentAt: string
  doctorName: string
  specialtyName: string
  status: 'IN_PROGRESS' | 'COMPLETED'
  releasedAt: string | null
  version: number
  assigned: boolean
}
export interface HistoryDetail {
  item: HistoryItem
  symptoms: string
  diagnosis: string
  notes: string
  conclusion: string
}
export interface HistoryQuery {
  page: number
  search: string
  from: string
  to: string
  publication: 'ALL' | 'RELEASED' | 'UNRELEASED'
}
export interface HistoryPage {
  items: HistoryItem[]
  total: number
}
export interface HistoryGateway {
  mode: 'pending' | 'mock' | 'real'
  patients(signal: AbortSignal): Promise<{ id: string; name: string }[]>
  list(
    patientId: string,
    query: HistoryQuery,
    signal: AbortSignal,
  ): Promise<HistoryPage>
  detail(
    patientId: string,
    id: string,
    signal: AbortSignal,
  ): Promise<HistoryDetail>
  release(
    patientId: string,
    id: string,
    expectedVersion: number,
    signal: AbortSignal,
  ): Promise<void>
}
export class HistoryError extends Error {
  readonly status: number
  constructor(status: number) {
    super('HISTORY_REQUEST_FAILED')
    this.status = status
  }
}
export function canRelease(role: string | undefined, item: HistoryItem) {
  return (
    role === 'DOCTOR' &&
    item.assigned &&
    item.status === 'COMPLETED' &&
    !item.releasedAt
  )
}
export function historyMessage(error: unknown) {
  const status = error instanceof HistoryError ? error.status : 0
  if (status === 401)
    return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
  if (status === 403) return 'Bạn không có quyền xem hoặc công bố hồ sơ này.'
  if (status === 404) return 'Không tìm thấy lịch sử trong phạm vi được xem.'
  if (status === 409)
    return 'Hồ sơ đã thay đổi. Hãy tải lại dữ liệu và kiểm tra trước khi công bố.'
  if (status === 503)
    return 'Dịch vụ lịch sử khám đang chờ kết nối Backend D11.'
  return 'Không thể tải lịch sử khám. Kiểm tra kết nối và thử lại.'
}
export const pageSize = 5
