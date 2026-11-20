import { Activity } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-3', className)}>
      <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <Activity className="size-6" aria-hidden="true" />
      </span>
      <span className="text-xl font-bold">
        Clinic<span className="text-primary">OS</span>
        <span className="mt-0.5 block text-[10px] font-medium text-muted-foreground">
          CLINIC MANAGEMENT
        </span>
      </span>
    </span>
  )
}
