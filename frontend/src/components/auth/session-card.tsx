import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useAuth } from '@/auth/context'
import { normalizeAuthError } from '@/auth/errors'
import { roleLabels } from '@/auth/types'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export function SessionCard() {
  const { user, refreshUser } = useAuth()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  return (
    <Card className="gap-4 p-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
        <h2 className="font-semibold">Phiên đăng nhập</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Vai trò: {user ? roleLabels[user.role] : 'Chưa đăng nhập'}. Phiên chỉ
        tồn tại trong bộ nhớ và kết thúc khi tải lại trang.
      </p>
      <Button
        variant="outline"
        disabled={pending}
        className="h-11 w-fit"
        onClick={async () => {
          if (pending) return
          setPending(true)
          setMessage(null)
          try {
            await refreshUser()
          } catch (error) {
            setMessage(normalizeAuthError(error).message)
          } finally {
            setPending(false)
          }
        }}
      >
        {pending ? 'Đang kiểm tra…' : 'Kiểm tra phiên'}
      </Button>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
    </Card>
  )
}
