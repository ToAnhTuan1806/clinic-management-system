import { useLocation } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/page-states'
import { navigation } from '@/lib/navigation'

export default function ModulePlaceholder() {
  const { pathname } = useLocation()
  const item = navigation.find((entry) => entry.path === pathname)!
  const Icon = item.icon
  return (
    <div className="space-y-6">
      <div>
        <Badge variant="outline" className="mb-3 text-primary">
          DEMO · Màn hình nền tảng
        </Badge>
        <h1 className="text-2xl font-semibold sm:text-3xl">{item.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{item.description}</p>
      </div>
      <Card className="gap-0 py-0">
        <div className="flex flex-wrap items-center gap-3 border-b p-5">
          <Icon className="size-5 text-primary" aria-hidden="true" />
          <h2 className="font-semibold">{item.label}</h2>
          <Badge className="ml-auto" variant="secondary">
            Chưa tích hợp API
          </Badge>
        </div>
        <EmptyState
          title="Phân hệ đang được chuẩn bị"
          description={`Giao diện ${item.label.toLocaleLowerCase('vi')} đã có routing. Chức năng nghiệp vụ và dữ liệu sẽ được bổ sung khi API sẵn sàng.`}
        />
      </Card>
      <p className="text-sm text-muted-foreground">
        Bản DEMO không thu thập hoặc lưu thông tin bệnh nhân.
      </p>
    </div>
  )
}
