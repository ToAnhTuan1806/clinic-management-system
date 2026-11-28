import { CircleAlert, Inbox } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export function LoadingState({ demo = false }: { demo?: boolean }) {
  return (
    <div
      role="status"
      aria-busy="true"
      className="space-y-5 rounded-xl border bg-card p-6"
    >
      <p className="text-sm text-muted-foreground">
        {demo ? 'DEMO · Mẫu trạng thái đang tải' : 'Đang tải giao diện…'}
      </p>
      <div aria-hidden="true" className="space-y-4">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-20 w-full" />
      </div>
    </div>
  )
}

export function EmptyState({
  title = 'Chưa có dữ liệu để hiển thị',
  description = 'Màn hình đang được chuẩn bị. Dữ liệu sẽ xuất hiện khi API được tích hợp.',
  compact = false,
  showAction = true,
}: {
  title?: string
  description?: string
  compact?: boolean
  showAction?: boolean
}) {
  return (
    <div
      className={
        compact
          ? 'flex flex-col items-center px-5 py-9 text-center'
          : 'flex flex-col items-center px-5 py-14 text-center'
      }
    >
      <span className="mb-4 flex size-14 items-center justify-center rounded-2xl border bg-background">
        <Inbox className="size-6 text-primary" aria-hidden="true" />
      </span>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
      {showAction && (
        <Button asChild variant="outline" className="mt-5">
          <Link to="/settings">Xem thiết lập nền tảng</Link>
        </Button>
      )}
    </div>
  )
}

export function ErrorState({ onReset }: { onReset: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-destructive/30 bg-card p-6"
    >
      <CircleAlert
        className="mb-3 size-6 text-destructive"
        aria-hidden="true"
      />
      <h3 className="font-semibold">DEMO · Không thể tải dữ liệu</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Mẫu thông báo lỗi để kiểm tra giao diện. Không có yêu cầu API nào được
        gửi.
      </p>
      <Button variant="outline" onClick={onReset} className="mt-4">
        Về trạng thái trống
      </Button>
    </div>
  )
}
