import { lazy, Suspense, useEffect, useRef } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router'
import { MotionConfig } from 'motion/react'
import { MainLayout } from '@/components/layout/main-layout'
import { ThemeProvider } from '@/components/theme-provider'
import { LoadingState } from '@/components/page-states'
import { navigation } from '@/lib/navigation'
import { AuthProvider } from '@/auth/provider'
import {
  HomeRedirect,
  ProtectedRoute,
  PublicAuthRoute,
  RoleGuard,
} from '@/auth/guards'

const Dashboard = lazy(() => import('@/pages/dashboard'))
const ModulePlaceholder = lazy(() => import('@/pages/module-placeholder'))
const Settings = lazy(() => import('@/pages/settings'))
const Login = lazy(() => import('@/pages/login'))
const Register = lazy(() => import('@/pages/register'))
const Booking = lazy(() => import('@/pages/booking'))
const Forbidden = lazy(() => import('@/pages/forbidden'))
const NotFound = lazy(() => import('@/pages/not-found'))
const Directory = lazy(() => import('@/pages/directory'))
const Patients = lazy(() => import('@/pages/patients'))
const Profile = lazy(() => import('@/pages/profile'))
const Schedules = lazy(() => import('@/pages/schedules'))
const Appointments = lazy(() => import('@/pages/appointments'))
const ReceptionDesk = lazy(() => import('@/pages/reception-desk'))
const Examinations = lazy(() => import('@/pages/examinations'))
const MedicalHistory = lazy(() => import('@/pages/medical-history'))
const Reports = lazy(() => import('@/pages/reports'))
const AuditLogs = lazy(() => import('@/pages/audit-logs'))

function RouteEffects() {
  const { pathname } = useLocation()
  const previous = useRef(pathname)
  useEffect(() => {
    const label =
      pathname === '/login' ||
      pathname === '/register' ||
      pathname === '/forbidden'
        ? {
            '/login': 'Đăng nhập',
            '/register': 'Đăng ký',
            '/forbidden': 'Không đủ quyền',
          }[pathname]
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
          <AuthProvider>
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
                <Route element={<PublicAuthRoute />}>
                  <Route path="/login" element={<Login />} />
                  <Route path="/register" element={<Register />} />
                </Route>
                <Route element={<ProtectedRoute />}>
                  <Route element={<MainLayout />}>
                    <Route index element={<HomeRedirect />} />
                    {navigation.map((item) => (
                      <Route
                        key={item.path}
                        element={<RoleGuard allowed={item.roles} />}
                      >
                        <Route
                          path={item.path}
                          element={
                            item.path === '/dashboard' ? (
                              <Dashboard />
                            ) : item.path === '/settings' ? (
                              <Settings />
                            ) : item.path === '/booking' ? (
                              <Booking />
                            ) : item.path === '/appointments' ? (
                              <Appointments />
                            ) : item.path === '/reception/appointments' ? (
                              <ReceptionDesk />
                            ) : item.path === '/medical-records' ? (
                              <Examinations />
                            ) : item.path === '/medical-history' ? (
                              <MedicalHistory />
                            ) : item.path === '/profile' ? (
                              <Profile />
                            ) : item.path === '/patients' ? (
                              <Patients />
                            ) : item.path === '/schedules' ? (
                              <Schedules />
                            ) : item.path === '/reports' ? (
                              <Reports />
                            ) : item.path === '/audit-logs' ? (
                              <AuditLogs />
                            ) : item.path === '/doctors' ||
                              item.path === '/specialties' ? (
                              <Directory
                                key={item.path}
                                kind={
                                  item.path === '/doctors'
                                    ? 'doctors'
                                    : 'specialties'
                                }
                              />
                            ) : (
                              <ModulePlaceholder />
                            )
                          }
                        />
                      </Route>
                    ))}
                    <Route path="/forbidden" element={<Forbidden />} />
                    <Route path="*" element={<NotFound />} />
                  </Route>
                </Route>
              </Routes>
            </Suspense>
          </AuthProvider>
        </BrowserRouter>
      </MotionConfig>
    </ThemeProvider>
  )
}
