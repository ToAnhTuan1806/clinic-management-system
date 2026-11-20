import type { ComponentProps } from 'react'
import { Dialog as Primitive } from 'radix-ui'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './button'

export const Dialog = Primitive.Root
export const DialogTitle = Primitive.Title
export const DialogDescription = Primitive.Description
export function DialogContent({
  children,
  className,
  closeDisabled = false,
  ...props
}: ComponentProps<typeof Primitive.Content> & { closeDisabled?: boolean }) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
      <Primitive.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-50 max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border bg-popover p-5 text-popover-foreground shadow-xl sm:p-6',
          className,
        )}
        {...props}
      >
        {children}
        <Primitive.Close asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="absolute top-3 right-3"
            aria-label="Đóng hộp thoại"
            disabled={closeDisabled}
          >
            <X aria-hidden="true" />
          </Button>
        </Primitive.Close>
      </Primitive.Content>
    </Primitive.Portal>
  )
}
