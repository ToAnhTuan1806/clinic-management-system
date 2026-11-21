import { ScheduleError, type ScheduleGateway } from './model'
import { apiClient } from '@/lib/api-client'
import { createScheduleApi } from './api'

// Only an unconfigured API origin is pending. A failed real request never falls back to mock.
const unavailable = async (): Promise<never> => {
  throw new ScheduleError('API_NOT_CONFIGURED')
}

export const pendingScheduleGateway: ScheduleGateway = {
  mode: 'pending',
  listSchedules: unavailable,
  getSchedule: unavailable,
  createSchedule: unavailable,
  updateSchedule: unavailable,
  blockSchedule: unavailable,
  listDoctorSlots: unavailable,
}

export const isScheduleMock =
  import.meta.env.DEV && import.meta.env.VITE_SCHEDULE_MOCK === 'true'

export const scheduleGateway: ScheduleGateway = isScheduleMock
  ? (await import('@/testing/schedule-mock')).createScheduleMock()
  : apiClient.defaults.baseURL
    ? createScheduleApi(apiClient)
    : pendingScheduleGateway
