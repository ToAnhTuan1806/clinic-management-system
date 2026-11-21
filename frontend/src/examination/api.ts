import type { AxiosInstance } from 'axios'
import { normalizeAuthError } from '@/auth/errors'
import { validId } from '@/schedule/model'

// D10 DTOs from the Backend worktree API_CONTRACT.md section 3.8.
export const examinationFields = {
  symptoms: 'Triệu chứng',
  diagnosis: 'Chẩn đoán mô phỏng',
  notes: 'Ghi chú',
  conclusion: 'Kết luận',
}

export type ExaminationDraft = Record<keyof typeof examinationFields, string>
export type Examination = ExaminationDraft & {
  id: string
  appointmentId: string
  status: 'IN_PROGRESS' | 'COMPLETED'
  version: number
}

export const fieldNames = Object.keys(
  examinationFields,
) as (keyof ExaminationDraft)[]
export const maxFieldLength = 5000

export function cleanDraft(draft: ExaminationDraft): ExaminationDraft {
  return {
    symptoms: draft.symptoms.trim(),
    diagnosis: draft.diagnosis.trim(),
    notes: draft.notes.trim(),
    conclusion: draft.conclusion.trim(),
  }
}

function validVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function decode(body: unknown): Examination {
  const row = (body as { data?: Partial<Examination> } | null)?.data
  if (
    !row ||
    !validId(row.id) ||
    !validId(row.appointmentId) ||
    !validVersion(row.version) ||
    (row.status !== 'IN_PROGRESS' && row.status !== 'COMPLETED') ||
    fieldNames.some((key) => row[key] !== null && typeof row[key] !== 'string')
  ) {
    throw new Error('INVALID_EXAMINATION_RESPONSE')
  }
  return {
    id: row.id,
    appointmentId: row.appointmentId,
    status: row.status,
    version: row.version,
    symptoms: row.symptoms ?? '',
    diagnosis: row.diagnosis ?? '',
    notes: row.notes ?? '',
    conclusion: row.conclusion ?? '',
  }
}

export function createExaminationApi(client: AxiosInstance) {
  const path = '/api/v1/medical-records'
  const recordPath = (id: string) => {
    if (!validId(id)) throw new Error('INVALID_EXAMINATION_ID')
    return path + '/' + id
  }
  function verify(result: Examination, appointmentId: string, id?: string) {
    if (result.appointmentId !== appointmentId || (id && result.id !== id))
      throw new Error('INVALID_EXAMINATION_RESPONSE')
    return result
  }
  function writable(record: Examination) {
    if (record.status !== 'IN_PROGRESS' || !validVersion(record.version))
      throw new Error('EXAMINATION_READ_ONLY')
  }
  function transition(
    result: Examination,
    previous: Examination,
    status: Examination['status'],
  ) {
    verify(result, previous.appointmentId, previous.id)
    if (result.status !== status || result.version <= previous.version)
      throw new Error('INVALID_EXAMINATION_RESPONSE')
    return result
  }
  return {
    async byAppointment(appointmentId: string, signal: AbortSignal) {
      if (!validId(appointmentId)) throw new Error('INVALID_APPOINTMENT')
      return verify(
        decode(
          (
            await client.get(path + '/by-appointment/' + appointmentId, {
              signal,
            })
          ).data,
        ),
        appointmentId,
      )
    },
    async create(appointmentId: string, signal: AbortSignal) {
      if (!validId(appointmentId)) throw new Error('INVALID_APPOINTMENT')
      const result = verify(
        decode((await client.post(path, { appointmentId }, { signal })).data),
        appointmentId,
      )
      if (result.status !== 'IN_PROGRESS')
        throw new Error('INVALID_EXAMINATION_RESPONSE')
      return result
    },
    async read(id: string, appointmentId: string, signal: AbortSignal) {
      return verify(
        decode((await client.get(recordPath(id), { signal })).data),
        appointmentId,
        id,
      )
    },
    async save(
      record: Examination,
      draft: ExaminationDraft,
      signal: AbortSignal,
    ) {
      writable(record)
      const body = cleanDraft(draft)
      if (fieldNames.some((key) => draft[key].length > maxFieldLength))
        throw new Error('INVALID_EXAMINATION_DRAFT')
      const response = await client.patch(
        recordPath(record.id),
        { ...body, expectedVersion: record.version },
        { signal },
      )
      return transition(decode(response.data), record, 'IN_PROGRESS')
    },
    async complete(record: Examination, signal: AbortSignal) {
      writable(record)
      if (
        !record.symptoms.trim() ||
        !record.diagnosis.trim() ||
        !record.conclusion.trim()
      )
        throw new Error('INVALID_EXAMINATION_DRAFT')
      const response = await client.post(
        recordPath(record.id) + '/completion',
        { expectedVersion: record.version },
        { signal },
      )
      return transition(decode(response.data), record, 'COMPLETED')
    },
  }
}

export function examinationProblem(error: unknown) {
  const { status, code } = normalizeAuthError(error)
  switch (status) {
    case 400:
      return 'Thông tin hồ sơ chưa hợp lệ. Vui lòng kiểm tra lại.'
    case 401:
      return 'Phiên đăng nhập đã hết hạn.'
    case 403:
      return 'Bạn không có quyền thao tác trên hồ sơ này.'
    case 404:
      return 'Không tìm thấy hồ sơ trong phạm vi được phân công.'
    case 409:
      return code === 'VERSION_CONFLICT'
        ? 'Hồ sơ đã thay đổi. Tải lại bản mới trước khi tiếp tục.'
        : 'Không thể tiếp tục vì lịch hẹn hoặc hồ sơ đã thay đổi. Hãy tải lại dữ liệu.'
    default:
      return 'Không thể xử lý hồ sơ khám. Vui lòng thử lại.'
  }
}
