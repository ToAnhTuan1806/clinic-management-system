import { describe, expect, it, vi } from 'vitest'
import type { AxiosInstance } from 'axios'
import { AuthApiError } from '@/auth/errors'
import { createExaminationApi, examinationProblem } from '@/examination/api'

describe('D10 approved examination DTO (mock transport)', () => {
  const signal = new AbortController().signal
  const fields = {
    symptoms: 'Synthetic symptom',
    diagnosis: 'Synthetic diagnosis',
    notes: '',
    conclusion: '',
  }
  const record = {
    id: '45',
    appointmentId: '12',
    status: 'IN_PROGRESS' as const,
    version: 2,
    ...fields,
  }
  const response = (data: unknown) => ({ data: { data } })
  function setup() {
    const client = { get: vi.fn(), post: vi.fn(), patch: vi.fn() }
    return {
      client,
      api: createExaminationApi(client as unknown as AxiosInstance),
    }
  }

  it('creates with only appointmentId and reads by returned record ID', async () => {
    const { api, client } = setup()
    client.post.mockResolvedValueOnce(response(record))
    client.get.mockResolvedValueOnce(response(record))
    expect(await api.create('12', signal)).toEqual(record)
    expect(await api.read('45', '12', signal)).toEqual(record)
    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/medical-records',
      { appointmentId: '12' },
      { signal },
    )
    expect(client.get).toHaveBeenCalledWith('/api/v1/medical-records/45', {
      signal,
    })
  })

  it('saves and completes using the last server version and whitelisted payloads', async () => {
    const { api, client } = setup()
    client.patch.mockResolvedValueOnce(
      response({ ...record, version: 3, conclusion: 'Synthetic conclusion' }),
    )
    client.post.mockResolvedValueOnce(
      response({
        ...record,
        version: 4,
        status: 'COMPLETED',
        conclusion: 'Synthetic conclusion',
      }),
    )
    const saved = await api.save(
      record,
      { ...fields, conclusion: ' Synthetic conclusion ' },
      signal,
    )
    const final = await api.complete(saved, signal)
    expect(final.status).toBe('COMPLETED')
    expect(client.patch).toHaveBeenCalledWith(
      '/api/v1/medical-records/45',
      { ...fields, conclusion: 'Synthetic conclusion', expectedVersion: 2 },
      { signal },
    )
    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/medical-records/45/completion',
      { expectedVersion: 3 },
      { signal },
    )
    await expect(api.save(final, fields, signal)).rejects.toThrow(
      'EXAMINATION_READ_ONLY',
    )
    await expect(api.complete(final, signal)).rejects.toThrow(
      'EXAMINATION_READ_ONLY',
    )
    expect(client.patch).toHaveBeenCalledTimes(1)
    expect(client.post).toHaveBeenCalledTimes(1)
  })

  it('rejects unrelated record identity, missing versions, and stale success responses', async () => {
    const { api, client } = setup()
    client.get.mockResolvedValueOnce(
      response({ ...record, appointmentId: '13' }),
    )
    client.get.mockResolvedValueOnce(
      response({ ...record, version: undefined }),
    )
    client.patch.mockResolvedValueOnce(response(record))
    await expect(api.read('45', '12', signal)).rejects.toThrow(
      'INVALID_EXAMINATION_RESPONSE',
    )
    await expect(api.read('45', '12', signal)).rejects.toThrow(
      'INVALID_EXAMINATION_RESPONSE',
    )
    await expect(api.save(record, fields, signal)).rejects.toThrow(
      'INVALID_EXAMINATION_RESPONSE',
    )
    await expect(
      api.complete({ ...record, diagnosis: ' ' }, signal),
    ).rejects.toThrow('INVALID_EXAMINATION_DRAFT')
    expect(client.post).not.toHaveBeenCalled()
  })

  it('requires conclusion for completion and validates raw UTF-16 length before trimming', async () => {
    const { api, client } = setup()
    await expect(api.complete(record, signal)).rejects.toThrow(
      'INVALID_EXAMINATION_DRAFT',
    )
    await expect(
      api.save(record, { ...fields, notes: ' '.repeat(5001) }, signal),
    ).rejects.toThrow('INVALID_EXAMINATION_DRAFT')
    expect(client.post).not.toHaveBeenCalled()
    expect(client.patch).not.toHaveBeenCalled()
  })

  it('looks up by appointment and rejects a mismatched ownership response', async () => {
    const { api, client } = setup()
    client.get.mockResolvedValueOnce(response(record))
    expect(await api.byAppointment('12', signal)).toEqual(record)
    expect(client.get).toHaveBeenCalledWith(
      '/api/v1/medical-records/by-appointment/12',
      { signal },
    )
    client.get.mockResolvedValueOnce(
      response({ ...record, appointmentId: '13' }),
    )
    await expect(api.byAppointment('12', signal)).rejects.toThrow(
      'INVALID_EXAMINATION_RESPONSE',
    )
  })

  it('preserves lookup 404 for the UI to reconcile against appointment state', async () => {
    const { api, client } = setup()
    const error = new AuthApiError('missing', 404, 'RESOURCE_NOT_FOUND')
    client.get.mockRejectedValueOnce(error)
    await expect(api.byAppointment('12', signal)).rejects.toBe(error)
    expect(client.post).not.toHaveBeenCalled()
  })

  it.each([
    [401, 'UNAUTHORIZED', 'Phiên đăng nhập'],
    [403, 'ACCESS_DENIED', 'không có quyền'],
    [404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy'],
    [409, 'DUPLICATE_RECORD', 'Không thể tiếp tục'],
    [409, 'VERSION_CONFLICT', 'Tải lại bản mới'],
  ])(
    'propagates %s (%s) without a synthesized record',
    async (status, code, message) => {
      const { api, client } = setup()
      const error = new AuthApiError('private error detail', status, code)
      client.get.mockRejectedValueOnce(error)
      await expect(api.read('45', '12', signal)).rejects.toBe(error)
      expect(examinationProblem(error)).toContain(message)
      expect(examinationProblem(error)).not.toContain('private')
    },
  )
})
