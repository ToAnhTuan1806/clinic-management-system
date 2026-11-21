import { useState } from 'react'
import { AlertTriangle, Loader2, Lock } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  formatVnDateFull,
  formatVnTimeRange,
  type DoctorSchedule,
} from '@/schedule/model'

interface BlockScheduleDialogProps {
  schedule: DoctorSchedule | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (id: string, reason?: string) => Promise<void>
}

export function BlockScheduleDialog({
  schedule,
  open,
  onOpenChange,
  onConfirm,
}: BlockScheduleDialogProps) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!schedule) return null

  const handleBlock = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onConfirm(schedule.id, reason)
      setReason('')
      onOpenChange(false)
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Không thể khóa ca làm việc. Vui lòng thử lại.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" closeDisabled={busy}>
        <div className="flex items-center gap-3 text-amber-600 dark:text-amber-400">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/50">
            <AlertTriangle className="size-5" aria-hidden="true" />
          </div>
          <div>
            <DialogTitle className="text-lg font-semibold text-foreground">
              Xác nhận khóa ca làm việc
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Hành động này sẽ tạm khóa khung giờ làm việc của bác sĩ.
            </DialogDescription>
          </div>
        </div>

        <div className="my-4 space-y-3 rounded-lg border bg-muted/40 p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Bác sĩ:</span>
            <span className="font-medium text-foreground">
              {schedule.doctorName || `Bác sĩ ${schedule.doctorId}`}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Ngày:</span>
            <span className="font-medium text-foreground">
              {formatVnDateFull(schedule.startsAt)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Thời gian (VN):</span>
            <span className="font-medium text-foreground">
              {formatVnTimeRange(schedule.startsAt, schedule.endsAt)}
            </span>
          </div>
          {schedule.roomLabel && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Phòng khám:</span>
              <span className="font-medium text-foreground">
                {schedule.roomLabel}
              </span>
            </div>
          )}
        </div>

        <div className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 rounded-md border border-amber-200 dark:border-amber-900">
          Lưu ý: Khi ca làm việc bị khóa (BLOCKED), bệnh nhân sẽ không thể đăng
          ký lịch khám mới trong khung giờ này.
        </div>

        <form onSubmit={handleBlock} className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="block-reason">Lý do khóa ca (không bắt buộc)</Label>
            <Input
              id="block-reason"
              placeholder="VD: Bác sĩ bận hội chẩn đột xuất, nghỉ phép..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
              maxLength={200}
            />
          </div>

          {error && (
            <div className="text-xs font-medium text-destructive" role="alert">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Hủy bỏ
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={busy}
              className="gap-2"
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  <span>Đang xử lý...</span>
                </>
              ) : (
                <>
                  <Lock className="size-4" aria-hidden="true" />
                  <span>Xác nhận khóa ca</span>
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
