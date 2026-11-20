import { forwardRef } from 'react'
import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

export const AuthFeedback = forwardRef<HTMLDivElement, { message: string }>(
  function AuthFeedback({ message }, ref) {
    return (
      <Alert
        ref={ref}
        variant="destructive"
        tabIndex={-1}
        className="p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CircleAlert aria-hidden="true" />
        <AlertTitle>Không thể hoàn tất yêu cầu</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    )
  },
)
