import { useEffect, useState } from 'react'
import {
  Calendar,
  IdCard,
  MapPin,
  Phone,
  ShieldCheck,
  User,
} from 'lucide-react'
import { DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { LoadingState } from '@/components/page-states'
import {
  patientMessage,
  sexLabels,
  type Patient,
  type PatientGateway,
} from '@/patient/model'
import { PatientEditor } from './editor'

export function PatientRecord({
  patientId,
  gateway,
  edit,
  onSaved,
  onBusy,
}: {
  patientId: string
  gateway: PatientGateway
  edit: boolean
  onSaved: () => void
  onBusy: (busy: boolean) => void
}) {
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<{
    attempt: number
    item: Patient | null
    error: string | null
  } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void gateway
      .getPatient(patientId, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted)
          setResult({ attempt: retry, item: value, error: null })
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({
            attempt: retry,
            item: null,
            error: patientMessage(error),
          })
      })
    return () => controller.abort()
  }, [patientId, gateway, retry])

  if (!result || result.attempt !== retry) {
    return (
      <>
        <DialogTitle>Đang tải hồ sơ bệnh nhân</DialogTitle>
        <DialogDescription className="sr-only">
          Đang lấy thông tin chi tiết của bệnh nhân.
        </DialogDescription>
        <LoadingState />
      </>
    )
  }

  if (result.error || !result.item) {
    return (
      <>
        <DialogTitle>Không thể mở hồ sơ</DialogTitle>
        <DialogDescription className="mt-3 text-destructive" role="alert">
          {result.error}
        </DialogDescription>
        <Button className="mt-4" onClick={() => setRetry((value) => value + 1)}>
          Thử lại
        </Button>
      </>
    )
  }

  if (edit) {
    return (
      <PatientEditor
        patient={result.item}
        gateway={gateway}
        onSaved={onSaved}
        onBusy={onBusy}
      />
    )
  }

  const patient = result.item

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-3 pr-8">
          <DialogTitle className="text-xl font-semibold break-words">
            {patient.fullName}
          </DialogTitle>
          <Badge variant={patient.active ? 'default' : 'secondary'}>
            {patient.active ? 'Đang hoạt động' : 'Ngừng hoạt động'}
          </Badge>
        </div>
        <DialogDescription className="mt-1.5 flex items-center gap-2 text-sm text-muted-foreground">
          <span className="font-mono font-medium text-foreground">
            {patient.patientCode}
          </span>
          {gateway.mode === 'mock' && ' · DEMO'}
        </DialogDescription>
      </div>

      <div className="grid gap-4 rounded-xl border bg-card/50 p-4 text-sm sm:grid-cols-2">
        <div className="flex items-start gap-3">
          <User
            className="mt-0.5 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <div>
            <p className="text-xs text-muted-foreground">Giới tính</p>
            <p className="font-medium">{sexLabels[patient.sex]}</p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Calendar
            className="mt-0.5 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <div>
            <p className="text-xs text-muted-foreground">Ngày sinh</p>
            <p className="font-medium">
              {patient.dateOfBirth || 'Chưa cập nhật'}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Phone
            className="mt-0.5 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <div>
            <p className="text-xs text-muted-foreground">Số điện thoại</p>
            <p className="font-medium">{patient.phone || 'Chưa cập nhật'}</p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <IdCard
            className="mt-0.5 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <div>
            <p className="text-xs text-muted-foreground">Tài khoản liên kết</p>
            <p className="font-medium">
              {patient.userId ? (
                <span className="font-mono text-primary">
                  ID #{patient.userId}
                </span>
              ) : (
                'Chưa liên kết'
              )}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 sm:col-span-2">
          <MapPin
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <div>
            <p className="text-xs text-muted-foreground">Địa chỉ</p>
            <p className="font-medium break-words">
              {patient.address || 'Chưa cập nhật địa chỉ'}
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
        <span>Hồ sơ bệnh nhân được lưu trữ bảo mật theo quy định y tế.</span>
      </div>
    </div>
  )
}
