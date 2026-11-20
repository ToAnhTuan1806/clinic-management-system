import { ArrowUpRight, ChevronRight, LogIn, ShieldCheck } from 'lucide-react'
import { Link, NavLink } from 'react-router'
import { Brand } from '@/components/brand'
import { Badge } from '@/components/ui/badge'
import { navigation } from '@/lib/navigation'
import { cn } from '@/lib/utils'

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-7 p-5">
      <Link
        to="/dashboard"
        onClick={onNavigate}
        aria-label="ClinicOS — về tổng quan"
        className="w-fit rounded-lg"
      >
        <Brand />
      </Link>
      <div className="flex items-center gap-3 rounded-xl border bg-background p-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-card text-sm font-semibold text-primary">
          CL
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Không gian phòng khám</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Bản xem trước{' '}
            <span className="font-semibold text-primary">DEMO</span>
          </p>
        </div>
      </div>
      <nav aria-label="Điều hướng chính">
        <p className="mb-3 px-3 text-[11px] font-semibold text-muted-foreground">
          KHÔNG GIAN LÀM VIỆC
        </p>
        <div className="space-y-1.5">
          {navigation.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'group flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className="size-[18px]" aria-hidden="true" />
                  <span>{label}</span>
                  {isActive && (
                    <ChevronRight
                      className="ml-auto size-4"
                      aria-hidden="true"
                    />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
      <div className="mt-auto space-y-5">
        <div className="rounded-xl border border-primary/15 bg-primary/5 p-4">
          <ShieldCheck
            className="mb-3 size-5 text-primary"
            aria-hidden="true"
          />
          <p className="text-sm font-semibold">Khởi đầu từ sự an tâm</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Đây là giao diện DEMO. Không nhập thông tin bệnh nhân thật.
          </p>
          <Link
            to="/settings"
            onClick={onNavigate}
            className="mt-3 inline-flex min-h-8 items-center gap-2 rounded text-xs font-semibold text-primary"
          >
            Xem thiết lập{' '}
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
        <div className="flex items-center justify-between border-t pt-4">
          <Link
            to="/login"
            onClick={onNavigate}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg text-sm text-muted-foreground hover:text-foreground"
          >
            <LogIn className="size-4" aria-hidden="true" />
            Đăng nhập
          </Link>
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
