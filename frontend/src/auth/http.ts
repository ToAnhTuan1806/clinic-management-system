import type { AxiosInstance, AxiosRequestConfig } from 'axios'
import { AuthApiError, normalizeAuthError } from './errors'
import { clearSession, getAuthSnapshot, markForbidden } from './session-store'

declare module 'axios' {
  interface AxiosRequestConfig {
    authMode?: 'public' | 'candidate'
    authSessionVersion?: number
  }
}

export function installAuthInterceptors(
  client: AxiosInstance,
  configured: () => boolean,
) {
  client.interceptors.request.use((config) => {
    if (!configured())
      throw new AuthApiError(
        'Dịch vụ chưa được cấu hình. Vui lòng thử lại sau.',
        0,
        'API_NOT_CONFIGURED',
      )
    const base = new URL(config.baseURL!)
    const target = new URL(client.getUri(config), base)
    if (
      base.origin !== target.origin ||
      !target.pathname.startsWith('/api/v1/')
    )
      throw new AuthApiError(
        'Địa chỉ dịch vụ không hợp lệ.',
        0,
        'INVALID_API_TARGET',
      )
    const current = getAuthSnapshot()
    if (config.authMode === 'public') config.headers.delete('Authorization')
    else if (config.authMode !== 'candidate') {
      if (current.status === 'authenticated' && current.accessToken) {
        config.headers.set('Authorization', `Bearer ${current.accessToken}`)
        config.authSessionVersion = current.version
      } else config.headers.delete('Authorization')
    }
    return config
  })
  client.interceptors.response.use(
    (response) => response,
    (error: unknown) => {
      const normalized = normalizeAuthError(error)
      const config =
        error && typeof error === 'object' && 'config' in error
          ? (error.config as AxiosRequestConfig | undefined)
          : undefined
      if (config?.authSessionVersion !== undefined) {
        if (normalized.status === 401)
          clearSession('expired', config.authSessionVersion)
        if (normalized.status === 403) markForbidden(config.authSessionVersion)
      }
      return Promise.reject(normalized)
    },
  )
}
