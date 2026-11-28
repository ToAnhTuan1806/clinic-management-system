import { ArrowUpRight, ChevronRight, LogOut, ShieldCheck } from 'lucide-react'
import { Link, NavLink } from 'react-router'
import { Brand } from '@/components/brand'
import { Badge } from '@/components/ui/badge'
import { navigation, roleHome } from '@/lib/navigation'
import { useAuth } from '@/auth/context'
import { roleLabels } from '@/auth/types'
import { isAuthMock } from '@/auth/config'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth()
  return (
    <div className="flex h-full flex-col gap-5 p-5">
      <Link
        to={user ? roleHome(user.role) : '/login'}
        onClick={onNavigate}
        aria-label="ClinicOS — về tổng quan"
        className="w-fit shrink-0 rounded-lg"
      >
        <Brand />
      </Link>
      <div className="flex shrink-0 items-center gap-3 rounded-xl border bg-background p-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-card text-sm font-semibold text-primary">
          CL
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold" title={user?.fullName}>
            {user?.fullName ?? 'Không gian phòng khám'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {user ? roleLabels[user.role] : 'Chưa đăng nhập'}
            {isAuthMock && (
              <span className="ml-1 font-semibold text-primary">MOCK</span>
            )}
          </p>
        </div>
      </div>
      <nav
        aria-label="Điều hướng chính"
        className="min-h-0 flex-1 overflow-y-auto pr-1"
      >
        <p className="mb-3 px-3 text-[11px] font-semibold text-muted-foreground">
          KHÔNG GIAN LÀM VIỆC
        </p>
        <div className="space-y-1">
          {navigation
            .filter((item) => user && item.roles.includes(user.role))
            .map(({ path, label, icon: Icon }) => (
              <NavLink
                key={path}
                to={path}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'group flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className="size-[18px] shrink-0" aria-hidden="true" />
                    <span className="truncate">{label}</span>
                    {isActive && (
                      <ChevronRight
                        className="ml-auto size-4 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                  </>
                )}
              </NavLink>
            ))}
        </div>
      </nav>
      <div className="shrink-0 space-y-4">
        <div className="hidden rounded-xl border border-primary/15 bg-primary/5 p-3.5 2xl:block">
          <ShieldCheck
            className="mb-2 size-5 text-primary"
            aria-hidden="true"
          />
          <p className="text-sm font-semibold">Vận hành đồng bộ</p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            Quản lý lịch hẹn, khám bệnh, hồ sơ và báo cáo trên cùng một nền
            tảng.
          </p>
          <Link
            to="/settings"
            onClick={onNavigate}
            className="mt-2.5 inline-flex min-h-8 items-center gap-2 rounded text-xs font-semibold text-primary"
          >
            Xem thiết lập{' '}
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
        <div className="flex items-center justify-between border-t pt-3">
          <Button
            variant="ghost"
            onClick={() => {
              logout()
              onNavigate?.()
            }}
            className="min-h-10 gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <LogOut className="size-4" aria-hidden="true" />
            Đăng xuất
          </Button>
          <Badge
            variant="outline"
            className="text-[10px] text-muted-foreground"
          >
            v0.1
          </Badge>
        </div>
      </div>
    </div>
  )
}

export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 overflow-y-auto border-r bg-card lg:block">
      <SidebarContent />
    </aside>
  )
}
