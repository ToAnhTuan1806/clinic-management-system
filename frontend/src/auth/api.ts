import type { AxiosInstance } from 'axios'
import { apiClient } from '@/lib/api-client'
import { backendAuthContract, isAuthMock } from './config'
import { normalizeAuthError } from './errors'
import type { AuthContract, LoginInput, RegisterInput } from './types'

export function createAuthApi(client: AxiosInstance, contract: AuthContract) {
  return {
    async login(input: LoginInput, signal?: AbortSignal) {
      const response = await client.post(
        '/api/v1/auth/login',
        contract.encodeLogin(input),
        { signal, authMode: 'public' },
      )
      return contract.decodeAccessToken(response.data)
    },
    async loginWithGoogle(idToken: string, signal?: AbortSignal) {
      const response = await client.post(
        '/api/v1/auth/google',
        { idToken },
        { signal, authMode: 'public' },
      )
      return contract.decodeAccessToken(response.data)
    },
    async register(input: RegisterInput, signal?: AbortSignal) {
      const response = await client.post(
        '/api/v1/auth/register',
        contract.encodeRegister(input),
        { signal, authMode: 'public' },
      )
      contract.decodeRegistration(response.data)
    },
    async me(candidateToken?: string, signal?: AbortSignal) {
      const response = await client.get('/api/v1/auth/me', {
        signal,
        ...(candidateToken
          ? {
              authMode: 'candidate' as const,
              headers: { Authorization: `Bearer ${candidateToken}` },
            }
          : {}),
      })
      return contract.decodeUser(response.data)
    },
  }
}

async function getApi() {
  if (import.meta.env.DEV && isAuthMock) {
    // Only the opt-in development QA profile uses this provisional test schema.
    const { mockAuthContract } = await import('@/testing/mock-auth-contract')
    return createAuthApi(apiClient, mockAuthContract)
  }
  return createAuthApi(apiClient, backendAuthContract)
}
export const authApi = {
  login: async (input: LoginInput, signal?: AbortSignal) => {
    try {
      return await (await getApi()).login(input, signal)
    } catch (error) {
      throw normalizeAuthError(error)
    }
  },
  loginWithGoogle: async (idToken: string, signal?: AbortSignal) => {
    try {
      return await (await getApi()).loginWithGoogle(idToken, signal)
    } catch (error) {
      throw normalizeAuthError(error)
    }
  },
  register: async (input: RegisterInput, signal?: AbortSignal) => {
    try {
      return await (await getApi()).register(input, signal)
    } catch (error) {
      throw normalizeAuthError(error)
    }
  },
  me: async (candidateToken?: string, signal?: AbortSignal) => {
    try {
      return await (await getApi()).me(candidateToken, signal)
    } catch (error) {
      throw normalizeAuthError(error)
    }
  },
}
