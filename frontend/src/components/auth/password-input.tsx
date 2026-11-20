import { forwardRef, useState, type ComponentProps } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export const PasswordInput = forwardRef<
  HTMLInputElement,
  ComponentProps<'input'> & { visibilityLabel?: string }
>(function PasswordInput({ visibilityLabel = 'mật khẩu', ...props }, ref) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Input
        {...props}
        ref={ref}
        type={visible ? 'text' : 'password'}
        className="h-11 pr-12"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={props.disabled}
        className="absolute top-0.5 right-0.5 size-10"
        onClick={() => setVisible(!visible)}
        aria-label={`${visible ? 'Ẩn' : 'Hiện'} ${visibilityLabel}`}
        aria-pressed={visible}
      >
        {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </Button>
    </div>
  )
})
