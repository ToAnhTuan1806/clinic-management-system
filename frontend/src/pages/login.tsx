import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useLocation } from 'react-router'
import { ArrowRight, LoaderCircle } from 'lucide-react'
import { useAuth } from '@/auth/context'
import { normalizeAuthError } from '@/auth/errors'
import type { LoginInput } from '@/auth/types'
import { emailRules, loginPasswordRules } from '@/auth/validation'
import { useSubmission } from '@/auth/use-submission'
import { AuthLayout } from '@/components/auth/auth-layout'
import { AuthFeedback } from '@/components/auth/auth-feedback'
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button'
import { PasswordInput } from '@/components/auth/password-input'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

export default function Login() {
  const { login, loginWithGoogle, notice } = useAuth()
  const { state } = useLocation()
  const form = useForm<LoginInput>({
    defaultValues: { email: '', password: '' },
    mode: 'onTouched',
  })
  const { pending, run } = useSubmission()
  const [error, setError] = useState<string | null>(null)
  const feedback = useRef<HTMLDivElement>(null)
  // Focus only after the disabled fieldset has been enabled in the DOM.
  useEffect(() => {
    if (error && !pending) feedback.current?.focus()
  }, [error, pending])
  return (
    <AuthLayout>
      <h1 className="text-3xl font-semibold">Chào mừng trở lại</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Đăng nhập để tiếp tục vào không gian chăm sóc của bạn.
      </p>
      {state?.registrationComplete === true && (
        <Alert className="mt-5 p-4" role="status">
          <AlertDescription>
            {state.mockRegistration === true
              ? 'DEMO · API mock đã phản hồi đăng ký PATIENT. Chưa xác minh với Backend thật.'
              : 'Đăng ký hoàn tất. Bạn có thể đăng nhập bằng tài khoản vừa tạo.'}
          </AlertDescription>
        </Alert>
      )}
      {notice === 'expired' && (
        <Alert className="mt-5 p-4" role="status">
          <AlertDescription>
            Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.
          </AlertDescription>
        </Alert>
      )}
      <Form {...form}>
        <form
          noValidate
          className="mt-7 space-y-5"
          aria-busy={pending}
          onSubmit={(event) => {
            event.preventDefault()
            void run(async (signal) => {
              await form.handleSubmit(async (values) => {
                setError(null)
                try {
                  await login(
                    { email: values.email.trim(), password: values.password },
                    signal,
                  )
                } catch (failure) {
                  if (signal.aborted) return
                  const problem = normalizeAuthError(failure)
                  setError(problem.message)
                  for (const field of ['email', 'password'] as const)
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
              name="email"
              rules={emailRules}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="email"
                      autoComplete="username"
                      inputMode="email"
                      placeholder="ban@example.com"
                      className="h-11"
                    />
                  </FormControl>
                  <FormDescription className="sr-only">
                    Địa chỉ email dùng để đăng nhập.
                  </FormDescription>
                  <FormMessage role="alert" />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              rules={loginPasswordRules}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Mật khẩu</FormLabel>
                  <FormControl>
                    <PasswordInput {...field} autoComplete="current-password" />
                  </FormControl>
                  <FormDescription className="sr-only">
                    Mật khẩu của tài khoản.
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
                  Đang đăng nhập…
                </>
              ) : (
                <>
                  Đăng nhập
                  <ArrowRight aria-hidden="true" />
                </>
              )}
            </Button>
          </fieldset>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Phiên đăng nhập được bảo mật an toàn trong bộ nhớ trình duyệt.
          </p>
        </form>
      </Form>
      <GoogleSignInButton
        disabled={pending}
        mode="signin"
        onCredential={(idToken) => {
          void run(async (signal) => {
            setError(null)
            try {
              await loginWithGoogle(idToken, signal)
            } catch (failure) {
              if (signal.aborted) return
              setError(normalizeAuthError(failure).message)
            }
          })
        }}
        onError={(message) => setError(message)}
      />
      <p className="mt-6 border-t pt-6 text-center text-sm text-muted-foreground">
        Bạn chưa có tài khoản?{' '}
        <Link
          to="/register"
          className="inline-flex min-h-10 items-center rounded font-semibold text-primary"
        >
          Đăng ký bệnh nhân
        </Link>
      </p>
    </AuthLayout>
  )
}
