import { useState } from 'react'
import { Monitor, Moon, Palette, Sun, Unplug } from 'lucide-react'
import { useTheme } from '@/lib/theme-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState, ErrorState, LoadingState } from '@/components/page-states'
import { SessionCard } from '@/components/auth/session-card'

export default function Settings() {
  const { theme, setTheme } = useTheme()
  const [state, setState] = useState<'empty' | 'loading' | 'error'>('empty')
  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          CÁ NHÂN HÓA TRẢI NGHIỆM
        </p>
        <h1 className="text-2xl font-semibold sm:text-3xl">
          Cài đặt không gian làm việc
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Giao diện nhất quán, phù hợp với cách bạn làm việc.
        </p>
      </div>
      <SessionCard />
      <Card className="gap-5 p-6">
        <div className="flex items-center gap-3">
          <Palette className="size-5 text-primary" aria-hidden="true" />
          <h2 className="font-semibold">Giao diện hiển thị</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Lựa chọn được lưu trên trình duyệt này. Chế độ hệ thống tự theo thiết
          lập của thiết bị.
        </p>
        <div
          role="group"
          aria-label="Chế độ giao diện"
          className="grid max-w-xl gap-3 sm:grid-cols-3"
        >
          {(
            [
              { value: 'light', label: 'Sáng', icon: Sun },
              { value: 'dark', label: 'Tối', icon: Moon },
              { value: 'system', label: 'Hệ thống', icon: Monitor },
            ] as const
          ).map(({ value, label, icon: Icon }) => (
            <Button
              key={value}
              variant={theme === value ? 'default' : 'outline'}
              className="h-14 gap-3"
              aria-pressed={theme === value}
              onClick={() => setTheme(value)}
            >
              <Icon aria-hidden="true" />
              {label}
            </Button>
          ))}
        </div>
      </Card>
      <Card className="gap-4 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <Unplug className="size-5 text-primary" aria-hidden="true" />
          <h2 className="font-semibold">Kết nối hệ thống</h2>
          <Badge variant="secondary">Đã kết nối API</Badge>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Các phân hệ nghiệp vụ đang kết nối trực tiếp với máy chủ ClinicOS và
          kiểm soát quyền truy cập theo vai trò tại Backend.
        </p>
      </Card>
      <Card className="gap-5 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-semibold">Thành phần trạng thái giao diện</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Xem trước các trạng thái trống, đang tải và thông báo lỗi dùng chung
          trong hệ thống.
        </p>
        <div
          role="group"
          aria-label="Xem trước trạng thái"
          className="flex flex-wrap gap-2"
        >
          {(
            [
              { value: 'empty', label: 'Trống' },
              { value: 'loading', label: 'Đang tải' },
              { value: 'error', label: 'Lỗi' },
            ] as const
          ).map(({ value, label }) => (
            <Button
              key={value}
              variant={state === value ? 'default' : 'outline'}
              aria-pressed={state === value}
              onClick={() => setState(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div aria-live="polite">
          {state === 'loading' ? (
            <LoadingState demo />
          ) : state === 'error' ? (
            <ErrorState onReset={() => setState('empty')} />
          ) : (
            <div className="rounded-xl border">
              <EmptyState
                compact
                title="Chưa có dữ liệu"
                description="Trạng thái trống chuẩn dùng chung cho các phân hệ."
              />
            </div>
          )}
        </div>
      </Card>
      <Card className="gap-5 p-6">
        <h2 className="font-semibold">Màu sắc nền tảng</h2>
        <div className="grid gap-4 sm:grid-cols-4">
          {[
            { label: 'Primary · Xanh y tế', color: 'bg-primary' },
            { label: 'Background · Nền', color: 'bg-background' },
            { label: 'Card · Bề mặt', color: 'bg-card' },
            { label: 'Muted · Trung tính', color: 'bg-muted' },
          ].map((token) => (
            <div key={token.label}>
              <div className={`h-16 rounded-lg border ${token.color}`} />
              <p className="mt-2 text-xs text-muted-foreground">
                {token.label}
              </p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
