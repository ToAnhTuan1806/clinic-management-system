import { Suspense } from 'react'
import { Outlet } from 'react-router'
import { Sidebar } from '@/components/layout/sidebar'
import { Header } from '@/components/layout/header'
import { LoadingState } from '@/components/page-states'
import { useAuth } from '@/auth/context'
import { isAuthMock } from '@/auth/config'
import { dismissAuthNotice } from '@/auth/session-store'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

export function MainLayout() {
  const { notice } = useAuth()
  return (
    <div className="min-h-dvh lg:pl-64">
      <Sidebar />
      <Header />
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto min-h-[calc(100dvh-5rem)] max-w-[1600px] p-4 pb-8 outline-none sm:p-8"
      >
        {isAuthMock && (
          <p className="mb-5 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-xs text-primary">
            DEMO · Đang kiểm thử với API MOCK, không phải Backend thật.
          </p>
        )}
        {notice === 'forbidden' && (
          <Alert variant="destructive" className="mb-5 p-4">
            <AlertTitle>Không đủ quyền</AlertTitle>
            <AlertDescription>
              Bạn không có quyền thực hiện thao tác vừa yêu cầu. Phiên đăng nhập
              vẫn được giữ.
              <Button
                onClick={dismissAuthNotice}
                variant="outline"
                className="mt-3"
              >
                Đóng thông báo
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <Suspense fallback={<LoadingState />}>
          <Outlet />
        </Suspense>
        <footer className="mt-9 flex flex-wrap items-center justify-between gap-2 border-t pt-5 text-xs text-muted-foreground">
          <span>ClinicOS · Hệ thống quản lý phòng khám.</span>
          <span>Múi giờ hiển thị: Asia/Ho_Chi_Minh (UTC+7)</span>
        </footer>
      </main>
    </div>
  )
}
