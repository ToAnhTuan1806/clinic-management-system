import { Suspense } from 'react'
import { Outlet } from 'react-router'
import { Sidebar } from '@/components/layout/sidebar'
import { Header } from '@/components/layout/header'
import { LoadingState } from '@/components/page-states'

export function MainLayout() {
  return (
    <div className="min-h-dvh lg:pl-64">
      <Sidebar />
      <Header />
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto min-h-[calc(100dvh-5rem)] max-w-[1600px] p-4 pb-8 outline-none sm:p-8"
      >
        <Suspense fallback={<LoadingState />}>
          <Outlet />
        </Suspense>
        <footer className="mt-9 flex flex-wrap items-center justify-between gap-2 border-t pt-5 text-xs text-muted-foreground">
          <span>ClinicOS · Thiết kế cho hành trình chăm sóc tốt hơn.</span>
          <span>DEMO · Chưa kết nối API</span>
        </footer>
      </main>
    </div>
  )
}
