import { useEffect, useRef, useState } from 'react'
import { googleClientId, isGoogleAuthEnabled } from '@/auth/config'

interface GoogleCredentialResponse {
  credential?: string
}

interface GoogleIdentityApi {
  accounts?: {
    id?: {
      initialize: (config: {
        client_id: string
        callback: (response: GoogleCredentialResponse) => void
      }) => void
      renderButton: (
        parent: HTMLElement,
        options: {
          theme?: 'outline' | 'filled_blue' | 'filled_black'
          size?: 'large' | 'medium' | 'small'
          text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin'
          shape?: 'rectangular' | 'pill' | 'circle' | 'square'
          width?: number
          locale?: string
        },
      ) => void
    }
  }
}

declare global {
  interface Window {
    google?: GoogleIdentityApi
  }
}

const GSI_SCRIPT_ID = 'google-identity-services'
const GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client'

function loadGoogleIdentityScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve()
  const existing = document.getElementById(GSI_SCRIPT_ID)
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener(
        'error',
        () => reject(new Error('Google script load failed')),
        { once: true },
      )
    })
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.id = GSI_SCRIPT_ID
    script.src = GSI_SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Google script load failed'))
    document.head.appendChild(script)
  })
}

export function GoogleSignInButton({
  disabled,
  mode = 'signin',
  onCredential,
  onError,
}: {
  disabled?: boolean
  mode?: 'signin' | 'signup'
  onCredential: (idToken: string) => void
  onError?: (message: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onCredentialRef = useRef(onCredential)
  const onErrorRef = useRef(onError)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    onCredentialRef.current = onCredential
    onErrorRef.current = onError
  }, [onCredential, onError])

  useEffect(() => {
    if (!isGoogleAuthEnabled) return
    let cancelled = false
    void loadGoogleIdentityScript()
      .then(() => {
        if (cancelled) return
        const gsi = window.google?.accounts?.id
        const container = containerRef.current
        if (!gsi || !container) {
          setUnavailable(true)
          return
        }
        container.replaceChildren()
        gsi.initialize({
          client_id: googleClientId,
          callback: (response) => {
            if (response.credential) {
              onCredentialRef.current(response.credential)
            } else {
              onErrorRef.current?.(
                'Không nhận được mã xác thực từ Google. Vui lòng thử lại.',
              )
            }
          },
        })
        gsi.renderButton(container, {
          theme: 'outline',
          size: 'large',
          text: mode === 'signup' ? 'signup_with' : 'continue_with',
          shape: 'rectangular',
          width: Math.min(360, Math.max(260, container.clientWidth || 340)),
          locale: 'vi',
        })
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true)
      })
    return () => {
      cancelled = true
    }
  }, [mode])

  if (!isGoogleAuthEnabled || unavailable) return null

  return (
    <div className="mt-5">
      <div className="relative my-5 flex items-center">
        <div className="grow border-t border-border" />
        <span className="mx-3 shrink-0 text-xs text-muted-foreground">
          Hoặc dùng tài khoản Google (bệnh nhân)
        </span>
        <div className="grow border-t border-border" />
      </div>
      <div
        ref={containerRef}
        className={`flex min-h-11 justify-center ${
          disabled ? 'pointer-events-none opacity-60' : ''
        }`}
        aria-label="Đăng nhập bằng Google"
      />
    </div>
  )
}
