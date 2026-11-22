import axios, { type AxiosInstance } from 'axios'
import { getAuthSnapshot } from '@/auth/session-store'
import { normalizeAuthError } from '@/auth/errors'
import { fromUtcIsoToVnParts } from '@/schedule/model'
import {
  HistoryError,
  pageSize,
  type HistoryDetail,
  type HistoryGateway,
  type HistoryItem,
  type HistoryPage,
  type HistoryQuery,
} from './model'

export function createHistoryApi(client: AxiosInstance): HistoryGateway {
  let cacheVersion = -1
  const appointmentCache = new Map<
    string,
    { doctorFullName?: string; specialtyName?: string; startAt?: string }
  >()

  function checkAuth() {
    const session = getAuthSnapshot()
    if (cacheVersion !== session.version) {
      appointmentCache.clear()
      cacheVersion = session.version
    }
    if (session.status !== 'authenticated' || !session.user) {
      throw new HistoryError(401)
    }
    if (session.user.role !== 'DOCTOR' && session.user.role !== 'PATIENT')
      throw new HistoryError(403)
    return session.user
  }

  async function read(
    url: string,
    config: { signal: AbortSignal; params?: Record<string, unknown> },
  ) {
    checkAuth()
    const version = getAuthSnapshot().version
    const response = await client.get(url, config)
    config.signal.throwIfAborted()
    if (getAuthSnapshot().version !== version)
      throw new DOMException('Session changed', 'AbortError')
    return response
  }
  const userRole = () => checkAuth().role

  function handleAxiosError(error: unknown, signal?: AbortSignal): never {
    if (signal?.aborted) {
      throw signal.reason || new DOMException('Aborted', 'AbortError')
    }
    if (error instanceof HistoryError) {
      throw error
    }
    if (axios.isAxiosError(error)) {
      const status = error.response?.status ?? 0
      throw new HistoryError(status)
    }
    const normalized = normalizeAuthError(error)
    throw new HistoryError(normalized.status)
  }

  async function getAppointmentInfo(
    appointmentId: string,
    signal: AbortSignal,
  ) {
    if (!appointmentId) return null
    if (appointmentCache.has(appointmentId)) {
      return appointmentCache.get(appointmentId)!
    }
    try {
      const response = await read(`/api/v1/appointments/${appointmentId}`, {
        signal,
      })
      const data = response.data?.data
      if (data) {
        const info = {
          doctorFullName: data.doctorFullName || undefined,
          specialtyName: data.specialtyName || undefined,
          startAt: data.startAt || undefined,
        }
        appointmentCache.set(appointmentId, info)
        return info
      }
    } catch (error) {
      handleAxiosError(error, signal)
    }
    return null
  }

  return {
    mode: 'real',

    async patients(
      signal: AbortSignal,
    ): Promise<{ id: string; name: string }[]> {
      signal.throwIfAborted()
      const user = checkAuth()

      if (user.role === 'PATIENT') {
        try {
          const response = await read('/api/v1/me/patient-profile', {
            signal,
          })
          const data = response.data?.data
          if (!data || !data.id) {
            throw new HistoryError(404)
          }
          return [
            {
              id: String(data.id),
              name: data.fullName || 'Bệnh nhân',
            },
          ]
        } catch (error) {
          handleAxiosError(error, signal)
        }
      }

      if (user.role === 'DOCTOR') {
        try {
          // Backend automatically scopes /api/v1/appointments to the logged-in doctor
          const patientMap = new Map<string, string>()
          for (let page = 0; ; page++) {
            const response = await read('/api/v1/appointments', {
              params: page ? { size: 100, page } : { size: 100 },
              signal,
            })
            const payload = response.data?.data
            const items = payload?.items ?? []
            for (const item of items) {
              if (
                typeof item.id === 'string' &&
                typeof item.startAt === 'string'
              ) {
                appointmentCache.set(item.id, {
                  doctorFullName: item.doctorFullName,
                  specialtyName: item.specialtyName,
                  startAt: item.startAt,
                })
              }
              if (item.patientId && !patientMap.has(String(item.patientId))) {
                patientMap.set(
                  String(item.patientId),
                  item.patientFullName ||
                    item.patientCode ||
                    `Bệnh nhân #${item.patientId}`,
                )
              }
            }
            if (
              !items.length ||
              (page + 1) * 100 >= (payload?.totalElements ?? items.length)
            )
              break
          }
          return Array.from(patientMap.entries()).map(([id, name]) => ({
            id,
            name,
          }))
        } catch (error) {
          handleAxiosError(error, signal)
        }
      }

      // ADMIN, RECEPTIONIST, or other roles do not have clinical history workspace access
      throw new HistoryError(403)
    },

    async list(
      patientId: string,
      query: HistoryQuery,
      signal: AbortSignal,
    ): Promise<HistoryPage> {
      signal.throwIfAborted()
      const viewer = checkAuth()
      if (!patientId) {
        return { items: [], total: 0 }
      }

      const hasClientFilter = Boolean(
        query.search.trim() ||
        query.from ||
        query.to ||
        (query.publication !== 'ALL' &&
          !(viewer.role === 'PATIENT' && query.publication === 'RELEASED')),
      )

      try {
        const fetchSize = hasClientFilter ? 100 : pageSize
        const fetchPage = hasClientFilter ? 0 : query.page

        const response = await read(
          `/api/v1/patients/${patientId}/medical-history`,
          {
            params: {
              page: fetchPage,
              size: fetchSize,
            },
            signal,
          },
        )

        const data = response.data?.data
        const rawItems: Record<string, any>[] = [...(data?.items ?? [])]
        const serverTotal: number =
          typeof data?.totalElements === 'number'
            ? data.totalElements
            : rawItems.length

        if (hasClientFilter) {
          for (let page = 1; page * fetchSize < serverTotal; page++) {
            const next = await read(
              `/api/v1/patients/${patientId}/medical-history`,
              { params: { page, size: fetchSize }, signal },
            )
            const payload = next.data?.data
            if (!Array.isArray(payload?.items) || payload.items.length === 0)
              throw new HistoryError(0)
            rawItems.push(...payload.items)
          }
        }
        // Preserve Backend completedAt DESC/id DESC ordering while enriching metadata.
        const enrichedItems: HistoryItem[] = await Promise.all(
          rawItems.map(async (row) => {
            const apt = await getAppointmentInfo(
              String(row.appointmentId),
              signal,
            )
            const appointmentAt = apt?.startAt || row.completedAt
            const doctorName =
              apt?.doctorFullName ||
              (row.doctorId ? `Bác sĩ #${row.doctorId}` : 'Bác sĩ')
            const specialtyName = apt?.specialtyName || 'Chuyên khoa'

            return {
              id: String(row.id),
              patientId: String(patientId),
              appointmentAt,
              doctorName,
              specialtyName,
              status: 'COMPLETED',
              releasedAt: row.releasedAt ?? null,
              version: typeof row.version === 'number' ? row.version : 0,
              assigned: userRole() === 'DOCTOR',
            }
          }),
        )

        if (hasClientFilter) {
          const searchLower = query.search.trim().toLocaleLowerCase('vi')
          const filtered = enrichedItems.filter(
            (row) =>
              (!query.from ||
                fromUtcIsoToVnParts(row.appointmentAt).date >= query.from) &&
              (!query.to ||
                fromUtcIsoToVnParts(row.appointmentAt).date <= query.to) &&
              (query.publication === 'ALL' ||
                (query.publication === 'RELEASED'
                  ? Boolean(row.releasedAt)
                  : !row.releasedAt)) &&
              (!searchLower ||
                (row.doctorName + ' ' + row.specialtyName)
                  .toLocaleLowerCase('vi')
                  .includes(searchLower)),
          )

          return {
            total: filtered.length,
            items: filtered.slice(
              query.page * pageSize,
              (query.page + 1) * pageSize,
            ),
          }
        }

        return {
          total: serverTotal,
          items: enrichedItems,
        }
      } catch (error) {
        handleAxiosError(error, signal)
      }
    },

    async detail(
      patientId: string,
      id: string,
      signal: AbortSignal,
    ): Promise<HistoryDetail> {
      signal.throwIfAborted()
      checkAuth()

      try {
        const response = await read(`/api/v1/medical-records/${id}`, {
          signal,
        })
        const rec = response.data?.data
        if (!rec) {
          throw new HistoryError(404)
        }
        if (
          String(rec.id) !== id ||
          String(rec.patientId) !== patientId ||
          (userRole() === 'PATIENT' &&
            (rec.status !== 'COMPLETED' || !rec.releasedAt))
        )
          throw new HistoryError(404)

        const apt = await getAppointmentInfo(String(rec.appointmentId), signal)
        const appointmentAt = apt?.startAt || rec.completedAt || rec.createdAt
        const doctorName =
          apt?.doctorFullName ||
          (rec.doctorId ? `Bác sĩ #${rec.doctorId}` : 'Bác sĩ')
        const specialtyName = apt?.specialtyName || 'Chuyên khoa'

        const item: HistoryItem = {
          id: String(rec.id),
          patientId: String(rec.patientId || patientId),
          appointmentAt,
          doctorName,
          specialtyName,
          status: rec.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'COMPLETED',
          releasedAt: rec.releasedAt ?? null,
          version: typeof rec.version === 'number' ? rec.version : 0,
          assigned: userRole() === 'DOCTOR',
        }

        return {
          item,
          symptoms: rec.symptoms ?? '',
          diagnosis: rec.diagnosis ?? '',
          notes: rec.notes ?? '',
          conclusion: rec.conclusion ?? '',
        }
      } catch (error) {
        handleAxiosError(error, signal)
      }
    },

    async release(
      _patientId: string,
      id: string,
      expectedVersion: number,
      signal: AbortSignal,
    ): Promise<void> {
      signal.throwIfAborted()
      const user = checkAuth()

      if (user.role !== 'DOCTOR') {
        throw new HistoryError(403)
      }

      if (
        typeof expectedVersion !== 'number' ||
        !Number.isSafeInteger(expectedVersion) ||
        expectedVersion < 0
      ) {
        throw new HistoryError(400)
      }

      try {
        await client.post(
          `/api/v1/medical-records/${id}/release`,
          { expectedVersion },
          { signal },
        )
      } catch (error) {
        handleAxiosError(error, signal)
      }
    },
  }
}
