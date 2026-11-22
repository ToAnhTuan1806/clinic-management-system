import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, CheckCheck, ExternalLink, RefreshCw } from 'lucide-react'
import { Link } from 'react-router'
import { useAuth } from '@/auth/context'
import { useSubmission } from '@/auth/use-submission'
import { canAccessPath } from '@/lib/navigation'
import {
  operationsApi,
  operationsMessage,
  notificationLabels,
  mergeNotifications,
  type Notification,
  type NotificationPage,
} from '@/operations/api'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { LoadingState } from '@/components/page-states'
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'

type Inbox = Omit<NotificationPage, 'unreadCount'> & {
  unreadCount: number | null
  busy: boolean
  error: string
}
const emptyInbox = (): Inbox => ({
  items: [],
  page: 0,
  size: 20,
  totalElements: 0,
  totalPages: 0,
  unreadCount: null,
  busy: false,
  error: '',
})
const time = (value: string) =>
  new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
export function NotificationCenter() {
  const { user, version, status } = useAuth()
  return user && status === 'authenticated' ? (
    <InboxContent key={version} />
  ) : null
}
function InboxContent() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<Inbox>(() => ({
    ...emptyInbox(),
    busy: operationsApi.ready,
  }))
  const controller = useRef<AbortController | null>(null)
  const sequence = useRef(0)
  const navigated = useRef(false)
  const { pending, run } = useSubmission()
  const load = useCallback(
    async (page = 0, append = false, initial = false) => {
      if (!operationsApi.ready) return
      controller.current?.abort()
      const active = new AbortController()
      controller.current = active
      const request = ++sequence.current
      if (!initial)
        setState((previous) => ({
          ...(append ? previous : emptyInbox()),
          busy: true,
          error: '',
        }))
      try {
        const result = await operationsApi.notifications(page, active.signal)
        if (!active.signal.aborted && request === sequence.current)
          setState((previous) => ({
            ...result,
            items: append
              ? mergeNotifications(previous.items, result.items)
              : result.items,
            busy: false,
            error: '',
          }))
      } catch (error) {
        if (!active.signal.aborted && request === sequence.current)
          setState({ ...emptyInbox(), error: operationsMessage(error) })
      }
    },
    [],
  )
  useEffect(() => {
    let active = true
    const cancel = () => {
      sequence.current++
      controller.current?.abort()
    }
    queueMicrotask(() => {
      if (active) void load(0, false, true)
    })
    return () => {
      active = false
      cancel()
    }
  }, [load])
  const markRead = (item: Notification) => {
    if (pending || state.busy) return
    void run(async (signal) => {
      controller.current?.abort()
      const request = ++sequence.current
      setState((previous) => ({ ...previous, busy: true, error: '' }))
      try {
        await operationsApi.markRead(item.id, signal)
        // Reconcile every displayed page and take the unread count from Backend, never subtract locally.
        let result: NotificationPage | undefined
        let items: Notification[] = []
        for (let page = 0; page <= state.page; page++) {
          result = await operationsApi.notifications(page, signal)
          items = mergeNotifications(items, result.items)
          if (page + 1 >= result.totalPages) break
        }
        if (result && !signal.aborted && request === sequence.current)
          setState({ ...result, items, busy: false, error: '' })
      } catch (error) {
        if (!signal.aborted && request === sequence.current)
          setState({ ...emptyInbox(), error: operationsMessage(error) })
      }
    })
  }
  const unread = state.unreadCount
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        setOpen(value)
        if (value && !pending) void load()
      }}
    >
      <SheetTrigger asChild>
        <Button
          size="icon"
          variant="outline"
          className="relative size-10"
          aria-label={
            unread === null ? 'Thông báo' : `Thông báo, ${unread} chưa đọc`
          }
        >
          <Bell className="size-4" aria-hidden="true" />
          {unread !== null && unread > 0 && (
            <Badge
              className="absolute -top-2 -right-2 min-w-5 justify-center px-1 text-[10px]"
              aria-hidden="true"
            >
              {unread > 99 ? '99+' : unread}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="gap-0 data-[side=right]:w-full sm:data-[side=right]:w-96"
        onCloseAutoFocus={(event) => {
          if (navigated.current) {
            event.preventDefault()
            document.getElementById('main-content')?.focus()
            navigated.current = false
          }
        }}
      >
        <SheetHeader className="border-b pr-12">
          <SheetTitle>Trung tâm thông báo</SheetTitle>
          <SheetDescription>
            Thay đổi hành chính của lịch khám · Giờ Việt Nam.
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
          {!operationsApi.ready ? (
            <Alert>
              <AlertDescription>
                Thông báo chưa sẵn sàng. Vui lòng thử lại sau.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <p role="status" className="text-sm text-muted-foreground">
                  {unread === null
                    ? 'Chưa tải số chưa đọc'
                    : `${unread} thông báo chưa đọc`}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={state.busy || pending}
                  onClick={() => void load()}
                >
                  <RefreshCw aria-hidden="true" />
                  Làm mới thông báo
                </Button>
              </div>
              {state.error ? (
                <Alert variant="destructive">
                  <AlertDescription>
                    <p>{state.error}</p>
                    <Button
                      variant="outline"
                      className="mt-3"
                      onClick={() => void load()}
                    >
                      Thử lại thông báo
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : state.busy && !state.items.length ? (
                <LoadingState />
              ) : !state.items.length ? (
                <div className="rounded-xl border border-dashed p-6 text-center">
                  <Bell
                    aria-hidden="true"
                    className="mx-auto mb-3 size-6 text-primary"
                  />
                  <h2 className="font-medium">Chưa có thông báo</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Các cập nhật lịch khám sẽ xuất hiện tại đây.
                  </p>
                </div>
              ) : (
                <>
                  <ul
                    aria-label="Danh sách thông báo"
                    aria-busy={state.busy}
                    className="space-y-3"
                  >
                    {state.items.map((item) => (
                      <li
                        key={item.id}
                        className={
                          'min-w-0 rounded-xl border p-4 ' +
                          (item.readAt
                            ? 'bg-card'
                            : 'border-primary/30 bg-primary/5')
                        }
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="min-w-0 flex-1 break-words text-sm font-medium">
                            {notificationLabels[item.eventType]}
                          </p>
                          {!item.readAt && (
                            <Badge variant="outline">Chưa đọc</Badge>
                          )}
                        </div>
                        {item.appointmentCode && (
                          <p className="mt-2 break-words text-xs text-muted-foreground">
                            Mã lịch: {item.appointmentCode}
                          </p>
                        )}
                        <time
                          dateTime={item.createdAt}
                          className="mt-2 block text-xs text-muted-foreground"
                        >
                          {time(item.createdAt)}
                        </time>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {!item.readAt && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={state.busy || pending}
                              onClick={() => markRead(item)}
                              aria-label={
                                'Đánh dấu đã đọc thông báo ' + item.id
                              }
                            >
                              <CheckCheck aria-hidden="true" />
                              {pending ? 'Đang cập nhật…' : 'Đánh dấu đã đọc'}
                            </Button>
                          )}
                          {item.appointmentId &&
                            user &&
                            canAccessPath(user.role, '/appointments') && (
                              <Button size="sm" variant="ghost" asChild>
                                <Link
                                  to={
                                    '/appointments?appointmentId=' +
                                    encodeURIComponent(item.appointmentId)
                                  }
                                  onClick={() => {
                                    navigated.current = true
                                    setOpen(false)
                                  }}
                                >
                                  <ExternalLink aria-hidden="true" />
                                  Mở lịch hẹn
                                </Link>
                              </Button>
                            )}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 text-xs text-muted-foreground">
                    Đã hiển thị {state.items.length} / {state.totalElements}{' '}
                    thông báo
                  </p>
                  {state.page + 1 < state.totalPages && (
                    <Button
                      className="mt-3"
                      variant="outline"
                      disabled={state.busy || pending}
                      onClick={() => void load(state.page + 1, true)}
                    >
                      {state.busy ? 'Đang tải…' : 'Tải thêm thông báo'}
                    </Button>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
