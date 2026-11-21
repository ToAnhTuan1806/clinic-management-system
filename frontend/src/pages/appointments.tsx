import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  AlertCircle,
  Ban,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  Stethoscope,
  User,
} from 'lucide-react'
import { useAuth } from '@/auth/context'
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
import { Skeleton } from '@/components/ui/skeleton'
import { bookingGateway } from '@/booking/gateway'
import {
  appointmentStatusLabels,
  bookingMessage,
  canChangeOrCancelAppointment,
  type Appointment,
  type AppointmentStatus,
} from '@/booking/model'
import { scheduleGateway } from '@/schedule/gateway'
import {
  formatVnDateFull,
  formatVnTimeRange,
  fromUtcIsoToVnParts,
  getVnTodayString,
  type ScheduleSlot,
} from '@/schedule/model'

export default function Appointments() {
  const { user } = useAuth()
  const role = user?.role || 'PATIENT'
  const isPatient = role === 'PATIENT'
  const isReceptionist = role === 'RECEPTIONIST'

  // Appointments list state
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)

  // Filters
  const [statusFilter, setStatusFilter] = useState<AppointmentStatus | 'ALL'>(
    'ALL',
  )
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFilter, setDateFilter] = useState<string>('')

  // Dialog State: Change Slot
  const [changeSlotApp, setChangeSlotApp] = useState<Appointment | null>(null)
  const [changeDate, setChangeDate] = useState<string>('')
  const [availableSlots, setAvailableSlots] = useState<ScheduleSlot[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<ScheduleSlot | null>(null)
  const [submittingChange, setSubmittingChange] = useState(false)
  const [changeError, setChangeError] = useState<string | null>(null)

  // Dialog State: Cancel Appointment
  const [cancelApp, setCancelApp] = useState<Appointment | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [submittingCancel, setSubmittingCancel] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  const todayStr = useMemo(() => getVnTodayString(), [])

  // Quick dates for Reschedule
  const quickDates = useMemo(() => {
    const list: { label: string; dateStr: string }[] = []
    const [y, m, d] = todayStr.split('-').map(Number)
    for (let i = 0; i < 5; i++) {
      const curMs = Date.UTC(y, m - 1, d) + i * 86400000
      const cur = new Date(curMs)
      const dateStr = `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, '0')}-${String(cur.getUTCDate()).padStart(2, '0')}`
      const label =
        i === 0
          ? 'Hôm nay'
          : i === 1
            ? 'Ngày mai'
            : `Thứ ${cur.getUTCDay() === 0 ? 'CN' : cur.getUTCDay() + 1}`
      list.push({ label, dateStr })
    }
    return list
  }, [todayStr])

  // Fetch appointments list
  useEffect(() => {
    const controller = new AbortController()

    void bookingGateway
      .listAppointments(
        {
          status: statusFilter !== 'ALL' ? statusFilter : undefined,
          date: dateFilter || undefined,
        },
        controller.signal,
      )
      .then((data) => {
        if (!controller.signal.aborted) {
          setAppointments(data.items)
          setError(null)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(bookingMessage(err))
          setLoading(false)
        }
      })

    return () => controller.abort()
  }, [statusFilter, dateFilter, revision])

  // Load available slots when reschedule dialog is open and date changes
  useEffect(() => {
    if (!changeSlotApp || !changeDate) {
      return
    }

    const controller = new AbortController()

    void scheduleGateway
      .listDoctorSlots(changeSlotApp.doctorId, changeDate, controller.signal)
      .then((rawSlots) => {
        if (!controller.signal.aborted) {
          const nowMs = Date.now()
          const filtered = rawSlots.filter((s) => {
            if (s.status !== 'AVAILABLE') return false
            // Cannot select slots in the past
            if (new Date(s.startsAt).getTime() <= nowMs) return false
            // Exclude current slot
            if (s.startsAt === changeSlotApp.startAt) return false
            return true
          })
          setAvailableSlots(filtered)
          setLoadingSlots(false)
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setAvailableSlots([])
          setLoadingSlots(false)
          setChangeError(bookingMessage(err))
        }
      })

    return () => controller.abort()
  }, [changeSlotApp, changeDate])

  const refreshAppointments = () => {
    setLoading(true)
    setError(null)
    setRevision((prev) => prev + 1)
  }

  // Handle open Change Slot Dialog
  const handleOpenChangeSlot = (app: Appointment) => {
    setChangeSlotApp(app)
    setChangeDate(fromUtcIsoToVnParts(app.startAt).date)
    setAvailableSlots([])
    setSelectedSlot(null)
    setChangeError(null)
    setLoadingSlots(true)
  }

  const handleSelectChangeDate = (newDate: string) => {
    setChangeDate(newDate)
    setAvailableSlots([])
    setSelectedSlot(null)
    setChangeError(null)
    setLoadingSlots(true)
  }

  // Handle submit Change Slot
  const handleConfirmChangeSlot = async () => {
    if (!changeSlotApp || !selectedSlot) return

    setSubmittingChange(true)
    setChangeError(null)

    try {
      await bookingGateway.changeSlot({
        appointmentId: changeSlotApp.id,
        scheduleId: selectedSlot.scheduleId,
        startAt: selectedSlot.startsAt,
        expectedVersion: changeSlotApp.version ?? 0,
      })

      setChangeSlotApp(null)
      setSelectedSlot(null)
      setFeedback({
        type: 'success',
        message: `Đổi lịch hẹn ${changeSlotApp.appointmentCode} thành công! Lịch hẹn đã chuyển về trạng thái Chờ xác nhận (PENDING).`,
      })
      refreshAppointments()
    } catch (err) {
      setChangeError(bookingMessage(err))
      // If version conflict, reload the latest appointment info
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        err.code === 'VERSION_CONFLICT'
      ) {
        try {
          const latest = await bookingGateway.getAppointment(changeSlotApp.id)
          setChangeSlotApp(latest)
        } catch {
          // Ignore
        }
      }
    } finally {
      setSubmittingChange(false)
    }
  }

  // Handle open Cancel Dialog
  const handleOpenCancel = (app: Appointment) => {
    setCancelApp(app)
    setCancelReason('')
    setCancelError(null)
  }

  // Handle submit Cancel Appointment
  const handleConfirmCancel = async () => {
    if (!cancelApp) return

    const trimmedReason = cancelReason.trim()
    if (!trimmedReason) {
      setCancelError('Vui lòng nhập lý do hủy lịch khám (1-255 ký tự).')
      return
    }

    setSubmittingCancel(true)
    setCancelError(null)

    try {
      await bookingGateway.cancelAppointment({
        appointmentId: cancelApp.id,
        reason: trimmedReason,
        expectedVersion: cancelApp.version ?? 0,
      })

      setCancelApp(null)
      setFeedback({
        type: 'success',
        message: `Đã hủy cuộc hẹn ${cancelApp.appointmentCode} thành công. Khung giờ khám đã được giải phóng.`,
      })
      refreshAppointments()
    } catch (err) {
      setCancelError(bookingMessage(err))
    } finally {
      setSubmittingCancel(false)
    }
  }

  // Filtered by search text
  const displayedAppointments = useMemo(() => {
    if (!searchQuery.trim()) return appointments
    const q = searchQuery.toLowerCase().trim()
    return appointments.filter((a) => {
      const codeMatch = a.appointmentCode.toLowerCase().includes(q)
      const docMatch = (a.doctorName || '').toLowerCase().includes(q)
      const patMatch = (a.patientName || '').toLowerCase().includes(q)
      const specMatch = (a.specialtyName || '').toLowerCase().includes(q)
      return codeMatch || docMatch || patMatch || specMatch
    })
  }, [appointments, searchQuery])

  // Status Badge Styling
  const renderStatusBadge = (status: AppointmentStatus) => {
    switch (status) {
      case 'CONFIRMED':
        return (
          <Badge className="bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30">
            {appointmentStatusLabels.CONFIRMED}
          </Badge>
        )
      case 'PENDING':
        return (
          <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30">
            {appointmentStatusLabels.PENDING}
          </Badge>
        )
      case 'CHECKED_IN':
        return (
          <Badge className="bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30">
            {appointmentStatusLabels.CHECKED_IN}
          </Badge>
        )
      case 'IN_PROGRESS':
        return (
          <Badge className="bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30">
            {appointmentStatusLabels.IN_PROGRESS}
          </Badge>
        )
      case 'COMPLETED':
        return (
          <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
            {appointmentStatusLabels.COMPLETED}
          </Badge>
        )
      case 'CANCELLED':
        return (
          <Badge
            variant="outline"
            className="text-muted-foreground border-border bg-muted/30"
          >
            {appointmentStatusLabels.CANCELLED}
          </Badge>
        )
      case 'NO_SHOW':
        return (
          <Badge className="bg-destructive/10 text-destructive border-destructive/30">
            {appointmentStatusLabels.NO_SHOW}
          </Badge>
        )
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="border-primary/30 text-primary bg-primary/5 text-xs px-2 py-0.5"
            >
              {isPatient
                ? 'Bệnh nhân'
                : isReceptionist
                  ? 'Lễ tân'
                  : role === 'DOCTOR'
                    ? 'Bác sĩ'
                    : 'Quản trị viên'}
            </Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl mt-1">
            {isPatient ? 'Lịch hẹn của tôi' : 'Quản lý lịch hẹn'}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isPatient
              ? 'Theo dõi, đổi lịch hoặc hủy các cuộc hẹn khám bệnh của bạn.'
              : 'Theo dõi và điều phối toàn bộ lịch hẹn khám tại phòng khám.'}
          </p>
        </div>

        {/* Action button */}
        {(isPatient || isReceptionist) && (
          <Button asChild className="gap-2 shrink-0">
            <Link to="/booking">
              <Plus className="size-4" aria-hidden="true" />
              <span>Đặt lịch khám mới</span>
            </Link>
          </Button>
        )}
      </div>

      {/* Global Feedback Banner */}
      {feedback && (
        <Alert
          className={
            feedback.type === 'success'
              ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
              : 'border-destructive/50 bg-destructive/10 text-destructive'
          }
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="size-4" />
          ) : (
            <AlertCircle className="size-4" />
          )}
          <AlertDescription className="flex items-center justify-between font-medium">
            <span>{feedback.message}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setFeedback(null)}
              className="h-6 px-1.5 text-xs"
            >
              Đóng
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Filter and Search Bar */}
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Status Filters */}
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              ['ALL', 'PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'] as (
                AppointmentStatus | 'ALL'
              )[]
            ).map((st) => (
              <Button
                key={st}
                type="button"
                variant={statusFilter === st ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter(st)}
                className="text-xs h-8"
              >
                {st === 'ALL' ? 'Tất cả' : appointmentStatusLabels[st] || st}
              </Button>
            ))}
          </div>

          {/* Date Filter & Search */}
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="h-8 text-xs w-36"
              aria-label="Lọc theo ngày khám"
            />
            {dateFilter && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDateFilter('')}
                className="h-8 text-xs px-2"
              >
                Xóa lọc ngày
              </Button>
            )}

            <div className="relative flex-1 sm:w-56">
              <Search
                className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                placeholder="Tìm theo mã, bác sĩ..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={refreshAppointments}
              disabled={loading}
              className="h-8 px-2.5"
              title="Làm mới danh sách"
            >
              <RotateCcw
                className={`size-3.5 ${loading ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
            </Button>
          </div>
        </div>
      </Card>

      {/* Main List Area */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <Alert className="border-destructive/50 bg-destructive/10 text-destructive">
          <AlertCircle className="size-4" />
          <AlertDescription className="flex items-center justify-between font-medium">
            <span>{error}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={refreshAppointments}
              className="text-xs h-7"
            >
              Thử lại
            </Button>
          </AlertDescription>
        </Alert>
      ) : displayedAppointments.length === 0 ? (
        <Card className="p-12 text-center space-y-3">
          <CalendarDays
            className="size-12 text-muted-foreground/40 mx-auto"
            aria-hidden="true"
          />
          <div className="space-y-1">
            <h3 className="font-semibold text-foreground text-base">
              Không có cuộc hẹn nào phù hợp
            </h3>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              {isPatient
                ? 'Bạn chưa có lịch hẹn nào hoặc không có lịch hẹn khớp với bộ lọc hiện tại.'
                : 'Không có dữ liệu lịch hẹn nào trong hệ thống khớp với bộ lọc.'}
            </p>
          </div>
          {(isPatient || isReceptionist) && (
            <Button asChild size="sm" className="mt-2 gap-1.5">
              <Link to="/booking">
                <Plus className="size-4" aria-hidden="true" />
                <span>Đặt lịch khám ngay</span>
              </Link>
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {displayedAppointments.map((app) => {
            const startParts = fromUtcIsoToVnParts(app.startAt)
            const permissions = canChangeOrCancelAppointment(app, role)

            return (
              <Card
                key={app.id}
                className="p-5 flex flex-col justify-between space-y-4 hover:border-primary/50 transition-all border bg-card"
              >
                {/* Header: Code + Status */}
                <div className="flex items-start justify-between border-b pb-3 gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-sm text-foreground">
                        {app.appointmentCode}
                      </span>
                      {renderStatusBadge(app.status)}
                    </div>
                    <span className="text-[11px] text-muted-foreground block mt-0.5">
                      Tạo lúc:{' '}
                      {app.createdAt
                        ? formatVnDateFull(
                            fromUtcIsoToVnParts(app.createdAt).date,
                          )
                        : 'Mới tạo'}
                    </span>
                  </div>

                  {app.roomLabel?.trim() ? (
                    <span className="text-xs font-medium text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-md">
                      {app.roomLabel.trim()}
                    </span>
                  ) : null}
                </div>

                {/* Details */}
                <div className="space-y-2.5 text-xs text-muted-foreground">
                  {/* Doctor & Specialty */}
                  <div className="flex items-center gap-2 text-foreground font-medium">
                    <Stethoscope
                      className="size-4 text-primary shrink-0"
                      aria-hidden="true"
                    />
                    <span>
                      {app.doctorName || 'Bác sĩ phụ trách'}
                      {app.specialtyName ? ` · ${app.specialtyName}` : ''}
                    </span>
                  </div>

                  {/* Date & Time */}
                  <div className="flex items-center gap-2">
                    <Clock
                      className="size-4 text-muted-foreground shrink-0"
                      aria-hidden="true"
                    />
                    <span>
                      <strong className="text-foreground">
                        {formatVnTimeRange(app.startAt, app.endAt)}
                      </strong>{' '}
                      — {formatVnDateFull(startParts.date)} (Giờ VN)
                    </span>
                  </div>

                  {/* Patient Info for Staff */}
                  {!isPatient && app.patientName && (
                    <div className="flex items-center gap-2">
                      <User
                        className="size-4 text-muted-foreground shrink-0"
                        aria-hidden="true"
                      />
                      <span>
                        Bệnh nhân:{' '}
                        <strong className="text-foreground">
                          {app.patientName}
                        </strong>
                        {app.patientPhone ? ` (${app.patientPhone})` : ''}
                      </span>
                    </div>
                  )}

                  {/* Booking Reason (D07) */}
                  {app.reason && (
                    <div className="flex items-start gap-2 pt-1 border-t text-[11px]">
                      <FileText
                        className="size-3.5 text-muted-foreground shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                      <span className="line-clamp-2">
                        Lý do khám: {app.reason}
                      </span>
                    </div>
                  )}

                  {/* Cancellation Reason (D08 / V7) */}
                  {app.status === 'CANCELLED' && app.cancellationReason && (
                    <div className="flex items-start gap-2 pt-1 border-t text-[11px] text-destructive/90 dark:text-destructive/80">
                      <Ban
                        className="size-3.5 text-destructive shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                      <span className="line-clamp-2">
                        Lý do hủy: {app.cancellationReason}
                      </span>
                    </div>
                  )}
                </div>

                {/* Actions Footer */}
                <div className="flex items-center justify-between pt-3 border-t">
                  <div className="text-[11px] text-muted-foreground">
                    {!permissions.canChange && permissions.reason && (
                      <span className="italic">{permissions.reason}</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {permissions.canChange && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenChangeSlot(app)}
                        className="gap-1.5 text-xs h-8"
                      >
                        <CalendarClock
                          className="size-3.5"
                          aria-hidden="true"
                        />
                        <span>Đổi lịch</span>
                      </Button>
                    )}

                    {permissions.canCancel && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenCancel(app)}
                        className="gap-1.5 text-xs h-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Ban className="size-3.5" aria-hidden="true" />
                        <span>Hủy lịch</span>
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* DIALOG: ĐỔI LỊCH KHÁM (CHANGE SLOT) */}
      <Dialog
        open={Boolean(changeSlotApp)}
        onOpenChange={(open) => {
          if (!open) {
            setChangeSlotApp(null)
            setSelectedSlot(null)
          }
        }}
      >
        <DialogContent className="max-w-lg" closeDisabled={submittingChange}>
          <div className="flex items-center gap-3 text-primary border-b pb-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <CalendarClock className="size-5" aria-hidden="true" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold text-foreground">
                Đổi lịch khám bệnh
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Chọn ngày và khung giờ khám mới cho cuộc hẹn{' '}
                <strong className="text-foreground">
                  {changeSlotApp?.appointmentCode}
                </strong>
                .
              </DialogDescription>
            </div>
          </div>

          {/* Error inside dialog */}
          {changeError && (
            <Alert className="my-2 border-destructive/50 bg-destructive/10 text-destructive text-xs">
              <AlertCircle className="size-4" />
              <AlertDescription className="font-medium">
                {changeError}
              </AlertDescription>
            </Alert>
          )}

          {/* Current appointment info summary */}
          {changeSlotApp && (
            <div className="my-3 space-y-1.5 p-3 rounded-lg border bg-muted/40 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Bác sĩ:</span>
                <span className="font-medium text-foreground">
                  {changeSlotApp.doctorName}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Lịch hiện tại:</span>
                <span className="font-bold text-muted-foreground">
                  {formatVnTimeRange(
                    changeSlotApp.startAt,
                    changeSlotApp.endAt,
                  )}
                  ,{' '}
                  {formatVnDateFull(
                    fromUtcIsoToVnParts(changeSlotApp.startAt).date,
                  )}
                </span>
              </div>
            </div>
          )}

          {/* Select New Date */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-foreground">
              1. Chọn ngày khám mới:
            </Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {quickDates.map((q) => (
                <Button
                  key={q.dateStr}
                  type="button"
                  variant={changeDate === q.dateStr ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleSelectChangeDate(q.dateStr)}
                  className="text-xs h-8"
                >
                  {q.label} ({q.dateStr.slice(5)})
                </Button>
              ))}

              <Input
                type="date"
                min={todayStr}
                value={changeDate}
                onChange={(e) => handleSelectChangeDate(e.target.value)}
                className="h-8 text-xs w-36 ml-1"
                aria-label="Chọn ngày đổi lịch"
              />
            </div>
          </div>

          {/* Select New Slot */}
          <div className="space-y-2 pt-2 border-t">
            <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Clock
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
              <span>2. Chọn khung giờ mới còn trống:</span>
            </Label>

            {loadingSlots ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full rounded-md" />
                ))}
              </div>
            ) : availableSlots.length === 0 ? (
              <div className="p-6 text-center rounded-lg border border-dashed text-xs text-muted-foreground">
                Không có khung giờ trống khả dụng nào trong ngày này. Vui lòng
                chọn ngày khác.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto p-1">
                {availableSlots.map((slot) => {
                  const isSelected = selectedSlot?.startsAt === slot.startsAt
                  return (
                    <button
                      key={slot.id || slot.startsAt}
                      type="button"
                      onClick={() => setSelectedSlot(slot)}
                      className={`p-2 rounded-lg border text-xs font-semibold transition-all text-center ${
                        isSelected
                          ? 'border-primary bg-primary text-primary-foreground shadow-xs ring-2 ring-primary ring-offset-1'
                          : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200 hover:border-emerald-500 hover:bg-emerald-500/20'
                      }`}
                    >
                      <span>
                        {formatVnTimeRange(slot.startsAt, slot.endsAt)}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setChangeSlotApp(null)}
              disabled={submittingChange}
            >
              Hủy bỏ
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleConfirmChangeSlot}
              disabled={!selectedSlot || submittingChange}
              className="gap-2"
            >
              {submittingChange ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  <span>Đang cập nhật...</span>
                </>
              ) : (
                <span>Xác nhận đổi lịch</span>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* DIALOG: HỦY LỊCH KHÁM (CANCEL APPOINTMENT) */}
      <Dialog
        open={Boolean(cancelApp)}
        onOpenChange={(open) => {
          if (!open) {
            setCancelApp(null)
            setCancelReason('')
          }
        }}
      >
        <DialogContent className="max-w-md" closeDisabled={submittingCancel}>
          <div className="flex items-center gap-3 text-destructive border-b pb-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              <Ban className="size-5" aria-hidden="true" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold text-foreground">
                Xác nhận hủy lịch khám
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Mã lịch hẹn:{' '}
                <strong className="text-foreground">
                  {cancelApp?.appointmentCode}
                </strong>
              </DialogDescription>
            </div>
          </div>

          {/* Error inside dialog */}
          {cancelError && (
            <Alert className="my-2 border-destructive/50 bg-destructive/10 text-destructive text-xs">
              <AlertCircle className="size-4" />
              <AlertDescription className="font-medium">
                {cancelError}
              </AlertDescription>
            </Alert>
          )}

          <div className="my-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-md text-xs text-amber-800 dark:text-amber-200">
            Lưu ý: Sau khi xác nhận hủy, khung giờ khám này sẽ được mở lại công
            khai cho bệnh nhân khác. Bạn sẽ không thể hoàn tác thao tác này.
          </div>

          {/* Reason Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="cancel-reason" className="text-xs font-semibold">
                Lý do hủy lịch (bắt buộc, 1–255 ký tự): *
              </Label>
              <span className="text-[11px] text-muted-foreground">
                {cancelReason.length}/255
              </span>
            </div>
            <Input
              id="cancel-reason"
              placeholder="VD: Bận công việc đột xuất, đã khám ở cơ sở khác..."
              maxLength={255}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className="text-xs"
              required
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCancelApp(null)}
              disabled={submittingCancel}
            >
              Giữ lại lịch hẹn
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleConfirmCancel}
              disabled={!cancelReason.trim() || submittingCancel}
              className="gap-2"
            >
              {submittingCancel ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  <span>Đang hủy...</span>
                </>
              ) : (
                <span>Xác nhận hủy lịch</span>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
