import { DirectoryError, type DirectoryGateway } from './model'
import { apiClient } from '@/lib/api-client'
import { createDirectoryApi } from './api'

// Only an unconfigured API origin is pending. A failed real request never falls back to mock.
const unavailable = async (): Promise<never> => {
  throw new DirectoryError('API_NOT_CONFIGURED')
}
export const pendingDirectoryGateway: DirectoryGateway = {
  mode: 'pending',
  listSpecialties: unavailable,
  listDoctors: unavailable,
  getDoctor: unavailable,
  getSpecialty: unavailable,
  specialtyOptions: unavailable,
  doctorUsers: unavailable,
  saveSpecialty: unavailable,
  saveDoctor: unavailable,
  setActive: unavailable,
}
export const isDirectoryMock =
  import.meta.env.DEV && import.meta.env.VITE_DIRECTORY_MOCK === 'true'
export const directoryGateway: DirectoryGateway = isDirectoryMock
  ? (await import('@/testing/directory-mock')).createDirectoryMock()
  : apiClient.defaults.baseURL
    ? createDirectoryApi(apiClient)
    : pendingDirectoryGateway
