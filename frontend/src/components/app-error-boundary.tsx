import { Component, type ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

// A failed lazy import must leave a recovery action instead of a blank app.
// Never render or log raw error details, user values or auth state here.
export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <main
          className="mx-auto max-w-lg space-y-4 p-6 py-16"
          id="main-content"
          tabIndex={-1}
        >
          <AlertCircle className="size-8 text-primary" aria-hidden="true" />
          <h1 className="text-2xl font-semibold">Không thể tải giao diện</h1>
          <p role="alert" className="text-sm text-muted-foreground">
            Vui lòng kiểm tra kết nối và tải lại ứng dụng. Bạn cần đăng nhập lại
            sau khi tải lại.
          </p>
          <Button onClick={() => window.location.reload()}>
            Tải lại ứng dụng
          </Button>
        </main>
      )
    }
    return this.props.children
  }
}
