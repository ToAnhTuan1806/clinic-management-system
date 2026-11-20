export const isAuthMock =
  import.meta.env.DEV && import.meta.env.VITE_AUTH_MOCK === 'true'

// The latest dev contract only defines D01; auth DTOs remain PROPOSED.
// Replace null only after reviewing the merged D02 contract. Never infer wire DTOs.
import type { AuthContract } from './types'
export const backendAuthContract: AuthContract | null = null
