import { useEffect, useState } from 'react'
import { DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { LoadingState } from '@/components/page-states'
import {
  directoryMessage,
  type DirectoryGateway,
  type DirectoryItem,
  type DirectoryKind,
} from '@/directory/model'
import { DirectoryEditor } from './editor'

export function DirectoryRecord({
  kind,
  item,
  gateway,
  edit,
  onSaved,
  onBusy,
}: {
  kind: DirectoryKind
  item: DirectoryItem
  gateway: DirectoryGateway
  edit: boolean
  onSaved: () => void
  onBusy: (busy: boolean) => void
}) {
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<{
    attempt: number
    item: DirectoryItem | null
    error: string | null
  } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const request =
      kind === 'doctors'
        ? gateway.getDoctor(item.id, controller.signal)
        : gateway.getSpecialty(item.id, controller.signal)
    void request
      .then((value) => {
        if (!controller.signal.aborted)
          setResult({ attempt: retry, item: value, error: null })
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({
            attempt: retry,
            item: null,
            error: directoryMessage(error),
          })
      })
    return () => controller.abort()
  }, [kind, item.id, gateway, retry])
  if (!result || result.attempt !== retry)
    return (
      <>
        <DialogTitle>Đang tải thông tin</DialogTitle>
        <DialogDescription className="sr-only">
          Đang lấy hồ sơ mới nhất.
        </DialogDescription>
        <LoadingState />
      </>
    )
  if (result.error || !result.item)
    return (
      <>
        <DialogTitle>Không thể mở thông tin</DialogTitle>
        <DialogDescription className="mt-3" role="alert">
          {result.error}
        </DialogDescription>
        <Button className="mt-4" onClick={() => setRetry((value) => value + 1)}>
          Thử lại
        </Button>
      </>
    )
  if (edit)
    return (
      <DirectoryEditor
        kind={kind}
        item={result.item}
        gateway={gateway}
        onSaved={onSaved}
        onBusy={onBusy}
      />
    )
  const record = result.item
  return (
    <>
      <DialogTitle className="pr-8 text-xl font-semibold break-words">
        {'doctorCode' in record ? record.fullName : record.name}
      </DialogTitle>
      <DialogDescription className="mt-2 text-sm text-muted-foreground">
        {'doctorCode' in record ? record.doctorCode : record.code}
        {gateway.mode === 'mock' && ' · DEMO'}
      </DialogDescription>
      <div className="mt-5 space-y-4 text-sm">
        {'specialtyName' in record && (
          <p className="break-words">
            <strong>Chuyên khoa: </strong>
            {record.specialtyName}
          </p>
        )}
        <Badge variant="outline">
          {record.active ? 'Đang hoạt động' : 'Ngừng hoạt động'}
        </Badge>
        {'userStatus' in record && (
          <p>
            Trạng thái tài khoản:{' '}
            {record.userStatus === 'ACTIVE' ? 'Đang hoạt động' : 'Đã khóa'}
          </p>
        )}
        {'licenseNumber' in record && (
          <p className="break-words">
            Số giấy phép: {record.licenseNumber || 'Chưa có'}
          </p>
        )}
        <p className="leading-relaxed whitespace-pre-wrap break-words">
          {('biography' in record ? record.biography : record.description) ||
            'Chưa có thông tin giới thiệu.'}
        </p>
      </div>
    </>
  )
}
