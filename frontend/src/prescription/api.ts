import type { AxiosInstance } from 'axios'
import { normalizeAuthError } from '@/auth/errors'
import { getAuthSnapshot } from '@/auth/session-store'
import {
  cleanItem,
  PrescriptionError,
  validatePrescription,
  type Prescription,
  type PrescriptionDraft,
  type PrescriptionGateway,
  type PrescriptionItem,
} from './model'

function decodeItem(raw: any): PrescriptionItem {
  return {
    id: raw?.id ? String(raw.id) : undefined,
    medicationName:
      typeof raw?.medicationName === 'string' ? raw.medicationName : '',
    quantity:
      typeof raw?.quantity === 'number'
        ? raw.quantity
        : Number(raw?.quantity) || 1,
    dosage: typeof raw?.dosage === 'string' ? raw.dosage : '',
    frequency: typeof raw?.frequency === 'string' ? raw.frequency : '',
    durationDays:
      typeof raw?.durationDays === 'number'
        ? raw.durationDays
        : Number(raw?.durationDays) || 1,
    instructions: typeof raw?.instructions === 'string' ? raw.instructions : '',
  }
}

function decodePrescription(raw: any): Prescription {
  if (
    !raw ||
    typeof raw !== 'object' ||
    !Array.isArray(raw.items) ||
    !/^\d+$/.test(raw.medicalRecordId) ||
    !Number.isSafeInteger(raw.recordVersion) ||
    raw.recordVersion < 0 ||
    typeof raw.editable !== 'boolean' ||
    raw.simulation !== true ||
    (raw.id !== null && !/^[1-9]\d*$/.test(raw.id)) ||
    (raw.id === null && raw.items.length > 0) ||
    raw.items.some(
      (item: any) =>
        !item ||
        !/^[1-9]\d*$/.test(item.id) ||
        typeof item.medicationName !== 'string' ||
        typeof item.dosage !== 'string' ||
        typeof item.frequency !== 'string' ||
        !Number.isSafeInteger(item.quantity) ||
        !Number.isSafeInteger(item.durationDays) ||
        (item.instructions !== null && typeof item.instructions !== 'string'),
    )
  ) {
    throw new PrescriptionError(
      500,
      'Dữ liệu phản hồi từ máy chủ không hợp lệ.',
    )
  }

  const items = Array.isArray(raw.items) ? raw.items.map(decodeItem) : []

  return {
    id: String(raw.id ?? ''),
    medicalRecordId: String(raw.medicalRecordId ?? ''),
    recordVersion:
      typeof raw.recordVersion === 'number'
        ? raw.recordVersion
        : Number(raw.recordVersion) || 0,
    editable: Boolean(raw.editable),
    simulation: raw.simulation !== undefined ? Boolean(raw.simulation) : true,
    items,
  }
}

function toPrescriptionError(error: unknown, signal?: AbortSignal): never {
  if (signal?.aborted) {
    throw signal.reason || new DOMException('Aborted', 'AbortError')
  }
  if (error instanceof PrescriptionError) {
    throw error
  }
  const normalized = normalizeAuthError(error)
  throw new PrescriptionError(normalized.status, undefined, normalized.code)
}

export function createPrescriptionApi(
  client: AxiosInstance,
): PrescriptionGateway {
  return {
    mode: 'real',

    async get(
      recordId: string,
      signal?: AbortSignal,
    ): Promise<Prescription | null> {
      signal?.throwIfAborted()
      if (!recordId) return null

      try {
        const session = getAuthSnapshot().version
        const response = await client.get(
          `/api/v1/medical-records/${recordId}/prescription`,
          { signal },
        )
        if (session !== getAuthSnapshot().version)
          throw new DOMException('Session changed', 'AbortError')
        const result = decodePrescription(response.data?.data)
        if (result.medicalRecordId !== recordId)
          throw new PrescriptionError(500)
        return result
      } catch (error) {
        toPrescriptionError(error, signal)
      }
    },

    async save(
      recordId: string,
      draft: PrescriptionDraft,
      expectedVersion: number,
      signal?: AbortSignal,
    ): Promise<Prescription> {
      signal?.throwIfAborted()
      if (!recordId) {
        throw new PrescriptionError(400, 'Mã hồ sơ khám không hợp lệ.')
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
          validation.generalError ||
            'Thông tin đơn thuốc không hợp lệ. Vui lòng kiểm tra lại.',
        )
      }

      try {
        const session = getAuthSnapshot().version
        const response = await client.put(
          `/api/v1/medical-records/${recordId}/prescription`,
          {
            expectedVersion,
            items: cleanedItems.map(({ id: _id, ...item }) => item),
          },
          { signal },
        )
        if (session !== getAuthSnapshot().version)
          throw new DOMException('Session changed', 'AbortError')
        const result = decodePrescription(response.data?.data)
        if (
          result.medicalRecordId !== recordId ||
          result.recordVersion !== expectedVersion + 1
        )
          throw new PrescriptionError(500)
        return result
      } catch (error) {
        toPrescriptionError(error, signal)
      }
    },
  }
}
