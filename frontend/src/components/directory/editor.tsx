import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { LoaderCircle } from 'lucide-react'
import { useSubmission } from '@/auth/use-submission'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  codeRule,
  nameRule,
  validId,
  DirectoryError,
  directoryMessage,
  type DirectoryGateway,
  type DirectoryItem,
  type DirectoryKind,
  type DoctorDraft,
  type SpecialtyDraft,
  type DoctorUser,
  type Page,
  type Specialty,
} from '@/directory/model'

export const selectClass =
  'h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-foreground disabled:opacity-50'
type Values = DoctorDraft & SpecialtyDraft
export function DirectoryEditor({
  kind,
  item,
  gateway,
  onSaved,
  onBusy,
}: {
  kind: DirectoryKind
  item?: DirectoryItem
  gateway: DirectoryGateway
  onSaved: () => void
  onBusy: (busy: boolean) => void
}) {
  const doctors = kind === 'doctors'
  const doctor = item && 'doctorCode' in item ? item : undefined
  const specialty = item && 'code' in item ? item : undefined
  const form = useForm<Values>({
    defaultValues: {
      code: specialty?.code ?? '',
      name: specialty?.name ?? '',
      description: specialty?.description ?? '',
      doctorCode: doctor?.doctorCode ?? '',
      licenseNumber: doctor?.licenseNumber ?? '',
      userId: doctor?.userId ?? '',
      specialtyId: doctor?.specialtyId ?? '',
      biography: doctor?.biography ?? '',
    },
  })
  const { pending, run } = useSubmission()
  const [lookup, setLookup] = useState<{
    key: string
    specialties: Specialty[]
    users: Page<DoctorUser>
    error: string | null
  } | null>(null)
  const [candidateQuery, setCandidateQuery] = useState({
    search: '',
    page: 0,
    pageSize: 20,
  })
  const [chosenUser, setChosenUser] = useState<DoctorUser | null>(null)
  const [error, setError] = useState<string | null>(null)
  const feedback = useRef<HTMLDivElement>(null)
  const [retry, setRetry] = useState(0)
  const lookupKey = JSON.stringify([retry, candidateQuery])
  const options = lookup?.key === lookupKey ? lookup : null
  const loaded = !doctors || (!!options && !options.error)
  useEffect(() => {
    onBusy(pending)
    return () => onBusy(false)
  }, [pending, onBusy])
  useEffect(() => {
    if (error && !pending) feedback.current?.focus()
  }, [error, pending])
  useEffect(() => {
    if (!doctors) return
    const controller = new AbortController()
    void Promise.all([
      gateway.specialtyOptions(controller.signal, true),
      doctor
        ? Promise.resolve({ items: [], page: 0, pageSize: 20, total: 0 })
        : gateway.doctorUsers(controller.signal, candidateQuery),
    ])
      .then(([specialties, users]) => {
        if (!controller.signal.aborted)
          setLookup({
            key: lookupKey,
            specialties: specialties.filter((value) => value.active),
            users,
            error: null,
          })
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setLookup({
            key: lookupKey,
            specialties: [],
            users: { items: [], page: 0, pageSize: 20, total: 0 },
            error: directoryMessage(failure),
          })
      })
    return () => controller.abort()
  }, [doctors, doctor, gateway, lookupKey, candidateQuery])
  const textField = (
    name:
      | 'code'
      | 'name'
      | 'description'
      | 'doctorCode'
      | 'licenseNumber'
      | 'biography',
    label: string,
    max: number,
    area = false,
  ) => (
    <FormField
      key={name}
      control={form.control}
      name={name}
      rules={{
        validate: (value) =>
          name === 'code' || name === 'doctorCode'
            ? codeRule(value)
            : name === 'name'
              ? nameRule(value)
              : value.length <= max || `Tối đa ${max} ký tự.`,
      }}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            {area ? (
              <textarea
                {...field}
                maxLength={max}
                className="min-h-28 w-full rounded-lg border border-input bg-background p-3 text-sm"
              />
            ) : (
              <Input
                {...field}
                maxLength={max}
                className="h-11"
                autoComplete="off"
              />
            )}
          </FormControl>
          <FormMessage role="alert" />
        </FormItem>
      )}
    />
  )
  const candidates = options?.users.items ?? []
  const choices =
    chosenUser && !candidates.some((value) => value.id === chosenUser.id)
      ? [chosenUser, ...candidates]
      : candidates
  return (
    <>
      <DialogTitle className="pr-8 text-xl font-semibold">
        {item ? 'Chỉnh sửa' : 'Thêm'} {doctors ? 'bác sĩ' : 'chuyên khoa'}
      </DialogTitle>
      <DialogDescription className="mt-2 text-sm text-muted-foreground">
        {gateway.mode === 'mock'
          ? 'DEMO · Thay đổi chỉ trong bộ nhớ kiểm thử, không gửi Backend.'
          : 'Kiểm tra thông tin trước khi lưu.'}
      </DialogDescription>
      {options?.error && (
        <Alert role="alert" className="mt-5">
          <AlertDescription>
            {options.error}
            <Button
              type="button"
              variant="outline"
              onClick={() => setRetry((value) => value + 1)}
            >
              Tải lại lựa chọn
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {doctors && !options && (
        <p role="status" className="mt-5 text-sm text-muted-foreground">
          Đang tải chuyên khoa và tài khoản bác sĩ…
        </p>
      )}
      <Form {...form}>
        <form
          noValidate
          aria-busy={pending}
          className="mt-6 space-y-5"
          onSubmit={(event) => {
            event.preventDefault()
            void run(async (signal) => {
              await form.handleSubmit(async (values) => {
                setError(null)
                try {
                  if (doctors)
                    await gateway.saveDoctor(
                      item?.id,
                      {
                        userId: values.userId,
                        specialtyId: values.specialtyId,
                        doctorCode: values.doctorCode,
                        licenseNumber: values.licenseNumber,
                        biography: values.biography,
                      },
                      signal,
                    )
                  else
                    await gateway.saveSpecialty(
                      item?.id,
                      {
                        code: values.code,
                        name: values.name,
                        description: values.description,
                      },
                      signal,
                    )
                  if (!signal.aborted) onSaved()
                } catch (failure) {
                  if (signal.aborted) return
                  setError(directoryMessage(failure))
                  if (failure instanceof DirectoryError) {
                    for (const [key, message] of Object.entries(failure.fields))
                      form.setError(key as keyof Values, {
                        type: 'server',
                        message,
                      })
                    if (
                      ['USER_ALREADY_LINKED', 'USER_NOT_ELIGIBLE'].includes(
                        failure.code,
                      )
                    ) {
                      setChosenUser(null)
                      form.setValue('userId', '')
                      setRetry((value) => value + 1)
                    }
                  }
                }
              })()
            })
          }}
        >
          <fieldset disabled={pending} className="space-y-5">
            {doctors ? (
              <>
                {!doctor && (
                  <div className="space-y-2">
                    <Label htmlFor="eligible-search">
                      Tìm tài khoản bác sĩ
                    </Label>
                    <Input
                      id="eligible-search"
                      type="search"
                      maxLength={120}
                      className="h-11"
                      placeholder="Họ tên hoặc email…"
                      value={candidateQuery.search}
                      onChange={(event) =>
                        setCandidateQuery((current) => ({
                          ...current,
                          search: event.target.value,
                          page: 0,
                        }))
                      }
                    />
                  </div>
                )}
                <FormField
                  control={form.control}
                  name="userId"
                  rules={{
                    validate: (value) =>
                      !!doctor ||
                      validId(value) ||
                      'Vui lòng chọn tài khoản bác sĩ hợp lệ.',
                  }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tài khoản bác sĩ</FormLabel>
                      <FormControl>
                        <select
                          {...field}
                          className={selectClass}
                          disabled={!!doctor || !loaded}
                          onChange={(event) => {
                            field.onChange(event)
                            setChosenUser(
                              choices.find(
                                (value) => value.id === event.target.value,
                              ) ?? null,
                            )
                          }}
                        >
                          <option value="">Chọn tài khoản DOCTOR</option>
                          {doctor ? (
                            <option value={doctor.userId}>
                              {doctor.fullName}
                            </option>
                          ) : (
                            choices.map((value) => (
                              <option key={value.id} value={value.id}>
                                {value.fullName}
                                {value.email ? ` · ${value.email}` : ''}
                              </option>
                            ))
                          )}
                        </select>
                      </FormControl>
                      <p className="text-xs text-muted-foreground">
                        {doctor
                          ? 'Tài khoản đã liên kết, không thể thay đổi.'
                          : 'Chỉ tài khoản DOCTOR ACTIVE chưa có hồ sơ bác sĩ.'}
                      </p>
                      <FormMessage role="alert" />
                      {options && !doctor && !options.users.items.length && (
                        <p role="status" className="text-sm">
                          Không có tài khoản bác sĩ khả dụng. Cần tài khoản
                          DOCTOR ACTIVE chưa liên kết.
                        </p>
                      )}
                    </FormItem>
                  )}
                />
                {!doctor && options && (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <p role="status">
                      {options.users.total} tài khoản · Trang{' '}
                      {candidateQuery.page + 1}/
                      {Math.max(
                        1,
                        Math.ceil(
                          options.users.total / candidateQuery.pageSize,
                        ),
                      )}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        aria-label="Tài khoản trang trước"
                        disabled={!loaded || candidateQuery.page === 0}
                        onClick={() =>
                          setCandidateQuery((current) => ({
                            ...current,
                            page: current.page - 1,
                          }))
                        }
                      >
                        Trước
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        aria-label="Tài khoản trang sau"
                        disabled={
                          !loaded ||
                          (candidateQuery.page + 1) * candidateQuery.pageSize >=
                            options.users.total
                        }
                        onClick={() =>
                          setCandidateQuery((current) => ({
                            ...current,
                            page: current.page + 1,
                          }))
                        }
                      >
                        Sau
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setRetry((value) => value + 1)}
                      >
                        Tải lại lựa chọn
                      </Button>
                    </div>
                  </div>
                )}
                {textField('doctorCode', 'Mã bác sĩ', 32)}
                {textField('licenseNumber', 'Số giấy phép', 100)}
                <FormField
                  control={form.control}
                  name="specialtyId"
                  rules={{
                    validate: (value) =>
                      (validId(value) &&
                        (doctor?.specialtyId === value ||
                          !!options?.specialties.some(
                            (option) => option.id === value,
                          ))) ||
                      'Vui lòng chọn chuyên khoa đang hoạt động.',
                  }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Chuyên khoa</FormLabel>
                      <FormControl>
                        <select
                          {...field}
                          className={selectClass}
                          disabled={!loaded}
                        >
                          <option value="">
                            Chọn chuyên khoa đang hoạt động
                          </option>
                          {doctor &&
                            !options?.specialties.some(
                              (value) => value.id === doctor.specialtyId,
                            ) && (
                              <option value={doctor.specialtyId}>
                                {doctor.specialtyName} · Chuyên khoa hiện tại
                              </option>
                            )}
                          {options?.specialties.map((value) => (
                            <option key={value.id} value={value.id}>
                              {value.code} · {value.name}
                            </option>
                          ))}
                        </select>
                      </FormControl>
                      <FormMessage role="alert" />
                      {options && !options.specialties.length && (
                        <p role="status" className="text-sm">
                          Chưa có chuyên khoa hoạt động để tạo hoặc chuyển hồ
                          sơ.
                        </p>
                      )}
                    </FormItem>
                  )}
                />
                {textField('biography', 'Giới thiệu chuyên môn', 5000, true)}
              </>
            ) : (
              <>
                {textField('code', 'Mã chuyên khoa', 32)}
                {textField('name', 'Tên chuyên khoa', 120)}
                {textField('description', 'Mô tả', 5000, true)}
              </>
            )}
          </fieldset>
          {error && (
            <Alert
              ref={feedback}
              tabIndex={-1}
              variant="destructive"
              role="alert"
            >
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button
            type="submit"
            className="h-11 w-full"
            disabled={pending || !loaded || gateway.mode === 'pending'}
          >
            {pending && (
              <LoaderCircle
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            )}
            {pending ? 'Đang lưu…' : 'Lưu thông tin'}
          </Button>
        </form>
      </Form>
    </>
  )
}
