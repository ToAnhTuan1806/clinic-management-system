import { getAuthSnapshot } from '@/auth/session-store'
import {
  ProfileError,
  validateProfile,
  type ProfileDraft,
  type ProfileGateway,
  type UserProfile,
} from '@/profile/model'

export function createProfileMock(
  customProfiles: Record<string, Partial<UserProfile>> = {},
): ProfileGateway {
  const store: Record<string, UserProfile> = {}

  const getActor = () => {
    const session = getAuthSnapshot()
    if (!session.user || session.status !== 'authenticated') {
      throw new ProfileError('AUTHENTICATION_REQUIRED', 401)
    }
    return session.user
  }

  return {
    mode: 'mock',

    async getProfile(signal: AbortSignal): Promise<UserProfile> {
      signal.throwIfAborted()
      const user = getActor()
      if (!store[user.id]) {
        store[user.id] = {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          status: 'ACTIVE',
          phone: customProfiles[user.id]?.phone ?? '0912345678',
          address:
            customProfiles[user.id]?.address ??
            '123 Đường Giải Phóng, Hai Bà Trưng, Hà Nội',
        }
      }
      return { ...store[user.id] }
    },

    async updateProfile(
      draft: ProfileDraft,
      signal: AbortSignal,
    ): Promise<UserProfile> {
      signal.throwIfAborted()
      const user = getActor()
      const errors = validateProfile(draft)
      if (Object.keys(errors).length > 0) {
        throw new ProfileError('VALIDATION_FAILED', 400, errors)
      }

      const existing = await this.getProfile(signal)
      const updated: UserProfile = {
        ...existing,
        fullName: draft.fullName.trim(),
        phone: draft.phone.trim(),
        address: draft.address.trim(),
      }
      store[user.id] = updated
      return { ...updated }
    },
  }
}
