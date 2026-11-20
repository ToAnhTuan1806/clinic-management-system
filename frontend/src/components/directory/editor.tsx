import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { LoaderCircle } from 'lucide-react'
import { useSubmission } from '@/auth/use-submission'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  DirectoryError,
  directoryMessage,
  type DirectoryGateway,
  type DirectoryItem,
  type DirectoryKind,
  type DoctorUser,
  type Specialty,
} from '@/directory/model'

export const selectClass =
  'h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-foreground disabled:opacity-50'
const textAreaClass =
  'min-h-28 w-full rounded-lg border border-input bg-background p-3 text-sm'
interface Values {
  name: string
  description: string
  userId: string
  specialtyId: string
  biography: string
}
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
  const doctor = item && 'userId' in item ? item : undefined
  const specialty = item && 'name' in item ? item : undefined
  const form = useForm<Values>({
    defaultValues: {
      name: specialty?.name ?? '',
      description: specialty?.description ?? '',
      userId: doctor?.userId ?? '',
      specialtyId: doctor?.specialtyId ?? '',
      biography: doctor?.biography ?? '',
    },
  })
  const { pending, run } = useSubmission()
  const [lookup, setLookup] = useState<{
    attempt: number
    options: { specialties: Specialty[]; users: DoctorUser[] } | null
    error: string | null
  } | null>(
    doctors
      ? null
      : { attempt: 0, options: { specialties: [], users: [] }, error: null },
  )
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const options = lookup?.attempt === retry ? lookup.options : null
  const lookupError = lookup?.attempt === retry ? lookup.error : null
  useEffect(() => {
    onBusy(pending)
    return () => onBusy(false)
  }, [pending, onBusy])
  useEffect(() => {
    if (!doctors) return
    const controller = new AbortController()
    void Promise.all([
      gateway.specialtyOptions(controller.signal, true),
      doctor ? Promise.resolve([]) : gateway.doctorUsers(controller.signal),
    ])
      .then(([specialties, users]) => {
        if (!controller.signal.aborted)
          setLookup({
            attempt: retry,
            error: null,
            options: {
              specialties: specialties.filter((value) => value.active),
              users: users.filter(
                (value) =>
                  value.active && value.role === 'DOCTOR' && !value.linked,
              ),
            },
          })
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setLookup({
            attempt: retry,
            options: null,
            error: directoryMessage(failure),
          })
      })
    return () => controller.abort()
  }, [doctors, doctor, gateway, retry])
  return (
    <>
      <DialogTitle className="pr-8 text-xl font-semibold">
        {item ? 'Chỉnh sửa' : 'Thêm'} {doctors ? 'bác sĩ' : 'chuyên khoa'}
      </DialogTitle>
      <DialogDescription className="mt-2 text-sm text-muted-foreground">
        {gateway.mode === 'mock'
          ? 'DEMO · Thay đổi chỉ trong bộ nhớ kiểm thử, không gửi Backend.'
          : 'Nhập thông tin và kiểm tra trước khi lưu.'}
      </DialogDescription>
      {lookupError && (
        <Alert className="mt-5" role="alert">
          <AlertDescription>
            {lookupError}
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
      {doctors && !options && !lookupError && (
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
                        biography: values.biography,
                      },
                      signal,
                    )
                  else
                    await gateway.saveSpecialty(
                      item?.id,
                      { name: values.name, description: values.description },
                      signal,
                    )
                  if (!signal.aborted) onSaved()
                } catch (failure) {
                  if (signal.aborted) return
                  setError(directoryMessage(failure))
                  if (failure instanceof DirectoryError)
                    for (const [key, message] of Object.entries(failure.fields))
                      form.setError(
                        key as keyof Values,
                        { type: 'server', message },
                        { shouldFocus: true },
                      )
                }
              })()
            })
          }}
        >
          <fieldset
            disabled={pending || (doctors && !options)}
            className="space-y-5"
          >
            {doctors ? (
              <>
                <FormField
                  control={form.control}
                  name="userId"
                  rules={{ required: 'Vui lòng chọn tài khoản bác sĩ hợp lệ.' }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tài khoản bác sĩ</FormLabel>
                      <FormControl>
                        <select
                          {...field}
                          className={selectClass}
                          disabled={!!doctor}
                        >
                          <option value="">Chọn tài khoản DOCTOR</option>
                          {doctor ? (
                            <option value={doctor.userId}>
                              {doctor.fullName}
                            </option>
                          ) : (
                            options?.users.map((user) => (
                              <option key={user.id} value={user.id}>
                                {user.fullName}
                              </option>
                            ))
                          )}
                        </select>
                      </FormControl>
                      <p className="text-xs text-muted-foreground">
                        {doctor
                          ? 'Tài khoản đã liên kết với hồ sơ này.'
                          : 'Chỉ tài khoản DOCTOR hoạt động và chưa liên kết.'}
                      </p>
                      <FormMessage role="alert" />
                      {options && !doctor && !options.users.length && (
                        <p role="status" className="text-sm">
                          Chưa có tài khoản bác sĩ khả dụng.
                        </p>
                      )}
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="specialtyId"
                  rules={{
                    required: 'Vui lòng chọn chuyên khoa đang hoạt động.',
                    validate: (value) =>
                      !!options?.specialties.some(
                        (option) => option.id === value,
                      ) || 'Vui lòng chọn chuyên khoa đang hoạt động.',
                  }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Chuyên khoa</FormLabel>
                      <FormControl>
                        <select {...field} className={selectClass}>
                          <option value="">
                            Chọn chuyên khoa đang hoạt động
                          </option>
                          {doctor &&
                            !options?.specialties.some(
                              (value) => value.id === doctor.specialtyId,
                            ) && (
                              <option value={doctor.specialtyId} disabled>
                                {doctor.specialtyName} · Ngừng hoạt động
                              </option>
                            )}
                          {options?.specialties.map((value) => (
                            <option key={value.id} value={value.id}>
                              {value.name}
                            </option>
                          ))}
                        </select>
                      </FormControl>
                      <FormMessage role="alert" />
                      {options && !options.specialties.length && (
                        <p role="status" className="text-sm">
                          Chưa có chuyên khoa hoạt động. Hãy tạo hoặc bật chuyên
                          khoa trước.
                        </p>
                      )}
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="biography"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Giới thiệu chuyên môn</FormLabel>
                      <FormControl>
                        <textarea {...field} className={textAreaClass} />
                      </FormControl>
                      <FormMessage role="alert" />
                    </FormItem>
                  )}
                />
              </>
            ) : (
              <>
                <FormField
                  control={form.control}
                  name="name"
                  rules={{
                    validate: (value) =>
                      !!value.trim() || 'Vui lòng nhập tên chuyên khoa.',
                  }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tên chuyên khoa</FormLabel>
                      <FormControl>
                        <Input {...field} className="h-11" autoComplete="off" />
                      </FormControl>
                      <FormMessage role="alert" />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Mô tả</FormLabel>
                      <FormControl>
                        <textarea {...field} className={textAreaClass} />
                      </FormControl>
                      <FormMessage role="alert" />
                    </FormItem>
                  )}
                />
              </>
            )}
          </fieldset>
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button
            type="submit"
            className="h-11 w-full"
            disabled={pending || !options || gateway.mode === 'pending'}
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
