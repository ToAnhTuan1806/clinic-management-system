import { useRef, useSyncExternalStore, type ReactNode } from 'react'
import { authApi } from './api'
import { AuthContext } from './context'
import { AuthApiError } from './errors'
import {
  beginAuthentication,
  clearSession,
  establishSession,
  getAuthSnapshot,
  subscribeAuth,
  updateSessionUser,
} from './session-store'
import type { LoginInput } from './types'

export function AuthProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(subscribeAuth, getAuthSnapshot)
  const pending = useRef<AbortController | null>(null)
  async function login(input: LoginInput, signal?: AbortSignal) {
    if (pending.current) return
    const controller = new AbortController()
    pending.current = controller
    const version = beginAuthentication()
    const requestSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal
    try {
      const token = await authApi.login(input, requestSignal)
      const user = await authApi.me(token, requestSignal)
      if (requestSignal.aborted || !establishSession(version, token, user))
        throw new AuthApiError('Yêu cầu đã được hủy.', 0, 'REQUEST_CANCELLED')
    } catch (error) {
      clearSession(null, version)
      throw error
    } finally {
      if (pending.current === controller) pending.current = null
    }
  }
  function logout() {
    pending.current?.abort()
    pending.current = null
    clearSession()
  }
  async function refreshUser() {
    const current = getAuthSnapshot()
    if (current.status !== 'authenticated') return
    const user = await authApi.me()
    updateSessionUser(user, current.version)
  }
  return (
    <AuthContext.Provider value={{ ...snapshot, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}
