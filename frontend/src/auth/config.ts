export const isAuthMock =
  import.meta.env.DEV && import.meta.env.VITE_AUTH_MOCK === 'true'

export const googleClientId = (
  import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
).trim()

export const isGoogleAuthEnabled = !isAuthMock && googleClientId.length > 0

export { backendAuthContract } from './backend-contract'
