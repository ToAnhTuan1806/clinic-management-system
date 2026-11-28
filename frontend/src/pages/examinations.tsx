import { useCallback, useEffect, useRef, useState } from 'react'
import { ClipboardList, RefreshCw } from 'lucide-react'
import { useAuth } from '@/auth/context'
import { isAuthMock } from '@/auth/config'
import { useSubmission } from '@/auth/use-submission'
import { normalizeAuthError } from '@/auth/errors'
import { createBookingApi } from '@/booking/api'
import { appointmentStatusLabels, type Appointment } from '@/booking/model'
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
import { PrescriptionEditor } from '@/components/prescription/prescription-editor'
import {
  cleanDraft,
  createExaminationApi,
  examinationFields,
  examinationProblem,
  fieldNames,
  maxFieldLength,
  type Examination,
  type ExaminationDraft,
} from '@/examination/api'
import { apiClient } from '@/lib/api-client'
import { formatVnTimeRange, getVnTodayString } from '@/schedule/model'

const preview = isAuthMock && import.meta.env.VITE_EXAMINATION_MOCK === 'true'
const queueApi = createBookingApi(apiClient)
const recordApi = apiClient.defaults.baseURL
  ? createExaminationApi(apiClient)
  : null
const statuses = ['CHECKED_IN', 'IN_PROGRESS'] as const
const pageSize = 8
const selectClass =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

async function loadQueue(date: string, signal: AbortSignal) {
  const buckets = await Promise.all(
    statuses.map(async (status) => {
      const rows: Appointment[] = []
      for (let page = 0; ; page++) {
        signal.throwIfAborted()
        const result = await queueApi.listAppointments(
          { date, status, page, pageSize: 100 },
          signal,
        )
        if (result.page !== page || result.pageSize < 1)
          throw new Error('INVALID_QUEUE_PAGE')
        rows.push(...result.items.filter((item) => item.status === status))
        if (
          !result.items.length ||
          (page + 1) * result.pageSize >= result.total
        )
          break
      }
      return rows
    }),
  )
  return [
    ...new Map(buckets.flat().map((item) => [item.id, item])).values(),
  ].sort(
    (a, b) =>
      Date.parse(a.startAt) - Date.parse(b.startAt) ||
      a.id.localeCompare(b.id, 'en', { numeric: true }),
  )
}

export default function Examinations() {
  const { user, version } = useAuth()
  if (user?.role !== 'DOCTOR') return null
  return <ExaminationWorkspace key={version} />
}

