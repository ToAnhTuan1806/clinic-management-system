import { PatientError, type PatientGateway } from './model'
import { apiClient } from '@/lib/api-client'
import { createPatientApi } from './api'

// Only an unconfigured API origin is pending. A failed real request never falls back to mock.
const unavailable = async (): Promise<never> => {
  throw new PatientError('API_NOT_CONFIGURED')
}

export const pendingPatientGateway: PatientGateway = {
  mode: 'pending',
  listPatients: unavailable,
  getPatient: unavailable,
  getMePatientProfile: unavailable,
  savePatient: unavailable,
  setActive: unavailable,
}

export const isPatientMock =
  import.meta.env.DEV && import.meta.env.VITE_PATIENT_MOCK === 'true'

export const patientGateway: PatientGateway = isPatientMock
  ? (await import('@/testing/patient-mock')).createPatientMock()
  : apiClient.defaults.baseURL
    ? createPatientApi(apiClient)
    : pendingPatientGateway
