import axios from 'axios'

// No requests are made by the scaffold. Configure only when an API exists.
export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || undefined,
  timeout: 15_000,
  headers: { Accept: 'application/json' },
})

// Avoid accidentally sending requests to the frontend origin.
apiClient.interceptors.request.use((config) => {
  if (!import.meta.env.VITE_API_BASE_URL) {
    throw new Error(
      'API chưa được cấu hình. Thiết lập VITE_API_BASE_URL trước khi tích hợp.',
    )
  }
  return config
})
