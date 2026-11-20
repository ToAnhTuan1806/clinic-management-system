import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronRight,
  ClipboardList,
  HeartPulse,
  Layers3,
  Stethoscope,
  UsersRound,
} from 'lucide-react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { BlurFade } from '@/components/ui/blur-fade'
import { EmptyState } from '@/components/page-states'

const metrics = [
  { label: 'Lịch hẹn hôm nay', icon: CalendarDays, to: '/appointments' },
  { label: 'Bệnh nhân', icon: UsersRound, to: '/patients' },
  { label: 'Đội ngũ bác sĩ', icon: Stethoscope, to: '/doctors' },
  { label: 'Hồ sơ bệnh án', icon: ClipboardList, to: '/medical-records' },
]

export default function Dashboard() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            KHÔNG GIAN CHĂM SÓC SỨC KHỎE
          </p>
          <h1 className="text-2xl font-semibold sm:text-3xl">
            Tổng quan phòng khám
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Mọi kết nối bắt đầu từ một không gian làm việc rõ ràng.
          </p>
        </div>
        <Button asChild variant="outline" className="h-10 gap-2 bg-card">
          <Link to="/appointments">
            <CalendarDays aria-hidden="true" />
            Xem lịch hẹn
          </Link>
        </Button>
      </div>
      <BlurFade duration={0.3} offset={4}>
        <section
          className="medical-banner relative isolate overflow-hidden rounded-2xl p-6 sm:p-8"
          aria-labelledby="welcome-title"
        >
          <div className="relative z-10 max-w-xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs">
              <span className="size-1.5 rounded-full bg-white" />
              Nền tảng giao diện đã sẵn sàng
            </span>
            <h2
              id="welcome-title"
              className="mt-5 max-w-md text-2xl leading-snug font-semibold sm:text-3xl"
            >
              Tập trung chăm sóc.
              <br />
              Kết nối mọi hành trình.
            </h2>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/90">
              Một nơi để quản lý bác sĩ, lịch hẹn và hồ sơ. Khám phá giao diện
              nền tảng của ClinicOS.
            </p>
            <Button
              asChild
              className="mt-6 h-10 bg-white px-4 text-blue-800 hover:bg-blue-50"
            >
              <Link to="/patients">
                Khám phá không gian <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
          <div
            aria-hidden="true"
            className="absolute top-1/2 right-12 hidden size-64 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 xl:flex"
          >
            <div className="flex size-48 items-center justify-center rounded-full border border-white/20">
              <div className="flex size-32 items-center justify-center rounded-3xl border border-white/25 bg-white/10">
                <HeartPulse className="size-20 text-white" strokeWidth={1} />
              </div>
            </div>
            <span className="absolute top-0 right-9 flex size-12 items-center justify-center rounded-2xl bg-white text-blue-700">
              <Stethoscope className="size-6" />
            </span>
            <span className="absolute bottom-0 left-6 flex size-11 items-center justify-center rounded-2xl border border-white/30 bg-primary text-white">
              <Check className="size-5" />
            </span>
          </div>
        </section>
      </BlurFade>
      <section
        aria-label="Chỉ số phòng khám"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {metrics.map(({ label, icon: Icon, to }) => (
          <Link
            key={to}
            to={to}
            className="group rounded-xl border bg-card p-5 transition-colors hover:border-primary/40"
          >
            <div className="flex items-center justify-between">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/7 text-primary">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <ArrowUpRight
                className="size-4 text-muted-foreground group-hover:text-primary"
                aria-hidden="true"
              />
            </div>
            <p className="mt-4 text-sm font-medium">{label}</p>
            <p
              className="mt-1 text-3xl font-semibold text-muted-foreground"
              aria-label="Chưa có số liệu"
            >
              —
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Chưa kết nối dữ liệu
            </p>
          </Link>
        ))}
      </section>
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card className="gap-0 py-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">Lịch hẹn hôm nay</h2>
              <Badge variant="secondary">DEMO</Badge>
            </div>
            <Link
              to="/appointments"
              className="inline-flex min-h-9 items-center gap-1 rounded text-xs font-medium text-primary"
            >
              Xem lịch <ChevronRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
          <EmptyState
            compact
            title="Lịch khám đang chờ được kết nối"
            description="Chưa có dữ liệu lịch hẹn. Không có cuộc hẹn hoặc thông tin bệnh nhân thật trong bản DEMO."
          />
        </Card>
        <Card className="gap-0 py-0">
          <div className="border-b p-5">
            <h2 className="font-semibold">Không gian quản lý</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Đi đến các phân hệ của phòng khám
            </p>
          </div>
          <div className="divide-y px-5">
            {metrics.slice(1).map(({ label, icon: Icon, to }) => (
              <Link
                key={to}
                to={to}
                className="group flex min-h-20 items-center gap-3 rounded py-3"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Icon
                    className="size-[18px] text-primary"
                    aria-hidden="true"
                  />
                </span>
                <span>
                  <span className="block text-sm font-medium group-hover:text-primary">
                    {label}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Màn hình nền tảng
                  </span>
                </span>
                <ChevronRight
                  className="ml-auto size-4 text-muted-foreground"
                  aria-hidden="true"
                />
              </Link>
            ))}
          </div>
        </Card>
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed px-5 py-4 text-sm">
        <Layers3 className="size-5 text-primary" aria-hidden="true" />
        <p className="flex-1 text-muted-foreground">
          Đang xem phiên bản nền tảng. Các nghiệp vụ sẽ được phát triển trong
          giai đoạn tiếp theo.
        </p>
        <Link
          to="/settings"
          className="inline-flex min-h-9 items-center gap-2 rounded font-medium text-primary"
        >
          Xem design system{' '}
          <ArrowUpRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </div>
  )
}
