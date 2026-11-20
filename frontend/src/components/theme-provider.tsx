import { useEffect, useState, type ReactNode } from 'react'
import { ThemeContext, type Theme } from '@/lib/theme-context'

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem('clinic-theme')
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    /* Browser storage may be unavailable. */
  }
  return 'system'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches)
      document.documentElement.classList.toggle('dark', dark)
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    }
    apply()
    media.addEventListener('change', apply)
    try {
      if (theme === 'system') localStorage.removeItem('clinic-theme')
      else localStorage.setItem('clinic-theme', theme)
    } catch {
      /* Theme still works for this session. */
    }
    return () => media.removeEventListener('change', apply)
  }, [theme])
  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
