import { createContext, useContext } from 'react'
import type { AuthSnapshot } from './session-store'
import type { LoginInput } from './types'

export interface AuthContextValue extends AuthSnapshot {
  login: (input: LoginInput, signal?: AbortSignal) => Promise<void>
  loginWithGoogle: (idToken: string, signal?: AbortSignal) => Promise<void>
  logout: () => void
  refreshUser: () => Promise<void>
}
export const AuthContext = createContext<AuthContextValue | null>(null)
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('AuthProvider is required')
  return context
}
