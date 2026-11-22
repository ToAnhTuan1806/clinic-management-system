import { describe, expect, it, vi } from 'vitest'
import type { AxiosInstance } from 'axios'
import { createPrescriptionApi } from '@/prescription/api'
import type { PrescriptionDraft } from '@/prescription/model'
import { AuthApiError } from '@/auth/errors'
import { clearSession } from '@/auth/session-store'

const signal = () => new AbortController().signal

function createAxiosError(
  status: number,
  message = 'Request failed',
  code?: string,
) {
  const error = new Error(message) as any
  error.isAxiosError = true
  error.response = { status, data: { status, message, code } }
  return error
}

describe('D12 Prescription Real API Contract', () => {
  function setup() {
    const client = {
      get: vi.fn(),
      put: vi.fn(),
    }
    const api = createPrescriptionApi(client as unknown as AxiosInstance)
    return { client, api }
  }

  const validDraft: PrescriptionDraft = {
    items: [
      {
        medicationName: 'Amoxicillin 500mg',
        quantity: 21,
        dosage: '1 viên',
        frequency: '3 lần/ngày sau khi ăn',
        durationDays: 7,
        instructions: 'Uống đủ liều 7 ngày',
      },
    ],
  }

  const mockPrescriptionResponse = {
    id: '501',
    medicalRecordId: '45',
    recordVersion: 2,
    editable: true,
    simulation: true,
    items: [
      {
        id: '1',
        medicationName: 'Amoxicillin 500mg',
        quantity: 21,
        dosage: '1 viên',
        frequency: '3 lần/ngày sau khi ăn',
        durationDays: 7,
        instructions: 'Uống đủ liều 7 ngày',
      },
    ],
  }

  describe('GET /api/v1/medical-records/{id}/prescription', () => {
    it('fetches and decodes prescription data', async () => {
      const { api, client } = setup()
      client.get.mockResolvedValueOnce({
        data: { data: mockPrescriptionResponse },
      })

      const result = await api.get('45', signal())
      expect(result).toEqual(mockPrescriptionResponse)
      expect(client.get).toHaveBeenCalledWith(
        '/api/v1/medical-records/45/prescription',
        { signal: expect.any(Object) },
      )
    })

    it('propagates 404; an empty prescription is a successful data response', async () => {
      const { api, client } = setup()
      client.get.mockRejectedValueOnce(createAxiosError(404, 'Not Found'))

      await expect(api.get('45', signal())).rejects.toMatchObject({
        status: 404,
      })
    })

    it('propagates 401, 403, 500 as PrescriptionError', async () => {
      const { api, client } = setup()

      client.get.mockRejectedValueOnce(createAxiosError(401, 'Unauthorized'))
      await expect(api.get('45', signal())).rejects.toMatchObject({
        status: 401,
      })

      client.get.mockRejectedValueOnce(createAxiosError(403, 'Forbidden'))
      await expect(api.get('45', signal())).rejects.toMatchObject({
        status: 403,
      })

      client.get.mockRejectedValueOnce(
        createAxiosError(500, 'Internal Server Error'),
      )
      await expect(api.get('45', signal())).rejects.toMatchObject({
        status: 500,
      })
    })

    it('returns null if recordId is empty string', async () => {
      const { api, client } = setup()
      const result = await api.get('', signal())
      expect(result).toBeNull()
      expect(client.get).not.toHaveBeenCalled()
    })
  })

  describe('PUT /api/v1/medical-records/{id}/prescription', () => {
    it('sends cleaned payload with expectedVersion and decodes response', async () => {
      const { api, client } = setup()
      client.put.mockResolvedValueOnce({
        data: {
          data: {
            ...mockPrescriptionResponse,
            recordVersion: 3,
          },
        },
      })

      const result = await api.save('45', validDraft, 2, signal())
      expect(result.recordVersion).toBe(3)
      expect(client.put).toHaveBeenCalledWith(
        '/api/v1/medical-records/45/prescription',
        {
          expectedVersion: 2,
          items: [
            {
              medicationName: 'Amoxicillin 500mg',
              quantity: 21,
              dosage: '1 viên',
              frequency: '3 lần/ngày sau khi ăn',
              durationDays: 7,
              instructions: 'Uống đủ liều 7 ngày',
            },
          ],
        },
        { signal: expect.any(Object) },
      )
    })

    it('validates expectedVersion before making API request', async () => {
      const { api, client } = setup()

      await expect(
        api.save('45', validDraft, -1, signal()),
      ).rejects.toMatchObject({
        status: 400,
      })
      await expect(
        api.save('45', validDraft, 2.5, signal()),
      ).rejects.toMatchObject({
        status: 400,
      })
      expect(client.put).not.toHaveBeenCalled()
    })

    it('validates items before making API request', async () => {
      const { api, client } = setup()

      const invalidDraft = {
        items: [
          {
            medicationName: '', // empty name
            quantity: 1,
            dosage: '1 viên',
            frequency: '1 lần',
            durationDays: 1,
            instructions: '',
          },
        ],
      }

      await expect(
        api.save('45', invalidDraft, 1, signal()),
      ).rejects.toMatchObject({
        status: 400,
      })
      expect(client.put).not.toHaveBeenCalled()
    })

    it('maps 409 VERSION_CONFLICT error accurately', async () => {
      const { api, client } = setup()
      client.put.mockRejectedValueOnce(
        createAxiosError(409, 'Version conflict', 'VERSION_CONFLICT'),
      )

      await expect(
        api.save('45', validDraft, 1, signal()),
      ).rejects.toMatchObject({
        status: 409,
        code: 'VERSION_CONFLICT',
      })
    })

    it('maps 403 forbidden error when record is completed and read-only', async () => {
      const { api, client } = setup()
      client.put.mockRejectedValueOnce(
        createAxiosError(403, 'Medical record is completed'),
      )

      await expect(
        api.save('45', validDraft, 1, signal()),
      ).rejects.toMatchObject({
        status: 403,
      })
    })
  })

  describe('Signal cancellation', () => {
    it('retains interceptor status/code and never echoes raw server detail', async () => {
      const { api, client } = setup()
      client.get.mockRejectedValueOnce(
        new AuthApiError('safe', 409, 'VERSION_CONFLICT'),
      )
      await expect(api.get('45')).rejects.toMatchObject({
        status: 409,
        code: 'VERSION_CONFLICT',
      })
      client.get.mockRejectedValueOnce(
        createAxiosError(404, 'synthetic private detail'),
      )
      await expect(api.get('45')).rejects.toMatchObject({
        status: 404,
        message: 'PRESCRIPTION_REQUEST_FAILED',
      })
    })
    it('rejects missing, malformed and cross-record successful bodies', async () => {
      const { api, client } = setup()
      for (const data of [
        undefined,
        { ...mockPrescriptionResponse, items: null },
        { ...mockPrescriptionResponse, medicalRecordId: '46' },
        { ...mockPrescriptionResponse, recordVersion: 1.5 },
      ]) {
        client.get.mockResolvedValueOnce({ data: { data } })
        await expect(api.get('45')).rejects.toMatchObject({ status: 500 })
      }
    })
    it('accepts official empty DTO with null id and rejects stale session responses', async () => {
      const { api, client } = setup()
      client.get.mockResolvedValueOnce({
        data: { data: { ...mockPrescriptionResponse, id: null, items: [] } },
      })
      expect((await api.get('45'))?.items).toEqual([])
      const pending = Promise.withResolvers<any>()
      client.get.mockReturnValueOnce(pending.promise)
      const response = api.get('45')
      clearSession()
      pending.resolve({ data: { data: mockPrescriptionResponse } })
      await expect(response).rejects.toMatchObject({ status: 0 })
    })
    it('never sends response-only item IDs when saving an existing prescription', async () => {
      const { api, client } = setup()
      client.put.mockResolvedValueOnce({
        data: { data: { ...mockPrescriptionResponse, recordVersion: 3 } },
      })
      await api.save(
        '45',
        { items: [{ ...validDraft.items[0], id: '123' }] },
        2,
      )
      expect(client.put.mock.calls[0][1].items[0]).not.toHaveProperty('id')
    })
    it('propagates DOMException when signal is aborted', async () => {
      const { api } = setup()
      const controller = new AbortController()
      controller.abort()

      await expect(api.get('45', controller.signal)).rejects.toBeInstanceOf(
        DOMException,
      )
      await expect(
        api.save('45', validDraft, 1, controller.signal),
      ).rejects.toBeInstanceOf(DOMException)
    })
  })
})
