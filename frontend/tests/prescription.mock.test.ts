import { afterEach, describe, expect, it } from 'vitest'
import {
  beginAuthentication,
  clearSession,
  establishSession,
} from '@/auth/session-store'
import type { Role } from '@/auth/types'
import {
  cleanItem,
  isPrescriptionEqual,
  MAX_PRESCRIPTION_ITEMS,
  PRESCRIPTION_SIMULATION_NOTICE,
  prescriptionMessage,
  validatePrescription,
  type PrescriptionItem,
} from '@/prescription/model'
import { createPrescriptionMock } from '@/testing/prescription-mock'

const signal = () => new AbortController().signal

function login(role: Role) {
  establishSession(beginAuthentication(), 'mock-token', {
    id: '50',
    fullName: 'Test Doctor',
    email: 'doctor@clinic.test',
    role,
  })
}

describe('D12 Prescription Mock & Domain Validation', () => {
  afterEach(() => {
    clearSession()
  })

  describe('Prescription validation logic', () => {
    const validItem: PrescriptionItem = {
      medicationName: 'Paracetamol 500mg',
      quantity: 10,
      dosage: '500mg (1 viên)',
      frequency: '2 lần/ngày',
      durationDays: 5,
      instructions: 'Uống sau ăn',
    }

    it('validates a correct prescription item', () => {
      const result = validatePrescription([validItem])
      expect(result.isValid).toBe(true)
      expect(Object.keys(result.itemErrors)).toHaveLength(0)
    })

    it('rejects empty medication name and name exceeding 200 chars', () => {
      const emptyName = validatePrescription([
        { ...validItem, medicationName: '   ' },
      ])
      expect(emptyName.isValid).toBe(false)
      expect(emptyName.itemErrors[0]?.medicationName).toContain(
        'không được để trống',
      )

      const longName = validatePrescription([
        { ...validItem, medicationName: 'A'.repeat(201) },
      ])
      expect(longName.isValid).toBe(false)
      expect(longName.itemErrors[0]?.medicationName).toContain(
        'tối đa 200 ký tự',
      )
    })

    it('enforces quantity bounds (1 to 10,000 integer)', () => {
      const zeroQty = validatePrescription([{ ...validItem, quantity: 0 }])
      expect(zeroQty.isValid).toBe(false)
      expect(zeroQty.itemErrors[0]?.quantity).toContain('từ 1 đến 10.000')

      const excessQty = validatePrescription([
        { ...validItem, quantity: 10001 },
      ])
      expect(excessQty.isValid).toBe(false)

      const floatQty = validatePrescription([{ ...validItem, quantity: 2.5 }])
      expect(floatQty.isValid).toBe(false)

      const maxQty = validatePrescription([{ ...validItem, quantity: 10000 }])
      expect(maxQty.isValid).toBe(true)
    })

    it('enforces dosage and frequency requirements (1 to 100 chars)', () => {
      const emptyDosage = validatePrescription([{ ...validItem, dosage: '' }])
      expect(emptyDosage.isValid).toBe(false)
      expect(emptyDosage.itemErrors[0]?.dosage).toContain('không được để trống')

      const longDosage = validatePrescription([
        { ...validItem, dosage: 'X'.repeat(101) },
      ])
      expect(longDosage.isValid).toBe(false)

      const emptyFreq = validatePrescription([{ ...validItem, frequency: '' }])
      expect(emptyFreq.isValid).toBe(false)
      expect(emptyFreq.itemErrors[0]?.frequency).toContain(
        'không được để trống',
      )

      const longFreq = validatePrescription([
        { ...validItem, frequency: 'F'.repeat(101) },
      ])
      expect(longFreq.isValid).toBe(false)
    })

    it('enforces duration bounds (1 to 365 integer days)', () => {
      const zeroDays = validatePrescription([{ ...validItem, durationDays: 0 }])
      expect(zeroDays.isValid).toBe(false)
      expect(zeroDays.itemErrors[0]?.durationDays).toContain('từ 1 đến 365')

      const excessDays = validatePrescription([
        { ...validItem, durationDays: 366 },
      ])
      expect(excessDays.isValid).toBe(false)

      const maxDays = validatePrescription([
        { ...validItem, durationDays: 365 },
      ])
      expect(maxDays.isValid).toBe(true)
    })

    it('enforces instructions length (max 1000 chars)', () => {
      const longInst = validatePrescription([
        { ...validItem, instructions: 'I'.repeat(1001) },
      ])
      expect(longInst.isValid).toBe(false)
      expect(longInst.itemErrors[0]?.instructions).toContain('tối đa 1.000')

      const validInst = validatePrescription([
        { ...validItem, instructions: 'I'.repeat(1000) },
      ])
      expect(validInst.isValid).toBe(true)
    })

    it('enforces maximum 50 items per prescription', () => {
      const items = Array.from({ length: 51 }, () => ({ ...validItem }))
      const result = validatePrescription(items)
      expect(result.isValid).toBe(false)
      expect(result.generalError).toContain(`tối đa ${MAX_PRESCRIPTION_ITEMS}`)
    })

    it('compares prescription equality ignoring extra whitespace', () => {
      const a = [{ ...validItem, medicationName: ' Paracetamol 500mg ' }]
      const b = [{ ...validItem, medicationName: 'Paracetamol 500mg' }]
      expect(isPrescriptionEqual(a, b)).toBe(true)

      const c = [{ ...validItem, quantity: 20 }]
      expect(isPrescriptionEqual(a, c)).toBe(false)
    })

    it('cleans item properties appropriately', () => {
      const cleaned = cleanItem({
        id: '99',
        medicationName: '  Amoxicillin 500mg  ',
        quantity: 12,
        dosage: '  1 viên  ',
        frequency: '  3 lần/ngày  ',
        durationDays: 7,
        instructions: '  Sau ăn  ',
      })
      expect(cleaned.medicationName).toBe('Amoxicillin 500mg')
      expect(cleaned.dosage).toBe('1 viên')
      expect(cleaned.frequency).toBe('3 lần/ngày')
      expect(cleaned.instructions).toBe('Sau ăn')
    })

    it('includes simulation notice in constant', () => {
      expect(PRESCRIPTION_SIMULATION_NOTICE).toContain('Đơn thuốc mô phỏng')
      expect(PRESCRIPTION_SIMULATION_NOTICE).toContain(
        'không có giá trị kê đơn',
      )
    })
  })

  describe('createPrescriptionMock gateway behaviors', () => {
    it('DOCTOR can read and update prescription with expectedVersion', async () => {
      login('DOCTOR')
      const mock = createPrescriptionMock()

      const initial = await mock.get('3', signal())
      expect(initial?.editable).toBe(true)
      expect(initial?.recordVersion).toBe(0)

      const draft = {
        items: [
          {
            medicationName: 'Augmentin 1g',
            quantity: 14,
            dosage: '1 viên',
            frequency: '2 lần/ngày',
            durationDays: 7,
            instructions: 'Uống sau bữa ăn sáng và tối',
          },
        ],
      }

      const saved = await mock.save('3', draft, 0, signal())
      expect(saved.recordVersion).toBe(1)
      expect(saved.items).toHaveLength(1)
      expect(saved.items[0].medicationName).toBe('Augmentin 1g')

      // Verify persistence on subsequent get
      const reloaded = await mock.get('3', signal())
      expect(reloaded?.recordVersion).toBe(1)
      expect(reloaded?.items).toHaveLength(1)
    })

    it('rejects version mismatch with 409 conflict', async () => {
      login('DOCTOR')
      const mock = createPrescriptionMock()

      const draft = {
        items: [
          {
            medicationName: 'Thuốc A',
            quantity: 1,
            dosage: '1 viên',
            frequency: '1 lần',
            durationDays: 1,
            instructions: '',
          },
        ],
      }

      // Record '3' version is currently 0, expecting 5 should throw 409
      await expect(mock.save('3', draft, 5, signal())).rejects.toMatchObject({
        status: 409,
        code: 'VERSION_CONFLICT',
      })
    })

    it('enforces read-only policy for COMPLETED records', async () => {
      login('DOCTOR')
      const mock = createPrescriptionMock()

      // Record '1' is pre-seeded as completed
      const prescription = await mock.get('1', signal())
      expect(prescription?.editable).toBe(false)

      const draft = { items: [] }
      await expect(mock.save('1', draft, 1, signal())).rejects.toMatchObject({
        status: 403,
      })
    })

    it('PATIENT can view completed & released prescription', async () => {
      login('PATIENT')
      const mock = createPrescriptionMock()

      // Record '1' is completed & released
      const prescription = await mock.get('1', signal())
      expect(prescription).not.toBeNull()
      expect(prescription?.items.length).toBeGreaterThan(0)
    })

    it('PATIENT cannot view unreleased prescription (404)', async () => {
      login('PATIENT')
      const mock = createPrescriptionMock()

      // Record '2' is completed but unreleased
      await expect(mock.get('2', signal())).rejects.toMatchObject({
        status: 404,
      })
    })

    it('PATIENT cannot edit or save prescription (403)', async () => {
      login('PATIENT')
      const mock = createPrescriptionMock()

      await expect(
        mock.save('1', { items: [] }, 1, signal()),
      ).rejects.toMatchObject({
        status: 403,
      })
    })

    it.each(['ADMIN', 'RECEPTIONIST'] as const)(
      'denies clinical prescription access to %s with 403',
      async (role) => {
        login(role)
        const mock = createPrescriptionMock()

        await expect(mock.get('1', signal())).rejects.toMatchObject({
          status: 403,
        })
        await expect(
          mock.save('3', { items: [] }, 0, signal()),
        ).rejects.toMatchObject({
          status: 403,
        })
      },
    )

    it('rejects unauthenticated requests with 401', async () => {
      clearSession()
      const mock = createPrescriptionMock()

      await expect(mock.get('1', signal())).rejects.toMatchObject({
        status: 401,
      })
      await expect(
        mock.save('3', { items: [] }, 0, signal()),
      ).rejects.toMatchObject({
        status: 401,
      })
    })

    it('propagates cancellation via DOMException', async () => {
      login('DOCTOR')
      const mock = createPrescriptionMock()
      const controller = new AbortController()
      controller.abort()

      await expect(mock.get('1', controller.signal)).rejects.toBeInstanceOf(
        DOMException,
      )
      await expect(
        mock.save('3', { items: [] }, 0, controller.signal),
      ).rejects.toBeInstanceOf(DOMException)
    })

    it.each([400, 401, 403, 404, 409, 503, 0])(
      'returns safe user-facing message for status %s',
      (status) => {
        const error = { status } as any
        const message = prescriptionMessage(error)
        expect(message).toBeTruthy()
      },
    )
  })
})
