import { isAuthMock } from '@/auth/config'
import { apiClient } from '@/lib/api-client'
import { createHistoryApi } from './api'
import type { HistoryGateway } from './model'

export const isHistoryMock =
  import.meta.env.DEV &&
  isAuthMock &&
  import.meta.env.VITE_HISTORY_MOCK === 'true'

export const historyGateway: HistoryGateway = isHistoryMock
  ? (await import('@/testing/history-mock')).createHistoryMock()
  : createHistoryApi(apiClient)
