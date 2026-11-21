import { BookingError, type BookingGateway } from './model'
import { apiClient } from '@/lib/api-client'
import { createBookingApi } from './api'

// Only an unconfigured API origin is pending. A failed real request never falls back to mock.
const unavailable = async (): Promise<never> => {
  throw new BookingError('API_NOT_CONFIGURED')
}

export const pendingBookingGateway: BookingGateway = {
  mode: 'pending',
  bookAppointment: unavailable,
  getAppointment: unavailable,
  listMyAppointments: unavailable,
  listAppointments: unavailable,
  changeSlot: unavailable,
  cancelAppointment: unavailable,
  confirmAppointment: unavailable,
  checkInAppointment: unavailable,
  markNoShow: unavailable,
}

export const isBookingMock =
  import.meta.env.DEV && import.meta.env.VITE_BOOKING_MOCK === 'true'

export const bookingGateway: BookingGateway = isBookingMock
  ? (await import('@/testing/booking-mock')).createBookingMock()
  : apiClient.defaults.baseURL
    ? createBookingApi(apiClient)
    : pendingBookingGateway
