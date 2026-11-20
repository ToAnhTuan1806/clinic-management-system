import { DirectoryError, type DirectoryGateway } from './model'

// D02 contract has no implemented D03 API. Do not guess URLs or send draft DTOs.
// Future real adapter must use apiClient/D02 interceptors and verified wire decoders.
const unavailable = async (): Promise<never> => {
  throw new DirectoryError('D03_CONTRACT_PENDING')
}
export const pendingDirectoryGateway: DirectoryGateway = {
  mode: 'pending',
  listSpecialties: unavailable,
  listDoctors: unavailable,
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
  : pendingDirectoryGateway
