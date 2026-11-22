import { afterEach, describe, expect, it } from 'vitest'
import {
  beginAuthentication,
  clearSession,
  establishSession,
} from '@/auth/session-store'
import { canRelease, HistoryError, historyMessage } from '@/history/model'
import { createHistoryMock } from '@/testing/history-mock'
import type { Role } from '@/auth/types'

const signal = () => new AbortController().signal
const query = {
  page: 0,
  search: '',
  from: '',
  to: '',
  publication: 'ALL' as const,
}
function login(role: Role) {
  establishSession(beginAuthentication(), 'mock-only', {
    id: '50',
    fullName: 'DEMO',
    email: 'demo@example.test',
    role,
  })
}
afterEach(() => clearSession())
describe('D11 MOCK domain and privacy, provisional UI model', () => {
  it('only returns published records to PATIENT, rejects draft and other patient detail', async () => {
    login('PATIENT')
    const api = createHistoryMock()
    const page = await api.list('1', query, signal())
    expect(page.items.length).toBeGreaterThan(0)
    expect(
      page.items.every(
        (item) => !!item.releasedAt && item.status === 'COMPLETED',
      ),
    ).toBe(true)
    await expect(api.detail('1', '1', signal())).rejects.toMatchObject({
      status: 404,
    })
    await expect(api.list('2', query, signal())).rejects.toMatchObject({
      status: 404,
    })
    await expect(api.release('1', '2', 0, signal())).rejects.toMatchObject({
      status: 403,
    })
  })
  it('publishes once with server version and rejects stale/repeated writes', async () => {
    login('DOCTOR')
    const api = createHistoryMock()
    const detail = await api.detail('1', '1', signal())
    expect(canRelease('DOCTOR', detail.item)).toBe(true)
    await expect(api.release('1', '1', 8, signal())).rejects.toMatchObject({
      status: 409,
    })
    await api.release('1', '1', detail.item.version, signal())
    const updated = await api.detail('1', '1', signal())
    expect(updated.item.releasedAt).toBeTruthy()
    expect(updated.item.version).toBe(1)
    expect(canRelease('DOCTOR', updated.item)).toBe(false)
    await expect(api.release('1', '1', 0, signal())).rejects.toMatchObject({
      status: 409,
    })
    login('PATIENT')
    expect((await api.detail('1', '1', signal())).conclusion).toBeTruthy()
  })
  it('enforces assignment, completed state, pagination and filters', async () => {
    login('DOCTOR')
    const api = createHistoryMock()
    await expect(api.detail('1', '5', signal())).rejects.toMatchObject({
      status: 404,
    })
    expect(
      canRelease('DOCTOR', (await api.detail('1', '3', signal())).item),
    ).toBe(false)
    const first = await api.list('1', query, signal())
    const second = await api.list('1', { ...query, page: 1 }, signal())
    expect(first.items).toHaveLength(5)
    expect(
      first.items.some((item) =>
        second.items.some((other) => item.id === other.id),
      ),
    ).toBe(false)
    expect(
      (await api.list('1', { ...query, search: 'missing' }, signal())).items,
    ).toHaveLength(0)
    expect(
      (
        await api.list(
          '1',
          { ...query, from: '2026-11-20', to: '2026-11-20' },
          signal(),
        )
      ).items,
    ).toHaveLength(1)
  })
  it.each(['ADMIN', 'RECEPTIONIST'] as const)(
    'denies clinical access for %s',
    async (role) => {
      login(role)
      const api = createHistoryMock()
      await expect(api.patients(signal())).rejects.toMatchObject({
        status: 403,
      })
      await expect(api.detail('1', '2', signal())).rejects.toMatchObject({
        status: 403,
      })
      await expect(api.release('1', '1', 0, signal())).rejects.toMatchObject({
        status: 403,
      })
    },
  )
  it('denies anonymous access and propagates cancellation', async () => {
    clearSession()
    const api = createHistoryMock()
    await expect(api.patients(signal())).rejects.toMatchObject({ status: 401 })
    login('DOCTOR')
    const controller = new AbortController()
    controller.abort()
    await expect(
      api.release('1', '1', 0, controller.signal),
    ).rejects.toBeInstanceOf(DOMException)
    expect((await api.detail('1', '1', signal())).item.releasedAt).toBeNull()
  })
  it.each([0, 401, 403, 404, 409, 503])(
    'uses safe error copy for status %s',
    (status) => {
      const error = new HistoryError(status)
      expect(historyMessage(error)).toBeTruthy()
      expect(historyMessage(error)).not.toContain(error.message)
    },
  )
})
