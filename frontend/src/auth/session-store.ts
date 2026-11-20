import type { AuthUser } from './types'

export interface AuthSnapshot {
  status: 'anonymous' | 'authenticating' | 'authenticated'
  accessToken: string | null
  user: AuthUser | null
  notice: 'expired' | 'forbidden' | null
  version: number
}

const listeners = new Set<() => void>()
let snapshot: AuthSnapshot = {
  status: 'anonymous',
  accessToken: null,
  user: null,
  notice: null,
  version: 0,
}
export const getAuthSnapshot = () => snapshot
export function subscribeAuth(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
function publish(next: AuthSnapshot) {
  snapshot = next
  listeners.forEach((listener) => listener())
}

export function beginAuthentication() {
  const version = snapshot.version + 1
  publish({
    status: 'authenticating',
    accessToken: null,
    user: null,
    notice: null,
    version,
  })
  return version
}
export function establishSession(
  version: number,
  accessToken: string,
  user: AuthUser,
) {
  if (version !== snapshot.version || snapshot.status !== 'authenticating')
    return false
  publish({ status: 'authenticated', accessToken, user, notice: null, version })
  return true
}
export function clearSession(
  notice: AuthSnapshot['notice'] = null,
  expectedVersion?: number,
) {
  if (expectedVersion !== undefined && expectedVersion !== snapshot.version)
    return
  publish({
    status: 'anonymous',
    accessToken: null,
    user: null,
    notice,
    version: snapshot.version + 1,
  })
}
export function updateSessionUser(user: AuthUser, version: number) {
  if (snapshot.version === version && snapshot.status === 'authenticated')
    publish({ ...snapshot, user })
}
export function markForbidden(version: number) {
  if (snapshot.version === version && snapshot.status === 'authenticated')
    publish({ ...snapshot, notice: 'forbidden' })
}
export function dismissAuthNotice() {
  publish({ ...snapshot, notice: null })
}
