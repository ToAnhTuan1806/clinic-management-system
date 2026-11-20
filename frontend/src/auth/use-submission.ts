import { useEffect, useRef, useState } from 'react'

export function useSubmission() {
  const lock = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const [pending, setPending] = useState(false)
  useEffect(
    () => () => {
      controller.current?.abort()
    },
    [],
  )
  async function run(task: (signal: AbortSignal) => Promise<void>) {
    if (lock.current) return
    lock.current = true
    const active = new AbortController()
    controller.current = active
    setPending(true)
    try {
      await task(active.signal)
    } finally {
      lock.current = false
      controller.current = null
      if (!active.signal.aborted) setPending(false)
    }
  }
  return { pending, run }
}