function ExaminationWorkspace() {
  const [date, setDate] = useState(getVnTodayString)
  const [status, setStatus] = useState('ALL')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [revision, setRevision] = useState(0)
  const [selected, setSelected] = useState<Appointment | null>(null)
  const [notice, setNotice] = useState('')
  const refreshButton = useRef<HTMLButtonElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const [resource, setResource] = useState<{
    key: string
    rows: Appointment[]
    error: string
  } | null>(null)
  const requestKey = JSON.stringify([date, revision])

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    void loadQueue(date, signal)
      .then((rows) => {
        if (!signal.aborted) setResource({ key: requestKey, rows, error: '' })
      })
      .catch((error) => {
        if (!signal.aborted)
          setResource({
            key: requestKey,
            rows: [],
            error: examinationProblem(error),
          })
      })
    return () => controller.abort()
  }, [date, requestKey])

  const current = resource?.key === requestKey ? resource : null
  const query = search.trim().toLocaleLowerCase('vi')
  const rows = (current?.rows ?? []).filter(
    (row) =>
      (status === 'ALL' || row.status === status) &&
      [row.patientName, row.patientCode, row.appointmentCode].some((value) =>
        value?.toLocaleLowerCase('vi').includes(query),
      ),
  )
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const currentPage = Math.min(page, pages - 1)
  const refresh = () => setRevision((value) => value + 1)
  const mock = isAuthMock

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">
            Không gian khám bệnh
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Lịch đã tiếp đón và đang khám được phân công cho bạn.
          </p>
        </div>
        <Button ref={refreshButton} variant="outline" onClick={refresh}>
          <RefreshCw aria-hidden="true" /> Làm mới
        </Button>
      </div>
      {mock && (
        <Alert>
          <AlertDescription>
            MOCK · Chỉ dùng dữ liệu tổng hợp để kiểm thử.
          </AlertDescription>
        </Alert>
      )}
      {!recordApi && (
        <Alert>
          <AlertDescription>
            Hàng đợi lịch hẹn đã có. Thao tác hồ sơ khám đang chờ Backend D10.
          </AlertDescription>
        </Alert>
      )}
      <Card className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
        <div className="min-w-0 space-y-2">
          <Label htmlFor="exam-search">Tìm bệnh nhân hoặc mã hẹn</Label>
          <Input
            id="exam-search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(0)
            }}
          />
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor="exam-date">Ngày khám (Việt Nam)</Label>
          <Input
            id="exam-date"
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value || getVnTodayString())
              setPage(0)
            }}
          />
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor="exam-status">Trạng thái</Label>
          <select
            id="exam-status"
            className={selectClass}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value)
              setPage(0)
            }}
          >
            <option value="ALL">Tất cả</option>
            {statuses.map((value) => (
              <option key={value} value={value}>
                {appointmentStatusLabels[value]}
              </option>
            ))}
          </select>
        </div>
      </Card>
      <div
        role="status"
        className={notice ? 'rounded-lg border bg-card p-3 text-sm' : 'sr-only'}
      >
        {notice}
      </div>
      <section
        aria-label="Hàng đợi khám"
        aria-busy={!current}
        className="space-y-3"
      >
        {!current ? (
          <LoadingState />
        ) : current.error ? (
          <Alert variant="destructive">
            <AlertDescription>{current.error}</AlertDescription>
          </Alert>
        ) : !rows.length ? (
          <Card className="flex items-center gap-3 p-5">
            <ClipboardList className="size-5 shrink-0" aria-hidden="true" />
            <p>Không có lịch khám phù hợp.</p>
          </Card>
        ) : (
          <ul className="space-y-2">
            {rows
              .slice(currentPage * pageSize, (currentPage + 1) * pageSize)
              .map((item) => (
                <li key={item.id}>
                  <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium break-words">
                        {item.patientName || item.patientCode || 'Bệnh nhân'}
                      </p>
                      <p className="text-sm break-words text-muted-foreground">
                        {item.appointmentCode} ·{' '}
                        {formatVnTimeRange(item.startAt, item.endAt)}
                      </p>
                      <Badge variant="secondary">
                        {appointmentStatusLabels[item.status]}
                      </Badge>
                    </div>
                    <Button
                      variant="outline"
                      onClick={(event) => {
                        opener.current = event.currentTarget
                        setNotice('')
                        setSelected(item)
                      }}
                    >
                      Mở chi tiết
                      <span className="sr-only"> {item.appointmentCode}</span>
                    </Button>
                  </Card>
                </li>
              ))}
          </ul>
        )}
      </section>
      {pages > 1 && (
        <nav
          aria-label="Phân trang hàng đợi"
          className="flex flex-wrap items-center justify-between gap-2"
        >
          <Button
            variant="outline"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            Trang trước
          </Button>
          <span className="text-sm">
            Trang {currentPage + 1} / {pages}
          </span>
          <Button
            variant="outline"
            disabled={currentPage + 1 >= pages}
            onClick={() => setPage(currentPage + 1)}
          >
            Trang sau
          </Button>
        </nav>
      )}
      {selected && (
        <ExaminationDetail
          appointment={selected}
          close={() => setSelected(null)}
          restoreFocus={() =>
            (opener.current?.isConnected
              ? opener.current
              : refreshButton.current
            )?.focus()
          }
          onSaved={(message) => {
            refresh()
            setNotice(message)
          }}
        />
      )}
    </div>
  )
}

