import { useEffect, useRef, useState } from 'react'
import { CalendarDays, RefreshCw } from 'lucide-react'
import { useAuth } from '@/auth/context'
import { useSubmission } from '@/auth/use-submission'
import { historyGateway } from '@/history/gateway'
import {
  canRelease,
  historyMessage,
  pageSize,
  type HistoryDetail,
  type HistoryPage,
  type HistoryQuery,
} from '@/history/model'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingState } from '@/components/page-states'

const selectClass =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const dateLabel = (value: string) =>
  new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'medium',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(value))
export default function MedicalHistory() {
  const { user, version } = useAuth()
  return user?.role === 'PATIENT' || user?.role === 'DOCTOR' ? (
    <HistoryWorkspace key={version + ':' + user.id} />
  ) : null
}
function HistoryWorkspace() {
  const { user } = useAuth()
  const [patients, setPatients] = useState<{ id: string; name: string }[]>([])
  const [patientId, setPatientId] = useState('')
  const [patientError, setPatientError] = useState('')
  const [revision, setRevision] = useState(0)
  const [query, setQuery] = useState<HistoryQuery>({
    page: 0,
    search: '',
    from: '',
    to: '',
    publication: user?.role === 'PATIENT' ? 'RELEASED' : 'ALL',
  })
  const [resource, setResource] = useState<{
    key: string
    data?: HistoryPage
    error?: string
  } | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const trigger = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void historyGateway
      .patients(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setPatients(result)
          setPatientId(result[0]?.id ?? '')
          setPatientError('')
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setPatientError(historyMessage(error))
      })
    return () => controller.abort()
  }, [revision])
  const key = JSON.stringify([patientId, query, revision])
  useEffect(() => {
    if (!patientId || (query.from && query.to && query.from > query.to)) return
    const controller = new AbortController()
    void historyGateway
      .list(patientId, query, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResource({ key, data })
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResource({ key, error: historyMessage(error) })
      })
    return () => controller.abort()
  }, [patientId, key, query])
  const current = resource?.key === key ? resource : null
  const update = (patch: Partial<HistoryQuery>) => {
    setSelected(null)
    setNotice('')
    setQuery((value) => ({ ...value, ...patch, page: 0 }))
  }
  const invalidDates = query.from && query.to && query.from > query.to
  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Lịch sử khám</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {user?.role === 'PATIENT'
              ? 'Hồ sơ đã công bố của bạn.'
              : 'Lịch sử khám trong phạm vi được phân công.'}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setSelected(null)
            setResource(null)
            setPatientError('')
            setRevision((value) => value + 1)
          }}
        >
          <RefreshCw aria-hidden="true" />
          Tải lại
        </Button>
      </div>
      {historyGateway.mode === 'mock' && (
        <Alert>
          <AlertDescription>
            MOCK · Dữ liệu tổng hợp để kiểm thử giao diện.
          </AlertDescription>
        </Alert>
      )}
      {patientError ? (
        <Alert variant="destructive">
          <AlertDescription>{patientError}</AlertDescription>
        </Alert>
      ) : !patientId ? (
        <LoadingState />
      ) : (
        <>
          <Card className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {user?.role === 'DOCTOR' && (
              <div className="space-y-1">
                <Label htmlFor="history-patient">
                  Bệnh nhân được phân công
                </Label>
                <select
                  id="history-patient"
                  className={selectClass}
                  value={patientId}
                  onChange={(event) => {
                    setSelected(null)
                    setResource(null)
                    setPatientId(event.target.value)
                    update({})
                  }}
                >
                  {patients.map((patient) => (
                    <option key={patient.id} value={patient.id}>
                      {patient.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="history-search">
                Tìm bác sĩ hoặc chuyên khoa
              </Label>
              <Input
                id="history-search"
                value={query.search}
                onChange={(event) => update({ search: event.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="history-from">Từ ngày</Label>
              <Input
                id="history-from"
                type="date"
                value={query.from}
                onChange={(event) => update({ from: event.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="history-to">Đến ngày</Label>
              <Input
                id="history-to"
                type="date"
                value={query.to}
                onChange={(event) => update({ to: event.target.value })}
              />
            </div>
            {user?.role === 'DOCTOR' && (
              <div className="space-y-1">
                <Label htmlFor="history-publication">Trạng thái công bố</Label>
                <select
                  id="history-publication"
                  className={selectClass}
                  value={query.publication}
                  onChange={(event) =>
                    update({
                      publication: event.target
                        .value as HistoryQuery['publication'],
                    })
                  }
                >
                  <option value="ALL">Tất cả</option>
                  <option value="RELEASED">Đã công bố</option>
                  <option value="UNRELEASED">Chưa công bố</option>
                </select>
              </div>
            )}
          </Card>
          <p role="status" className={notice ? 'text-sm' : 'sr-only'}>
            {notice}
          </p>
          {invalidDates ? (
            <Alert variant="destructive">
              <AlertDescription>
                Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.
              </AlertDescription>
            </Alert>
          ) : !current ? (
            <LoadingState />
          ) : current.error ? (
            <Alert variant="destructive">
              <AlertDescription>{current.error}</AlertDescription>
            </Alert>
          ) : !current.data?.items.length ? (
            <Card className="p-6">
              <p>Chưa có lượt khám phù hợp.</p>
            </Card>
          ) : (
            <ol aria-label="Các lượt khám" className="space-y-3">
              {current.data.items.map((item) => (
                <li key={item.id}>
                  <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 space-y-2">
                      <p className="flex items-center gap-2 font-medium">
                        <CalendarDays
                          className="size-4 shrink-0"
                          aria-hidden="true"
                        />
                        {dateLabel(item.appointmentAt)}
                      </p>
                      <p className="break-words">
                        {item.doctorName} · {item.specialtyName}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary">
                          {item.status === 'COMPLETED'
                            ? 'Đã hoàn tất'
                            : 'Đang khám'}
                        </Badge>
                        <Badge
                          variant={item.releasedAt ? 'default' : 'outline'}
                        >
                          {item.releasedAt ? 'Đã công bố' : 'Chưa công bố'}
                        </Badge>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      onClick={(event) => {
                        trigger.current = event.currentTarget
                        setSelected(item.id)
                      }}
                    >
                      Xem chi tiết
                      <span className="sr-only"> lượt {item.id}</span>
                    </Button>
                  </Card>
                </li>
              ))}
            </ol>
          )}
          {current?.data && current.data.total > pageSize && (
            <nav
              aria-label="Phân trang lịch sử"
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <Button
                variant="outline"
                disabled={query.page === 0}
                onClick={() =>
                  setQuery((value) => ({ ...value, page: value.page - 1 }))
                }
              >
                Trang trước
              </Button>
              <span className="text-sm">
                Trang {query.page + 1} /{' '}
                {Math.ceil(current.data.total / pageSize)}
              </span>
              <Button
                variant="outline"
                disabled={(query.page + 1) * pageSize >= current.data.total}
                onClick={() =>
                  setQuery((value) => ({ ...value, page: value.page + 1 }))
                }
              >
                Trang sau
              </Button>
            </nav>
          )}
        </>
      )}
      {selected && (
        <HistoryRecord
          key={patientId + ':' + selected}
          patientId={patientId}
          id={selected}
          close={() => setSelected(null)}
          restore={() => trigger.current?.focus()}
          released={() => {
            setSelected(null)
            setResource(null)
            setNotice('Đã công bố hồ sơ.')
            setRevision((value) => value + 1)
          }}
        />
      )}
    </div>
  )
}
function HistoryRecord({
  patientId,
  id,
  close,
  restore,
  released,
}: {
  patientId: string
  id: string
  close: () => void
  restore: () => void
  released: () => void
}) {
  const { user } = useAuth()
  const [detail, setDetail] = useState<HistoryDetail | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [confirm, setConfirm] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const { pending, run } = useSubmission()
  useEffect(() => {
    const controller = new AbortController()
    void historyGateway
      .detail(patientId, id, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return
        if (
          user?.role === 'PATIENT' &&
          (!value.item.releasedAt || value.item.status !== 'COMPLETED')
        ) {
          setError('Hồ sơ chưa được công bố.')
          setDetail(null)
          setBlocked(true)
          return
        }
        setDetail(value)
        setBlocked(false)
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setError(historyMessage(error))
          setDetail(null)
          setBlocked(true)
        }
      })
    return () => controller.abort()
  }, [patientId, id, revision, user?.role])
  const retry = () => {
    setDetail(null)
    setError('')
    setConfirm(false)
    setRevision((value) => value + 1)
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) close()
      }}
    >
      <DialogContent
        closeDisabled={pending}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          restore()
        }}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault()
        }}
        onInteractOutside={(event) => {
          if (pending) event.preventDefault()
        }}
      >
        <DialogTitle className="pr-9">Chi tiết lượt khám</DialogTitle>
        <DialogDescription>
          Nội dung hồ sơ theo quyền truy cập hiện tại.
        </DialogDescription>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {blocked ? (
          <Button className="mt-3" variant="outline" onClick={retry}>
            Tải lại hồ sơ
          </Button>
        ) : !detail ? (
          <LoadingState />
        ) : (
          <div className="mt-4 space-y-4">
            <Badge variant={detail.item.releasedAt ? 'default' : 'outline'}>
              {detail.item.releasedAt ? 'Đã công bố' : 'Chưa công bố'}
            </Badge>
            <dl className="space-y-3">
              {[
                ['Triệu chứng', detail.symptoms],
                ['Chẩn đoán mô phỏng', detail.diagnosis],
                ['Ghi chú', detail.notes],
                ['Kết luận', detail.conclusion],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words">
                    {value || 'Chưa ghi nhận'}
                  </dd>
                </div>
              ))}
            </dl>
            {canRelease(user?.role, detail.item) && (
              <Button onClick={() => setConfirm(true)}>Công bố hồ sơ</Button>
            )}
          </div>
        )}
        <Dialog
          open={confirm}
          onOpenChange={(open) => {
            if (!pending) setConfirm(open)
          }}
        >
          {confirm && (
            <DialogContent
              closeDisabled={pending}
              onEscapeKeyDown={(event) => {
                if (pending) event.preventDefault()
              }}
              onInteractOutside={(event) => {
                if (pending) event.preventDefault()
              }}
            >
              <DialogTitle className="pr-9">Xác nhận công bố hồ sơ</DialogTitle>
              <DialogDescription className="mt-2">
                Sau khi công bố, bệnh nhân có thể xem nội dung hồ sơ hoàn tất
                của mình.
              </DialogDescription>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  autoFocus
                  disabled={pending}
                  onClick={() => setConfirm(false)}
                >
                  Quay lại
                </Button>
                <Button
                  disabled={pending}
                  onClick={() => {
                    if (
                      !detail ||
                      !canRelease(user?.role, detail.item) ||
                      blocked
                    )
                      return
                    void run(async (signal) => {
                      try {
                        await historyGateway.release(
                          patientId,
                          id,
                          detail.item.version,
                          signal,
                        )
                        if (!signal.aborted) released()
                      } catch (error) {
                        if (!signal.aborted) {
                          setError(historyMessage(error))
                          setDetail(null)
                          setBlocked(true)
                          setConfirm(false)
                        }
                      }
                    })
                  }}
                >
                  {pending ? 'Đang công bố…' : 'Xác nhận công bố'}
                </Button>
              </div>
            </DialogContent>
          )}
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}
