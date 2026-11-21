import { useMemo, useState } from 'react'
import { Calendar, Clock, Loader2, Stethoscope } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  fromUtcIsoToVnParts,
  getVnTodayString,
  validateSchedule,
  type DoctorSchedule,
  type ScheduleDraft,
  type ScheduleStatus,
} from '@/schedule/model'

export interface DoctorOption {
  id: string
  fullName: string
  specialtyName?: string
  doctorCode?: string
}

interface ScheduleEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialSchedule?: DoctorSchedule | null
  doctors: DoctorOption[]
  selectedDate?: string
  selectedDoctorId?: string
  isDoctorRole?: boolean
  onSave: (draft: ScheduleDraft, editId?: string) => Promise<void>
}

interface ScheduleEditorFormProps {
  initialSchedule?: DoctorSchedule | null
  doctors: DoctorOption[]
  selectedDate?: string
  selectedDoctorId?: string
  isDoctorRole: boolean
  onCancel: () => void
  onSave: (draft: ScheduleDraft, editId?: string) => Promise<void>
}

function ScheduleEditorForm({
  initialSchedule,
  doctors,
  selectedDate,
  selectedDoctorId,
  isDoctorRole,
  onCancel,
  onSave,
}: ScheduleEditorFormProps) {
  const isEdit = Boolean(initialSchedule)

  const initialValues = useMemo(() => {
    if (initialSchedule) {
      const startParts = fromUtcIsoToVnParts(initialSchedule.startsAt)
      const endParts = fromUtcIsoToVnParts(initialSchedule.endsAt)
      return {
        doctorId: initialSchedule.doctorId,
        date: startParts.date,
        startTime: startParts.time,
        endTime: endParts.time,
        slotDurationMinutes:
          (initialSchedule.slotDurationMinutes as 15 | 30 | 60) || 30,
        roomLabel: initialSchedule.roomLabel || '',
        status: initialSchedule.status,
      }
    }
    return {
      doctorId: selectedDoctorId || doctors[0]?.id || '',
      date: selectedDate || getVnTodayString(),
      startTime: '08:00',
      endTime: '12:00',
      slotDurationMinutes: 30 as 15 | 30 | 60,
      roomLabel: '',
      status: 'ACTIVE' as ScheduleStatus,
    }
  }, [initialSchedule, doctors, selectedDate, selectedDoctorId])

  const [doctorId, setDoctorId] = useState(initialValues.doctorId)
  const [date, setDate] = useState(initialValues.date)
  const [startTime, setStartTime] = useState(initialValues.startTime)
  const [endTime, setEndTime] = useState(initialValues.endTime)
  const [slotDurationMinutes, setSlotDurationMinutes] = useState<15 | 30 | 60>(
    initialValues.slotDurationMinutes,
  )
  const [roomLabel, setRoomLabel] = useState(initialValues.roomLabel)
  const [status, setStatus] = useState<ScheduleStatus>(initialValues.status)

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const applyPreset = (start: string, end: string) => {
    setStartTime(start)
    setEndTime(end)
    setErrors((prev) => {
      const next = { ...prev }
      delete next.startTime
      delete next.endTime
      delete next.slotDurationMinutes
      return next
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setGlobalError(null)

    const draft: ScheduleDraft = {
      doctorId,
      date,
      startTime,
      endTime,
      status,
      roomLabel: roomLabel.trim() || undefined,
      slotDurationMinutes,
    }

    const fieldErrors = validateSchedule(draft)
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors)
      return
    }

    setBusy(true)
    try {
      await onSave(draft, initialSchedule?.id)
      onCancel()
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'message' in err) {
        setGlobalError(String(err.message))
      } else {
        setGlobalError('Đã xảy ra lỗi khi lưu ca làm việc. Vui lòng thử lại.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Calendar className="size-5" aria-hidden="true" />
        </div>
        <div>
          <DialogTitle className="text-lg font-semibold text-foreground">
            {isEdit ? 'Chỉnh sửa ca làm việc' : 'Thêm ca làm việc mới'}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {isEdit
              ? 'Cập nhật thời gian hoặc phòng khám cho ca làm việc của bác sĩ.'
              : 'Thiết lập ca trực theo giờ Việt Nam (UTC+7) cho bác sĩ.'}
          </DialogDescription>
        </div>
      </div>

      {globalError && (
        <div
          className="mt-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {globalError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        {/* Doctor selector */}
        <div className="space-y-1.5">
          <Label
            htmlFor="schedule-doctor"
            className="flex items-center gap-1.5"
          >
            <Stethoscope
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <span>Bác sĩ phụ trách *</span>
          </Label>
          {isDoctorRole ? (
            <Input
              id="schedule-doctor"
              value={
                doctors.find((d) => d.id === doctorId)?.fullName ||
                'Bác sĩ (Hồ sơ của bạn)'
              }
              disabled
              className="bg-muted"
            />
          ) : (
            <select
              id="schedule-doctor"
              value={doctorId}
              onChange={(e) => {
                setDoctorId(e.target.value)
                setErrors((prev) => ({ ...prev, doctorId: '' }))
              }}
              disabled={busy}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">-- Chọn bác sĩ --</option>
              {doctors.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.fullName} ({doc.doctorCode || `ID ${doc.id}`}
                  {doc.specialtyName ? ` - ${doc.specialtyName}` : ''})
                </option>
              ))}
            </select>
          )}
          {errors.doctorId && (
            <p className="text-xs text-destructive">{errors.doctorId}</p>
          )}
        </div>

        {/* Date picker */}
        <div className="space-y-1.5">
          <Label htmlFor="schedule-date" className="flex items-center gap-1.5">
            <Calendar
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <span>Ngày làm việc (VN) *</span>
          </Label>
          <Input
            id="schedule-date"
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value)
              setErrors((prev) => ({ ...prev, date: '' }))
            }}
            disabled={busy}
          />
          {errors.date && (
            <p className="text-xs text-destructive">{errors.date}</p>
          )}
        </div>

        {/* Time presets */}
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Chọn nhanh khung giờ:
          </span>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs h-7"
              onClick={() => applyPreset('08:00', '12:00')}
              disabled={busy}
            >
              Ca sáng (08:00 - 12:00)
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs h-7"
              onClick={() => applyPreset('13:30', '17:30')}
              disabled={busy}
            >
              Ca chiều (13:30 - 17:30)
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs h-7"
              onClick={() => applyPreset('18:00', '21:00')}
              disabled={busy}
            >
              Ca tối (18:00 - 21:00)
            </Button>
          </div>
        </div>

        {/* Start and End Time */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label
              htmlFor="schedule-start-time"
              className="flex items-center gap-1.5"
            >
              <Clock
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
              <span>Giờ bắt đầu *</span>
            </Label>
            <Input
              id="schedule-start-time"
              type="time"
              value={startTime}
              onChange={(e) => {
                setStartTime(e.target.value)
                setErrors((prev) => ({ ...prev, startTime: '' }))
              }}
              disabled={busy}
            />
            {errors.startTime && (
              <p className="text-xs text-destructive">{errors.startTime}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="schedule-end-time"
              className="flex items-center gap-1.5"
            >
              <Clock
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
              <span>Giờ kết thúc *</span>
            </Label>
            <Input
              id="schedule-end-time"
              type="time"
              value={endTime}
              onChange={(e) => {
                setEndTime(e.target.value)
                setErrors((prev) => ({ ...prev, endTime: '' }))
              }}
              disabled={busy}
            />
            {errors.endTime && (
              <p className="text-xs text-destructive">{errors.endTime}</p>
            )}
          </div>
        </div>

        {/* Slot Duration */}
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">
            Thời lượng mỗi slot khám *
          </Label>
          <div className="grid grid-cols-3 gap-2">
            {[15, 30, 60].map((slot) => (
              <button
                key={slot}
                type="button"
                onClick={() => {
                  setSlotDurationMinutes(slot as 15 | 30 | 60)
                  setErrors((prev) => ({ ...prev, slotDurationMinutes: '' }))
                }}
                disabled={busy}
                className={`flex flex-col items-center justify-center rounded-lg border p-2.5 text-center text-xs font-medium transition-colors ${
                  slotDurationMinutes === slot
                    ? 'border-primary bg-primary/10 text-primary font-semibold ring-1 ring-primary'
                    : 'border-input hover:bg-muted text-muted-foreground'
                }`}
              >
                <span className="text-sm">{slot} phút</span>
                <span className="text-[10px] opacity-80">
                  {slot === 15
                    ? 'Khám nhanh'
                    : slot === 30
                      ? 'Tiêu chuẩn'
                      : 'Chuyên sâu'}
                </span>
              </button>
            ))}
          </div>
          {errors.slotDurationMinutes && (
            <p className="text-xs text-destructive">
              {errors.slotDurationMinutes}
            </p>
          )}
        </div>

        {/* Room Label */}
        <div className="space-y-1.5">
          <Label htmlFor="schedule-room">Phòng khám / Địa điểm</Label>
          <Input
            id="schedule-room"
            placeholder="VD: Phòng 102 - Khoa Nội tổng quát"
            value={roomLabel}
            onChange={(e) => {
              setRoomLabel(e.target.value)
              setErrors((prev) => ({ ...prev, roomLabel: '' }))
            }}
            maxLength={64}
            disabled={busy}
          />
          {errors.roomLabel && (
            <p className="text-xs text-destructive">{errors.roomLabel}</p>
          )}
        </div>

        {/* Status */}
        <div className="space-y-1.5">
          <Label htmlFor="schedule-status">Trạng thái ca làm việc</Label>
          <select
            id="schedule-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as ScheduleStatus)}
            disabled={busy}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="ACTIVE">ACTIVE (Mở ca làm việc)</option>
            <option value="BLOCKED">BLOCKED (Tạm khóa ca)</option>
          </select>
        </div>

        {/* Form Actions */}
        <div className="flex items-center justify-end gap-2 pt-3">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={busy}
          >
            Hủy
          </Button>
          <Button type="submit" disabled={busy} className="gap-2">
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                <span>Đang lưu...</span>
              </>
            ) : (
              <span>{isEdit ? 'Lưu thay đổi' : 'Thêm ca làm việc'}</span>
            )}
          </Button>
        </div>
      </form>
    </>
  )
}

export function ScheduleEditorDialog({
  open,
  onOpenChange,
  initialSchedule,
  doctors,
  selectedDate,
  selectedDoctorId,
  isDoctorRole = false,
  onSave,
}: ScheduleEditorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {open && (
          <ScheduleEditorForm
            key={initialSchedule?.id || 'new'}
            initialSchedule={initialSchedule}
            doctors={doctors}
            selectedDate={selectedDate}
            selectedDoctorId={selectedDoctorId}
            isDoctorRole={isDoctorRole}
            onCancel={() => onOpenChange(false)}
            onSave={onSave}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
