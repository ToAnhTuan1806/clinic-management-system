import { ShieldX } from 'lucide-react'
import { Link } from 'react-router'
import { useAuth } from '@/auth/context'
import { Button } from '@/components/ui/button'
import { roleHome } from '@/lib/navigation'

export default function Forbidden() {
  const { user } = useAuth()
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <ShieldX className="mx-auto size-12 text-primary" aria-hidden="true" />
      <p className="mt-5 text-sm font-semibold text-primary">
        403 · Không đủ quyền
      </p>
      <h1 className="mt-3 text-2xl font-semibold">
        Bạn không có quyền truy cập màn hình này
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Quay lại không gian phù hợp với tài khoản của bạn hoặc liên hệ quản trị
        viên nếu cần được hỗ trợ.
      </p>
      <Button asChild className="mt-6 h-11">
        <Link to={roleHome(user!.role)}>Về không gian của tôi</Link>
      </Button>
    </div>
  )
}
