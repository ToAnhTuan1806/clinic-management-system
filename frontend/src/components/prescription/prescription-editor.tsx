import { useEffect, useState } from 'react'
import {
  AlertCircle,
  ArrowUp,
  ArrowDown,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { useSubmission } from '@/auth/use-submission'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingState } from '@/components/page-states'
import { prescriptionGateway } from '@/prescription/gateway'
import {
  cleanItem,
  createEmptyItem,
  isPrescriptionEqual,
  MAX_PRESCRIPTION_ITEMS,
  PRESCRIPTION_SIMULATION_NOTICE,
  prescriptionMessage,
  PrescriptionError,
  validatePrescription,
  type Prescription,
  type PrescriptionItem,
  type PrescriptionItemErrors,
} from '@/prescription/model'

interface PrescriptionEditorProps {
  recordId: string
  recordStatus: 'IN_PROGRESS' | 'COMPLETED'
  recordVersion: number
  onVersionChange?: (newVersion: number, signal: AbortSignal) => Promise<void>
  onStateChange?: (dirty: boolean, busy: boolean) => void
  onConflict?: (status?: number) => void
  disabled?: boolean
}

export function PrescriptionEditor({
  recordId,
  recordStatus,
  recordVersion,
  onVersionChange,
  onStateChange,
  onConflict,
  disabled = false,
}: PrescriptionEditorProps) {
  const [prescription, setPrescription] = useState<Prescription | null>(null)
  const [items, setItems] = useState<PrescriptionItem[]>([])
  const [initialItems, setInitialItems] = useState<PrescriptionItem[]>([])
  const [loading, setLoading] = useState(Boolean(recordId))
  const { pending: saving, run } = useSubmission()
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [reloadCount, setReloadCount] = useState(0)
  const [submitted, setSubmitted] = useState(false)

  const isCompleted = recordStatus === 'COMPLETED'
  const isReadOnly =
    isCompleted ||
    disabled ||
    saving ||
    loading ||
    failed ||
    prescription?.editable === false

  useEffect(() => {
    if (!recordId) return

    const controller = new AbortController()
    let active = true

    prescriptionGateway
      .get(recordId, controller.signal)
      .then((data) => {
        if (active && !controller.signal.aborted) {
          setPrescription(data)
          const loadedItems = data?.items || []
          setItems(loadedItems)
          setInitialItems(loadedItems)
          setSubmitted(false)
          setError('')
          setFailed(false)
        }
      })
      .catch((err) => {
        if (active && !controller.signal.aborted) {
          setError(prescriptionMessage(err))
          setFailed(true)
          if (
            err instanceof PrescriptionError &&
            [401, 403, 404].includes(err.status)
          )
            onConflict?.(err.status)
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
  }, [recordId, reloadCount, onConflict])

  const isDirty = !isPrescriptionEqual(items, initialItems)
  useEffect(() => {
    onStateChange?.(isDirty, saving || loading)
  }, [isDirty, saving, loading, onStateChange])
  const validation = validatePrescription(items)

  const handleAddItem = () => {
    if (isReadOnly || items.length >= MAX_PRESCRIPTION_ITEMS) return
    setItems((prev) => [...prev, createEmptyItem()])
  }

  const handleRemoveItem = (index: number) => {
    if (isReadOnly) return
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  const handleItemChange = (
    index: number,
    field: keyof PrescriptionItem,
    value: string | number,
  ) => {
    if (isReadOnly) return
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item
        return { ...item, [field]: value }
      }),
    )
  }

  const handleSave = async () => {
    if (isReadOnly || !isDirty) return
    setSubmitted(true)

    if (!validation.isValid) {
      setError('Vui lòng kiểm tra lại các trường thông tin đơn thuốc có lỗi.')
      return
    }

    void run(async (signal) => {
      setError('')
      setFeedback('')

      const currentExpectedVersion = recordVersion

      try {
        const saved = await prescriptionGateway.save(
          recordId,
          { items: items.map(cleanItem) },
          currentExpectedVersion,
          signal,
        )
        if (signal.aborted) return
        await onVersionChange?.(saved.recordVersion, signal)
        if (signal.aborted) return
        setPrescription(saved)
        setItems(saved.items)
        setInitialItems(saved.items)
        setSubmitted(false)
        setFeedback('Đã lưu toàn bộ đơn thuốc mô phỏng thành công.')
      } catch (err) {
        if (signal.aborted) return
        setError(prescriptionMessage(err))
        setFailed(true)
        onConflict?.(err instanceof PrescriptionError ? err.status : undefined)
      }
    })
  }

  const handleRetry = () => {
    setLoading(true)
    setPrescription(null)
    setItems([])
    setInitialItems([])
    setError('')
    setFeedback('')
    setReloadCount((prev) => prev + 1)
  }

  if (loading) {
    return <LoadingState />
  }

  return (
    <div className="space-y-4 rounded-lg border p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold sm:text-lg">
              Đơn thuốc mô phỏng
            </h3>
            {isCompleted ? (
              <Badge variant="secondary">Đã hoàn tất · Chỉ đọc</Badge>
            ) : isDirty ? (
              <Badge
                variant="outline"
                className="text-amber-600 dark:text-amber-400"
              >
                Chưa lưu
              </Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground sm:text-sm">
            {items.length} / {MAX_PRESCRIPTION_ITEMS} dòng thuốc
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isCompleted && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddItem}
                disabled={isReadOnly || items.length >= MAX_PRESCRIPTION_ITEMS}
              >
                <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                Thêm thuốc
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSave}
                disabled={isReadOnly || !isDirty}
              >
                {saving ? 'Đang lưu…' : 'Lưu đơn thuốc'}
              </Button>
            </>
          )}
          {error && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleRetry}
              disabled={saving}
            >
              <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Tải lại
            </Button>
          )}
        </div>
      </div>

      <Alert>
        <AlertCircle className="h-4 w-4" aria-hidden="true" />
        <AlertDescription className="text-xs sm:text-sm">
          {PRESCRIPTION_SIMULATION_NOTICE}
        </AlertDescription>
      </Alert>

      {error && (
        <Alert variant="destructive">
          <AlertDescription className="text-sm">{error}</AlertDescription>
        </Alert>
      )}

      {feedback && (
        <Alert className="border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300">
          <AlertDescription className="text-sm font-medium">
            {feedback}
          </AlertDescription>
        </Alert>
      )}

      {items.length === 0 ? (
        <div className="rounded-md border border-dashed py-8 text-center">
          <p className="text-sm text-muted-foreground">
            Chưa có dòng thuốc nào trong đơn thuốc mô phỏng.
          </p>
          {!isCompleted && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={handleAddItem}
              disabled={isReadOnly}
            >
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              Thêm dòng thuốc đầu tiên
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item, index) => {
            const itemErrors: PrescriptionItemErrors =
              submitted || isDirty ? validation.itemErrors[index] || {} : {}

            return (
              <Card
                key={item.id ? 'saved:' + item.id : 'draft:' + index}
                className="relative space-y-3 p-3.5 sm:p-4"
              >
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">
                    Thuốc #{index + 1}
                  </span>
                  {!isCompleted && (
                    <div className="flex flex-wrap gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isReadOnly || index === 0}
                        aria-label={`Di chuyển thuốc #${index + 1} lên`}
                        onClick={() =>
                          setItems((prev) => {
                            const next = [...prev]
                            ;[next[index - 1], next[index]] = [
                              next[index],
                              next[index - 1],
                            ]
                            return next
                          })
                        }
                      >
                        <ArrowUp className="size-4" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isReadOnly || index === items.length - 1}
                        aria-label={`Di chuyển thuốc #${index + 1} xuống`}
                        onClick={() =>
                          setItems((prev) => {
                            const next = [...prev]
                            ;[next[index + 1], next[index]] = [
                              next[index],
                              next[index + 1],
                            ]
                            return next
                          })
                        }
                      >
                        <ArrowDown className="size-4" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 text-destructive hover:bg-destructive/10"
                        onClick={() => handleRemoveItem(index)}
                        disabled={isReadOnly}
                        aria-label={`Xóa thuốc #${index + 1}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                        <span className="ml-1 text-xs sm:inline">Xóa</span>
                      </Button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="space-y-1 sm:col-span-2 lg:col-span-1">
                    <Label
                      htmlFor={`med-name-${index}`}
                      className="text-xs font-medium"
                    >
                      Tên thuốc <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id={`med-name-${index}`}
                      value={item.medicationName}
                      disabled={isReadOnly}
                      placeholder="VD: Paracetamol 500mg"
                      maxLength={200}
                      onChange={(e) =>
                        handleItemChange(
                          index,
                          'medicationName',
                          e.target.value,
                        )
                      }
                      className={
                        itemErrors.medicationName ? 'border-destructive' : ''
                      }
                    />
                    {itemErrors.medicationName && (
                      <p className="text-xs text-destructive">
                        {itemErrors.medicationName}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1">
                    <Label
                      htmlFor={`med-qty-${index}`}
                      className="text-xs font-medium"
                    >
                      Số lượng <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id={`med-qty-${index}`}
                      type="number"
                      min={1}
                      max={10000}
                      value={item.quantity || ''}
                      disabled={isReadOnly}
                      placeholder="10"
                      onChange={(e) =>
                        handleItemChange(
                          index,
                          'quantity',
                          Number(e.target.value),
                        )
                      }
                      className={
                        itemErrors.quantity ? 'border-destructive' : ''
                      }
                    />
                    {itemErrors.quantity && (
                      <p className="text-xs text-destructive">
                        {itemErrors.quantity}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1">
                    <Label
                      htmlFor={`med-dosage-${index}`}
                      className="text-xs font-medium"
                    >
                      Liều dùng <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id={`med-dosage-${index}`}
                      value={item.dosage}
                      disabled={isReadOnly}
                      placeholder="VD: 500mg / 1 viên"
                      maxLength={100}
                      onChange={(e) =>
                        handleItemChange(index, 'dosage', e.target.value)
                      }
                      className={itemErrors.dosage ? 'border-destructive' : ''}
                    />
                    {itemErrors.dosage && (
                      <p className="text-xs text-destructive">
                        {itemErrors.dosage}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1">
                    <Label
                      htmlFor={`med-freq-${index}`}
                      className="text-xs font-medium"
                    >
                      Tần suất <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id={`med-freq-${index}`}
                      value={item.frequency}
                      disabled={isReadOnly}
                      placeholder="VD: 2 lần/ngày sau ăn"
                      maxLength={100}
                      onChange={(e) =>
                        handleItemChange(index, 'frequency', e.target.value)
                      }
                      className={
                        itemErrors.frequency ? 'border-destructive' : ''
                      }
                    />
                    {itemErrors.frequency && (
                      <p className="text-xs text-destructive">
                        {itemErrors.frequency}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1">
                    <Label
                      htmlFor={`med-days-${index}`}
                      className="text-xs font-medium"
                    >
                      Số ngày <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id={`med-days-${index}`}
                      type="number"
                      min={1}
                      max={365}
                      value={item.durationDays || ''}
                      disabled={isReadOnly}
                      placeholder="5"
                      onChange={(e) =>
                        handleItemChange(
                          index,
                          'durationDays',
                          Number(e.target.value),
                        )
                      }
                      className={
                        itemErrors.durationDays ? 'border-destructive' : ''
                      }
                    />
                    {itemErrors.durationDays && (
                      <p className="text-xs text-destructive">
                        {itemErrors.durationDays}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1 sm:col-span-2 lg:col-span-1">
                    <Label
                      htmlFor={`med-inst-${index}`}
                      className="text-xs font-medium"
                    >
                      Hướng dẫn sử dụng
                    </Label>
                    <Input
                      id={`med-inst-${index}`}
                      value={item.instructions}
                      disabled={isReadOnly}
                      placeholder="VD: Uống với nhiều nước"
                      maxLength={1000}
                      onChange={(e) =>
                        handleItemChange(index, 'instructions', e.target.value)
                      }
                      className={
                        itemErrors.instructions ? 'border-destructive' : ''
                      }
                    />
                    {itemErrors.instructions && (
                      <p className="text-xs text-destructive">
                        {itemErrors.instructions}
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
