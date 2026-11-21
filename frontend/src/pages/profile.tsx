import { useEffect, useState } from 'react'
import {
  AlertCircle,
  Check,
  CheckCircle2,
  IdCard,
  Loader2,
  Lock,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  User,
  UserRound,
} from 'lucide-react'
import { useAuth } from '@/auth/context'
import { roleLabels } from '@/auth/types'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { EmptyState, LoadingState } from '@/components/page-states'
import { profileGateway } from '@/profile/gateway'
import {
  profileMessage,
  validateProfile,
  type ProfileDraft,
  type ProfileFieldErrors,
  type UserProfile,
} from '@/profile/model'
import { patientGateway } from '@/patient/gateway'
import { sexLabels, type Patient } from '@/patient/model'

export default function ProfilePage() {
  const { user, refreshUser } = useAuth()
  const isPatient = user?.role === 'PATIENT'

  const profileKey = JSON.stringify([user?.id, user?.role])
  const [profileResource, setProfileResource] = useState<{
    key: string
    data: UserProfile | null
    error: string | null
  } | null>(null)
  const loading = profileResource?.key !== profileKey
  const profile = !loading ? profileResource?.data : null
  const loadError = !loading ? profileResource?.error : null

  const patientKey = JSON.stringify([user?.id, user?.role, 'patient'])
  const [patientResource, setPatientResource] = useState<{
    key: string
    data: Patient | null
  } | null>(null)
  const patientLoading = isPatient && patientResource?.key !== patientKey
  const patientRecord = !patientLoading ? (patientResource?.data ?? null) : null

  const [draft, setDraft] = useState<ProfileDraft>({
    fullName: '',
    phone: '',
    address: '',
  })
  const [errors, setErrors] = useState<ProfileFieldErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Fetch User Profile
  useEffect(() => {
    const controller = new AbortController()

    void profileGateway
      .getProfile(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setProfileResource({
            key: profileKey,
            data,
            error: null,
          })
          setDraft({
            fullName: data.fullName,
            phone: data.phone,
            address: data.address,
          })
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setProfileResource({
            key: profileKey,
            data: null,
            error: profileMessage(err),
          })
        }
      })

    return () => controller.abort()
  }, [profileKey])

  // Fetch Linked Patient Profile for PATIENT role
  useEffect(() => {
    if (!isPatient) return
    const controller = new AbortController()

    void patientGateway
      .getMePatientProfile(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setPatientResource({
            key: patientKey,
            data,
          })
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setPatientResource({
            key: patientKey,
            data: null,
          })
        }
      })

    return () => controller.abort()
  }, [isPatient, patientKey])

  const handleChange = (field: keyof ProfileDraft, value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
    setSaveError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return

    const validationErrors = validateProfile(draft)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      const firstField = Object.keys(validationErrors)[0]
      document.getElementById(`profile-${firstField}`)?.focus()
      return
    }

    setSubmitting(true)
    setSaveSuccess(null)
    setSaveError(null)

    const controller = new AbortController()
    try {
      const updated = await profileGateway.updateProfile(
        draft,
        controller.signal,
      )
      setProfileResource({
        key: profileKey,
        data: updated,
        error: null,
      })
      setDraft({
        fullName: updated.fullName,
        phone: updated.phone,
        address: updated.address,
      })
      // Update session auth state so full name syncs across layout
      await refreshUser()
      setSaveSuccess('Hồ sơ cá nhân đã được cập nhật thành công.')
    } catch (err) {
      const msg = profileMessage(err)
      setSaveError(msg)
      if (err && typeof err === 'object' && 'fields' in err && err.fields) {
        setErrors(err.fields as ProfileFieldErrors)
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Badge variant="outline" className="mb-2 text-primary">
            TÀI KHOẢN NGƯỜI DÙNG
          </Badge>
          <h1 className="text-2xl font-semibold sm:text-3xl">Hồ sơ cá nhân</h1>
        </div>
        <LoadingState />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <Badge variant="outline" className="mb-2 text-primary">
          TÀI KHOẢN NGƯỜI DÙNG
        </Badge>
        <h1 className="text-2xl font-semibold sm:text-3xl">Hồ sơ cá nhân</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Quản lý thông tin định danh tài khoản và thông tin liên hệ của bạn.
        </p>
      </div>

      {/* Notifications */}
      {saveSuccess && (
        <Alert className="border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200">
          <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
          <AlertDescription className="font-medium">
            {saveSuccess}
          </AlertDescription>
        </Alert>
      )}

      {saveError && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      )}

      {loadError && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {/* Account Overview & Read-only Section */}
      <Card className="p-6 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b pb-6">
          <div className="flex items-center gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl border bg-primary/10 text-xl font-bold text-primary">
              {profile?.fullName
                ? profile.fullName.trim().charAt(0).toUpperCase()
                : 'U'}
            </div>
            <div>
              <h2 className="text-xl font-semibold">
                {profile?.fullName || user?.fullName}
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                {profile?.email || user?.email}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="px-3 py-1 font-medium">
              {user ? roleLabels[user.role] : 'Người dùng'}
            </Badge>
            <Badge
              variant={
                profile?.status === 'ACTIVE' || (!profile && user)
                  ? 'default'
                  : 'secondary'
              }
              className="px-3 py-1"
            >
              {profile?.status === 'ACTIVE' || (!profile && user)
                ? 'Đang hoạt động'
                : 'Đã khóa'}
            </Badge>
          </div>
        </div>

        {/* Read-only Identity Attributes */}
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Thông tin hệ thống (Chỉ đọc)
          </h3>
          <div className="grid gap-4 rounded-xl border bg-muted/20 p-4 text-sm sm:grid-cols-3">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Mail className="size-3.5" />
                <span>Email đăng nhập</span>
                <Lock className="size-3 text-muted-foreground/70" />
              </div>
              <p className="font-mono text-xs font-medium text-foreground truncate">
                {profile?.email || user?.email}
              </p>
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5" />
                <span>Vai trò</span>
                <Lock className="size-3 text-muted-foreground/70" />
              </div>
              <p className="font-medium text-foreground">
                {user ? roleLabels[user.role] : '—'}
              </p>
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <IdCard className="size-3.5" />
                <span>Mã người dùng (User ID)</span>
                <Lock className="size-3 text-muted-foreground/70" />
              </div>
              <p className="font-mono text-xs font-medium text-foreground">
                #{profile?.id || user?.id}
              </p>
            </div>
          </div>
        </div>

        {/* Editable Form */}
        <form onSubmit={handleSubmit} className="space-y-5 pt-2" noValidate>
          <div className="border-t pt-5">
            <h3 className="text-sm font-semibold text-foreground mb-4">
              Cập nhật thông tin liên hệ
            </h3>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="profile-fullName">
                  Họ và tên <span className="text-destructive">*</span>
                </Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="profile-fullName"
                    value={draft.fullName}
                    onChange={(e) => handleChange('fullName', e.target.value)}
                    placeholder="Nhập họ và tên đầy đủ"
                    disabled={submitting}
                    aria-invalid={Boolean(errors.fullName)}
                    className="pl-9"
                  />
                </div>
                {errors.fullName && (
                  <p
                    className="text-xs font-medium text-destructive"
                    role="alert"
                  >
                    {errors.fullName}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="profile-phone">Số điện thoại liên hệ</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="profile-phone"
                    type="tel"
                    value={draft.phone}
                    onChange={(e) => handleChange('phone', e.target.value)}
                    placeholder="VD: 0912345678"
                    disabled={submitting}
                    aria-invalid={Boolean(errors.phone)}
                    className="pl-9"
                  />
                </div>
                {errors.phone && (
                  <p
                    className="text-xs font-medium text-destructive"
                    role="alert"
                  >
                    {errors.phone}
                  </p>
                )}
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="profile-address">
                  Địa chỉ thường trú / liên hệ
                </Label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="profile-address"
                    value={draft.address}
                    onChange={(e) => handleChange('address', e.target.value)}
                    placeholder="Nhập địa chỉ của bạn"
                    disabled={submitting}
                    aria-invalid={Boolean(errors.address)}
                    className="pl-9"
                  />
                </div>
                {errors.address && (
                  <p
                    className="text-xs font-medium text-destructive"
                    role="alert"
                  >
                    {errors.address}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between border-t pt-4">
            <p className="text-xs text-muted-foreground">
              Mật khẩu không được cập nhật qua hồ sơ cá nhân.
            </p>
            <Button
              type="submit"
              disabled={submitting}
              className="min-w-32 gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  <span>Đang lưu…</span>
                </>
              ) : (
                <>
                  <Check className="size-4" aria-hidden="true" />
                  <span>Lưu thay đổi</span>
                </>
              )}
            </Button>
          </div>
        </form>
      </Card>

      {/* Linked Patient Profile (Shown exclusively for PATIENT role) */}
      {isPatient && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between border-b pb-4">
            <div className="flex items-center gap-2.5">
              <UserRound className="size-5 text-primary" />
              <h2 className="font-semibold text-lg">
                Hồ sơ bệnh nhân tại phòng khám
              </h2>
            </div>
            {patientRecord && (
              <Badge variant={patientRecord.active ? 'default' : 'secondary'}>
                {patientRecord.active ? 'Đang hoạt động' : 'Ngừng hoạt động'}
              </Badge>
            )}
          </div>

          {patientLoading ? (
            <LoadingState />
          ) : patientRecord ? (
            <div className="grid gap-4 sm:grid-cols-2 text-sm pt-1">
              <div>
                <p className="text-xs text-muted-foreground">Mã bệnh nhân</p>
                <p className="font-mono font-semibold text-foreground mt-0.5">
                  {patientRecord.patientCode}
                </p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">
                  Họ và tên trong hồ sơ
                </p>
                <p className="font-medium text-foreground mt-0.5">
                  {patientRecord.fullName}
                </p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">Giới tính</p>
                <p className="font-medium text-foreground mt-0.5">
                  {sexLabels[patientRecord.sex]}
                </p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">Ngày sinh</p>
                <p className="font-medium text-foreground mt-0.5">
                  {patientRecord.dateOfBirth || 'Chưa cập nhật'}
                </p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">
                  Số điện thoại hồ sơ
                </p>
                <p className="font-medium text-foreground mt-0.5">
                  {patientRecord.phone || 'Chưa cập nhật'}
                </p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">Địa chỉ hồ sơ</p>
                <p className="font-medium text-foreground mt-0.5">
                  {patientRecord.address || 'Chưa cập nhật'}
                </p>
              </div>
            </div>
          ) : (
            <EmptyState
              title="Chưa có hồ sơ bệnh nhân liên kết"
              description="Tài khoản này chưa được liên kết với hồ sơ bệnh nhân. Hãy liên hệ bộ phận tiếp đón tại phòng khám khi đến khám bệnh để được liên kết hồ sơ định danh y tế."
              compact
            />
          )}
        </Card>
      )}
    </div>
  )
}
