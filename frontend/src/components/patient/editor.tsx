import { useState } from 'react'
import { AlertCircle, Check, Loader2 } from 'lucide-react'
import { DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  patientMessage,
  validatePatient,
  type Patient,
  type PatientDraft,
  type PatientFieldErrors,
  type PatientGateway,
  type Sex,
} from '@/patient/model'

export const selectClass =
  'h-11 w-full rounded-lg border border-input bg-background px-3 text-sm ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

export function PatientEditor({
  patient,
  gateway,
  onSaved,
  onBusy,
}: {
  patient?: Patient
  gateway: PatientGateway
  onSaved: () => void
  onBusy: (busy: boolean) => void
}) {
  const isEditing = Boolean(patient)

  const [draft, setDraft] = useState<PatientDraft>({
    patientCode: patient?.patientCode ?? '',
    fullName: patient?.fullName ?? '',
    dateOfBirth: patient?.dateOfBirth ?? '',
    sex: patient?.sex ?? 'FEMALE',
    phone: patient?.phone ?? '',
    address: patient?.address ?? '',
    userId: patient?.userId ?? '',
  })

  const [errors, setErrors] = useState<PatientFieldErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const handleChange = (field: keyof PatientDraft, value: string) => {
    setDraft((prev) => ({
      ...prev,
      [field]: field === 'patientCode' ? value.toUpperCase() : value,
    }))
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
    setServerError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return

    const validationErrors = validatePatient(draft)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      const firstField = Object.keys(validationErrors)[0]
      document.getElementById(`patient-field-${firstField}`)?.focus()
      return
    }

    setSubmitting(true)
    onBusy(true)
    setServerError(null)

    const controller = new AbortController()
    try {
      await gateway.savePatient(patient?.id, draft, controller.signal)
      onSaved()
    } catch (error) {
      const msg = patientMessage(error)
      setServerError(msg)
      if (
        error &&
        typeof error === 'object' &&
        'fields' in error &&
        error.fields
      ) {
        setErrors(error.fields as PatientFieldErrors)
      }
    } finally {
      setSubmitting(false)
      onBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div>
        <DialogTitle className="text-xl font-semibold">
          {isEditing ? 'Cập nhật hồ sơ bệnh nhân' : 'Thêm hồ sơ bệnh nhân mới'}
        </DialogTitle>
        <DialogDescription className="mt-1.5 text-sm text-muted-foreground">
          {isEditing
            ? 'Chỉnh sửa thông tin hành chính của bệnh nhân.'
            : 'Nhập thông tin ban đầu để tạo hồ sơ bệnh nhân tại phòng khám.'}
        </DialogDescription>
      </div>

      {serverError && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="patient-field-patientCode">
            Mã bệnh nhân <span className="text-destructive">*</span>
          </Label>
          <Input
            id="patient-field-patientCode"
            value={draft.patientCode}
            onChange={(e) => handleChange('patientCode', e.target.value)}
            placeholder="VD: BN000123"
            disabled={submitting}
            aria-invalid={Boolean(errors.patientCode)}
            className="font-mono uppercase"
          />
          {errors.patientCode && (
            <p className="text-xs font-medium text-destructive" role="alert">
              {errors.patientCode}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="patient-field-fullName">
            Họ và tên <span className="text-destructive">*</span>
          </Label>
          <Input
            id="patient-field-fullName"
            value={draft.fullName}
            onChange={(e) => handleChange('fullName', e.target.value)}
            placeholder="VD: Nguyễn Văn An"
            disabled={submitting}
            aria-invalid={Boolean(errors.fullName)}
          />
          {errors.fullName && (
            <p className="text-xs font-medium text-destructive" role="alert">
              {errors.fullName}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="patient-field-dateOfBirth">Ngày sinh</Label>
          <Input
            id="patient-field-dateOfBirth"
            type="date"
            value={draft.dateOfBirth}
            onChange={(e) => handleChange('dateOfBirth', e.target.value)}
            disabled={submitting}
            aria-invalid={Boolean(errors.dateOfBirth)}
          />
          {errors.dateOfBirth && (
            <p className="text-xs font-medium text-destructive" role="alert">
              {errors.dateOfBirth}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="patient-field-sex">Giới tính</Label>
          <select
            id="patient-field-sex"
            value={draft.sex}
            onChange={(e) => handleChange('sex', e.target.value as Sex)}
            disabled={submitting}
            className={selectClass}
          >
            <option value="FEMALE">Nữ</option>
            <option value="MALE">Nam</option>
            <option value="OTHER">Khác</option>
            <option value="UNKNOWN">Chưa xác định</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="patient-field-phone">Số điện thoại</Label>
          <Input
            id="patient-field-phone"
            type="tel"
            value={draft.phone}
            onChange={(e) => handleChange('phone', e.target.value)}
            placeholder="VD: 0912345678"
            disabled={submitting}
            aria-invalid={Boolean(errors.phone)}
          />
          {errors.phone && (
            <p className="text-xs font-medium text-destructive" role="alert">
              {errors.phone}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="patient-field-userId">
            ID tài khoản liên kết (tùy chọn)
          </Label>
          <Input
            id="patient-field-userId"
            value={draft.userId}
            onChange={(e) => handleChange('userId', e.target.value)}
            placeholder="VD: 10"
            disabled={submitting}
            aria-invalid={Boolean(errors.userId)}
          />
          {errors.userId && (
            <p className="text-xs font-medium text-destructive" role="alert">
              {errors.userId}
            </p>
          )}
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="patient-field-address">Địa chỉ</Label>
          <Input
            id="patient-field-address"
            value={draft.address}
            onChange={(e) => handleChange('address', e.target.value)}
            placeholder="VD: 123 Phố Huế, Hai Bà Trưng, Hà Nội"
            disabled={submitting}
            aria-invalid={Boolean(errors.address)}
          />
          {errors.address && (
            <p className="text-xs font-medium text-destructive" role="alert">
              {errors.address}
            </p>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="submit" disabled={submitting} className="min-w-28 gap-2">
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              <span>Đang lưu…</span>
            </>
          ) : (
            <>
              <Check className="size-4" aria-hidden="true" />
              <span>{isEditing ? 'Lưu thay đổi' : 'Tạo hồ sơ'}</span>
            </>
          )}
        </Button>
      </div>
    </form>
  )
}
