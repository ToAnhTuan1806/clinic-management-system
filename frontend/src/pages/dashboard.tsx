import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  CalendarDays,
  ClipboardCheck,
  LogIn,
  RefreshCw,
  UsersRound,
  ArrowUpRight,
} from 'lucide-react'
import { useAuth } from '@/auth/context'
import { isAuthMock } from '@/auth/config'
import { canAccessPath } from '@/lib/navigation'
import { appointmentStatusLabels } from '@/booking/model'
import {
  operationsApi,
  statuses,
  canViewDashboard,
  dateRangeError,
  defaultDateRange,
  operationsMessage,
  type DateRange,
  type Summary,
} from '@/operations/api'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingState } from '@/components/page-states'

export default function Dashboard() {
  const { user, version } = useAuth()
  return canViewDashboard(user?.role) ? (
    <DashboardWorkspace key={version} />
  ) : null
}
function DashboardWorkspace() {
  const { user } = useAuth()
  const [draft, setDraft] = useState(defaultDateRange)
  const [range, setRange] = useState<DateRange>(draft)
  const [revision, setRevision] = useState(0)
  const [validation, setValidation] = useState('')
  const key = range.from + ':' + range.to + ':' + revision
  const [resource, setResource] = useState<{
    key: string
    data?: Summary
    error?: string
  } | null>(null)
  useEffect(() => {
    if (!operationsApi.ready) return
    const controller = new AbortController()
    void operationsApi
      .summary(range, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResource({ key, data })
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResource({ key, error: operationsMessage(error) })
      })
    return () => controller.abort()
  }, [range, key])
  const current = resource?.key === key ? resource : null
  const data = current?.data
  const metrics = data
    ? [
        {
          label: 'Tổng số lịch hẹn',
          value: data.totalAppointments,
          icon: CalendarDays,
        },
        { label: 'Lượt check-in', value: data.checkedInCount, icon: LogIn },
        {
          label: 'Lịch hoàn tất',
          value: data.completedCount,
          icon: ClipboardCheck,
        },
        {
          label: 'Bệnh nhân duy nhất',
          value: data.uniquePatients,
          icon: UsersRound,
        },
      ]
    : []
  const scope =
    user?.role === 'DOCTOR'
      ? 'Chỉ lịch và lượt khám được phân công cho bạn.'
      : user?.role === 'RECEPTIONIST'
        ? 'Theo dõi lịch hẹn và tiếp đón toàn phòng khám.'
        : 'Số liệu vận hành toàn phòng khám.'
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            KHÔNG GIAN CHĂM SÓC SỨC KHỎE
          </p>
          <h1 className="text-2xl font-semibold sm:text-3xl">
            {user?.role === 'DOCTOR'
              ? 'Không gian bác sĩ'
              : user?.role === 'RECEPTIONIST'
                ? 'Không gian lễ tân'
                : 'Tổng quan phòng khám'}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{scope}</p>
        </div>
        <Button asChild variant="outline" className="h-10 gap-2 bg-card">
          <Link to="/appointments">
            <CalendarDays aria-hidden="true" />
            Xem lịch hẹn
          </Link>
        </Button>
      </div>
      <section
        className="medical-banner rounded-2xl p-5 text-white sm:p-6"
        aria-label="Tổng quan vận hành"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Nhịp hoạt động phòng khám</h2>
            <p className="mt-1 text-sm text-white/90">
              Theo dõi lịch hẹn và phối hợp chăm sóc trong cùng một không gian.
            </p>
          </div>
          <Badge variant="outline" className="border-white/30 text-white">
            {!operationsApi.ready
              ? 'Chưa kết nối'
              : isAuthMock
                ? 'HTTP MOCK · D13'
                : 'Dữ liệu API'}
          </Badge>
        </div>
      </section>
      <Card className="p-5">
        <form
          className="flex flex-wrap items-end gap-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            const error = dateRangeError(draft)
            setValidation(error)
            if (error) return
            setRange({ ...draft })
            setRevision((value) => value + 1)
          }}
        >
          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor="summary-from">Từ ngày</Label>
            <Input
              id="summary-from"
              type="date"
              value={draft.from}
              onChange={(e) => setDraft({ ...draft, from: e.target.value })}
              aria-invalid={!!validation}
              aria-describedby={
                validation ? 'summary-validation' : 'summary-timezone'
              }
            />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor="summary-to">Đến ngày</Label>
            <Input
              id="summary-to"
              type="date"
              value={draft.to}
              onChange={(e) => setDraft({ ...draft, to: e.target.value })}
              aria-invalid={!!validation}
              aria-describedby={
                validation ? 'summary-validation' : 'summary-timezone'
              }
            />
          </div>
          <Button type="submit">Áp dụng</Button>
          <p
            id="summary-timezone"
            className="w-full text-xs text-muted-foreground"
          >
            Ngày khám theo giờ Việt Nam (UTC+7).
          </p>
          {validation && (
            <p
              role="alert"
              id="summary-validation"
              className="w-full text-sm text-destructive"
            >
              {validation}
            </p>
          )}
        </form>
      </Card>
      {!operationsApi.ready ? (
        <Alert>
          <AlertDescription>
            Thống kê chưa sẵn sàng. Vui lòng thử lại sau.
          </AlertDescription>
        </Alert>
      ) : !current ? (
        <LoadingState />
      ) : current.error ? (
        <Alert variant="destructive">
          <AlertDescription>
            <p>{current.error}</p>
            <Button
              variant="outline"
              className="mt-3"
              onClick={() => setRevision((v) => v + 1)}
            >
              <RefreshCw aria-hidden="true" />
              Thử lại Dashboard
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        data && (
          <>
            <dl
              aria-label="Chỉ số vận hành"
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
            >
              {metrics.map(({ label, value, icon: Icon }) => (
                <Card key={label} className="gap-0 p-5">
                  <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-primary/7 text-primary">
                    <Icon aria-hidden="true" className="size-5" />
                  </div>
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="mt-2 text-3xl font-semibold tabular-nums">
                    {value.toLocaleString('vi-VN')}
                  </dd>
                </Card>
              ))}
            </dl>
            <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
              <Card className="p-5">
                <h2 className="font-semibold">
                  Phân bố lịch hẹn theo trạng thái
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {range.from} — {range.to}
                </p>
                {data.totalAppointments === 0 ? (
                  <div className="py-8 text-center">
                    <h3 className="font-medium">
                      Chưa có lịch hẹn trong khoảng ngày này
                    </h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Hãy chọn khoảng ngày khác để xem thống kê.
                    </p>
                  </div>
                ) : (
                  <dl
                    aria-label="Phân bố trạng thái"
                    className="mt-5 space-y-4"
                  >
                    {statuses.map((status) => (
                      <div key={status}>
                        <div className="mb-1.5 flex justify-between gap-2 text-sm">
                          <dt>{appointmentStatusLabels[status]}</dt>
                          <dd className="font-medium tabular-nums">
                            {data.appointmentsByStatus[status].toLocaleString(
                              'vi-VN',
                            )}
                          </dd>
                        </div>
                        <div
                          aria-hidden="true"
                          className="h-2 overflow-hidden rounded-full bg-muted"
                        >
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{
                              width:
                                Math.min(
                                  100,
                                  (data.appointmentsByStatus[status] /
                                    data.totalAppointments) *
                                    100,
                                ) + '%',
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </dl>
                )}
              </Card>
              <Card className="p-5">
                <h2 className="font-semibold">Không gian quản lý</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Đi đến các phân hệ của phòng khám
                </p>
                <nav aria-label="Truy cập nhanh" className="mt-3 divide-y">
                  {[
                    { to: '/appointments', label: 'Lịch hẹn' },
                    { to: '/patients', label: 'Bệnh nhân' },
                    { to: '/medical-records', label: 'Khám bệnh' },
                    { to: '/doctors', label: 'Bác sĩ' },
                  ]
                    .filter((link) => user && canAccessPath(user.role, link.to))
                    .map((link) => (
                      <Link
                        key={link.to}
                        to={link.to}
                        className="flex min-h-14 items-center justify-between gap-3 rounded py-3 text-sm hover:text-primary"
                      >
                        {link.label}
                        <ArrowUpRight aria-hidden="true" className="size-4" />
                      </Link>
                    ))}
                </nav>
              </Card>
            </div>
          </>
        )
      )}
    </div>
  )
}
