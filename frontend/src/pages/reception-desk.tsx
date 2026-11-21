import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  AlertCircle,
  Ban,
  CalendarCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  FileText,
  Filter,
  Loader2,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Stethoscope,
  User,
  UserCheck,
  UserX,
  X,
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
  canCheckInAppointment,
  canConfirmAppointment,
  canMarkNoShowAppointment,
  type Appointment,
  type AppointmentStatus,
} from '@/booking/model'
import {
  formatVnDateFull,
  formatVnTimeRange,
  getVnTodayString,
} from '@/schedule/model'

export default function ReceptionDesk() {
  const { user } = useAuth()
  const role = user?.role || 'RECEPTIONIST'

  const todayStr = useMemo(() => getVnTodayString(), [])

  // List & Filter States
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  // Filters
  const [selectedDate, setSelectedDate] = useState<string>(todayStr)
  const [statusFilter, setStatusFilter] = useState<AppointmentStatus | 'ALL'>(
    'ALL',
  )
  const [searchQuery, setSearchQuery] = useState('')

  // User Feedback
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'info'
    message: string
  } | null>(null)

  // Dialog States
  // 1. Confirm Dialog
  const [confirmApp, setConfirmApp] = useState<Appointment | null>(null)
  const [submittingConfirm, setSubmittingConfirm] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  // 2. Check-in Dialog
  const [checkInApp, setCheckInApp] = useState<Appointment | null>(null)
  const [submittingCheckIn, setSubmittingCheckIn] = useState(false)
  const [checkInError, setCheckInError] = useState<string | null>(null)

  // 3. Mark No-show Dialog
  const [noShowApp, setNoShowApp] = useState<Appointment | null>(null)
  const [submittingNoShow, setSubmittingNoShow] = useState(false)
  const [noShowError, setNoShowError] = useState<string | null>(null)

  // 4. Cancel Dialog
  const [cancelApp, setCancelApp] = useState<Appointment | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [submittingCancel, setSubmittingCancel] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  // Refresh handler
  const refreshAppointments = () => {
    setLoading(true)
    setRevision((prev) => prev + 1)
  }

  // Load appointments
  useEffect(() => {
    const controller = new AbortController()

    void bookingGateway
      .listAppointments(
        {
          date: selectedDate || undefined,
          status: statusFilter !== 'ALL' ? statusFilter : undefined,
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
  }, [selectedDate, statusFilter, revision])

  // Filtered by Search Query
  const displayedAppointments = useMemo(() => {
    if (!searchQuery.trim()) return appointments
    const q = searchQuery.toLowerCase().trim()
    return appointments.filter((a) => {
      const codeMatch = a.appointmentCode.toLowerCase().includes(q)
      const patNameMatch = (a.patientName || '').toLowerCase().includes(q)
      const patPhoneMatch = (a.patientPhone || '').includes(q)
      const patCodeMatch = (a.patientCode || '').toLowerCase().includes(q)
      const docMatch = (a.doctorName || '').toLowerCase().includes(q)
      const specMatch = (a.specialtyName || '').toLowerCase().includes(q)
      return (
        codeMatch ||
        patNameMatch ||
        patPhoneMatch ||
        patCodeMatch ||
        docMatch ||
        specMatch
      )
    })
  }, [appointments, searchQuery])

  // Calculate statistics for the selected date
  const stats = useMemo(() => {
    const total = appointments.length
    const pending = appointments.filter((a) => a.status === 'PENDING').length
    const confirmed = appointments.filter(
      (a) => a.status === 'CONFIRMED',
    ).length
    const checkedIn = appointments.filter(
      (a) => a.status === 'CHECKED_IN',
    ).length
    const noShow = appointments.filter((a) => a.status === 'NO_SHOW').length
    const inProgress = appointments.filter(
      (a) => a.status === 'IN_PROGRESS',
    ).length
    const completed = appointments.filter(
      (a) => a.status === 'COMPLETED',
    ).length
    const cancelled = appointments.filter(
      (a) => a.status === 'CANCELLED',
    ).length

    return {
      total,
      pending,
      confirmed,
      checkedIn,
      noShow,
      inProgress,
      completed,
      cancelled,
    }
  }, [appointments])

  // ================= ACTION HANDLERS =================

  // 1. Confirm Appointment (PENDING -> CONFIRMED)
  const handleConfirmSubmit = async () => {
    if (!confirmApp) return
    setSubmittingConfirm(true)
    setConfirmError(null)

    try {
      await bookingGateway.confirmAppointment({
        appointmentId: confirmApp.id,
        expectedVersion: confirmApp.version ?? 0,
      })

      setConfirmApp(null)
      setFeedback({
        type: 'success',
        message: `Đã xác nhận lịch hẹn ${confirmApp.appointmentCode} thành công. Trạng thái chuyển sang ĐÃ XÁC NHẬN.`,
      })
      refreshAppointments()
    } catch (err) {
      const msg = bookingMessage(err)
      setConfirmError(msg)
      if (msg.includes('409') || msg.includes('phiên bản')) {
        refreshAppointments()
      }
    } finally {
      setSubmittingConfirm(false)
    }
  }

  // 2. Check-in Appointment (CONFIRMED -> CHECKED_IN)
  const handleCheckInSubmit = async () => {
    if (!checkInApp) return
    setSubmittingCheckIn(true)
    setCheckInError(null)

    try {
      await bookingGateway.checkInAppointment({
        appointmentId: checkInApp.id,
        expectedVersion: checkInApp.version ?? 0,
      })

      setCheckInApp(null)
      setFeedback({
        type: 'success',
        message: `Đã tiếp đón bệnh nhân ${checkInApp.patientName || checkInApp.appointmentCode} thành công (CHECKED_IN).`,
      })
      refreshAppointments()
    } catch (err) {
      const msg = bookingMessage(err)
      setCheckInError(msg)
      if (msg.includes('409') || msg.includes('phiên bản')) {
        refreshAppointments()
      }
    } finally {
      setSubmittingCheckIn(false)
    }
  }

  // 3. Mark No-show (CONFIRMED -> NO_SHOW)
  const handleNoShowSubmit = async () => {
    if (!noShowApp) return
    setSubmittingNoShow(true)
    setNoShowError(null)

    try {
      await bookingGateway.markNoShow({
        appointmentId: noShowApp.id,
        expectedVersion: noShowApp.version ?? 0,
      })

      setNoShowApp(null)
      setFeedback({
        type: 'info',
        message: `Đã đánh dấu vắng mặt lịch hẹn ${noShowApp.appointmentCode} thành công (NO_SHOW).`,
      })
      refreshAppointments()
    } catch (err) {
      const msg = bookingMessage(err)
      setNoShowError(msg)
      if (msg.includes('409') || msg.includes('phiên bản')) {
        refreshAppointments()
      }
    } finally {
      setSubmittingNoShow(false)
    }
  }

  // 4. Cancel Appointment
  const handleCancelSubmit = async () => {
    if (!cancelApp) return
    const trimmed = cancelReason.trim()
    if (!trimmed) {
      setCancelError('Vui lòng nhập lý do hủy lịch khám (1-255 ký tự).')
      return
    }
    if (trimmed.length > 255) {
      setCancelError('Lý do hủy lịch khám không được vượt quá 255 ký tự.')
      return
    }

    setSubmittingCancel(true)
    setCancelError(null)

    try {
      await bookingGateway.cancelAppointment({
        appointmentId: cancelApp.id,
        reason: trimmed,
        expectedVersion: cancelApp.version ?? 0,
      })

      setCancelApp(null)
      setFeedback({
        type: 'info',
        message: `Đã hủy cuộc hẹn ${cancelApp.appointmentCode}. Khung giờ khám đã được hoàn lại.`,
      })
      refreshAppointments()
    } catch (err) {
      const msg = bookingMessage(err)
      setCancelError(msg)
      if (msg.includes('409') || msg.includes('phiên bản')) {
        refreshAppointments()
      }
    } finally {
      setSubmittingCancel(false)
    }
  }

  // Helper: Status badge
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
        return <Badge variant="secondary">{status}</Badge>
    }
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Bàn tiếp đón & Điều phối lịch khám
            </h1>
            <Badge variant="outline" className="text-primary border-primary/30">
              Lễ tân tiếp đón
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Quản lý luồng tiếp đón bệnh nhân trong ngày, xác nhận lịch hẹn, làm
            thủ tục check-in và xử lý vắng mặt.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refreshAppointments}
            disabled={loading}
            className="gap-1.5"
            aria-label="Tải lại danh sách lịch khám"
          >
            <RefreshCw
              className={`size-3.5 ${loading ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>Làm mới</span>
          </Button>

          <Button asChild size="sm" className="gap-1.5">
            <Link to="/booking">
              <Plus className="size-4" aria-hidden="true" />
              <span>Đặt lịch tại quầy</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <Alert
          className={`flex items-start justify-between ${
            feedback.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200'
              : feedback.type === 'error'
                ? 'border-destructive/30 bg-destructive/10 text-destructive'
                : 'border-sky-500/30 bg-sky-500/10 text-sky-900 dark:text-sky-200'
          }`}
        >
          <div className="flex items-start gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2
                className="size-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0"
                aria-hidden="true"
              />
            ) : feedback.type === 'error' ? (
              <AlertCircle
                className="size-4 text-destructive mt-0.5 shrink-0"
                aria-hidden="true"
              />
            ) : (
              <CalendarCheck
                className="size-4 text-sky-600 dark:text-sky-400 mt-0.5 shrink-0"
                aria-hidden="true"
              />
            )}
            <AlertDescription className="text-sm font-medium">
              {feedback.message}
            </AlertDescription>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-muted-foreground hover:text-foreground text-xs"
            aria-label="Đóng thông báo"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </Alert>
      )}

      {/* Global Error Banner */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
          <AlertDescription className="flex items-center justify-between text-sm">
            <span>{error}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={refreshAppointments}
              className="ml-4 h-7 text-xs"
            >
              Thử lại
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Statistics Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <Card
          onClick={() => setStatusFilter('ALL')}
          className={`p-3 transition-colors cursor-pointer border ${
            statusFilter === 'ALL'
              ? 'border-primary ring-1 ring-primary bg-primary/5'
              : 'hover:bg-muted/50'
          }`}
        >
          <div className="text-xs font-medium text-muted-foreground">
            Tổng lịch hẹn
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-2xl font-bold tracking-tight text-foreground">
              {stats.total}
            </span>
            <CalendarDays className="size-4 text-muted-foreground" />
          </div>
        </Card>

        <Card
          onClick={() => setStatusFilter('PENDING')}
          className={`p-3 transition-colors cursor-pointer border ${
            statusFilter === 'PENDING'
              ? 'border-amber-500 ring-1 ring-amber-500 bg-amber-500/5'
              : 'hover:bg-muted/50'
          }`}
        >
          <div className="text-xs font-medium text-amber-700 dark:text-amber-400">
            Chờ xác nhận
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
              {stats.pending}
            </span>
            <Clock className="size-4 text-amber-500" />
          </div>
        </Card>

        <Card
          onClick={() => setStatusFilter('CONFIRMED')}
          className={`p-3 transition-colors cursor-pointer border ${
            statusFilter === 'CONFIRMED'
              ? 'border-sky-500 ring-1 ring-sky-500 bg-sky-500/5'
              : 'hover:bg-muted/50'
          }`}
        >
          <div className="text-xs font-medium text-sky-700 dark:text-sky-400">
            Đã xác nhận
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-2xl font-bold tracking-tight text-sky-600 dark:text-sky-400">
              {stats.confirmed}
            </span>
            <CalendarCheck className="size-4 text-sky-500" />
          </div>
        </Card>

        <Card
          onClick={() => setStatusFilter('CHECKED_IN')}
          className={`p-3 transition-colors cursor-pointer border ${
            statusFilter === 'CHECKED_IN'
              ? 'border-purple-500 ring-1 ring-purple-500 bg-purple-500/5'
              : 'hover:bg-muted/50'
          }`}
        >
          <div className="text-xs font-medium text-purple-700 dark:text-purple-400">
            Đã tiếp đón
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-2xl font-bold tracking-tight text-purple-600 dark:text-purple-400">
              {stats.checkedIn}
            </span>
            <UserCheck className="size-4 text-purple-500" />
          </div>
        </Card>

        <Card
          onClick={() => setStatusFilter('NO_SHOW')}
          className={`p-3 transition-colors cursor-pointer border col-span-2 sm:col-span-1 ${
            statusFilter === 'NO_SHOW'
              ? 'border-destructive ring-1 ring-destructive bg-destructive/5'
              : 'hover:bg-muted/50'
          }`}
        >
          <div className="text-xs font-medium text-destructive">Vắng mặt</div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-2xl font-bold tracking-tight text-destructive">
              {stats.noShow}
            </span>
            <UserX className="size-4 text-destructive" />
          </div>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <Card className="p-4 space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* Date Selector & Quick Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <Label
              htmlFor="reception-date-input"
              className="text-xs font-semibold text-muted-foreground mr-1"
            >
              Ngày khám:
            </Label>
            <Input
              id="reception-date-input"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-40 h-8 text-xs font-medium"
            />
            <Button
              type="button"
              variant={selectedDate === todayStr ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedDate(todayStr)}
              className="h-8 text-xs"
            >
              Hôm nay
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const [y, m, d] = todayStr.split('-').map(Number)
                const nextDay = new Date(Date.UTC(y, m - 1, d) + 86400000)
                const nextStr = `${nextDay.getUTCFullYear()}-${String(nextDay.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDay.getUTCDate()).padStart(2, '0')}`
                setSelectedDate(nextStr)
              }}
              className="h-8 text-xs"
            >
              Ngày mai
            </Button>
            {selectedDate && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelectedDate('')}
                className="h-8 text-xs text-muted-foreground"
              >
                Tất cả ngày
              </Button>
            )}
          </div>

          {/* Search Box */}
          <div className="relative w-full lg:w-80">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              placeholder="Tìm mã lịch, tên BN, SĐT, bác sĩ..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-8 text-xs"
            />
          </div>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t">
          <span className="text-xs font-medium text-muted-foreground mr-1">
            Trạng thái:
          </span>
          {(
            [
              { key: 'ALL', label: 'Tất cả' },
              { key: 'PENDING', label: 'Chờ xác nhận' },
              { key: 'CONFIRMED', label: 'Đã xác nhận' },
              { key: 'CHECKED_IN', label: 'Đã tiếp đón' },
              { key: 'IN_PROGRESS', label: 'Đang khám' },
              { key: 'COMPLETED', label: 'Hoàn thành' },
              { key: 'NO_SHOW', label: 'Vắng mặt' },
              { key: 'CANCELLED', label: 'Đã hủy' },
            ] as const
          ).map((tab) => {
            const isActive = statusFilter === tab.key
            return (
              <Button
                key={tab.key}
                type="button"
                variant={isActive ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter(tab.key)}
                className={`h-7 px-2.5 text-xs rounded-full ${
                  isActive
                    ? ''
                    : 'text-muted-foreground hover:text-foreground bg-transparent'
                }`}
              >
                {tab.label}
              </Button>
            )
          })}
        </div>
      </Card>

      {/* Main Appointment List */}
      <div className="space-y-3">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <Skeleton className="h-5 w-36" />
                  <Skeleton className="h-5 w-24" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-32" />
                </div>
              </Card>
            ))}
          </div>
        ) : displayedAppointments.length === 0 ? (
          <Card className="p-12 text-center space-y-3 border-dashed">
            <div className="flex justify-center">
              <div className="rounded-full bg-muted p-3">
                <Filter className="size-6 text-muted-foreground" />
              </div>
            </div>
            <h3 className="text-base font-semibold text-foreground">
              Không có lịch hẹn nào phù hợp
            </h3>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              Không tìm thấy lịch hẹn cho bộ lọc ngày{' '}
              {selectedDate || 'toàn bộ'} hoặc trạng thái đã chọn.
            </p>
            {(selectedDate !== todayStr ||
              statusFilter !== 'ALL' ||
              searchQuery) && (
              <div className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedDate(todayStr)
                    setStatusFilter('ALL')
                    setSearchQuery('')
                  }}
                  className="text-xs"
                >
                  Xóa bộ lọc về hôm nay
                </Button>
              </div>
            )}
          </Card>
        ) : (
          <div className="space-y-3">
            {displayedAppointments.map((app) => {
              const confirmCheck = canConfirmAppointment(app, role)
              const checkInCheck = canCheckInAppointment(app, role)
              const noShowCheck = canMarkNoShowAppointment(app, role)

              return (
                <Card
                  key={app.id}
                  className="p-4 transition-shadow hover:shadow-xs border space-y-3"
                  data-appointment-id={app.id}
                  data-appointment-code={app.appointmentCode}
                >
                  {/* Top Bar: Code, Status, Time */}
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b pb-2.5">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-mono text-sm font-bold tracking-tight text-foreground bg-muted/60 px-2 py-0.5 rounded">
                        {app.appointmentCode}
                      </span>
                      {renderStatusBadge(app.status)}
                    </div>

                    <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <Clock className="size-3.5 shrink-0 text-primary" />
                      <span>{formatVnDateFull(app.startAt)}</span>
                      <span>·</span>
                      <span className="font-semibold text-foreground">
                        {formatVnTimeRange(app.startAt, app.endAt)}
                      </span>
                    </div>
                  </div>

                  {/* Information Grid: Patient, Doctor, Details */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                    {/* Patient info */}
                    <div className="space-y-1 rounded-lg bg-muted/30 p-2.5 border">
                      <div className="flex items-center gap-1.5 font-semibold text-foreground">
                        <User className="size-3.5 text-primary" />
                        <span>{app.patientName || 'Chưa cập nhật'}</span>
                      </div>
                      <div className="flex items-center gap-1 text-muted-foreground pl-5">
                        <Phone className="size-3" />
                        <span>{app.patientPhone || 'Không có SĐT'}</span>
                        {app.patientCode && (
                          <span className="ml-1 text-[11px] opacity-75">
                            ({app.patientCode})
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Doctor and Specialty */}
                    <div className="space-y-1 rounded-lg bg-muted/30 p-2.5 border">
                      <div className="flex items-center gap-1.5 font-semibold text-foreground">
                        <Stethoscope className="size-3.5 text-primary" />
                        <span>BS. {app.doctorName || 'Chưa phân công'}</span>
                      </div>
                      <div className="text-muted-foreground pl-5">
                        <span>Chuyên khoa: {app.specialtyName || '—'}</span>
                      </div>
                    </div>

                    {/* Reason & Meta */}
                    <div className="space-y-1 rounded-lg bg-muted/30 p-2.5 border md:col-span-2 lg:col-span-1">
                      {app.reason ? (
                        <div className="flex items-start gap-1.5 text-muted-foreground">
                          <FileText className="size-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                          <span className="line-clamp-2">
                            Lý do: {app.reason}
                          </span>
                        </div>
                      ) : (
                        <div className="text-muted-foreground italic">
                          Không ghi chú lý do khám
                        </div>
                      )}

                      {/* Operational Metadata */}
                      {app.confirmedAt && (
                        <div className="text-[11px] text-sky-700 dark:text-sky-300">
                          Xác nhận lúc:{' '}
                          {new Date(app.confirmedAt).toLocaleTimeString(
                            'vi-VN',
                          )}
                        </div>
                      )}
                      {app.checkedInAt && (
                        <div className="text-[11px] text-purple-700 dark:text-purple-300">
                          Tiếp đón lúc:{' '}
                          {new Date(app.checkedInAt).toLocaleTimeString(
                            'vi-VN',
                          )}
                        </div>
                      )}
                      {app.noShowAt && (
                        <div className="text-[11px] text-destructive">
                          Báo vắng lúc:{' '}
                          {new Date(app.noShowAt).toLocaleTimeString('vi-VN')}
                        </div>
                      )}
                      {app.status === 'CANCELLED' && app.cancellationReason && (
                        <div className="text-[11px] text-destructive flex items-center gap-1">
                          <Ban className="size-3" />
                          <span>Lý do hủy: {app.cancellationReason}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions Footer */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t">
                    <div className="text-[11px] text-muted-foreground">
                      Phiên bản dữ liệu: v{app.version ?? 0}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {/* 1. Action: XÁC NHẬN (PENDING -> CONFIRMED) */}
                      {confirmCheck.allowed && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            setConfirmApp(app)
                            setConfirmError(null)
                          }}
                          className="h-8 text-xs gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
                          data-action="confirm"
                        >
                          <Check className="size-3.5" aria-hidden="true" />
                          <span>Xác nhận lịch</span>
                        </Button>
                      )}

                      {/* 2. Action: TIẾP ĐÓN / CHECK-IN (CONFIRMED -> CHECKED_IN) */}
                      {checkInCheck.allowed && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            setCheckInApp(app)
                            setCheckInError(null)
                          }}
                          className="h-8 text-xs gap-1.5 bg-sky-600 hover:bg-sky-700 text-white"
                          data-action="checkin"
                        >
                          <UserCheck className="size-3.5" aria-hidden="true" />
                          <span>Tiếp đón (Check-in)</span>
                        </Button>
                      )}

                      {/* 3. Action: BÁO VẮNG MẶT (NO_SHOW) */}
                      {(noShowCheck.allowed || app.status === 'CONFIRMED') && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setNoShowApp(app)
                            setNoShowError(null)
                          }}
                          className="h-8 text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                          data-action="noshow"
                        >
                          <UserX className="size-3.5" aria-hidden="true" />
                          <span>Báo vắng mặt</span>
                        </Button>
                      )}

                      {/* 4. Action: HỦY LỊCH (CANCELLED) */}
                      {(app.status === 'PENDING' ||
                        app.status === 'CONFIRMED') && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setCancelApp(app)
                            setCancelReason('')
                            setCancelError(null)
                          }}
                          className="h-8 text-xs text-muted-foreground hover:text-destructive"
                          data-action="cancel"
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
      </div>

      {/* ================= DIALOG 1: XÁC NHẬN LỊCH HẸN ================= */}
      <Dialog
        open={Boolean(confirmApp)}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmApp(null)
            setConfirmError(null)
          }
        }}
      >
        <DialogContent className="max-w-md" closeDisabled={submittingConfirm}>
          <div className="flex items-center gap-3 border-b pb-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Check className="size-5" aria-hidden="true" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold text-foreground">
                Xác nhận lịch hẹn khám
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Mã lịch hẹn: {confirmApp?.appointmentCode}
              </DialogDescription>
            </div>
          </div>

          <div className="space-y-3 py-2 text-xs">
            {confirmError && (
              <Alert variant="destructive">
                <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                <AlertDescription>{confirmError}</AlertDescription>
              </Alert>
            )}

            <p className="text-muted-foreground leading-relaxed">
              Bạn có chắc chắn muốn xác nhận lịch hẹn này không? Trạng thái sẽ
              được chuyển từ <strong>CHỜ XÁC NHẬN</strong> sang{' '}
              <strong>ĐÃ XÁC NHẬN</strong>.
            </p>

            {confirmApp && (
              <div className="rounded-lg bg-muted/40 p-3 space-y-1.5 border">
                <div>
                  Bệnh nhân:{' '}
                  <strong>{confirmApp.patientName || 'Chưa cập nhật'}</strong> (
                  {confirmApp.patientPhone || '—'})
                </div>
                <div>
                  Bác sĩ: <strong>BS. {confirmApp.doctorName || '—'}</strong> (
                  {confirmApp.specialtyName})
                </div>
                <div>
                  Thời gian khám:{' '}
                  <strong>
                    {formatVnDateFull(confirmApp.startAt)} (
                    {formatVnTimeRange(confirmApp.startAt, confirmApp.endAt)})
                  </strong>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmApp(null)}
              disabled={submittingConfirm}
            >
              Hủy bỏ
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleConfirmSubmit}
              disabled={submittingConfirm}
              className="bg-amber-600 hover:bg-amber-700 text-white gap-2"
            >
              {submittingConfirm ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  <span>Đang xử lý...</span>
                </>
              ) : (
                <span>Xác nhận lịch</span>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ================= DIALOG 2: TIẾP ĐÓN BỆNH NHÂN (CHECK-IN) ================= */}
      <Dialog
        open={Boolean(checkInApp)}
        onOpenChange={(open) => {
          if (!open) {
            setCheckInApp(null)
            setCheckInError(null)
          }
        }}
      >
        <DialogContent className="max-w-md" closeDisabled={submittingCheckIn}>
          <div className="flex items-center gap-3 border-b pb-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400">
              <UserCheck className="size-5" aria-hidden="true" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold text-foreground">
                Tiếp đón bệnh nhân (Check-in)
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Mã lịch hẹn: {checkInApp?.appointmentCode}
              </DialogDescription>
            </div>
          </div>

          <div className="space-y-3 py-2 text-xs">
            {checkInError && (
              <Alert variant="destructive">
                <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                <AlertDescription>{checkInError}</AlertDescription>
              </Alert>
            )}

            <p className="text-muted-foreground leading-relaxed">
              Xác nhận bệnh nhân đã có mặt tại phòng khám. Hệ thống sẽ chuyển
              trạng thái sang <strong>ĐÃ TIẾP ĐÓN (CHECKED_IN)</strong> và thông
              báo cho phòng khám chuyên khoa.
            </p>

            {checkInApp && (
              <div className="rounded-lg bg-muted/40 p-3 space-y-1.5 border">
                <div>
                  Bệnh nhân:{' '}
                  <strong>{checkInApp.patientName || 'Chưa cập nhật'}</strong> (
                  {checkInApp.patientPhone || '—'})
                </div>
                <div>
                  Bác sĩ phụ trách:{' '}
                  <strong>BS. {checkInApp.doctorName || '—'}</strong> (
                  {checkInApp.specialtyName})
                </div>
                <div>
                  Khung giờ:{' '}
                  <strong>
                    {formatVnTimeRange(checkInApp.startAt, checkInApp.endAt)}
                  </strong>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCheckInApp(null)}
              disabled={submittingCheckIn}
            >
              Hủy bỏ
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleCheckInSubmit}
              disabled={submittingCheckIn}
              className="bg-sky-600 hover:bg-sky-700 text-white gap-2"
            >
              {submittingCheckIn ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  <span>Đang tiếp đón...</span>
                </>
              ) : (
                <span>Xác nhận tiếp đón</span>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ================= DIALOG 3: ĐÁNH DẤU VẮNG MẶT (NO-SHOW) ================= */}
      <Dialog
        open={Boolean(noShowApp)}
        onOpenChange={(open) => {
          if (!open) {
            setNoShowApp(null)
            setNoShowError(null)
          }
        }}
      >
        <DialogContent className="max-w-md" closeDisabled={submittingNoShow}>
          <div className="flex items-center gap-3 border-b pb-3 text-destructive">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              <UserX className="size-5" aria-hidden="true" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold text-foreground">
                Đánh dấu bệnh nhân vắng mặt
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Mã lịch hẹn: {noShowApp?.appointmentCode}
              </DialogDescription>
            </div>
          </div>

          <div className="space-y-3 py-2 text-xs">
            {noShowError && (
              <Alert variant="destructive">
                <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                <AlertDescription>{noShowError}</AlertDescription>
              </Alert>
            )}

            <p className="text-muted-foreground leading-relaxed">
              Bạn có chắc chắn muốn đánh dấu bệnh nhân vắng mặt không? Cuộc hẹn
              sẽ chuyển sang trạng thái <strong>VẮNG MẶT (NO_SHOW)</strong> để
              ghi nhận hồ sơ theo dõi.
            </p>

            {noShowApp && (
              <div className="rounded-lg bg-destructive/5 p-3 space-y-1.5 border border-destructive/20 text-foreground">
                <div>
                  Bệnh nhân:{' '}
                  <strong>{noShowApp.patientName || 'Chưa cập nhật'}</strong>
                </div>
                <div>
                  Bác sĩ: <strong>BS. {noShowApp.doctorName || '—'}</strong>
                </div>
                <div>
                  Khung giờ hẹn:{' '}
                  <strong>
                    {formatVnDateFull(noShowApp.startAt)} (
                    {formatVnTimeRange(noShowApp.startAt, noShowApp.endAt)})
                  </strong>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setNoShowApp(null)}
              disabled={submittingNoShow}
            >
              Hủy bỏ
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleNoShowSubmit}
              disabled={submittingNoShow}
              className="gap-2"
            >
              {submittingNoShow ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  <span>Đang xử lý...</span>
                </>
              ) : (
                <span>Xác nhận vắng mặt</span>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ================= DIALOG 4: HỦY LỊCH HẸN ================= */}
      <Dialog
        open={Boolean(cancelApp)}
        onOpenChange={(open) => {
          if (!open) {
            setCancelApp(null)
            setCancelReason('')
            setCancelError(null)
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
                Mã lịch hẹn: {cancelApp?.appointmentCode}
              </DialogDescription>
            </div>
          </div>

          <div className="space-y-4 py-2">
            {cancelError && (
              <Alert variant="destructive">
                <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                <AlertDescription className="text-xs">
                  {cancelError}
                </AlertDescription>
              </Alert>
            )}

            <p className="text-xs text-muted-foreground leading-relaxed">
              Thao tác hủy lịch khám không thể hoàn tác. Khung giờ này sẽ được
              mở lại để tiếp nhận bệnh nhân khác.
            </p>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-xs">
                <Label htmlFor="reception-cancel-reason">
                  Lý do hủy khám <span className="text-destructive">*</span>
                </Label>
                <span
                  className={`text-[11px] ${
                    cancelReason.length > 255
                      ? 'text-destructive font-bold'
                      : 'text-muted-foreground'
                  }`}
                >
                  {cancelReason.length}/255 ký tự
                </span>
              </div>
              <textarea
                id="reception-cancel-reason"
                rows={3}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                maxLength={255}
                placeholder="Nhập lý do hủy lịch theo yêu cầu bệnh nhân hoặc phòng khám..."
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCancelApp(null)}
              disabled={submittingCancel}
            >
              Đóng
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleCancelSubmit}
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
