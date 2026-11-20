import { Link } from 'react-router'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="py-20 text-center">
      <p className="text-sm font-semibold text-primary">404</p>
      <h1 className="mt-3 text-3xl font-semibold">Không tìm thấy màn hình</h1>
      <p className="mt-3 text-muted-foreground">
        Đường dẫn này chưa có trong không gian phòng khám.
      </p>
      <Button asChild className="mt-6">
        <Link to="/dashboard">Về tổng quan</Link>
      </Button>
    </div>
  )
}
