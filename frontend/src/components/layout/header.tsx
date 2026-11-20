import { useRef, useState } from 'react'
import { ChevronRight, Menu } from 'lucide-react'
import { useLocation } from 'react-router'
import { ThemeToggle } from '@/components/theme-toggle'
import { SidebarContent } from '@/components/layout/sidebar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { navigation } from '@/lib/navigation'
import { isAuthMock } from '@/auth/config'

export function Header() {
  const [open, setOpen] = useState(false)
  const navigated = useRef(false)
  const { pathname } = useLocation()
  const current = navigation.find((item) => item.path === pathname)
  return (
    <header className="sticky top-0 z-30 flex h-20 items-center gap-3 border-b bg-card px-4 sm:px-8">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="size-10 lg:hidden"
            aria-label="Mở menu điều hướng"
          >
            <Menu aria-hidden="true" />
          </Button>
        </SheetTrigger>
        <SheetContent
          side="left"
          className="w-72 gap-0 overflow-y-auto pb-[env(safe-area-inset-bottom)]"
          onCloseAutoFocus={(event) => {
            if (navigated.current) {
              event.preventDefault()
              document.getElementById('main-content')?.focus()
              navigated.current = false
            }
          }}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Menu điều hướng</SheetTitle>
            <SheetDescription>
              Chọn một màn hình trong không gian phòng khám DEMO.
            </SheetDescription>
          </SheetHeader>
          <SidebarContent
            onNavigate={() => {
              navigated.current = true
              setOpen(false)
            }}
          />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <span className="hidden text-muted-foreground sm:inline">
          Không gian làm việc
        </span>
        <ChevronRight
          className="hidden size-3.5 text-muted-foreground sm:block"
          aria-hidden="true"
        />
        <span className="truncate font-medium">
          {current?.label ??
            (pathname === '/forbidden' ? 'Không đủ quyền' : 'Không tìm thấy')}
        </span>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-3 sm:gap-5">
        <Badge
          variant="outline"
          className="border-primary/20 bg-primary/5 px-2.5 py-1 text-primary"
        >
          {isAuthMock ? 'API MOCK' : 'DEMO'}
        </Badge>
        <span
          className="hidden h-6 w-px bg-border sm:block"
          aria-hidden="true"
        />
        <ThemeToggle />
      </div>
    </header>
  )
}
