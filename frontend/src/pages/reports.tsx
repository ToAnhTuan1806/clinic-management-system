import { useEffect, useState } from 'react'
import {
  BarChart3,
  CalendarDays,
  ClipboardCheck,
  LogIn,
  RefreshCw,
  Stethoscope,
  Layers2,
  UsersRound,
} from 'lucide-react'
import { useAuth } from '@/auth/context'
import { appointmentStatusLabels } from '@/booking/model'
import {
  dateRangeError,
  defaultDateRange,
  type DateRange,
} from '@/operations/api'
import {
  canViewReports,
  formatVnDateLabel,
  reportsApi,
  reportsMessage,
  statusBarOrder,
  type VisitReport,
} from '@/reports/api'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingState } from '@/components/page-states'

export default function Reports() {
  const { user, version } = useAuth()
  return canViewReports(user?.role) ? <ReportsWorkspace key={version} /> : null
}

function ReportsWorkspace() {
  const { user } = useAuth()
  const [draft, setDraft] = useState<DateRange>(defaultDateRange)
  const [range, setRange] = useState<DateRange>(draft)
  const [revision, setRevision] = useState(0)
  const [validation, setValidation] = useState('')
  const key = `${range.from}:${range.to}:${revision}`
  const [resource, setResource] = useState<{
    key: string
    data?: VisitReport
    error?: string
  } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void reportsApi
      .visitReport(range, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResource({ key, data })
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setResource({ key, error: reportsMessage(error) })
        }
      })
    return () => controller.abort()
  }, [range, key])

  const current = resource?.key === key ? resource : null
  const data = current?.data
  const maxDaily = data
    ? Math.max(1, ...data.dailyVisits.map((item) => item.totalAppointments))
    : 1

  const scopeLabel =
    user?.role === 'DOCTOR'
      ? 'Thống kê lượt khám của riêng bạn theo múi giờ Việt Nam (UTC+7).'
      : user?.role === 'RECEPTIONIST'
        ? 'Báo cáo vận hành và tiếp đón toàn phòng khám theo múi giờ Việt Nam (UTC+7).'
        : 'Báo cáo tổng hợp lượt khám toàn phòng khám theo bác sĩ, chuyên khoa và trạng thái.'

  const kpis = data
    ? [
        {
          label: 'Tổng lượt khám',
          value: data.totalAppointments,
          icon: CalendarDays,
        },
        {
          label: 'Lượt check-in',
          value: data.checkedInCount,
          icon: LogIn,
        },
        {
          label: 'Hoàn tất khám',
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            BÁO CÁO VẬN HÀNH
          </p>
          <h1 className="text-2xl font-semibold sm:text-3xl">
            Báo cáo lượt khám
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{scopeLabel}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-10 gap-2 bg-card"
          onClick={() => setRevision((v) => v + 1)}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Làm mới
        </Button>
      </div>

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
            setRevision((v) => v + 1)
          }}
        >
          <div className="min-w-[140px] flex-1 space-y-2">
            <Label htmlFor="report-from">Từ ngày</Label>
            <Input
              id="report-from"
              type="date"
              className="h-10"
              value={draft.from}
              onChange={(e) => setDraft({ ...draft, from: e.target.value })}
              aria-invalid={!!validation}
            />
          </div>
          <div className="min-w-[140px] flex-1 space-y-2">
            <Label htmlFor="report-to">Đến ngày</Label>
            <Input
              id="report-to"
              type="date"
              className="h-10"
              value={draft.to}
              onChange={(e) => setDraft({ ...draft, to: e.target.value })}
              aria-invalid={!!validation}
            />
          </div>
          <Button type="submit" className="h-10">
            Áp dụng
          </Button>
          <p className="w-full text-xs text-muted-foreground">
            Khoảng ngày tính theo giờ Việt Nam (Asia/Ho_Chi_Minh), tối đa 366
            ngày.
          </p>
          {validation && (
            <Alert variant="destructive" className="w-full">
              <AlertDescription>{validation}</AlertDescription>
            </Alert>
          )}
        </form>
      </Card>

      {!current ? (
        <LoadingState />
      ) : current.error ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{current.error}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRevision((v) => v + 1)}
            >
              Thử lại
            </Button>
          </AlertDescription>
        </Alert>
      ) : data ? (
        <>
          <dl
            aria-label="Chỉ số tổng hợp lượt khám"
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
          >
            {kpis.map((item) => {
              const Icon = item.icon
              return (
                <Card key={item.label} className="gap-0 p-5">
                  <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-primary/7 text-primary">
                    <Icon className="size-5" aria-hidden="true" />
                  </div>
                  <dt className="text-sm text-muted-foreground">
                    {item.label}
                  </dt>
                  <dd className="mt-2 text-3xl font-semibold tabular-nums">
                    {item.value.toLocaleString('vi-VN')}
                  </dd>
                </Card>
              )
            })}
          </dl>

          {data.totalAppointments === 0 ? (
            <Card className="p-8 text-center">
              <BarChart3
                className="mx-auto mb-3 size-8 text-muted-foreground"
                aria-hidden="true"
              />
              <h2 className="text-base font-semibold">
                Chưa có lượt khám trong khoảng thời gian đã chọn
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Thử mở rộng khoảng ngày để xem thống kê theo ngày, bác sĩ và
                chuyên khoa.
              </p>
            </Card>
          ) : (
            <>
              <div className="grid gap-6 lg:grid-cols-2">
                <Card className="p-5">
                  <div className="mb-4 flex items-center justify-between gap-2">
                    <h2 className="text-base font-semibold">
                      Phân bố theo trạng thái
                    </h2>
                    <Badge variant="secondary">
                      {data.totalAppointments} lượt
                    </Badge>
                  </div>
                  <div className="space-y-3">
                    {statusBarOrder.map((status) => {
                      const count = data.appointmentsByStatus[status] ?? 0
                      const pct =
                        data.totalAppointments > 0
                          ? Math.round((count / data.totalAppointments) * 100)
                          : 0
                      return (
                        <div key={status} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span>{appointmentStatusLabels[status]}</span>
                            <span className="font-medium tabular-nums">
                              {count} ({pct}%)
                            </span>
                          </div>
                          <div
                            className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
                            role="progressbar"
                            aria-label={appointmentStatusLabels[status]}
                            aria-valuenow={pct}
                            aria-valuemin={0}
                            aria-valuemax={100}
                          >
                            <div
                              className="h-full rounded-full bg-primary transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </Card>

                <Card className="p-5">
                  <div className="mb-4 flex items-center justify-between gap-2">
                    <h2 className="text-base font-semibold">
                      Lượt khám theo ngày
                    </h2>
                    <Badge variant="outline">
                      {data.dailyVisits.length} ngày
                    </Badge>
                  </div>
                  <div className="space-y-3">
                    {data.dailyVisits.map((day) => {
                      const widthPct = Math.round(
                        (day.totalAppointments / maxDaily) * 100,
                      )
                      return (
                        <div key={day.date} className="space-y-1">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm">
                            <span className="font-medium">
                              {formatVnDateLabel(day.date)}
                            </span>
                            <span className="text-muted-foreground tabular-nums">
                              Tổng {day.totalAppointments} · Check-in{' '}
                              {day.checkedInCount} · Hoàn tất{' '}
                              {day.completedCount}
                            </span>
                          </div>
                          <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-sky-500 dark:bg-sky-400"
                              style={{ width: `${widthPct}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </Card>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <Card className="p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <Stethoscope
                      className="size-4 text-primary"
                      aria-hidden="true"
                    />
                    <h2 className="text-base font-semibold">
                      Thống kê theo bác sĩ
                    </h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[420px] text-left text-sm">
                      <thead className="border-b text-xs text-muted-foreground">
                        <tr>
                          <th className="py-2 pr-3">Bác sĩ</th>
                          <th className="py-2 pr-3">Chuyên khoa</th>
                          <th className="py-2 pr-3 text-right">Tổng</th>
                          <th className="py-2 pr-3 text-right">Check-in</th>
                          <th className="py-2 text-right">Hoàn tất</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {data.byDoctor.map((doc) => (
                          <tr key={doc.doctorId}>
                            <td className="py-2.5 pr-3">
                              <p className="font-medium">{doc.doctorName}</p>
                              <p className="text-xs text-muted-foreground">
                                {doc.doctorCode}
                              </p>
                            </td>
                            <td className="py-2.5 pr-3 text-muted-foreground">
                              {doc.specialtyName}
                            </td>
                            <td className="py-2.5 pr-3 text-right font-medium tabular-nums">
                              {doc.totalAppointments}
                            </td>
                            <td className="py-2.5 pr-3 text-right tabular-nums">
                              {doc.checkedInCount}
                            </td>
                            <td className="py-2.5 text-right tabular-nums">
                              {doc.completedCount}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>

                <Card className="p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <Layers2
                      className="size-4 text-primary"
                      aria-hidden="true"
                    />
                    <h2 className="text-base font-semibold">
                      Thống kê theo chuyên khoa
                    </h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[360px] text-left text-sm">
                      <thead className="border-b text-xs text-muted-foreground">
                        <tr>
                          <th className="py-2 pr-3">Chuyên khoa</th>
                          <th className="py-2 pr-3 text-right">Tổng</th>
                          <th className="py-2 pr-3 text-right">Check-in</th>
                          <th className="py-2 text-right">Hoàn tất</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {data.bySpecialty.map((spec) => (
                          <tr key={spec.specialtyId}>
                            <td className="py-2.5 pr-3">
                              <p className="font-medium">
                                {spec.specialtyName}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {spec.specialtyCode}
                              </p>
                            </td>
                            <td className="py-2.5 pr-3 text-right font-medium tabular-nums">
                              {spec.totalAppointments}
                            </td>
                            <td className="py-2.5 pr-3 text-right tabular-nums">
                              {spec.checkedInCount}
                            </td>
                            <td className="py-2.5 text-right tabular-nums">
                              {spec.completedCount}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            </>
          )}
        </>
      ) : null}
    </div>
  )
}
