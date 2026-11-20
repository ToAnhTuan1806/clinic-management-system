import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from './context'
import type { Role } from './types'
import { canAccessPath, roleHome } from '@/lib/navigation'
import { LoadingState } from '@/components/page-states'

export function ProtectedRoute() {
  const auth = useAuth()
  const location = useLocation()
  if (auth.status === 'authenticating')
    return (
      <main id="main-content" tabIndex={-1} className="p-6">
        <LoadingState />
      </main>
    )
  if (auth.status !== 'authenticated')
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}
export function RoleGuard({ allowed }: { allowed: readonly Role[] }) {
  const { user } = useAuth()
  if (!user || !allowed.includes(user.role))
    return <Navigate to="/forbidden" replace />
  return <Outlet />
}
export function PublicAuthRoute() {
  const { user, status } = useAuth()
  const { state } = useLocation()
  if (status === 'authenticated' && user) {
    const from: unknown = state && typeof state === 'object' ? state.from : null
    const destination =
      typeof from === 'string' && canAccessPath(user.role, from)
        ? from
        : roleHome(user.role)
    return <Navigate to={destination} replace />
  }
  return <Outlet />
}
export function HomeRedirect() {
  const { user } = useAuth()
  return <Navigate to={user ? roleHome(user.role) : '/login'} replace />
}
