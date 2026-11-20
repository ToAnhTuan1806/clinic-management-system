import { useState, type FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff, HeartPulse, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router'
import { Brand } from '@/components/brand'
import { ThemeToggle } from '@/components/theme-toggle'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function Login() {
  const [showPassword, setShowPassword] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitted(true)
  }
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="grid min-h-dvh outline-none lg:grid-cols-2"
    >
      <section className="medical-banner hidden flex-col justify-between p-12 lg:flex">
        <p className="text-sm font-semibold">CLINICOS / KHÔNG GIAN CHĂM SÓC</p>
        <div className="max-w-md">
          <HeartPulse
            className="mb-8 size-20"
            strokeWidth={1}
            aria-hidden="true"
          />
          <h2 className="text-4xl leading-tight font-semibold">
            Chăm sóc tốt hơn.
            <br />
            Bắt đầu từ kết nối.
          </h2>
          <p className="mt-6 leading-relaxed text-white/90">
            Nền tảng quản lý phòng khám với trải nghiệm rõ ràng, thống nhất và
            dễ sử dụng.
          </p>
        </div>
        <p className="flex items-center gap-2 text-sm text-white/90">
          <ShieldCheck className="size-4" aria-hidden="true" />
          Bản DEMO · Không sử dụng dữ liệu thật
        </p>
      </section>
      <section className="flex min-w-0 flex-col p-5 sm:p-10">
        <div className="flex items-center justify-between">
          <Link
            to="/dashboard"
            className="rounded-lg"
            aria-label="ClinicOS — về tổng quan"
          >
            <Brand />
          </Link>
          <ThemeToggle />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <Badge className="mb-5 w-fit" variant="secondary">
            DEMO · Chưa kết nối xác thực
          </Badge>
          <h1 className="text-3xl font-semibold">Chào mừng trở lại</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Xem trước màn hình đăng nhập. Chỉ nhập thông tin DEMO, không dùng
            tài khoản thật.
          </p>
          <form
            onSubmit={submit}
            className="mt-8 space-y-5"
            aria-describedby="login-note"
          >
            <div className="space-y-2">
              <Label htmlFor="email">Email DEMO</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="demo@example.test"
                autoComplete="off"
                required
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Mật khẩu DEMO</Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="off"
                  required
                  minLength={8}
                  placeholder="Ít nhất 8 ký tự DEMO"
                  className="h-11 pr-12"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute top-0.5 right-0.5 size-10"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? (
                    <EyeOff aria-hidden="true" />
                  ) : (
                    <Eye aria-hidden="true" />
                  )}
                </Button>
              </div>
            </div>
            <p
              id="login-note"
              className="text-xs leading-relaxed text-muted-foreground"
            >
              Thông tin nhập không được gửi đi hoặc lưu bởi ứng dụng.
            </p>
            {submitted && (
              <p
                role="alert"
                className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm leading-relaxed"
              >
                Chưa kết nối dịch vụ xác thực. Bạn có thể mở bản DEMO bên dưới
                để khám phá giao diện.
              </p>
            )}
            <Button type="submit" className="h-11 w-full">
              Xem trước đăng nhập
              <ArrowRight aria-hidden="true" />
            </Button>
          </form>
          <div className="mt-6 border-t pt-6">
            <Button asChild variant="outline" className="h-11 w-full">
              <Link to="/dashboard">Mở không gian DEMO</Link>
            </Button>
          </div>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          ClinicOS · Frontend foundation
        </p>
      </section>
    </main>
  )
}
