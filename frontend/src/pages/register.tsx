import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router'
import { ArrowRight, LoaderCircle, UserRoundCheck } from 'lucide-react'
import { authApi } from '@/auth/api'
import { isAuthMock } from '@/auth/config'
import { normalizeAuthError } from '@/auth/errors'
import type { RegisterInput } from '@/auth/types'
import { emailRules, nameRules, registerPasswordRules } from '@/auth/validation'
import { useSubmission } from '@/auth/use-submission'
import { AuthLayout } from '@/components/auth/auth-layout'
import { AuthFeedback } from '@/components/auth/auth-feedback'
import { PasswordInput } from '@/components/auth/password-input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

type RegisterForm = RegisterInput & { confirmPassword: string }
export default function Register() {
  const navigate = useNavigate()
  const form = useForm<RegisterForm>({
    defaultValues: {
      fullName: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
    mode: 'onTouched',
  })
  const { pending, run } = useSubmission()
  const [error, setError] = useState<string | null>(null)
  const feedback = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (error && !pending) feedback.current?.focus()
  }, [error, pending])
  return (
    <AuthLayout>
      <h1 className="text-3xl font-semibold">Tạo tài khoản bệnh nhân</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Bắt đầu hành trình chăm sóc sức khỏe với không gian dành riêng cho bạn.
      </p>
      <Badge variant="outline" className="mt-4 w-fit gap-2 py-1.5 text-primary">
        <UserRoundCheck className="size-4" aria-hidden="true" />
        Dành cho bệnh nhân đăng ký mới
      </Badge>
      <Form {...form}>
        <form
          noValidate
          className="mt-6 space-y-5"
          aria-busy={pending}
          onSubmit={(event) => {
            event.preventDefault()
            void run(async (signal) => {
              await form.handleSubmit(async (values) => {
                setError(null)
                try {
                  await authApi.register(
                    {
                      fullName: values.fullName.trim(),
                      email: values.email.trim(),
                      password: values.password,
                    },
                    signal,
                  )
                  if (!signal.aborted)
                    navigate('/login', {
                      replace: true,
                      state: {
                        registrationComplete: true,
                        mockRegistration: isAuthMock,
                      },
                    })
                } catch (failure) {
                  if (signal.aborted) return
                  const problem = normalizeAuthError(failure)
                  setError(problem.message)
                  for (const field of [
                    'fullName',
                    'email',
                    'password',
                    'confirmPassword',
                  ] as const)
                    if (problem.fields[field])
                      form.setError(field, {
                        type: 'server',
                        message: problem.fields[field],
                      })
                }
              })()
            })
          }}
        >
          <fieldset disabled={pending} className="space-y-5">
            <FormField
              control={form.control}
              name="fullName"
              rules={nameRules}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Họ và tên</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoComplete="name"
                      placeholder="Họ và tên của bạn"
                      className="h-11"
                    />
                  </FormControl>
                  <FormDescription className="sr-only">
                    Nhập họ tên không rỗng, tối đa 120 ký tự.
                  </FormDescription>
                  <FormMessage role="alert" />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              rules={emailRules}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder="ban@example.com"
                      className="h-11"
                    />
                  </FormControl>
                  <FormDescription className="sr-only">
                    Email dùng cho tài khoản bệnh nhân.
                  </FormDescription>
                  <FormMessage role="alert" />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              rules={{ ...registerPasswordRules, deps: ['confirmPassword'] }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Mật khẩu</FormLabel>
                  <FormControl>
                    <PasswordInput {...field} autoComplete="new-password" />
                  </FormControl>
                  <FormDescription>Từ 12 đến 72 ký tự.</FormDescription>
                  <FormMessage role="alert" />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              rules={{
                required: 'Vui lòng xác nhận mật khẩu.',
                validate: (value) =>
                  value === form.getValues('password') ||
                  'Xác nhận mật khẩu không khớp.',
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Xác nhận mật khẩu</FormLabel>
                  <FormControl>
                    <PasswordInput
                      {...field}
                      autoComplete="new-password"
                      visibilityLabel="xác nhận mật khẩu"
                    />
                  </FormControl>
                  <FormDescription className="sr-only">
                    Nhập lại chính xác mật khẩu đã chọn.
                  </FormDescription>
                  <FormMessage role="alert" />
                </FormItem>
              )}
            />
            {error && <AuthFeedback ref={feedback} message={error} />}
            <Button type="submit" disabled={pending} className="h-11 w-full">
              {pending ? (
                <>
                  <LoaderCircle
                    className="animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                  Đang đăng ký…
                </>
              ) : (
                <>
                  Đăng ký tài khoản
                  <ArrowRight aria-hidden="true" />
                </>
              )}
            </Button>
          </fieldset>
        </form>
      </Form>
      <p className="mt-6 border-t pt-6 text-center text-sm text-muted-foreground">
        Đã có tài khoản?{' '}
        <Link
          to="/login"
          className="inline-flex min-h-9 items-center rounded font-semibold text-primary"
        >
          Đăng nhập
        </Link>
      </p>
    </AuthLayout>
  )
}
