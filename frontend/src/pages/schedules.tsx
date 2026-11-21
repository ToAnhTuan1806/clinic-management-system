import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Filter,
  Plus,
  RefreshCw,
  Stethoscope,
} from 'lucide-react'
import { useAuth } from '@/auth/context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import {
  getVnTodayString,
  getWeekDaysForDate,
  scheduleMessage,
  type DoctorSchedule,
  type ScheduleDraft,
  type ScheduleQuery,
  type ScheduleSlot,
} from '@/schedule/model'
import { scheduleGateway } from '@/schedule/gateway'
import { CalendarView } from '@/components/schedule/calendar-view'
import {
  ScheduleEditorDialog,
  type DoctorOption,
} from '@/components/schedule/schedule-editor'
import { BlockScheduleDialog } from '@/components/schedule/block-dialog'
import { MOCK_DOCTORS } from '@/testing/schedule-mock'

export default function SchedulesPage() {
  const { user } = useAuth()
  const role = user?.role || 'PATIENT'

  const canManage = role === 'ADMIN' || role === 'RECEPTIONIST'
  const isDoctor = role === 'DOCTOR'
  const isPatient = role === 'PATIENT'

  // Doctors list (combines synthetic mock doctors or loaded doctors)
  const doctors: DoctorOption[] = useMemo(() => {
    return MOCK_DOCTORS.map((d) => ({
      id: d.id,
      fullName: d.fullName,
      specialtyName: d.specialtyName,
      doctorCode: d.doctorCode,
    }))
  }, [])

  // For DOCTOR role, find own doctor ID
  const myDoctor = useMemo(() => {
    if (!isDoctor) return null
    return MOCK_DOCTORS.find((d) => d.userId === user?.id) || MOCK_DOCTORS[0]
  }, [isDoctor, user?.id])

  // Filters & State
  const [currentDate, setCurrentDate] = useState(() => getVnTodayString())
  const [viewMode, setViewMode] = useState<'week' | 'day'>('week')
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>(() => {
    if (isDoctor && myDoctor) return myDoctor.id
    return ''
  })
  const [statusFilter, setStatusFilter] = useState<
    'ALL' | 'ACTIVE' | 'BLOCKED'
  >('ALL')
  const [reloadToken, setReloadToken] = useState(0)

  // Data state
  const [schedules, setSchedules] = useState<DoctorSchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Slots for Day View
  const [doctorSlots, setDoctorSlots] = useState<ScheduleSlot[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)

  // Modals state
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState<DoctorSchedule | null>(
    null,
  )
  const [editorDate, setEditorDate] = useState<string | undefined>(undefined)

  const [blockDialogOpen, setBlockDialogOpen] = useState(false)
  const [blockingSchedule, setBlockingSchedule] =
    useState<DoctorSchedule | null>(null)

  // Calculate week days for current date
  const weekDays = useMemo(() => getWeekDaysForDate(currentDate), [currentDate])

  // Fetch schedules via AbortController in useEffect
  useEffect(() => {
    const controller = new AbortController()

    const query: ScheduleQuery = {
      doctorId:
        isDoctor && myDoctor ? myDoctor.id : selectedDoctorId || undefined,
      status: statusFilter,
    }

    if (viewMode === 'week') {
      query.startDate = weekDays[0]?.dateStr
      query.endDate = weekDays[6]?.dateStr
    } else {
      query.startDate = currentDate
      query.endDate = currentDate
    }

    void scheduleGateway
      .listSchedules(query, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setSchedules(data)
          setError(null)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(scheduleMessage(err))
          setLoading(false)
        }
      })

    return () => controller.abort()
  }, [
    isDoctor,
    myDoctor,
    selectedDoctorId,
    statusFilter,
    viewMode,
    weekDays,
    currentDate,
    reloadToken,
  ])

  // Fetch slots for day view if a doctor is selected
  useEffect(() => {
    const docId = isDoctor && myDoctor ? myDoctor.id : selectedDoctorId
    if (viewMode !== 'day' || !docId) {
      return
    }

    const controller = new AbortController()

    void scheduleGateway
      .listDoctorSlots(docId, currentDate, controller.signal)
      .then((slots) => {
        if (!controller.signal.aborted) {
          setDoctorSlots(slots)
          setLoadingSlots(false)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDoctorSlots([])
          setLoadingSlots(false)
        }
      })

    return () => controller.abort()
  }, [viewMode, currentDate, selectedDoctorId, isDoctor, myDoctor, reloadToken])

  // Clear success notification after 5s
  useEffect(() => {
    if (!success) return
    const timer = setTimeout(() => setSuccess(null), 5000)
    return () => clearTimeout(timer)
  }, [success])

  // Handlers for Schedule Editor
  const handleOpenCreate = (forDate?: string) => {
    setEditingSchedule(null)
    setEditorDate(forDate || currentDate)
    setEditorOpen(true)
  }

  const handleOpenEdit = (schedule: DoctorSchedule) => {
    setEditingSchedule(schedule)
    setEditorDate(undefined)
    setEditorOpen(true)
  }

  const handleSaveSchedule = async (draft: ScheduleDraft, editId?: string) => {
    if (editId) {
      await scheduleGateway.updateSchedule(editId, draft)
      setSuccess('Cập nhật ca làm việc thành công.')
    } else {
      await scheduleGateway.createSchedule(draft)
      setSuccess('Thêm ca làm việc mới thành công.')
    }
    setReloadToken((c) => c + 1)
  }

  // Handlers for Block Dialog
  const handleOpenBlock = (schedule: DoctorSchedule) => {
    setBlockingSchedule(schedule)
    setBlockDialogOpen(true)
  }

  const handleConfirmBlock = async (id: string, reason?: string) => {
    await scheduleGateway.blockSchedule(id, reason)
    setSuccess('Đã khóa ca làm việc thành công.')
    setReloadToken((c) => c + 1)
  }

  const handleRetry = () => {
    setLoading(true)
    setError(null)
    setReloadToken((c) => c + 1)
  }

  return (
    <div className="space-y-6">
      {/* Header section */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Lịch làm việc bác sĩ
            </h1>
            <Badge
              variant="outline"
              className="text-xs px-2 py-0.5 border-primary/30 text-primary bg-primary/5"
            >
              {role === 'ADMIN'
                ? 'Quản trị viên'
                : role === 'RECEPTIONIST'
                  ? 'Lễ tân'
                  : role === 'DOCTOR'
                    ? 'Bác sĩ'
                    : 'Bệnh nhân'}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Quản lý ca trực, phân bổ phòng khám và theo dõi lịch làm việc theo
            giờ Việt Nam (UTC+7).
          </p>
        </div>

        {canManage && (
          <Button
            type="button"
            onClick={() => handleOpenCreate()}
            className="gap-2 shadow-xs"
          >
            <Plus className="size-4" aria-hidden="true" />
            <span>Thêm ca làm việc</span>
          </Button>
        )}
      </div>

      {/* Toast Alert for Success / Error */}
      {success && (
        <Alert className="border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200">
          <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
          <AlertDescription className="font-medium">{success}</AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert className="border-destructive/40 bg-destructive/10 text-destructive">
          <AlertCircle className="size-4" />
          <AlertDescription className="font-medium flex items-center justify-between">
            <span>{error}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleRetry}
              className="h-7 text-xs ml-2"
            >
              <RefreshCw className="size-3 mr-1" /> Thử lại
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Filter and Control Bar */}
      <Card className="p-4 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            {/* Doctor Filter */}
            <div className="flex items-center gap-2">
              <Stethoscope
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
              {isDoctor ? (
                <div className="text-xs font-semibold px-2.5 py-1.5 rounded-md bg-muted border text-foreground">
                  Lịch của tôi: {myDoctor?.fullName || user?.fullName}
                </div>
              ) : (
                <select
                  value={selectedDoctorId}
                  onChange={(e) => setSelectedDoctorId(e.target.value)}
                  className="rounded-md border border-input bg-background px-3 py-1.5 text-xs shadow-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Lọc theo bác sĩ"
                >
                  <option value="">-- Tất cả bác sĩ --</option>
                  {doctors.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.fullName} ({doc.doctorCode || `ID ${doc.id}`}
                      {doc.specialtyName ? ` - ${doc.specialtyName}` : ''})
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Status Filter */}
            <div className="flex items-center gap-2">
              <Filter
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
              <select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(
                    e.target.value as 'ALL' | 'ACTIVE' | 'BLOCKED',
                  )
                }
                className="rounded-md border border-input bg-background px-3 py-1.5 text-xs shadow-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Lọc theo trạng thái ca"
              >
                <option value="ALL">Tất cả trạng thái</option>
                <option value="ACTIVE">ACTIVE (Mở ca)</option>
                <option value="BLOCKED">BLOCKED (Đã khóa)</option>
              </select>
            </div>
          </div>

          {/* Timezone label */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="size-3.5" aria-hidden="true" />
            <span>Múi giờ: Asia/Ho_Chi_Minh (UTC+7)</span>
          </div>
        </div>
      </Card>

      {/* Loading Skeleton or Calendar Grid */}
      {loading ? (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-8 w-32" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <Card key={i} className="p-3 min-h-[300px] space-y-2">
                <Skeleton className="h-6 w-20" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <CalendarView
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          currentDate={currentDate}
          onCurrentDateChange={setCurrentDate}
          weekDays={weekDays}
          schedules={schedules}
          canManage={canManage}
          isPatient={isPatient}
          doctorSlots={doctorSlots}
          loadingSlots={loadingSlots}
          onEditSchedule={handleOpenEdit}
          onBlockSchedule={handleOpenBlock}
          onAddScheduleForDate={handleOpenCreate}
        />
      )}

      {/* Schedule Editor Modal (Create / Edit) */}
      <ScheduleEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        initialSchedule={editingSchedule}
        doctors={doctors}
        selectedDate={editorDate}
        selectedDoctorId={
          isDoctor && myDoctor ? myDoctor.id : selectedDoctorId || undefined
        }
        isDoctorRole={isDoctor}
        onSave={handleSaveSchedule}
      />

      {/* Block Confirmation Dialog */}
      <BlockScheduleDialog
        schedule={blockingSchedule}
        open={blockDialogOpen}
        onOpenChange={setBlockDialogOpen}
        onConfirm={handleConfirmBlock}
      />
    </div>
  )
}
