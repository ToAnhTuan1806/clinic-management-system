import { CalendarDays } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/page-states'

export default function Booking() {
  return (
    <div className="space-y-6">
      <div>
        <Badge variant="secondary" className="mb-3">
          DEMO · Khu vực bệnh nhân
        </Badge>
        <h1 className="text-2xl font-semibold sm:text-3xl">Đặt lịch khám</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Không gian dành riêng cho lịch khám của bạn.
        </p>
      </div>
      <Card className="gap-0 py-0">
        <div className="flex items-center gap-3 border-b p-5">
          <CalendarDays className="size-5 text-primary" aria-hidden="true" />
          <h2 className="font-semibold">Lựa chọn lịch khám</h2>
        </div>
        <EmptyState
          title="Chức năng đặt lịch đang được chuẩn bị"
          description="DEMO · Chưa có API lịch khám. Không có bác sĩ, khung giờ hoặc hồ sơ bệnh nhân giả được hiển thị như dữ liệu thật."
        />
      </Card>
    </div>
  )
}
