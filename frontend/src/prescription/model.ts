export interface PrescriptionItem {
  id?: string
  medicationName: string
  quantity: number
  dosage: string
  frequency: string
  durationDays: number
  instructions: string
}

export interface Prescription {
  id: string
  medicalRecordId: string
  recordVersion: number
  editable: boolean
  simulation: boolean
  items: PrescriptionItem[]
}

export interface PrescriptionDraft {
  items: PrescriptionItem[]
}

export interface PrescriptionItemErrors {
  medicationName?: string
  quantity?: string
  dosage?: string
  frequency?: string
  durationDays?: string
  instructions?: string
}

export interface PrescriptionValidationResult {
  isValid: boolean
  generalError?: string
  itemErrors: Record<number, PrescriptionItemErrors>
}

export const MAX_PRESCRIPTION_ITEMS = 50
export const MAX_MEDICATION_NAME_LENGTH = 200
export const MIN_QUANTITY = 1
export const MAX_QUANTITY = 10000
export const MAX_DOSAGE_LENGTH = 100
export const MAX_FREQUENCY_LENGTH = 100
export const MIN_DURATION_DAYS = 1
export const MAX_DURATION_DAYS = 365
export const MAX_INSTRUCTIONS_LENGTH = 1000

export const PRESCRIPTION_SIMULATION_NOTICE =
  'Đơn thuốc mô phỏng — Chỉ phục vụ mục đích học tập, không có giá trị kê đơn điều trị.'

export class PrescriptionError extends Error {
  readonly status: number
  readonly code?: string

  constructor(status: number, message?: string, code?: string) {
    super(message || 'PRESCRIPTION_REQUEST_FAILED')
    this.status = status
    this.code = code
  }
}

export function createEmptyItem(): PrescriptionItem {
  return {
    medicationName: '',
    quantity: 1,
    dosage: '',
    frequency: '',
    durationDays: 1,
    instructions: '',
  }
}

export function cleanItem(item: PrescriptionItem): PrescriptionItem {
  return {
    id: item.id,
    medicationName: item.medicationName.trim(),
    quantity: Number(item.quantity) || 0,
    dosage: item.dosage.trim(),
    frequency: item.frequency.trim(),
    durationDays: Number(item.durationDays) || 0,
    instructions: (item.instructions ?? '').trim(),
  }
}

export function validatePrescription(
  items: PrescriptionItem[],
): PrescriptionValidationResult {
  if (items.length > MAX_PRESCRIPTION_ITEMS) {
    return {
      isValid: false,
      generalError: `Đơn thuốc tối đa ${MAX_PRESCRIPTION_ITEMS} dòng.`,
      itemErrors: {},
    }
  }

  const itemErrors: Record<number, PrescriptionItemErrors> = {}
  let hasErrors = false

  items.forEach((item, index) => {
    const errors: PrescriptionItemErrors = {}
    const medName = item.medicationName.trim()
    if (!medName) {
      errors.medicationName = 'Tên thuốc không được để trống.'
    } else if (medName.length > MAX_MEDICATION_NAME_LENGTH) {
      errors.medicationName = `Tên thuốc tối đa ${MAX_MEDICATION_NAME_LENGTH} ký tự.`
    }

    const qty = Number(item.quantity)
    if (!Number.isInteger(qty) || qty < MIN_QUANTITY || qty > MAX_QUANTITY) {
      errors.quantity = `Số lượng phải là số nguyên từ ${MIN_QUANTITY} đến ${MAX_QUANTITY.toLocaleString('vi-VN')}.`
    }

    const dosage = item.dosage.trim()
    if (!dosage) {
      errors.dosage = 'Liều dùng không được để trống.'
    } else if (dosage.length > MAX_DOSAGE_LENGTH) {
      errors.dosage = `Liều dùng tối đa ${MAX_DOSAGE_LENGTH} ký tự.`
    }

    const frequency = item.frequency.trim()
    if (!frequency) {
      errors.frequency = 'Tần suất không được để trống.'
    } else if (frequency.length > MAX_FREQUENCY_LENGTH) {
      errors.frequency = `Tần suất tối đa ${MAX_FREQUENCY_LENGTH} ký tự.`
    }

    const days = Number(item.durationDays)
    if (
      !Number.isInteger(days) ||
      days < MIN_DURATION_DAYS ||
      days > MAX_DURATION_DAYS
    ) {
      errors.durationDays = `Số ngày phải là số nguyên từ ${MIN_DURATION_DAYS} đến ${MAX_DURATION_DAYS}.`
    }

    const instructions = (item.instructions ?? '').trim()
    if (instructions.length > MAX_INSTRUCTIONS_LENGTH) {
      errors.instructions = `Hướng dẫn tối đa ${MAX_INSTRUCTIONS_LENGTH.toLocaleString('vi-VN')} ký tự.`
    }

    if (Object.keys(errors).length > 0) {
      itemErrors[index] = errors
      hasErrors = true
    }
  })

  return {
    isValid: !hasErrors,
    itemErrors,
  }
}

export function isPrescriptionEqual(
  a: PrescriptionItem[],
  b: PrescriptionItem[],
): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const itemA = cleanItem(a[i])
    const itemB = cleanItem(b[i])
    if (
      itemA.medicationName !== itemB.medicationName ||
      itemA.quantity !== itemB.quantity ||
      itemA.dosage !== itemB.dosage ||
      itemA.frequency !== itemB.frequency ||
      itemA.durationDays !== itemB.durationDays ||
      itemA.instructions !== itemB.instructions
    ) {
      return false
    }
  }
  return true
}

export function prescriptionMessage(error: unknown): string {
  if (error instanceof PrescriptionError) {
    if (error.status === 401)
      return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
    if (error.status === 403)
      return 'Bạn không có quyền xem hoặc chỉnh sửa đơn thuốc này.'
    if (error.status === 404)
      return 'Không tìm thấy hồ sơ hoặc đơn thuốc trong phạm vi được xem.'
    if (error.status === 409)
      return 'Hồ sơ đã thay đổi (xung đột phiên bản). Vui lòng tải lại dữ liệu mới nhất.'
    if (error.status === 400)
      return (
        (error.message !== 'PRESCRIPTION_REQUEST_FAILED' && error.message) ||
        'Thông tin đơn thuốc không hợp lệ. Vui lòng kiểm tra lại.'
      )
    if (error.status === 503)
      return 'Dịch vụ đơn thuốc đang bảo trì hoặc chưa sẵn sàng.'
  }
  return 'Không thể tải hoặc lưu đơn thuốc. Vui lòng thử lại.'
}

export interface PrescriptionGateway {
  mode: 'mock' | 'real' | 'pending'
  get(recordId: string, signal?: AbortSignal): Promise<Prescription | null>
  save(
    recordId: string,
    draft: PrescriptionDraft,
    expectedVersion: number,
    signal?: AbortSignal,
  ): Promise<Prescription>
}
