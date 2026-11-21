import { ProfileError, type ProfileGateway } from './model'
import { apiClient } from '@/lib/api-client'
import { createProfileApi } from './api'

const unavailable = async (): Promise<never> => {
  throw new ProfileError('API_NOT_CONFIGURED')
}

export const pendingProfileGateway: ProfileGateway = {
  mode: 'pending',
  getProfile: unavailable,
  updateProfile: unavailable,
}

export const isProfileMock =
  import.meta.env.DEV && import.meta.env.VITE_PROFILE_MOCK === 'true'

export const profileGateway: ProfileGateway = isProfileMock
  ? (await import('@/testing/profile-mock')).createProfileMock()
  : apiClient.defaults.baseURL
    ? createProfileApi(apiClient)
    : pendingProfileGateway
