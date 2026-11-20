import { lazy, Suspense, useEffect, useRef } from 'react'
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router'
import { MotionConfig } from 'motion/react'
import { MainLayout } from '@/components/layout/main-layout'
import { ThemeProvider } from '@/components/theme-provider'
import { LoadingState } from '@/components/page-states'
import { navigation } from '@/lib/navigation'

const Dashboard = lazy(() => import('@/pages/dashboard'))
const ModulePlaceholder = lazy(() => import('@/pages/module-placeholder'))
const Settings = lazy(() => import('@/pages/settings'))
const Login = lazy(() => import('@/pages/login'))
const NotFound = lazy(() => import('@/pages/not-found'))

function RouteEffects() {
  const { pathname } = useLocation()
  const previous = useRef(pathname)
  useEffect(() => {
    const label =
      pathname === '/login'
        ? 'Đăng nhập'
        : (navigation.find((item) => item.path === pathname)?.label ??
          'Không tìm thấy')
    document.title = `${label} · ClinicOS DEMO`
    if (previous.current !== pathname) {
      document.getElementById('main-content')?.focus({ preventScroll: true })
      window.scrollTo({ top: 0, behavior: 'instant' })
      previous.current = pathname
    }
  }, [pathname])
  return null
}

export default function App() {
  return (
    <ThemeProvider>
      <MotionConfig reducedMotion="user">
        <BrowserRouter>
          <RouteEffects />
          <a href="#main-content" className="skip-link">
            Đến nội dung chính
          </a>
          <Suspense
            fallback={
              <div className="p-6">
                <LoadingState />
              </div>
            }
          >
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route element={<MainLayout />}>
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<Dashboard />} />
                {navigation
                  .filter(
                    (item) =>
                      item.path !== '/dashboard' && item.path !== '/settings',
                  )
                  .map((item) => (
                    <Route
                      key={item.path}
                      path={item.path}
                      element={<ModulePlaceholder />}
                    />
                  ))}
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </MotionConfig>
    </ThemeProvider>
  )
}
