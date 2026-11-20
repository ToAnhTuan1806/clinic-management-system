import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/lib/theme-context'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const toggle = () => {
    const dark =
      theme === 'dark' ||
      (theme === 'system' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches)
    setTheme(dark ? 'light' : 'dark')
  }
  return (
    <Button
      variant="outline"
      size="icon"
      className="size-10 bg-card"
      onClick={toggle}
      aria-label="Chuyển giao diện sáng hoặc tối"
      title="Chuyển giao diện sáng hoặc tối"
    >
      <Sun aria-hidden="true" className="hidden dark:block" />
      <Moon aria-hidden="true" className="dark:hidden" />
    </Button>
  )
}
