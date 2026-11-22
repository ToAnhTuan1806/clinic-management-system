import { isAuthMock } from '@/auth/config'
import { apiClient } from '@/lib/api-client'
import { createPrescriptionApi } from './api'
import type { PrescriptionGateway } from './model'

export const isPrescriptionMock =
  import.meta.env.DEV &&
  isAuthMock &&
  import.meta.env.VITE_PRESCRIPTION_MOCK !== 'false'

export const prescriptionGateway: PrescriptionGateway = isPrescriptionMock
  ? (await import('@/testing/prescription-mock')).createPrescriptionMock()
  : createPrescriptionApi(apiClient)
