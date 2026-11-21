import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/auth/context'
import { roleHome } from '@/lib/navigation'

export default function NotFound() {
  const { user } = useAuth()
  return (
    <div className="py-20 text-center">
      <p className="text-sm font-semibold text-primary">404</p>
      <h1 className="mt-3 text-3xl font-semibold">Không tìm thấy màn hình</h1>
      <p className="mt-3 text-muted-foreground">
        Đường dẫn này chưa có trong không gian phòng khám.
      </p>
      <Button asChild className="mt-6">
        <Link to={user ? roleHome(user.role) : '/login'}>
          Về không gian của tôi
        </Link>
      </Button>
    </div>
  )
}