function ExaminationDetail({
  appointment,
  close,
  restoreFocus,
  onSaved,
}: {
  appointment: Appointment
  close: () => void
  restoreFocus: () => void
  onSaved: (message: string) => void
}) {
  const [record, setRecord] = useState<Examination | null>(null)
  const [latestAppointment, setLatestAppointment] = useState(appointment)
  const [draft, setDraft] = useState<ExaminationDraft | null>(null)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [blocked, setBlocked] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [reload, setReload] = useState(0)
  const [tab, setTab] = useState<'clinical' | 'prescription'>('clinical')
  const [prescriptionDirty, setPrescriptionDirty] = useState(false)
  const [prescriptionBusy, setPrescriptionBusy] = useState(false)
  const prescriptionState = useCallback((dirty: boolean, busy: boolean) => {
    setPrescriptionDirty(dirty)
    setPrescriptionBusy(busy)
  }, [])
  const prescriptionConflict = useCallback((status?: number) => {
    setPrescriptionBusy(false)
    setBlocked(true)
    setError(
      'Không thể đồng bộ hồ sơ. Vui lòng tải lại toàn bộ hồ sơ trước khi tiếp tục.',
    )
    if (status === 401 || status === 403 || status === 404) {
      setRecord(null)
      setDraft(null)
    }
  }, [])
  const recordId = record?.id
  const [loading, setLoading] = useState(Boolean(recordApi))
  const { pending, run } = useSubmission()

  useEffect(() => {
    if (!recordApi) return
    const controller = new AbortController()
    const { signal } = controller
    const refresh = async () => {
      try {
        const latest = await queueApi.getAppointment(appointment.id, signal)
        let result: Examination | null
        try {
          result = await recordApi.byAppointment(appointment.id, signal)
        } catch (failure) {
          if (normalizeAuthError(failure).status !== 404) throw failure
          if (latest.status !== 'CHECKED_IN')
            throw new Error('MISSING_RECORD_LINK')
          result = null
        }
        if (!signal.aborted) {
          setLatestAppointment(latest)
          setRecord(result)
          setDraft(result)
          setBlocked(false)
        }
      } catch (failure) {
        if (!signal.aborted) {
          setError(
            failure instanceof Error &&
              failure.message === 'MISSING_RECORD_LINK'
              ? 'Lịch đang khám nhưng không tìm thấy hồ sơ. Vui lòng tải lại hoặc liên hệ quản trị.'
              : examinationProblem(failure),
          )
          setBlocked(true)
        }
      } finally {
        if (!signal.aborted) setLoading(false)
      }
    }
    void refresh()
    return () => controller.abort()
  }, [appointment, reload])

  const dirty = Boolean(
    record &&
    draft &&
    fieldNames.some((key) => cleanDraft(draft)[key] !== record[key]),
  )
  const change = (action: 'create' | 'save' | 'complete') => {
    if (
      !recordApi ||
      blocked ||
      loading ||
      prescriptionBusy ||
      (action === 'complete' && prescriptionDirty)
    )
      return
    void run(async (signal) => {
      setError('')
      setFeedback('')
      try {
        const saved =
          action === 'create' &&
          !record &&
          !recordId &&
          latestAppointment.status === 'CHECKED_IN'
            ? await recordApi.create(appointment.id, signal)
            : action === 'save' && record && draft
              ? await recordApi.save(record, draft, signal)
              : action === 'complete' && record && !dirty
                ? await recordApi.complete(record, signal)
                : null
        if (!saved || signal.aborted) return
        setRecord(saved)
        setDraft(saved)
        setConfirm(false)
        const message =
          action === 'complete'
            ? 'Đã hoàn tất khám.'
            : action === 'save'
              ? 'Đã lưu nháp.'
              : 'Đã mở hồ sơ khám.'
        setFeedback(message)
        onSaved(message)
        const latest = await recordApi.read(saved.id, appointment.id, signal)
        if (
          latest.version < saved.version ||
          (saved.status === 'COMPLETED' && latest.status !== 'COMPLETED')
        ) {
          throw new Error('INVALID_EXAMINATION_RESPONSE')
        }
        if (!signal.aborted) {
          setRecord(latest)
          setDraft(latest)
        }
      } catch (failure) {
        if (signal.aborted) return
        setError(examinationProblem(failure))
        const { status } = normalizeAuthError(failure)
        if (status === 401 || status === 403 || status === 404) {
          setRecord(null)
          setDraft(null)
          setFeedback('')
        }
        // An uncertain mutation must be reconciled before retrying.
        if (status !== 400) setBlocked(true)
        setConfirm(false)
      }
    })
  }

  const preventClose = (event: { preventDefault: () => void }) => {
    if (pending || prescriptionBusy) event.preventDefault()
  }
  const readOnly =
    pending ||
    prescriptionBusy ||
    loading ||
    blocked ||
    record?.status === 'COMPLETED'
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending && !prescriptionBusy) close()
      }}
    >
      <DialogContent
        className="space-y-4"
        closeDisabled={pending || prescriptionBusy}
        onEscapeKeyDown={preventClose}
        onInteractOutside={preventClose}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          restoreFocus()
        }}
      >
        <DialogTitle className="pr-10">Chi tiết khám bệnh</DialogTitle>
        <DialogDescription className="break-words">
          {appointment.patientName || 'Bệnh nhân'} ·{' '}
          {appointment.appointmentCode}
        </DialogDescription>
        {preview && <Badge variant="outline">MOCK</Badge>}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <p
          role="status"
          className={feedback ? 'text-sm font-medium' : 'sr-only'}
        >
          {feedback}
        </p>
        {blocked && !pending && (
          <div className="space-y-2">
            {(dirty || prescriptionDirty) && (
              <p className="text-sm text-muted-foreground">
                Tải lại sẽ thay các thay đổi chưa lưu bằng bản trên máy chủ.
              </p>
            )}
            <Button
              variant="outline"
              onClick={() => {
                setLoading(true)
                setError('')
                setFeedback('')
                setReload((value) => value + 1)
              }}
            >
              Tải lại hồ sơ
            </Button>
          </div>
        )}
        {!recordApi ? (
          <p className="text-sm text-muted-foreground">
            Dịch vụ ghi hồ sơ khám chưa sẵn sàng.
          </p>
        ) : loading ? (
          <LoadingState />
        ) : record && draft ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant={tab === 'clinical' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTab('clinical')}
                >
                  Hồ sơ lâm sàng
                </Button>
                <Button
                  type="button"
                  variant={tab === 'prescription' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTab('prescription')}
                >
                  Đơn thuốc mô phỏng
                </Button>
              </div>
              <Badge>
                {record.status === 'COMPLETED'
                  ? 'Đã hoàn tất · Chỉ đọc'
                  : 'Bản nháp'}
              </Badge>
            </div>

            <div hidden={tab !== 'clinical'}>
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!readOnly && dirty) change('save')
                }}
              >
                {fieldNames.map((key) => (
                  <div key={key} className="space-y-1">
                    <Label htmlFor={'exam-' + key}>
                      {examinationFields[key]}
                    </Label>
                    <textarea
                      id={'exam-' + key}
                      rows={2}
                      maxLength={maxFieldLength}
                      className={selectClass + ' h-auto min-h-16 py-2'}
                      value={draft[key]}
                      readOnly={readOnly}
                      onChange={(event) =>
                        setDraft({ ...draft, [key]: event.target.value })
                      }
                    />
                  </div>
                ))}
                {record.status === 'IN_PROGRESS' && (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Lưu triệu chứng và chẩn đoán mô phỏng trước khi hoàn tất.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="submit"
                        variant="outline"
                        disabled={readOnly || !dirty}
                      >
                        {pending ? 'Đang xử lý…' : 'Lưu nháp'}
                      </Button>
                      <Button
                        type="button"
                        disabled={
                          readOnly ||
                          dirty ||
                          prescriptionDirty ||
                          !record.symptoms.trim() ||
                          !record.diagnosis.trim() ||
                          !record.conclusion.trim()
                        }
                        onClick={() => setConfirm(true)}
                      >
                        Hoàn tất khám
                      </Button>
                    </div>
                  </>
                )}
              </form>
            </div>
            {prescriptionDirty && tab === 'clinical' && (
              <p
                role="status"
                className="text-sm text-amber-700 dark:text-amber-300"
              >
                Đơn thuốc còn thay đổi chưa lưu. Hãy lưu đơn thuốc trước khi
                hoàn tất khám.
              </p>
            )}
            <div hidden={tab !== 'prescription'}>
              <PrescriptionEditor
                key={record.id + ':' + reload}
                recordId={record.id}
                recordStatus={record.status}
                recordVersion={record.version}
                onVersionChange={async (newVer, signal) => {
                  const latest = await recordApi.read(
                    record.id,
                    appointment.id,
                    signal,
                  )
                  if (signal.aborted) return
                  if (
                    latest.version !== newVer ||
                    fieldNames.some((key) => latest[key] !== record[key])
                  )
                    throw new Error('STALE_CLINICAL_RECORD')
                  setRecord(latest)
                  setDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          version: latest.version,
                          status: latest.status,
                        }
                      : latest,
                  )
                }}
                onStateChange={prescriptionState}
                onConflict={prescriptionConflict}
                disabled={blocked || loading || pending}
              />
            </div>
          </>
        ) : !blocked && latestAppointment.status === 'CHECKED_IN' ? (
          <Button
            disabled={pending || Boolean(recordId)}
            onClick={() => change('create')}
          >
            {pending ? 'Đang mở hồ sơ…' : 'Bắt đầu khám'}
          </Button>
        ) : !blocked ? (
          <p className="text-sm">Lịch hẹn chưa cung cấp mã hồ sơ để mở.</p>
        ) : null}
        <Dialog
          open={confirm}
          onOpenChange={(open) => {
            if (!pending) setConfirm(open)
          }}
        >
          {confirm && (
            <DialogContent
              closeDisabled={pending}
              onEscapeKeyDown={preventClose}
              onInteractOutside={preventClose}
            >
              <DialogTitle className="pr-10">
                Xác nhận hoàn tất khám
              </DialogTitle>
              <DialogDescription className="mt-2">
                Sau khi hoàn tất, hồ sơ chỉ đọc và không thể chỉnh sửa trực
                tiếp.
              </DialogDescription>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  autoFocus
                  variant="outline"
                  disabled={pending}
                  onClick={() => setConfirm(false)}
                >
                  Quay lại
                </Button>
                <Button disabled={pending} onClick={() => change('complete')}>
                  {pending ? 'Đang hoàn tất…' : 'Xác nhận hoàn tất'}
                </Button>
              </div>
            </DialogContent>
          )}
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}
