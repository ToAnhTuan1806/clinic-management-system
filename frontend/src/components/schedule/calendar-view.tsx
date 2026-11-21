import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  Edit2,
  Lock,
  MapPin,
  ShieldAlert,
  Stethoscope,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  formatVnDateFull,
  formatVnTimeRange,
  fromUtcIsoToVnParts,
  getVnTodayString,
  type DoctorSchedule,
  type ScheduleSlot,
  type WeekDayInfo,
} from '@/schedule/model'

interface CalendarViewProps {
  viewMode: 'week' | 'day'
  onViewModeChange: (mode: 'week' | 'day') => void
  currentDate: string // YYYY-MM-DD
  onCurrentDateChange: (date: string) => void
  weekDays: WeekDayInfo[]
  schedules: DoctorSchedule[]
  canManage: boolean
  isPatient: boolean
  doctorSlots?: ScheduleSlot[]
  loadingSlots?: boolean
  onEditSchedule?: (schedule: DoctorSchedule) => void
  onBlockSchedule?: (schedule: DoctorSchedule) => void
  onAddScheduleForDate?: (date: string) => void
}

export function CalendarView({
  viewMode,
  onViewModeChange,
  currentDate,
  onCurrentDateChange,
  weekDays,
  schedules,
  canManage,
  isPatient,
  doctorSlots = [],
  loadingSlots = false,
  onEditSchedule,
  onBlockSchedule,
  onAddScheduleForDate,
}: CalendarViewProps) {
  const todayStr = getVnTodayString()

  // Navigation handlers
  const handlePrev = () => {
    const [y, m, d] = currentDate.split('-').map(Number)
    const targetMs =
      Date.UTC(y, m - 1, d) - (viewMode === 'week' ? 7 : 1) * 86400000
    const next = new Date(targetMs)
    const nextStr = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`
    onCurrentDateChange(nextStr)
  }

  const handleNext = () => {
    const [y, m, d] = currentDate.split('-').map(Number)
    const targetMs =
      Date.UTC(y, m - 1, d) + (viewMode === 'week' ? 7 : 1) * 86400000
    const next = new Date(targetMs)
    const nextStr = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`
    onCurrentDateChange(nextStr)
  }

  const handleToday = () => {
    onCurrentDateChange(todayStr)
  }

  // Filter schedules by day
  const getSchedulesForDay = (dateStr: string) => {
    return schedules.filter((s) => {
      const { date } = fromUtcIsoToVnParts(s.startsAt)
      return date === dateStr
    })
  }

  return (
    <div className="space-y-4">
      {/* Calendar Header Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Navigation */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handlePrev}
            aria-label={viewMode === 'week' ? 'Tuần trước' : 'Ngày trước'}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleToday}
            className={currentDate === todayStr ? 'font-semibold' : ''}
          >
            Hôm nay
          </Button>

          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleNext}
            aria-label={viewMode === 'week' ? 'Tuần sau' : 'Ngày sau'}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>

          {/* Date Label */}
          <span className="text-sm font-medium text-foreground ml-2">
            {viewMode === 'week' ? (
              <>
                {weekDays[0]?.displayDate} - {weekDays[6]?.displayDate}/
                {weekDays[6]?.dateStr.slice(0, 4)}
              </>
            ) : (
              formatVnDateFull(currentDate)
            )}
          </span>
        </div>

        {/* View mode toggle */}
        <div className="flex items-center gap-1 rounded-lg border bg-muted/50 p-1">
          <button
            type="button"
            onClick={() => onViewModeChange('week')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              viewMode === 'week'
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Theo tuần
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('day')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              viewMode === 'day'
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Theo ngày
          </button>
        </div>
      </div>

      {/* Patient Notice Banner */}
      {isPatient && (
        <div className="flex items-start gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3.5 text-xs text-blue-900 dark:text-blue-200">
          <ShieldAlert
            className="size-4 shrink-0 text-blue-600 dark:text-blue-400 mt-0.5"
            aria-hidden="true"
          />
          <div>
            <span className="font-semibold">
              Chế độ xem lịch khám cho bệnh nhân:{' '}
            </span>
            Bạn có thể tra cứu ca làm việc và các khung giờ phục vụ của bác sĩ.
            Chức năng đặt lịch hẹn trực tuyến sẽ chính thức khả dụng tại phân hệ
            Đặt lịch khám (Sprint 2 - D07).
          </div>
        </div>
      )}

      {/* WEEK VIEW */}
      {viewMode === 'week' && (
        <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
          {weekDays.map((day) => {
            const daySchedules = getSchedulesForDay(day.dateStr)
            const isSelected = day.dateStr === currentDate

            return (
              <Card
                key={day.dateStr}
                className={`flex flex-col min-h-[360px] p-3 transition-colors ${
                  day.isToday
                    ? 'border-primary/50 bg-primary/5 shadow-xs'
                    : isSelected
                      ? 'border-border bg-card'
                      : 'bg-card/50'
                }`}
              >
                {/* Day Header */}
                <div className="flex items-center justify-between pb-2 mb-2 border-b">
                  <div
                    className="cursor-pointer"
                    onClick={() => {
                      onCurrentDateChange(day.dateStr)
                      onViewModeChange('day')
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-foreground">
                        {day.dayLabel}
                      </span>
                      {day.isToday && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1 py-0 h-4 bg-primary/20 text-primary border-primary/30"
                        >
                          Hôm nay
                        </Badge>
                      )}
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      {day.displayDate}
                    </span>
                  </div>

                  {canManage && onAddScheduleForDate && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-6 text-muted-foreground hover:text-foreground"
                      onClick={() => onAddScheduleForDate(day.dateStr)}
                      title={`Thêm ca trực ngày ${day.displayDate}`}
                      aria-label={`Thêm ca trực ngày ${day.displayDate}`}
                    >
                      <span className="text-base leading-none font-bold">
                        +
                      </span>
                    </Button>
                  )}
                </div>

                {/* Day Shifts */}
                <div className="flex-1 space-y-2 overflow-y-auto">
                  {daySchedules.length === 0 ? (
                    <div className="flex h-32 items-center justify-center text-center text-xs text-muted-foreground/70">
                      Không có ca trực
                    </div>
                  ) : (
                    daySchedules.map((schedule) => {
                      const isBlocked = schedule.status === 'BLOCKED'
                      return (
                        <div
                          key={schedule.id}
                          className={`group relative rounded-lg border p-2.5 text-xs transition-shadow hover:shadow-xs ${
                            isBlocked
                              ? 'border-red-500/30 bg-red-500/5 text-muted-foreground'
                              : 'border-emerald-500/30 bg-emerald-500/5 text-foreground'
                          }`}
                        >
                          {/* Status & Time */}
                          <div className="flex items-center justify-between gap-1 mb-1">
                            <span className="font-semibold text-foreground flex items-center gap-1">
                              <Clock
                                className="size-3 text-muted-foreground"
                                aria-hidden="true"
                              />
                              {formatVnTimeRange(
                                schedule.startsAt,
                                schedule.endsAt,
                              )}
                            </span>
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 h-4 font-medium ${
                                isBlocked
                                  ? 'border-red-500/40 text-red-600 dark:text-red-400 bg-red-500/10'
                                  : 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10'
                              }`}
                            >
                              {isBlocked ? (
                                <span className="flex items-center gap-0.5">
                                  <Lock
                                    className="size-2.5"
                                    aria-hidden="true"
                                  />{' '}
                                  Khóa
                                </span>
                              ) : (
                                'Mở ca'
                              )}
                            </Badge>
                          </div>

                          {/* Doctor info */}
                          <div className="font-medium text-foreground truncate">
                            {schedule.doctorName ||
                              `Bác sĩ ${schedule.doctorId}`}
                          </div>

                          {schedule.specialtyName && (
                            <div className="text-[11px] text-muted-foreground truncate">
                              {schedule.specialtyName}
                            </div>
                          )}

                          {/* Room & Slot info */}
                          <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                            {schedule.roomLabel && (
                              <span className="flex items-center gap-0.5 truncate max-w-[120px]">
                                <MapPin
                                  className="size-2.5 shrink-0"
                                  aria-hidden="true"
                                />
                                {schedule.roomLabel}
                              </span>
                            )}
                            <span className="rounded bg-muted px-1 py-0.5">
                              {schedule.slotDurationMinutes || 30}p/slot
                            </span>
                          </div>

                          {/* Action Buttons for Staff */}
                          {canManage && (
                            <div className="mt-2 flex items-center justify-end gap-1 border-t pt-1.5">
                              {onEditSchedule && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-6 text-muted-foreground hover:text-foreground"
                                  onClick={() => onEditSchedule(schedule)}
                                  title="Chỉnh sửa ca"
                                  aria-label="Chỉnh sửa ca làm việc"
                                >
                                  <Edit2
                                    className="size-3"
                                    aria-hidden="true"
                                  />
                                </Button>
                              )}
                              {!isBlocked && onBlockSchedule && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-6 text-amber-600 hover:text-amber-700 hover:bg-amber-500/10"
                                  onClick={() => onBlockSchedule(schedule)}
                                  title="Khóa ca này"
                                  aria-label="Khóa ca làm việc"
                                >
                                  <Lock className="size-3" aria-hidden="true" />
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* DAY VIEW */}
      {viewMode === 'day' && (
        <Card className="p-4 space-y-4">
          <div className="flex items-center justify-between border-b pb-3">
            <div>
              <h3 className="font-semibold text-foreground text-base">
                Lịch làm việc ngày {formatVnDateFull(currentDate)}
              </h3>
              <p className="text-xs text-muted-foreground">
                Tổng cộng {getSchedulesForDay(currentDate).length} ca trực được
                ghi nhận.
              </p>
            </div>
            {canManage && onAddScheduleForDate && (
              <Button
                type="button"
                size="sm"
                onClick={() => onAddScheduleForDate(currentDate)}
                className="gap-1.5"
              >
                <span>+ Thêm ca trực</span>
              </Button>
            )}
          </div>

          {/* List of Shifts for this Day */}
          <div className="space-y-3">
            {getSchedulesForDay(currentDate).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <CalendarIcon
                  className="size-10 text-muted-foreground/50 mb-2"
                  aria-hidden="true"
                />
                <p className="text-sm font-medium text-foreground">
                  Không có ca trực nào trong ngày này
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Vui lòng chọn ngày khác hoặc thêm ca làm việc mới.
                </p>
              </div>
            ) : (
              getSchedulesForDay(currentDate).map((schedule) => {
                const isBlocked = schedule.status === 'BLOCKED'
                return (
                  <div
                    key={schedule.id}
                    className={`flex flex-col sm:flex-row sm:items-center justify-between rounded-lg border p-4 gap-3 ${
                      isBlocked
                        ? 'border-red-500/30 bg-red-500/5'
                        : 'border-emerald-500/30 bg-emerald-500/5'
                    }`}
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-base font-bold text-foreground">
                          {formatVnTimeRange(
                            schedule.startsAt,
                            schedule.endsAt,
                          )}
                        </span>
                        <Badge
                          variant="outline"
                          className={
                            isBlocked
                              ? 'border-red-500/40 text-red-600 bg-red-500/10'
                              : 'border-emerald-500/40 text-emerald-700 bg-emerald-500/10'
                          }
                        >
                          {isBlocked ? 'ĐÃ KHÓA (BLOCKED)' : 'ĐANG MỞ (ACTIVE)'}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          {schedule.slotDurationMinutes || 30} phút/slot
                        </Badge>
                      </div>

                      <div className="flex items-center gap-2 text-sm text-foreground">
                        <Stethoscope
                          className="size-4 text-primary"
                          aria-hidden="true"
                        />
                        <span className="font-medium">
                          {schedule.doctorName || `Bác sĩ ${schedule.doctorId}`}
                        </span>
                        {schedule.specialtyName && (
                          <span className="text-muted-foreground">
                            • {schedule.specialtyName}
                          </span>
                        )}
                      </div>

                      {schedule.roomLabel && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <MapPin className="size-3.5" aria-hidden="true" />
                          <span>{schedule.roomLabel}</span>
                        </div>
                      )}
                    </div>

                    {/* Action buttons */}
                    {canManage && (
                      <div className="flex items-center gap-2 pt-2 sm:pt-0 border-t sm:border-t-0">
                        {onEditSchedule && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onEditSchedule(schedule)}
                            className="gap-1.5"
                          >
                            <Edit2 className="size-3.5" aria-hidden="true" />
                            <span>Chỉnh sửa</span>
                          </Button>
                        )}
                        {!isBlocked && onBlockSchedule && (
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() => onBlockSchedule(schedule)}
                            className="gap-1.5"
                          >
                            <Lock className="size-3.5" aria-hidden="true" />
                            <span>Khóa ca</span>
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>

          {/* Slots view for Day (if any slots are loaded) */}
          {(doctorSlots.length > 0 || loadingSlots) && (
            <div className="mt-6 border-t pt-4">
              <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <Clock className="size-4 text-primary" aria-hidden="true" />
                <span>Danh sách khung giờ khám (Slots) trong ngày:</span>
                {loadingSlots && (
                  <span className="text-xs font-normal text-muted-foreground animate-pulse">
                    (Đang tải...)
                  </span>
                )}
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                {doctorSlots.map((slot) => {
                  const isAvailable = slot.status === 'AVAILABLE'
                  const isSlotBlocked = slot.status === 'BLOCKED'
                  return (
                    <div
                      key={slot.id}
                      className={`rounded-md border p-2 text-center text-xs transition-colors ${
                        isAvailable
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                          : isSlotBlocked
                            ? 'border-muted bg-muted/40 text-muted-foreground opacity-60'
                            : 'border-blue-500/30 bg-blue-500/10 text-blue-800 dark:text-blue-200'
                      }`}
                    >
                      <div className="font-semibold">
                        {formatVnTimeRange(slot.startsAt, slot.endsAt)}
                      </div>
                      <div className="text-[10px] mt-0.5 font-medium">
                        {isAvailable
                          ? 'Còn trống'
                          : isSlotBlocked
                            ? 'Đã khóa'
                            : 'Đã đặt'}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
