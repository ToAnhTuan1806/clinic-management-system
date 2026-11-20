import type { ReactNode } from 'react'
import { HeartPulse, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router'
import { Brand } from '@/components/brand'
import { ThemeToggle } from '@/components/theme-toggle'
import { Badge } from '@/components/ui/badge'
import { isAuthMock } from '@/auth/config'

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="grid min-h-dvh outline-none lg:grid-cols-2"
    >
      <section className="medical-banner hidden flex-col justify-between p-12 lg:flex">
        <p className="text-sm font-semibold">CLINICOS / KHÔNG GIAN CHĂM SÓC</p>
        <div className="max-w-md">
          <HeartPulse
            className="mb-8 size-20"
            strokeWidth={1}
            aria-hidden="true"
          />
          <h2 className="text-4xl leading-tight font-semibold">
            Chăm sóc tốt hơn.
            <br />
            Bắt đầu từ kết nối.
          </h2>
          <p className="mt-6 leading-relaxed text-white/90">
            Một không gian rõ ràng và thống nhất cho hành trình chăm sóc sức
            khỏe của bạn.
          </p>
        </div>
        <p className="flex items-center gap-2 text-sm text-white/90">
          <ShieldCheck className="size-4" aria-hidden="true" />
          Phiên đăng nhập kết thúc khi tải lại trang.
        </p>
      </section>
      <section className="flex min-w-0 flex-col p-5 sm:p-10">
        <div className="flex items-center justify-between">
          <Link to="/" className="rounded-lg" aria-label="ClinicOS — trang chủ">
            <Brand />
          </Link>
          <ThemeToggle />
        </div>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
          <Badge variant="secondary" className="mb-5 w-fit">
            {isAuthMock
              ? 'DEMO · API MOCK · Không phải Backend thật'
              : 'Chưa kết nối dịch vụ xác thực'}
          </Badge>
          {children}
        </div>
        <p className="text-center text-xs text-muted-foreground">
          ClinicOS · Không sử dụng thông tin thật trong bản thử nghiệm.
        </p>
      </section>
    </main>
  )
}
