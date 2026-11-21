export const isAuthMock =
  import.meta.env.DEV && import.meta.env.VITE_AUTH_MOCK === 'true'

export { backendAuthContract } from './backend-contract'
