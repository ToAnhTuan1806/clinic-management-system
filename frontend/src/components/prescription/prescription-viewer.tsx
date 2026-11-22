import { useEffect, useState } from 'react'
import { AlertCircle, Pill, RefreshCw } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { LoadingState } from '@/components/page-states'
import { prescriptionGateway } from '@/prescription/gateway'
import {
  PRESCRIPTION_SIMULATION_NOTICE,
  prescriptionMessage,
  type Prescription,
} from '@/prescription/model'

interface PrescriptionViewerProps {
  recordId: string
  released: boolean
}

export function PrescriptionViewer({
  recordId,
  released,
}: PrescriptionViewerProps) {
  const [prescription, setPrescription] = useState<Prescription | null>(null)
  const [loading, setLoading] = useState(Boolean(recordId && released))
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    // Privacy guard: Unreleased records must not attempt to fetch or expose prescription
    if (!recordId || !released) {
      return
    }

    const controller = new AbortController()
    let active = true

    prescriptionGateway
      .get(recordId, controller.signal)
      .then((data) => {
        if (active && !controller.signal.aborted) {
          setPrescription(data)
          setError('')
        }
      })
      .catch((err) => {
        if (active && !controller.signal.aborted) {
          setError(prescriptionMessage(err))
        }
      })
      .finally(() => {
        if (active && !controller.signal.aborted) {
          setLoading(false)
        }
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [recordId, released, reload])

  if (!released) {
    return null
  }

  if (loading) {
    return <LoadingState />
  }

  return (
    <div className="space-y-3 rounded-lg border p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2.5">
        <div className="flex items-center gap-2">
          <Pill className="h-4 w-4 text-primary" aria-hidden="true" />
          <h4 className="text-sm font-semibold sm:text-base">
            Đơn thuốc mô phỏng
          </h4>
          <Badge variant="secondary">Chỉ đọc</Badge>
        </div>
        {error && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setLoading(true)
              setPrescription(null)
              setError('')
              setReload((v) => v + 1)
            }}
          >
            <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Tải lại
          </Button>
        )}
      </div>

      <Alert>
        <AlertCircle className="h-4 w-4" aria-hidden="true" />
        <AlertDescription className="text-xs sm:text-sm">
          {PRESCRIPTION_SIMULATION_NOTICE}
        </AlertDescription>
      </Alert>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription className="text-sm">{error}</AlertDescription>
        </Alert>
      ) : !prescription || prescription.items.length === 0 ? (
        <p className="py-3 text-center text-sm text-muted-foreground">
          Chưa có đơn thuốc mô phỏng cho lượt khám này.
        </p>
      ) : (
        <div className="space-y-3 pt-1">
          {prescription.items.map((item, idx) => (
            <Card key={item.id || idx} className="p-3 sm:p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-primary">
                    {idx + 1}. {item.medicationName}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
                    Số lượng:{' '}
                    <span className="font-medium text-foreground">
                      {item.quantity}
                    </span>{' '}
                    · Liều dùng:{' '}
                    <span className="font-medium text-foreground">
                      {item.dosage}
                    </span>{' '}
                    · Thời gian:{' '}
                    <span className="font-medium text-foreground">
                      {item.durationDays} ngày
                    </span>
                  </p>
                </div>
                <Badge variant="outline">{item.frequency}</Badge>
              </div>
              {item.instructions && (
                <div className="mt-2 rounded bg-muted/50 p-2 text-xs sm:text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">
                    Hướng dẫn:{' '}
                  </span>
                  {item.instructions}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
