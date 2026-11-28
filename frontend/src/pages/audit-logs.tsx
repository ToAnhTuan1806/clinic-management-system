import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/auth/context'
import {
  actorRoleLabels,
  actorUserIdError,
  auditActionLabels,
  auditResultLabels,
  canViewAuditLogs,
  entityTypeLabels,
  formatVnDateTime,
  optionalDateRangeError,
  reportsApi,
  reportsMessage,
  type AuditLogFilter,
  type AuditLogPage,
  type AuditSort,
} from '@/reports/api'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingState } from '@/components/page-states'

const initialFilter = (): AuditLogFilter => ({
  from: '',
  to: '',
  actorUserId: '',
  action: '',
  page: 0,
  size: 20,
  sort: 'occurredAt,desc',
})

export default function AuditLogs() {
  const { user, version } = useAuth()
  return canViewAuditLogs(user?.role) ? (
    <AuditLogsWorkspace key={version} />
  ) : null
}

function AuditLogsWorkspace() {
  const [draft, setDraft] = useState<AuditLogFilter>(initialFilter)
  const [filter, setFilter] = useState<AuditLogFilter>(initialFilter)
  const [revision, setRevision] = useState(0)
  const [validation, setValidation] = useState('')
  const key = JSON.stringify(filter) + ':' + revision
  const [resource, setResource] = useState<{
    key: string
    data?: AuditLogPage
    error?: string
  } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void reportsApi
      .auditLogs(filter, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResource({ key, data })
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setResource({ key, error: reportsMessage(error) })
        }
      })
    return () => controller.abort()
  }, [filter, key])

  const current = resource?.key === key ? resource : null
  const data = current?.data

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            KIỂM TOÁN HỆ THỐNG · CHỈ QUẢN TRỊ VIÊN
          </p>
          <h1 className="text-2xl font-semibold sm:text-3xl">
            Nhật ký kiểm toán
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Truy vết các thao tác nghiệp vụ quan trọng (chỉ đọc, không hỗ trợ
            sửa hoặc xóa).
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-10 gap-2 bg-card"
          onClick={() => setRevision((v) => v + 1)}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Làm mới
        </Button>
      </div>

      <Card className="p-5">
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            const dateErr = optionalDateRangeError(draft.from, draft.to)
            const actorErr = actorUserIdError(draft.actorUserId)
            const err = dateErr || actorErr
            setValidation(err)
            if (err) return
            setFilter({ ...draft, page: 0 })
            setRevision((v) => v + 1)
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="audit-from">Từ ngày</Label>
            <Input
              id="audit-from"
              type="date"
              className="h-10"
              value={draft.from}
              aria-invalid={
                !!validation && !!optionalDateRangeError(draft.from, draft.to)
              }
              aria-describedby={validation ? 'audit-validation' : undefined}
              onChange={(e) => setDraft({ ...draft, from: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="audit-to">Đến ngày</Label>
            <Input
              id="audit-to"
              type="date"
              className="h-10"
              value={draft.to}
              aria-invalid={
                !!validation && !!optionalDateRangeError(draft.from, draft.to)
              }
              aria-describedby={validation ? 'audit-validation' : undefined}
              onChange={(e) => setDraft({ ...draft, to: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="audit-actor">ID người thao tác</Label>
            <Input
              id="audit-actor"
              inputMode="numeric"
              className="h-10"
              placeholder="VD: 8"
              value={draft.actorUserId}
              aria-invalid={
                !!validation && !!actorUserIdError(draft.actorUserId)
              }
              aria-describedby={validation ? 'audit-validation' : undefined}
              onChange={(e) =>
                setDraft({ ...draft, actorUserId: e.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="audit-action">Hành động</Label>
            <select
              id="audit-action"
              value={draft.action}
              onChange={(e) => setDraft({ ...draft, action: e.target.value })}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Tất cả hành động</option>
              {Object.entries(auditActionLabels).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="audit-sort">Sắp xếp thời gian</Label>
            <select
              id="audit-sort"
              value={draft.sort}
              onChange={(e) =>
                setDraft({ ...draft, sort: e.target.value as AuditSort })
              }
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="occurredAt,desc">Mới nhất trước</option>
              <option value="occurredAt,asc">Cũ nhất trước</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-5">
            <Button type="submit" className="h-10">
              Lọc nhật ký
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10"
              onClick={() => {
                const reset = initialFilter()
                setValidation('')
                setDraft(reset)
                setFilter(reset)
                setRevision((v) => v + 1)
              }}
            >
              Đặt lại
            </Button>
          </div>
          {validation && (
            <Alert
              id="audit-validation"
              variant="destructive"
              className="sm:col-span-2 lg:col-span-5"
            >
              <AlertDescription>{validation}</AlertDescription>
            </Alert>
          )}
        </form>
      </Card>

      {!current ? (
        <LoadingState />
      ) : current.error ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{current.error}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRevision((v) => v + 1)}
            >
              Thử lại
            </Button>
          </AlertDescription>
        </Alert>
      ) : data ? (
        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
              <h2 className="text-base font-semibold">Danh sách bản ghi</h2>
            </div>
            <Badge variant="secondary">{data.totalElements} bản ghi</Badge>
          </div>

          {data.items.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Không có bản ghi kiểm toán nào khớp với bộ lọc hiện tại.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3">Thời gian (VN)</th>
                    <th className="py-2 pr-3">Người thao tác</th>
                    <th className="py-2 pr-3">Hành động</th>
                    <th className="py-2 pr-3">Đối tượng</th>
                    <th className="py-2 text-right">Kết quả</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.items.map((item) => (
                    <tr key={item.id}>
                      <td className="py-2.5 pr-3 whitespace-nowrap tabular-nums">
                        {formatVnDateTime(item.occurredAt)}
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className="font-medium">
                          {actorRoleLabels[item.actorRole] ?? item.actorRole}
                        </span>
                        {item.actorUserId && (
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            #{item.actorUserId}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        <p className="font-medium">
                          {auditActionLabels[item.action] ?? item.action}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.action}
                        </p>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span>
                          {entityTypeLabels[item.entityType] ?? item.entityType}
                        </span>
                        {item.entityId && (
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            #{item.entityId}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 text-right">
                        <Badge
                          variant={
                            item.result === 'SUCCESS'
                              ? 'secondary'
                              : 'destructive'
                          }
                        >
                          {auditResultLabels[item.result]}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.totalPages > 1 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm">
              <p className="text-muted-foreground">
                Trang {data.page + 1} / {data.totalPages}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={data.page <= 0}
                  onClick={() =>
                    setFilter((prev) => ({
                      ...prev,
                      page: Math.max(0, prev.page - 1),
                    }))
                  }
                >
                  <ChevronLeft className="size-4" aria-hidden="true" />
                  Trang trước
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={data.page + 1 >= data.totalPages}
                  onClick={() =>
                    setFilter((prev) => ({ ...prev, page: prev.page + 1 }))
                  }
                >
                  Trang sau
                  <ChevronRight className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  )
}
