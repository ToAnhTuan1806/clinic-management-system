import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { AlertDialog } from 'radix-ui'
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Layers2,
  Plus,
  Search,
  Stethoscope,
} from 'lucide-react'
import { useAuth } from '@/auth/context'
import { useSubmission } from '@/auth/use-submission'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { LoadingState } from '@/components/page-states'
import { DirectoryEditor, selectClass } from '@/components/directory/editor'
import { DirectoryRecord } from '@/components/directory/record'
import { directoryGateway } from '@/directory/gateway'
import {
  canManageDirectory,
  directoryMessage,
  visibleDoctor,
  type DirectoryItem,
  type DirectoryKind,
  type DirectoryQuery,
  type Page,
  type Specialty,
} from '@/directory/model'

type Modal =
  | { type: 'edit'; item?: DirectoryItem }
  | { type: 'details' | 'status'; item: DirectoryItem }
const initialQuery: DirectoryQuery = {
  search: '',
  page: 0,
  pageSize: 10,
  active: 'all',
  specialtyId: '',
}

export default function DirectoryPage({ kind }: { kind: DirectoryKind }) {
  const { user } = useAuth()
  const doctors = kind === 'doctors'
  const manage = canManageDirectory(user)
  const canFilterInactive =
    user?.role === 'ADMIN' ||
    user?.role === 'RECEPTIONIST' ||
    (user?.role === 'DOCTOR' && doctors)
  const pendingAPI = directoryGateway.mode === 'pending'
  const [query, setQuery] = useState(initialQuery)
  const [resource, setResource] = useState<{
    key: string
    data: Page<DirectoryItem> | null
    error: string | null
  } | null>(null)
  const [specialties, setSpecialties] = useState<Specialty[]>([])
  const [filterError, setFilterError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [modal, setModal] = useState<Modal | null>(null)
  const [selectionVersion, setSelectionVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const title = doctors
    ? user?.role === 'DOCTOR'
      ? 'Hồ sơ bác sĩ của tôi'
      : 'Đội ngũ bác sĩ'
    : 'Chuyên khoa'
  const { pending: changing, run } = useSubmission()
  const requestKey = JSON.stringify([
    kind,
    query,
    revision,
    user?.id,
    user?.role,
  ])
  const loading = resource?.key !== requestKey
  const data = !loading ? resource?.data : null
  const error = !loading ? resource?.error : null

  useEffect(() => {
    const controller = new AbortController()
    const effectiveQuery = !canFilterInactive
      ? { ...query, active: 'active' as const }
      : query
    const request = doctors
      ? directoryGateway.listDoctors(effectiveQuery, controller.signal)
      : directoryGateway.listSpecialties(effectiveQuery, controller.signal)
    void request
      .then((result) => {
        if (controller.signal.aborted) return
        if (query.page > 0 && !result.items.length && result.total > 0) {
          setQuery((current) => ({
            ...current,
            page: Math.max(0, Math.ceil(result.total / current.pageSize) - 1),
          }))
          return
        }
        const items = result.items.filter(
          (item) =>
            user &&
            ('doctorCode' in item
              ? visibleDoctor(item, user)
              : user.role !== 'PATIENT' || item.active),
        )
        setResource({
          key: requestKey,
          data: { ...result, items },
          error: null,
        })
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setResource({
            key: requestKey,
            data: null,
            error: directoryMessage(failure),
          })
      })
    return () => controller.abort()
  }, [doctors, query, revision, user, requestKey, canFilterInactive])
  useEffect(() => {
    if (!doctors || pendingAPI) return
    const controller = new AbortController()
    void directoryGateway
      .specialtyOptions(
        controller.signal,
        user?.role === 'PATIENT' || user?.role === 'DOCTOR',
      )
      .then((result) => {
        if (!controller.signal.aborted) {
          setSpecialties(result)
          setFilterError(null)
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          setSpecialties([])
          setFilterError(directoryMessage(failure))
        }
      })
    return () => controller.abort()
  }, [doctors, pendingAPI, revision, user])
  // Cancelled requests cannot restore data after logout, role changes or route changes.
  const filter = (update: Partial<DirectoryQuery>) => {
    setSuccess(null)
    setQuery((current) => ({ ...current, ...update, page: 0 }))
  }
  const open = (value: Modal) => {
    returnFocus.current = document.activeElement as HTMLElement
    setMutationError(null)
    setSuccess(null)
    setSelectionVersion((current) => current + 1)
    setModal(value)
  }
  const restoreFocus = (event: Event) => {
    event.preventDefault()
    if (returnFocus.current?.isConnected) {
      returnFocus.current.focus()
      return
    }
    document.getElementById('main-content')?.focus()
  }
  const completed = () => {
    setModal(null)
    setMutationError(null)
    setSuccess(
      `${directoryGateway.mode === 'mock' ? 'DEMO · ' : ''}Đã lưu thay đổi.`,
    )
    setRevision((value) => value + 1)
  }
  const close = (next: boolean) => {
    if (!next && !busy && !changing) setModal(null)
  }
  const pages = Math.max(
    1,
    data?.totalPages ?? Math.ceil((data?.total ?? 0) / query.pageSize),
  )
  const Icon = doctors ? Stethoscope : Layers2

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground">
            DANH MỤC CHĂM SÓC
          </p>
          <h1 className="mt-2 text-3xl font-semibold">{title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {doctors
              ? user?.role === 'DOCTOR'
                ? 'Thông tin chuyên môn và chuyên khoa được liên kết với tài khoản của bạn.'
                : 'Tìm bác sĩ theo tên, chuyên khoa và trạng thái hoạt động.'
              : 'Tra cứu chuyên khoa và quản lý trạng thái phục vụ của phòng khám.'}
          </p>
        </div>
        {manage && (
          <Button
            className="h-11"
            disabled={pendingAPI}
            onClick={() => open({ type: 'edit' })}
          >
            <Plus aria-hidden="true" />
            {doctors ? 'Thêm bác sĩ' : 'Thêm chuyên khoa'}
          </Button>
        )}
      </header>
      <nav aria-label="Danh mục" className="flex gap-2 border-b pb-3">
        <Button
          asChild
          variant={doctors ? 'secondary' : 'ghost'}
          className="h-10"
        >
          <Link to="/doctors" aria-current={doctors ? 'page' : undefined}>
            Bác sĩ
          </Link>
        </Button>
        <Button
          asChild
          variant={!doctors ? 'secondary' : 'ghost'}
          className="h-10"
        >
          <Link to="/specialties" aria-current={!doctors ? 'page' : undefined}>
            Chuyên khoa
          </Link>
        </Button>
      </nav>
      {directoryGateway.mode !== 'real' && (
        <Alert>
          <CircleAlert aria-hidden="true" />
          <AlertDescription>
            {pendingAPI
              ? 'Danh mục đang chờ kết nối dịch vụ. Chưa có dữ liệu thật hoặc thao tác lưu khả dụng.'
              : 'DEMO · Dữ liệu kiểm thử tổng hợp. Các thay đổi chỉ lưu tạm trong bộ nhớ, chưa tích hợp Backend D03.'}
          </AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert role="status">
          <CheckCircle2 aria-hidden="true" />
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}
      <section
        aria-label="Bộ lọc danh mục"
        className="grid gap-4 rounded-2xl border bg-card p-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <div className="sm:col-span-2">
          <Label htmlFor={`${kind}-search`}>
            Tìm kiếm {doctors ? 'bác sĩ' : 'chuyên khoa'}
          </Label>
          <div className="relative mt-2">
            <Search
              className="absolute top-3.5 left-3 size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              maxLength={120}
              id={`${kind}-search`}
              type="search"
              className="h-11 pl-10"
              placeholder={
                doctors
                  ? 'Nhập mã hoặc tên bác sĩ…'
                  : 'Nhập mã hoặc tên chuyên khoa…'
              }
              value={query.search}
              disabled={pendingAPI}
              onChange={(event) => filter({ search: event.target.value })}
            />
          </div>
        </div>
        {doctors && (
          <div>
            <Label htmlFor="specialty-filter">Chuyên khoa</Label>
            <select
              id="specialty-filter"
              className={`${selectClass} mt-2`}
              value={query.specialtyId}
              disabled={pendingAPI}
              onChange={(event) => filter({ specialtyId: event.target.value })}
            >
              <option value="">Tất cả chuyên khoa</option>
              {specialties.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {canFilterInactive && (
          <div>
            <Label htmlFor={`${kind}-active`}>Trạng thái</Label>
            <select
              id={`${kind}-active`}
              className={`${selectClass} mt-2`}
              value={query.active}
              disabled={pendingAPI}
              onChange={(event) =>
                filter({
                  active: event.target.value as DirectoryQuery['active'],
                })
              }
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="active">Đang hoạt động</option>
              <option value="inactive">Ngừng hoạt động</option>
            </select>
          </div>
        )}
        {!canFilterInactive && (
          <p className="self-end pb-3 text-sm text-muted-foreground">
            Chỉ hiển thị danh mục hoạt động theo quyền truy cập.
          </p>
        )}
      </section>
      {filterError && (
        <Alert role="alert">
          <AlertDescription>
            Không tải được bộ lọc chuyên khoa. {filterError}
            <Button
              variant="outline"
              className="h-10"
              onClick={() => setRevision((value) => value + 1)}
            >
              Tải lại bộ lọc
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <section
        aria-label={doctors ? 'Danh sách bác sĩ' : 'Danh sách chuyên khoa'}
        aria-busy={loading}
      >
        {loading ? (
          <LoadingState />
        ) : error ? (
          <div role="alert" className="rounded-2xl border bg-card p-6">
            <h2 className="font-semibold">
              {pendingAPI ? 'Danh mục chưa sẵn sàng' : 'Không thể tải danh mục'}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            {!pendingAPI && (
              <Button
                className="mt-4 h-10"
                variant="outline"
                onClick={() => setRevision((value) => value + 1)}
              >
                Thử lại
              </Button>
            )}
          </div>
        ) : !data?.items.length ? (
          <div
            role="status"
            className="rounded-2xl border bg-card p-10 text-center"
          >
            <Icon
              className="mx-auto mb-4 size-8 text-primary"
              aria-hidden="true"
            />
            <h2 className="font-semibold">
              Không tìm thấy {doctors ? 'bác sĩ' : 'chuyên khoa'}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {user?.role === 'DOCTOR' && doctors
                ? 'Tài khoản của bạn chưa có hồ sơ phù hợp với bộ lọc.'
                : 'Thử thay đổi từ khóa hoặc bộ lọc để xem kết quả khác.'}
            </p>
            <Button
              variant="outline"
              className="mt-4 h-10"
              onClick={() => setQuery(initialQuery)}
            >
              Xóa bộ lọc
            </Button>
          </div>
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {data.items.map((item) => {
              const name = 'fullName' in item ? item.fullName : item.name
              return (
                <li
                  key={item.id}
                  className="flex min-w-0 flex-col rounded-2xl border bg-card p-5"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="font-semibold break-words">{name}</h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {'doctorCode' in item ? item.doctorCode : item.code}
                      </p>
                      {'specialtyName' in item && (
                        <p className="mt-1 text-sm break-words text-muted-foreground">
                          {item.specialtyName}
                          {!item.specialtyActive && ' · Ngừng hoạt động'}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="mt-4">
                    <Badge variant={item.active ? 'secondary' : 'outline'}>
                      {item.active ? 'Đang hoạt động' : 'Ngừng hoạt động'}
                    </Badge>
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm leading-relaxed break-words text-muted-foreground">
                    {('biography' in item
                      ? item.biography
                      : item.description) || 'Chưa có thông tin giới thiệu.'}
                  </p>
                  <div className="mt-auto flex flex-wrap gap-2 pt-5">
                    <Button
                      variant="outline"
                      className="h-10"
                      aria-label={`Xem ${name}`}
                      onClick={() => open({ type: 'details', item })}
                    >
                      Xem hồ sơ
                    </Button>
                    {manage && (
                      <>
                        <Button
                          variant="ghost"
                          className="h-10"
                          aria-label={`Chỉnh sửa ${name}`}
                          onClick={() => open({ type: 'edit', item })}
                        >
                          Chỉnh sửa
                        </Button>
                        <Button
                          variant="ghost"
                          className="h-10"
                          aria-label={`${item.active ? 'Tắt' : 'Bật'} hoạt động ${name}`}
                          onClick={() => open({ type: 'status', item })}
                        >
                          {item.active ? 'Tắt hoạt động' : 'Bật hoạt động'}
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
      <footer className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
        <p role="status" className="text-sm text-muted-foreground">
          {loading
            ? 'Đang tải kết quả…'
            : error
              ? 'Chưa có kết quả'
              : `${data?.total ?? 0} kết quả · Trang ${query.page + 1}/${pages}`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor={`${kind}-page-size`} className="sr-only">
            Số kết quả mỗi trang
          </Label>
          <select
            id={`${kind}-page-size`}
            className={`${selectClass} w-auto`}
            value={query.pageSize}
            disabled={pendingAPI || loading}
            onChange={(event) =>
              filter({ pageSize: Number(event.target.value) })
            }
          >
            <option value="10">10 / trang</option>
            <option value="20">20 / trang</option>
            <option value="50">50 / trang</option>
          </select>
          <Button
            variant="outline"
            className="h-11"
            aria-label="Trang trước"
            disabled={loading || !!error || query.page === 0}
            onClick={() =>
              setQuery((current) => ({ ...current, page: current.page - 1 }))
            }
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            className="h-11"
            aria-label="Trang sau"
            disabled={loading || !!error || query.page + 1 >= pages}
            onClick={() =>
              setQuery((current) => ({ ...current, page: current.page + 1 }))
            }
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </footer>
      <Dialog
        open={modal?.type === 'edit' || modal?.type === 'details'}
        onOpenChange={close}
      >
        {modal && modal.type !== 'status' && (
          <DialogContent
            closeDisabled={busy}
            onCloseAutoFocus={restoreFocus}
            onEscapeKeyDown={(event) => {
              if (busy) event.preventDefault()
            }}
            onInteractOutside={(event) => {
              if (busy) event.preventDefault()
            }}
          >
            {modal.item ? (
              <DirectoryRecord
                key={selectionVersion}
                kind={kind}
                item={modal.item}
                gateway={directoryGateway}
                edit={modal.type === 'edit' && manage}
                onSaved={completed}
                onBusy={setBusy}
              />
            ) : (
              manage && (
                <DirectoryEditor
                  key={selectionVersion}
                  kind={kind}
                  gateway={directoryGateway}
                  onSaved={completed}
                  onBusy={setBusy}
                />
              )
            )}
          </DialogContent>
        )}
      </Dialog>
      <AlertDialog.Root open={modal?.type === 'status'} onOpenChange={close}>
        {modal?.type === 'status' && (
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
            <AlertDialog.Content
              className="fixed top-1/2 left-1/2 z-50 max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border bg-popover p-6 text-popover-foreground shadow-xl"
              onCloseAutoFocus={restoreFocus}
              onEscapeKeyDown={(event) => {
                if (changing) event.preventDefault()
              }}
            >
              <AlertDialog.Title className="text-xl font-semibold">
                {modal.item.active ? 'Tắt' : 'Bật'} hoạt động?
              </AlertDialog.Title>
              <AlertDialog.Description className="mt-3 text-sm leading-relaxed break-words text-muted-foreground">
                {modal.item.active
                  ? 'Mục này sẽ không xuất hiện trong danh mục hoạt động dành cho bệnh nhân. Thông tin vẫn được giữ lại.'
                  : 'Mục này sẽ được đánh dấu hoạt động trở lại.'}{' '}
                {directoryGateway.mode === 'mock' &&
                  'DEMO · Chỉ thay đổi dữ liệu kiểm thử trong bộ nhớ.'}
              </AlertDialog.Description>
              <p className="mt-3 text-sm font-medium break-words">
                {'fullName' in modal.item
                  ? modal.item.fullName
                  : modal.item.name}
              </p>
              {mutationError && (
                <p role="alert" className="mt-4 text-sm text-destructive">
                  {mutationError}
                </p>
              )}
              <div className="mt-6 flex justify-end gap-3">
                <AlertDialog.Cancel asChild>
                  <Button
                    variant="outline"
                    className="h-11"
                    disabled={changing}
                  >
                    Hủy
                  </Button>
                </AlertDialog.Cancel>
                <Button
                  className="h-11"
                  disabled={changing || !manage || pendingAPI}
                  onClick={() => {
                    if (!manage || modal.type !== 'status') return
                    void run(async (signal) => {
                      setMutationError(null)
                      try {
                        await directoryGateway.setActive(
                          kind,
                          modal.item.id,
                          !modal.item.active,
                          signal,
                        )
                        if (!signal.aborted) completed()
                      } catch (failure) {
                        if (!signal.aborted)
                          setMutationError(directoryMessage(failure))
                      }
                    })
                  }}
                >
                  {changing ? 'Đang lưu…' : 'Xác nhận'}
                </Button>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        )}
      </AlertDialog.Root>
    </div>
  )
}
