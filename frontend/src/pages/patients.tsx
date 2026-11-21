import { useEffect, useRef, useState } from 'react'
import { AlertDialog } from 'radix-ui'
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  IdCard,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Power,
  Search,
  ShieldAlert,
  User,
} from 'lucide-react'
import { useAuth } from '@/auth/context'
import { useSubmission } from '@/auth/use-submission'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card } from '@/components/ui/card'
import { EmptyState, LoadingState } from '@/components/page-states'
import { patientGateway } from '@/patient/gateway'
import {
  canManagePatients,
  patientMessage,
  sexLabels,
  type Page,
  type Patient,
  type PatientQuery,
} from '@/patient/model'
import { PatientRecord } from '@/components/patient/record'
import { PatientEditor } from '@/components/patient/editor'

type ModalState =
  | { type: 'create' }
  | { type: 'edit'; patientId: string }
  | { type: 'details'; patientId: string }
  | { type: 'status'; patient: Patient }

const initialQuery: PatientQuery = {
  search: '',
  page: 0,
  pageSize: 10,
  active: 'all',
}

export default function PatientsPage() {
  const { user } = useAuth()
  const manage = canManagePatients(user)
  const isPatient = user?.role === 'PATIENT'
  const isDoctor = user?.role === 'DOCTOR'

  // --- State for ADMIN / RECEPTIONIST ---
  const [query, setQuery] = useState<PatientQuery>(initialQuery)
  const [resource, setResource] = useState<{
    key: string
    data: Page<Patient> | null
    error: string | null
  } | null>(null)
  const [revision, setRevision] = useState(0)
  const [modal, setModal] = useState<ModalState | null>(null)
  const [busy, setBusy] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const { pending: changing, run } = useSubmission()

  // --- State for PATIENT self ---
  const selfKey = JSON.stringify([isPatient, user?.id, revision])
  const [selfResource, setSelfResource] = useState<{
    key: string
    patient: Patient | null
    error: string | null
  } | null>(null)
  const selfLoading = isPatient && selfResource?.key !== selfKey
  const selfPatient = !selfLoading ? (selfResource?.patient ?? null) : null

  // Load patient's own profile if role is PATIENT
  useEffect(() => {
    if (!isPatient) return
    const controller = new AbortController()

    void patientGateway
      .getMePatientProfile(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setSelfResource({ key: selfKey, patient: data, error: null })
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setSelfResource({
            key: selfKey,
            patient: null,
            error: patientMessage(err),
          })
        }
      })

    return () => controller.abort()
  }, [isPatient, selfKey])

  // Load clinic-wide list if ADMIN or RECEPTIONIST
  const requestKey = JSON.stringify([query, revision, user?.id, user?.role])
  const loading = manage && resource?.key !== requestKey
  const data = !loading ? resource?.data : null
  const error = !loading ? resource?.error : null

  useEffect(() => {
    if (!manage) return
    const controller = new AbortController()

    void patientGateway
      .listPatients(query, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        if (query.page > 0 && !result.items.length && result.total > 0) {
          setQuery((cur) => ({
            ...cur,
            page: Math.max(0, Math.ceil(result.total / cur.pageSize) - 1),
          }))
          return
        }
        setResource({
          key: requestKey,
          data: result,
          error: null,
        })
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          setResource({
            key: requestKey,
            data: null,
            error: patientMessage(failure),
          })
        }
      })

    return () => controller.abort()
  }, [manage, query, revision, user, requestKey])

  const openModal = (next: ModalState, trigger?: HTMLElement | null) => {
    returnFocus.current = trigger ?? (document.activeElement as HTMLElement)
    setMutationError(null)
    setModal(next)
  }

  const closeModal = () => {
    if (busy || changing) return
    setModal(null)
    setMutationError(null)
  }

  const restoreFocus = () => {
    returnFocus.current?.focus()
  }

  const handleSaved = () => {
    closeModal()
    setSuccess('Hồ sơ bệnh nhân đã được lưu thành công.')
    setRevision((r) => r + 1)
  }

  // Clear success notice after 5 seconds
  useEffect(() => {
    if (!success) return
    const timer = setTimeout(() => setSuccess(null), 5000)
    return () => clearTimeout(timer)
  }, [success])

  // =========================================================================
  // VIEW: DOCTOR
  // =========================================================================
  if (isDoctor) {
    return (
      <div className="space-y-6">
        <div>
          <Badge variant="outline" className="mb-2 text-primary">
            CHÍNH SÁCH BẢO MẬT & PHÂN CÔNG
          </Badge>
          <h1 className="text-2xl font-semibold sm:text-3xl">
            Quản lý bệnh nhân
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Thông tin và phạm vi truy cập hồ sơ bệnh nhân của bác sĩ.
          </p>
        </div>

        <Card className="p-6 border-amber-500/30 bg-amber-500/5">
          <div className="flex items-start gap-4">
            <ShieldAlert className="size-6 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-2">
              <h2 className="text-base font-semibold text-foreground">
                Chờ triển khai chính sách phân công (Assignment Policy)
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Hiện tại hệ thống chưa hỗ trợ chính sách phân công bệnh nhân cho
                Bác sĩ. Để bảo vệ dữ liệu y tế cá nhân theo quy định bảo mật,
                Bác sĩ không thể xem danh sách toàn bộ bệnh nhân phòng khám.
              </p>
              <p className="text-xs text-muted-foreground pt-1">
                Quyền xem hồ sơ bệnh nhân sẽ được áp dụng tự động khi có lịch
                hẹn được phân công.
              </p>
            </div>
          </div>
        </Card>
      </div>
    )
  }

  // =========================================================================
  // VIEW: PATIENT
  // =========================================================================
  if (isPatient) {
    return (
      <div className="space-y-6">
        <div>
          <Badge variant="outline" className="mb-2 text-primary">
            HỒ SƠ Y TẾ CÁ NHÂN
          </Badge>
          <h1 className="text-2xl font-semibold sm:text-3xl">
            Hồ sơ bệnh nhân của tôi
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Thông tin định danh y tế được phòng khám cấp và quản lý.
          </p>
        </div>

        {selfLoading ? (
          <LoadingState />
        ) : selfPatient ? (
          <Card className="p-6 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
              <div>
                <h2 className="text-xl font-semibold">
                  {selfPatient.fullName}
                </h2>
                <p className="text-sm text-muted-foreground font-mono mt-1">
                  Mã bệnh nhân:{' '}
                  <span className="font-semibold text-foreground">
                    {selfPatient.patientCode}
                  </span>
                </p>
              </div>
              <Badge variant={selfPatient.active ? 'default' : 'secondary'}>
                {selfPatient.active ? 'Đang hoạt động' : 'Ngừng hoạt động'}
              </Badge>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="flex items-start gap-3">
                <User className="size-4 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground">Giới tính</p>
                  <p className="text-sm font-medium">
                    {sexLabels[selfPatient.sex]}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Calendar className="size-4 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground">Ngày sinh</p>
                  <p className="text-sm font-medium">
                    {selfPatient.dateOfBirth || 'Chưa cập nhật'}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Phone className="size-4 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground">
                    Số điện thoại liên hệ
                  </p>
                  <p className="text-sm font-medium">
                    {selfPatient.phone || 'Chưa cập nhật'}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <IdCard className="size-4 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground">
                    Tài khoản liên kết
                  </p>
                  <p className="text-sm font-medium font-mono text-primary">
                    ID #{selfPatient.userId}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 sm:col-span-2">
                <MapPin className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">
                    Địa chỉ thường trú
                  </p>
                  <p className="text-sm font-medium">
                    {selfPatient.address || 'Chưa cập nhật địa chỉ'}
                  </p>
                </div>
              </div>
            </div>

            <p className="text-xs text-muted-foreground border-t pt-4">
              Nếu thông tin có sai lệch, vui lòng liên hệ nhân viên tiếp đón tại
              phòng khám để điều chỉnh.
            </p>
          </Card>
        ) : (
          <Card className="p-8">
            <EmptyState
              title="Chưa có hồ sơ bệnh nhân liên kết"
              description="Tài khoản của bạn chưa được liên kết với hồ sơ bệnh nhân tại phòng khám. Vui lòng liên hệ quầy tiếp đón để được hỗ trợ tạo và liên kết hồ sơ y tế."
            />
          </Card>
        )}
      </div>
    )
  }

  // =========================================================================
  // VIEW: ADMIN & RECEPTIONIST
  // =========================================================================
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Badge variant="outline" className="mb-2 text-primary">
            QUẢN LÝ HỒ SƠ HÀNH CHÍNH
          </Badge>
          <h1 className="text-2xl font-semibold sm:text-3xl">
            Quản lý bệnh nhân
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Danh sách bệnh nhân, thông tin định danh và quản lý tiếp nhận tại
            phòng khám.
          </p>
        </div>

        {manage && (
          <Button
            onClick={(e) => openModal({ type: 'create' }, e.currentTarget)}
            className="h-11 gap-2 shadow-sm shrink-0"
          >
            <Plus className="size-4" aria-hidden="true" />
            <span>Thêm bệnh nhân</span>
          </Button>
        )}
      </div>

      {/* Success toast / alert */}
      {success && (
        <Alert className="border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200">
          <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
          <AlertDescription className="font-medium">{success}</AlertDescription>
        </Alert>
      )}

      {/* Search and Filters */}
      <Card className="p-4 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search
              className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query.search}
              onChange={(e) =>
                setQuery((cur) => ({ ...cur, search: e.target.value, page: 0 }))
              }
              placeholder="Tìm theo mã bệnh nhân, họ tên hoặc số điện thoại…"
              className="pl-9 h-11"
              aria-label="Tìm kiếm bệnh nhân"
            />
          </div>

          <div
            role="group"
            aria-label="Lọc theo trạng thái hoạt động"
            className="flex rounded-lg border bg-muted/40 p-1 shrink-0"
          >
            {(
              [
                { value: 'all', label: 'Tất cả' },
                { value: 'active', label: 'Hoạt động' },
                { value: 'inactive', label: 'Ngừng hoạt động' },
              ] as const
            ).map(({ value, label }) => (
              <Button
                key={value}
                type="button"
                variant={query.active === value ? 'default' : 'ghost'}
                size="sm"
                className="h-8 px-3 text-xs"
                onClick={() =>
                  setQuery((cur) => ({ ...cur, active: value, page: 0 }))
                }
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      {/* Main Content Area */}
      {loading ? (
        <LoadingState />
      ) : error ? (
        <Card className="p-6">
          <div className="flex items-center gap-3 text-destructive">
            <AlertCircle className="size-5 shrink-0" />
            <p className="text-sm font-medium">{error}</p>
          </div>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => setRevision((r) => r + 1)}
          >
            Thử lại
          </Button>
        </Card>
      ) : !data || data.items.length === 0 ? (
        <Card className="p-8">
          <EmptyState
            title="Không tìm thấy bệnh nhân nào"
            description={
              query.search
                ? `Không có kết quả nào phù hợp với từ khóa "${query.search}".`
                : 'Chưa có hồ sơ bệnh nhân nào trong danh mục.'
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0 border">
          {/* Table view for Desktop */}
          <div className="hidden md:block overflow-x-auto">
            <table
              className="w-full text-left text-sm"
              aria-label="Danh sách bệnh nhân"
            >
              <thead className="border-b bg-muted/50 text-xs font-medium text-muted-foreground">
                <tr>
                  <th scope="col" className="px-5 py-3.5">
                    Mã BN
                  </th>
                  <th scope="col" className="px-5 py-3.5">
                    Họ và tên
                  </th>
                  <th scope="col" className="px-5 py-3.5">
                    Giới tính
                  </th>
                  <th scope="col" className="px-5 py-3.5">
                    Ngày sinh
                  </th>
                  <th scope="col" className="px-5 py-3.5">
                    Điện thoại
                  </th>
                  <th scope="col" className="px-5 py-3.5">
                    Trạng thái
                  </th>
                  <th scope="col" className="px-5 py-3.5 text-right">
                    Thao tác
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.items.map((patient) => (
                  <tr
                    key={patient.id}
                    className="transition-colors hover:bg-muted/30"
                  >
                    <td className="px-5 py-3.5 font-mono text-xs font-medium">
                      {patient.patientCode}
                    </td>
                    <td className="px-5 py-3.5 font-medium">
                      {patient.fullName}
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground">
                      {sexLabels[patient.sex]}
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground">
                      {patient.dateOfBirth || '—'}
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground">
                      {patient.phone || '—'}
                    </td>
                    <td className="px-5 py-3.5">
                      <Badge variant={patient.active ? 'default' : 'secondary'}>
                        {patient.active ? 'Hoạt động' : 'Ngừng hoạt động'}
                      </Badge>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="size-8 p-0"
                          onClick={(e) =>
                            openModal(
                              { type: 'details', patientId: patient.id },
                              e.currentTarget,
                            )
                          }
                          aria-label={`Xem chi tiết ${patient.fullName}`}
                        >
                          <Eye className="size-4" aria-hidden="true" />
                        </Button>
                        {manage && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="size-8 p-0"
                              onClick={(e) =>
                                openModal(
                                  { type: 'edit', patientId: patient.id },
                                  e.currentTarget,
                                )
                              }
                              aria-label={`Chỉnh sửa ${patient.fullName}`}
                            >
                              <Pencil className="size-4" aria-hidden="true" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="size-8 p-0 text-muted-foreground hover:text-foreground"
                              onClick={(e) =>
                                openModal(
                                  { type: 'status', patient },
                                  e.currentTarget,
                                )
                              }
                              aria-label={`${patient.active ? 'Ngừng hoạt động' : 'Kích hoạt lại'} ${patient.fullName}`}
                            >
                              <Power className="size-4" aria-hidden="true" />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Card list view for Mobile */}
          <div className="divide-y divide-border md:hidden">
            {data.items.map((patient) => (
              <div key={patient.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{patient.fullName}</p>
                    <p className="text-xs font-mono text-muted-foreground mt-0.5">
                      {patient.patientCode}
                    </p>
                  </div>
                  <Badge variant={patient.active ? 'default' : 'secondary'}>
                    {patient.active ? 'Hoạt động' : 'Ngừng'}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div>
                    <span>Giới tính: </span>
                    <span className="font-medium text-foreground">
                      {sexLabels[patient.sex]}
                    </span>
                  </div>
                  <div>
                    <span>Ngày sinh: </span>
                    <span className="font-medium text-foreground">
                      {patient.dateOfBirth || '—'}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <span>SĐT: </span>
                    <span className="font-medium text-foreground">
                      {patient.phone || '—'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 h-9 gap-1.5 text-xs"
                    onClick={(e) =>
                      openModal(
                        { type: 'details', patientId: patient.id },
                        e.currentTarget,
                      )
                    }
                  >
                    <Eye className="size-3.5" aria-hidden="true" />
                    <span>Chi tiết</span>
                  </Button>
                  {manage && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 h-9 gap-1.5 text-xs"
                        onClick={(e) =>
                          openModal(
                            { type: 'edit', patientId: patient.id },
                            e.currentTarget,
                          )
                        }
                      >
                        <Pencil className="size-3.5" aria-hidden="true" />
                        <span>Sửa</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 px-2.5 text-xs"
                        onClick={(e) =>
                          openModal(
                            { type: 'status', patient },
                            e.currentTarget,
                          )
                        }
                        aria-label="Đổi trạng thái"
                      >
                        <Power className="size-3.5" aria-hidden="true" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Pagination Footer */}
          <div className="flex items-center justify-between border-t px-4 py-3 sm:px-6">
            <p className="text-xs text-muted-foreground">
              Tổng số{' '}
              <span className="font-medium text-foreground">{data.total}</span>{' '}
              bệnh nhân
              {data.totalPages && data.totalPages > 1 && (
                <span>
                  {' '}
                  · Trang {data.page + 1} / {data.totalPages}
                </span>
              )}
            </p>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={query.page <= 0}
                onClick={() =>
                  setQuery((cur) => ({ ...cur, page: cur.page - 1 }))
                }
                className="size-8 p-0"
                aria-label="Trang trước"
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  data.totalPages ? query.page + 1 >= data.totalPages : true
                }
                onClick={() =>
                  setQuery((cur) => ({ ...cur, page: cur.page + 1 }))
                }
                className="size-8 p-0"
                aria-label="Trang sau"
              >
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Detail / Create / Edit Modal */}
      <Dialog
        open={
          modal?.type === 'create' ||
          modal?.type === 'edit' ||
          modal?.type === 'details'
        }
        onOpenChange={closeModal}
      >
        {modal && modal.type !== 'status' && (
          <DialogContent
            closeDisabled={busy}
            onCloseAutoFocus={restoreFocus}
            onEscapeKeyDown={(e) => {
              if (busy) e.preventDefault()
            }}
            onInteractOutside={(e) => {
              if (busy) e.preventDefault()
            }}
          >
            {modal.type === 'create' ? (
              <PatientEditor
                gateway={patientGateway}
                onSaved={handleSaved}
                onBusy={setBusy}
              />
            ) : modal.type === 'edit' ? (
              <PatientRecord
                patientId={modal.patientId}
                gateway={patientGateway}
                edit={true}
                onSaved={handleSaved}
                onBusy={setBusy}
              />
            ) : (
              <PatientRecord
                patientId={modal.patientId}
                gateway={patientGateway}
                edit={false}
                onSaved={handleSaved}
                onBusy={setBusy}
              />
            )}
          </DialogContent>
        )}
      </Dialog>

      {/* Status Toggle Confirmation (No Hard Delete) */}
      <AlertDialog.Root
        open={modal?.type === 'status'}
        onOpenChange={closeModal}
      >
        {modal?.type === 'status' && (
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
            <AlertDialog.Content
              className="fixed top-1/2 left-1/2 z-50 max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border bg-popover p-6 text-popover-foreground shadow-xl"
              onCloseAutoFocus={restoreFocus}
            >
              <AlertDialog.Title className="text-xl font-semibold">
                {modal.patient.active
                  ? 'Ngừng hoạt động bệnh nhân?'
                  : 'Kích hoạt lại bệnh nhân?'}
              </AlertDialog.Title>
              <AlertDialog.Description className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {modal.patient.active
                  ? 'Bệnh nhân này sẽ được chuyển sang trạng thái ngừng hoạt động. Hồ sơ y tế và lịch sử khám bệnh được giữ nguyên hoàn toàn (không xóa vĩnh viễn).'
                  : 'Bệnh nhân này sẽ được kích hoạt lại để tiếp tục tiếp nhận khám bệnh.'}
              </AlertDialog.Description>

              <div className="mt-3 rounded-lg border bg-muted/30 p-3 text-sm">
                <p className="font-medium text-foreground">
                  {modal.patient.fullName}
                </p>
                <p className="text-xs font-mono text-muted-foreground mt-0.5">
                  Mã BN: {modal.patient.patientCode}
                </p>
              </div>

              {mutationError && (
                <p
                  role="alert"
                  className="mt-4 text-sm font-medium text-destructive"
                >
                  {mutationError}
                </p>
              )}

              <div className="mt-6 flex justify-end gap-3">
                <AlertDialog.Cancel asChild>
                  <Button
                    variant="outline"
                    className="h-11"
                    disabled={changing}
                  >
                    Hủy
                  </Button>
                </AlertDialog.Cancel>
                <Button
                  className="h-11"
                  disabled={changing}
                  onClick={() => {
                    if (modal.type !== 'status') return
                    void run(async (signal) => {
                      setMutationError(null)
                      try {
                        await patientGateway.setActive(
                          modal.patient.id,
                          !modal.patient.active,
                          signal,
                        )
                        closeModal()
                        setSuccess(
                          `Đã ${modal.patient.active ? 'ngừng hoạt động' : 'kích hoạt lại'} bệnh nhân thành công.`,
                        )
                        setRevision((r) => r + 1)
                      } catch (err) {
                        setMutationError(patientMessage(err))
                      }
                    })
                  }}
                >
                  {changing ? 'Đang xử lý…' : 'Xác nhận'}
                </Button>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        )}
      </AlertDialog.Root>
    </div>
  )
}
