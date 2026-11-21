import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Layers2,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Stethoscope,
} from 'lucide-react'
import { useAuth } from '@/auth/context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { directoryGateway } from '@/directory/gateway'
import type { Doctor } from '@/directory/model'
import { scheduleGateway } from '@/schedule/gateway'
import {
  formatVnDateFull,
  formatVnTimeRange,
  fromUtcIsoToVnParts,
  getVnTodayString,
  type ScheduleSlot,
} from '@/schedule/model'
import { bookingGateway } from '@/booking/gateway'
import {
  appointmentStatusLabels,
  bookingMessage,
  generateRequestKey,
  validateBookingDraft,
  type Appointment,
  type BookingDraft,
} from '@/booking/model'

export default function BookingPage() {
  const { user } = useAuth()
  const role = user?.role || 'PATIENT'
  const isReceptionist = role === 'RECEPTIONIST'

  // Wizard Step: 1: Chuyên khoa -> 2: Bác sĩ -> 3: Ngày & Giờ -> 4: Xác nhận -> 5: Thành công
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4 | 5>(1)

  // Step 1: Specialties
  const [specialties, setSpecialties] = useState<
    { id: string; name: string; code: string; description?: string }[]
  >([])
  const [loadingSpecialties, setLoadingSpecialties] = useState(true)
  const [selectedSpecialtyId, setSelectedSpecialtyId] = useState<string>('')

  // Step 2: Doctors
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [loadingDoctors, setLoadingDoctors] = useState(false)
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('')

  // Step 3: Date & Slots
  const todayStr = useMemo(() => getVnTodayString(), [])
  const [selectedDate, setSelectedDate] = useState<string>(todayStr)
  const [slots, setSlots] = useState<ScheduleSlot[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<ScheduleSlot | null>(null)

  // Step 4: Reason & Patient Info & RequestKey
  const [reason, setReason] = useState<string>('')
  const [patientIdInput, setPatientIdInput] = useState<string>('')
  const [requestKey, setRequestKey] = useState<string>(() =>
    generateRequestKey(),
  )
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [bookingError, setBookingError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  // Step 5: Completed Appointment
  const [bookedAppointment, setBookedAppointment] =
    useState<Appointment | null>(null)

  // Load active specialties on mount
  useEffect(() => {
    const controller = new AbortController()
    void directoryGateway
      .specialtyOptions(controller.signal, true)
      .then((data) => {
        if (!controller.signal.aborted) {
          setSpecialties(data)
          setLoadingSpecialties(false)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoadingSpecialties(false)
        }
      })
    return () => controller.abort()
  }, [])

  // Load doctors when specialty is selected
  useEffect(() => {
    if (!selectedSpecialtyId) return

    const controller = new AbortController()
    void directoryGateway
      .listDoctors(
        {
          search: '',
          page: 0,
          pageSize: 50,
          active: 'active',
          specialtyId: selectedSpecialtyId,
        },
        controller.signal,
      )
      .then((res) => {
        if (!controller.signal.aborted) {
          // Only active doctors
          setDoctors(res.items.filter((d) => d.active))
          setLoadingDoctors(false)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDoctors([])
          setLoadingDoctors(false)
        }
      })

    return () => controller.abort()
  }, [selectedSpecialtyId])

  // Load slots when doctor and date are chosen
  useEffect(() => {
    if (!selectedDoctorId || !selectedDate) return

    const controller = new AbortController()

    void scheduleGateway
      .listDoctorSlots(selectedDoctorId, selectedDate, controller.signal)
      .then((rawSlots) => {
        if (!controller.signal.aborted) {
          const nowMs = Date.now()
          // Filter only AVAILABLE slots and slots not in the past
          const availableSlots = rawSlots.filter((s) => {
            if (s.status !== 'AVAILABLE') return false
            const slotStartMs = new Date(s.startsAt).getTime()
            if (selectedDate === todayStr && slotStartMs <= nowMs) {
              return false
            }
            return true
          })
          setSlots(availableSlots)
          setLoadingSlots(false)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setSlots([])
          setLoadingSlots(false)
        }
      })

    return () => controller.abort()
  }, [selectedDoctorId, selectedDate, todayStr])

  // Quick Date Select Options (Today, Tomorrow, Day after tomorrow)
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

  // Selected Object references
  const selectedSpecialty = useMemo(
    () => specialties.find((s) => s.id === selectedSpecialtyId),
    [specialties, selectedSpecialtyId],
  )
  const selectedDoctor = useMemo(
    () => doctors.find((d) => d.id === selectedDoctorId),
    [doctors, selectedDoctorId],
  )

  // Handlers for Navigation Steps
  const handleSelectSpecialty = (id: string) => {
    setSelectedSpecialtyId(id)
    setSelectedDoctorId('')
    setDoctors([])
    setLoadingDoctors(true)
    setSelectedSlot(null)
    setSlots([])
    setCurrentStep(2)
  }

  const handleSelectDoctor = (id: string) => {
    setSelectedDoctorId(id)
    setSelectedSlot(null)
    setSlots([])
    setLoadingSlots(true)
    setCurrentStep(3)
  }

  const handleDateChange = (newDate: string) => {
    setSelectedDate(newDate)
    setSelectedSlot(null)
    setSlots([])
    setLoadingSlots(true)
  }

  const handleSelectSlot = (slot: ScheduleSlot) => {
    setSelectedSlot(slot)
    setRequestKey(generateRequestKey())
    setBookingError(null)
  }

  const handleProceedToConfirm = () => {
    if (!selectedSlot) return
    setFieldErrors({})
    setBookingError(null)
    setCurrentStep(4)
  }

  const handleOpenConfirmDialog = () => {
    if (!selectedSlot) return

    const draft: BookingDraft = {
      specialtyId: selectedSpecialtyId,
      doctorId: selectedDoctorId,
      date: selectedDate,
      slot: selectedSlot,
      reason,
      patientId: isReceptionist ? patientIdInput.trim() : undefined,
      requestKey,
    }

    const errs = validateBookingDraft(draft)
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs)
      return
    }

    setConfirmOpen(true)
  }

  const handleConfirmSubmit = async () => {
    if (!selectedSlot) return
    setSubmitting(true)
    setBookingError(null)

    const draft: BookingDraft = {
      specialtyId: selectedSpecialtyId,
      doctorId: selectedDoctorId,
      date: selectedDate,
      slot: selectedSlot,
      reason,
      patientId: isReceptionist ? patientIdInput.trim() : undefined,
      requestKey, // Idempotency key retained on retry!
    }

    try {
      const result = await bookingGateway.bookAppointment(draft)
      setBookedAppointment(result)
      setConfirmOpen(false)
      setCurrentStep(5)
    } catch (err: unknown) {
      setConfirmOpen(false)
      setBookingError(bookingMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  const handleResetBooking = () => {
    setSelectedSpecialtyId('')
    setSelectedDoctorId('')
    setSelectedSlot(null)
    setReason('')
    setPatientIdInput('')
    setBookingError(null)
    setFieldErrors({})
    setBookedAppointment(null)
    setRequestKey(generateRequestKey())
    setCurrentStep(1)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="border-primary/30 text-primary bg-primary/5 text-xs px-2 py-0.5"
          >
            {isReceptionist
              ? 'Đặt lịch tại quầy tiếp đón'
              : 'Khu vực bệnh nhân'}
          </Badge>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl mt-1">
          Đặt lịch khám
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Quy trình đặt lịch tiêu chuẩn: Chọn chuyên khoa $\rightarrow$ Bác sĩ
          $\rightarrow$ Thời gian $\rightarrow$ Xác nhận.
        </p>
      </div>

      {/* Progress Stepper */}
      <div className="flex items-center justify-between max-w-2xl border rounded-lg p-3 bg-muted/40 text-xs font-medium">
        <div
          className={`flex items-center gap-1.5 ${
            currentStep >= 1
              ? 'text-primary font-semibold'
              : 'text-muted-foreground'
          }`}
        >
          <span className="flex size-5 items-center justify-center rounded-full bg-primary/20 text-[11px]">
            1
          </span>
          <span>Chuyên khoa</span>
        </div>
        <ArrowRight
          className="size-3 text-muted-foreground"
          aria-hidden="true"
        />

        <div
          className={`flex items-center gap-1.5 ${
            currentStep >= 2
              ? 'text-primary font-semibold'
              : 'text-muted-foreground'
          }`}
        >
          <span className="flex size-5 items-center justify-center rounded-full bg-primary/20 text-[11px]">
            2
          </span>
          <span>Bác sĩ</span>
        </div>
        <ArrowRight
          className="size-3 text-muted-foreground"
          aria-hidden="true"
        />

        <div
          className={`flex items-center gap-1.5 ${
            currentStep >= 3
              ? 'text-primary font-semibold'
              : 'text-muted-foreground'
          }`}
        >
          <span className="flex size-5 items-center justify-center rounded-full bg-primary/20 text-[11px]">
            3
          </span>
          <span>Ngày & Giờ</span>
        </div>
        <ArrowRight
          className="size-3 text-muted-foreground"
          aria-hidden="true"
        />

        <div
          className={`flex items-center gap-1.5 ${
            currentStep >= 4
              ? 'text-primary font-semibold'
              : 'text-muted-foreground'
          }`}
        >
          <span className="flex size-5 items-center justify-center rounded-full bg-primary/20 text-[11px]">
            4
          </span>
          <span>Xác nhận</span>
        </div>
      </div>

      {/* STEP 1: CHỌN CHUYÊN KHOA */}
      {currentStep === 1 && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center gap-2 border-b pb-3">
            <Layers2 className="size-5 text-primary" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-foreground">
              Bước 1: Lựa chọn chuyên khoa
            </h2>
          </div>

          {loadingSpecialties ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-lg" />
              ))}
            </div>
          ) : specialties.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Hiện chưa có chuyên khoa nào khả dụng để đặt lịch.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {specialties.map((spec) => (
                <button
                  key={spec.id}
                  type="button"
                  onClick={() => handleSelectSpecialty(spec.id)}
                  className={`flex flex-col items-start p-4 rounded-xl border text-left transition-all hover:border-primary hover:shadow-xs ${
                    selectedSpecialtyId === spec.id
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-border bg-card'
                  }`}
                >
                  <div className="flex items-center justify-between w-full mb-1">
                    <span className="font-semibold text-foreground text-sm">
                      {spec.name}
                    </span>
                    {spec.code?.trim() ? (
                      <Badge variant="secondary" className="text-[10px]">
                        {spec.code.trim()}
                      </Badge>
                    ) : null}
                  </div>
                  {spec.description?.trim() ? (
                    <span className="text-xs text-muted-foreground line-clamp-2">
                      {spec.description.trim()}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* STEP 2: CHỌN BÁC SĨ */}
      {currentStep === 2 && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between border-b pb-3">
            <div className="flex items-center gap-2">
              <Stethoscope className="size-5 text-primary" aria-hidden="true" />
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  Bước 2: Chọn bác sĩ phụ trách
                </h2>
                <p className="text-xs text-muted-foreground">
                  Chuyên khoa đã chọn:{' '}
                  <strong className="text-foreground">
                    {selectedSpecialty?.name}
                  </strong>
                </p>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCurrentStep(1)}
              className="gap-1 text-xs"
            >
              <ChevronLeft className="size-3.5" aria-hidden="true" />
              <span>Đổi chuyên khoa</span>
            </Button>
          </div>

          {loadingDoctors ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-28 w-full rounded-lg" />
              ))}
            </div>
          ) : doctors.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Không có bác sĩ khả dụng nào thuộc chuyên khoa này. Vui lòng chọn
              chuyên khoa khác.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {doctors.map((doc) => (
                <div
                  key={doc.id}
                  className={`flex flex-col justify-between p-4 rounded-xl border transition-all ${
                    selectedDoctorId === doc.id
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-border bg-card'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-foreground text-sm">
                        {doc.fullName}
                      </h3>
                      {doc.doctorCode?.trim() ? (
                        <Badge variant="outline" className="text-[10px]">
                          {doc.doctorCode.trim()}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-xs text-primary font-medium">
                      {doc.specialtyName}
                    </p>
                    {doc.biography && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                        {doc.biography}
                      </p>
                    )}
                  </div>

                  <div className="pt-3 flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleSelectDoctor(doc.id)}
                      className="gap-1.5 text-xs"
                    >
                      <span>Chọn bác sĩ</span>
                      <ArrowRight className="size-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* STEP 3: CHỌN NGÀY VÀ GIỜ KHÁM (SLOTS) */}
      {currentStep === 3 && (
        <Card className="p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b pb-3 gap-2">
            <div>
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Calendar className="size-5 text-primary" aria-hidden="true" />
                <span>Bước 3: Chọn ngày và khung giờ khám</span>
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Bác sĩ:{' '}
                <strong className="text-foreground">
                  {selectedDoctor?.fullName}
                </strong>{' '}
                ({selectedSpecialty?.name})
              </p>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCurrentStep(2)}
              className="gap-1 text-xs self-start sm:self-auto"
            >
              <ChevronLeft className="size-3.5" aria-hidden="true" />
              <span>Đổi bác sĩ</span>
            </Button>
          </div>

          {/* Date Selection */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-foreground">
              1. Chọn ngày khám:
            </Label>
            <div className="flex flex-wrap items-center gap-2">
              {quickDates.map((q) => (
                <Button
                  key={q.dateStr}
                  type="button"
                  variant={selectedDate === q.dateStr ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleDateChange(q.dateStr)}
                  className="text-xs h-8"
                >
                  {q.label} ({q.dateStr.slice(5)})
                </Button>
              ))}

              <div className="flex items-center gap-1.5 ml-2">
                <Input
                  type="date"
                  min={todayStr}
                  value={selectedDate}
                  onChange={(e) => handleDateChange(e.target.value)}
                  className="h-8 text-xs w-36"
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Ngày đã chọn: {formatVnDateFull(selectedDate)} (Giờ Việt Nam
              UTC+7).
            </p>
          </div>

          {/* Slots Selection */}
          <div className="space-y-2 pt-2 border-t">
            <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Clock
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
              <span>2. Chọn khung giờ khám còn trống (Slots):</span>
            </Label>

            {loadingSlots ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-md" />
                ))}
              </div>
            ) : slots.length === 0 ? (
              <div className="p-8 text-center rounded-lg border border-dashed text-muted-foreground text-xs space-y-1">
                <Clock
                  className="size-8 text-muted-foreground/50 mx-auto mb-2"
                  aria-hidden="true"
                />
                <p className="font-medium text-foreground">
                  Không có khung giờ trống trong ngày này
                </p>
                <p>
                  Bác sĩ không có lịch làm việc hoặc tất cả các slot đã được đặt
                  trước. Vui lòng chọn ngày khác.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                {slots.map((slot) => {
                  const isSelected = selectedSlot?.startsAt === slot.startsAt
                  return (
                    <button
                      key={slot.id || slot.startsAt}
                      type="button"
                      onClick={() => handleSelectSlot(slot)}
                      className={`flex flex-col items-center justify-center p-2.5 rounded-lg border text-xs transition-all ${
                        isSelected
                          ? 'border-primary bg-primary text-primary-foreground font-semibold shadow-xs ring-2 ring-primary ring-offset-1'
                          : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200 hover:border-emerald-500 hover:bg-emerald-500/20'
                      }`}
                    >
                      <span className="font-bold">
                        {formatVnTimeRange(slot.startsAt, slot.endsAt)}
                      </span>
                      {slot.roomLabel?.trim() ? (
                        <span className="text-[10px] opacity-80 mt-0.5">
                          {slot.roomLabel.trim()}
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Continue button */}
          <div className="flex items-center justify-between pt-4 border-t">
            <span className="text-xs text-muted-foreground">
              {selectedSlot ? (
                <>
                  Khung giờ đã chọn:{' '}
                  <strong className="text-foreground">
                    {formatVnTimeRange(
                      selectedSlot.startsAt,
                      selectedSlot.endsAt,
                    )}
                  </strong>
                </>
              ) : (
                'Vui lòng nhấp chọn một khung giờ khám ở trên.'
              )}
            </span>

            <Button
              type="button"
              disabled={!selectedSlot}
              onClick={handleProceedToConfirm}
              className="gap-1.5"
            >
              <span>Tiếp tục xác nhận</span>
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </Card>
      )}

      {/* STEP 4: XÁC NHẬN THÔNG TIN & GỬI ĐẶT LỊCH */}
      {currentStep === 4 && selectedSlot && (
        <Card className="p-6 space-y-5">
          <div className="flex items-center justify-between border-b pb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-foreground">
                Bước 4: Kiểm tra và xác nhận lịch hẹn
              </h2>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCurrentStep(3)}
              className="gap-1 text-xs"
            >
              <ChevronLeft className="size-3.5" aria-hidden="true" />
              <span>Chọn lại giờ</span>
            </Button>
          </div>

          {/* Error Alert if 409 or other error */}
          {bookingError && (
            <Alert className="border-destructive/50 bg-destructive/10 text-destructive">
              <AlertCircle className="size-4" />
              <AlertDescription className="font-medium flex flex-col gap-1.5">
                <span>{bookingError}</span>
                {bookingError.includes('409') && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentStep(3)}
                    className="w-fit text-xs h-7"
                  >
                    Quay lại chọn khung giờ khác
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Summary Card */}
          <div className="rounded-xl border bg-muted/30 p-4 space-y-3 text-sm">
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Chuyên khoa:</span>
              <span className="font-medium text-foreground">
                {selectedSpecialty?.name}
              </span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Bác sĩ phụ trách:</span>
              <span className="font-medium text-foreground">
                {selectedDoctor?.fullName}
              </span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Ngày khám:</span>
              <span className="font-medium text-foreground">
                {formatVnDateFull(selectedDate)}
              </span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Khung giờ:</span>
              <span className="font-bold text-primary">
                {formatVnTimeRange(selectedSlot.startsAt, selectedSlot.endsAt)}{' '}
                (Asia/Ho_Chi_Minh)
              </span>
            </div>
            {selectedSlot.roomLabel && (
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Địa điểm / Phòng:</span>
                <span className="font-medium text-foreground">
                  {selectedSlot.roomLabel}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Bệnh nhân:</span>
              <span className="font-medium text-foreground">
                {isReceptionist
                  ? patientIdInput
                    ? `Bệnh nhân ID #${patientIdInput}`
                    : 'Đặt hộ tại quầy'
                  : user?.fullName || 'Hồ sơ của bạn'}
              </span>
            </div>
          </div>

          {/* Receptionist patientId Input */}
          {isReceptionist && (
            <div className="space-y-1.5">
              <Label htmlFor="booking-patient-id">
                ID Bệnh nhân được đặt hộ (Hành chính) *
              </Label>
              <Input
                id="booking-patient-id"
                placeholder="Nhập ID bệnh nhân (chuỗi số BIGINT, VD: 10)"
                value={patientIdInput}
                onChange={(e) => setPatientIdInput(e.target.value)}
              />
              {fieldErrors.patientId && (
                <p className="text-xs text-destructive">
                  {fieldErrors.patientId}
                </p>
              )}
            </div>
          )}

          {/* Reason input */}
          <div className="space-y-1.5">
            <Label htmlFor="booking-reason">
              Lý do khám / Triệu chứng ban đầu (tùy chọn)
            </Label>
            <Input
              id="booking-reason"
              placeholder="VD: Khám định kỳ, kiểm tra huyết áp, đau đầu..."
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            {fieldErrors.reason && (
              <p className="text-xs text-destructive">{fieldErrors.reason}</p>
            )}
            <p className="text-[11px] text-muted-foreground">
              Tối đa 500 ký tự. Thông tin giúp bác sĩ chuẩn bị tốt hơn trước
              buổi khám.
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCurrentStep(3)}
              disabled={submitting}
            >
              Quay lại
            </Button>
            <Button
              type="button"
              onClick={handleOpenConfirmDialog}
              disabled={submitting}
              className="gap-2"
            >
              <span>Xác nhận & Đặt lịch</span>
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </Card>
      )}

      {/* CONFIRMATION DIALOG */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md" closeDisabled={submitting}>
          <div className="flex items-center gap-3 text-primary">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <CheckCircle2 className="size-5" aria-hidden="true" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold text-foreground">
                Xác nhận đặt lịch khám
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Vui lòng kiểm tra lại thông tin trước khi hoàn tất đăng ký.
              </DialogDescription>
            </div>
          </div>

          <div className="my-4 space-y-2 rounded-lg border bg-muted/40 p-3.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Bác sĩ:</span>
              <span className="font-semibold text-foreground">
                {selectedDoctor?.fullName}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Thời gian:</span>
              <span className="font-semibold text-foreground">
                {selectedSlot &&
                  formatVnTimeRange(selectedSlot.startsAt, selectedSlot.endsAt)}
                , ngày {selectedDate}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Chuyên khoa:</span>
              <span className="font-medium text-foreground">
                {selectedSpecialty?.name}
              </span>
            </div>
          </div>

          <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-md text-[11px] text-amber-800 dark:text-amber-200">
            Lưu ý: Quý khách vui lòng có mặt tại quầy tiếp đón trước giờ hẹn 15
            phút để hoàn tất thủ tục khám.
          </div>

          <div className="flex items-center justify-end gap-2 pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmOpen(false)}
              disabled={submitting}
            >
              Kiểm tra lại
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleConfirmSubmit}
              disabled={submitting}
              className="gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  <span>Đang xử lý...</span>
                </>
              ) : (
                <span>Đồng ý & Đặt lịch</span>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* STEP 5: ĐẶT LỊCH THÀNH CÔNG */}
      {currentStep === 5 && bookedAppointment && (
        <Card className="p-8 text-center max-w-xl mx-auto space-y-6">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 mx-auto">
            <CheckCircle2 className="size-8" aria-hidden="true" />
          </div>

          <div className="space-y-1">
            <h2 className="text-2xl font-bold text-foreground">
              Đặt lịch khám thành công!
            </h2>
            <p className="text-sm text-muted-foreground">
              Thông tin cuộc hẹn của bạn đã được ghi nhận vào hệ thống phòng
              khám.
            </p>
          </div>

          {/* Appointment Code Card */}
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-2">
            <span className="text-xs text-muted-foreground">
              Mã cuộc hẹn của bạn:
            </span>
            <div className="text-2xl font-black text-primary tracking-wider font-mono">
              {bookedAppointment.appointmentCode}
            </div>
            <Badge
              variant="outline"
              className="text-xs border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10"
            >
              {appointmentStatusLabels[bookedAppointment.status] ||
                bookedAppointment.status}
            </Badge>
          </div>

          {/* Details breakdown */}
          <div className="rounded-lg border p-4 text-xs space-y-2 text-left bg-muted/20">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Bác sĩ:</span>
              <span className="font-semibold text-foreground">
                {bookedAppointment.doctorName}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Chuyên khoa:</span>
              <span className="font-medium text-foreground">
                {bookedAppointment.specialtyName}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                Thời gian khám (VN):
              </span>
              <span className="font-bold text-foreground">
                {formatVnTimeRange(
                  bookedAppointment.startAt,
                  bookedAppointment.endAt,
                )}
                , ngày {fromUtcIsoToVnParts(bookedAppointment.startAt).date}
              </span>
            </div>
            {bookedAppointment.roomLabel && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Phòng khám:</span>
                <span className="font-medium text-foreground">
                  {bookedAppointment.roomLabel}
                </span>
              </div>
            )}
            {bookedAppointment.reason && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Lý do khám:</span>
                <span className="text-foreground">
                  {bookedAppointment.reason}
                </span>
              </div>
            )}
          </div>

          <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleResetBooking}
              className="gap-2 w-full sm:w-auto"
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              <span>Đặt lịch khám khác</span>
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}
