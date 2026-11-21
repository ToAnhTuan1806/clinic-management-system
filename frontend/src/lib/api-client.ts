import axios from 'axios'
import { isAuthMock } from '@/auth/config'
import { installAuthInterceptors } from '@/auth/http'

const baseURL = isAuthMock
  ? window.location.origin
  : import.meta.env.VITE_API_BASE_URL
export const apiClient = axios.create({
  baseURL: baseURL || undefined,
  timeout: 15_000,
  headers: { Accept: 'application/json' },
})

installAuthInterceptors(apiClient, () => Boolean(baseURL))
