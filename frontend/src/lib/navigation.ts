import {
  CalendarClock,
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  Layers2,
  Settings2,
  Stethoscope,
  UserCheck,
  UserRound,
  UsersRound,
} from 'lucide-react'
import type { Role } from '@/auth/types'

const staff: readonly Role[] = ['ADMIN', 'DOCTOR', 'RECEPTIONIST']
const everyone: readonly Role[] = [...staff, 'PATIENT']

export const navigation = [
  {
    path: '/dashboard',
    roles: staff,
    label: 'Tổng quan',
    title: 'Tổng quan phòng khám',
    icon: LayoutDashboard,
    description: 'Không gian làm việc của phòng khám.',
  },
  {
    path: '/doctors',
    roles: everyone,
    label: 'Bác sĩ',
    title: 'Đội ngũ bác sĩ',
    icon: Stethoscope,
    description: 'Quản lý đội ngũ và thông tin chuyên môn tại một nơi.',
  },
  {
    path: '/specialties',
    roles: everyone,
    label: 'Chuyên khoa',
    title: 'Chuyên khoa',
    icon: Layers2,
    description: 'Danh mục chuyên khoa và trạng thái phục vụ.',
  },
  {
    path: '/patients',
    roles: ['ADMIN', 'RECEPTIONIST'] as readonly Role[],
    label: 'Bệnh nhân',
    title: 'Quản lý bệnh nhân',
    icon: UsersRound,
    description: 'Không gian dành cho danh sách và thông tin bệnh nhân.',
  },
  {
    path: '/schedules',
    roles: everyone,
    label: 'Lịch làm việc',
    title: 'Lịch làm việc bác sĩ',
    icon: CalendarClock,
    description: 'Theo dõi và quản lý ca làm việc của đội ngũ bác sĩ.',
  },
  {
    path: '/appointments',
    roles: everyone,
    label: 'Lịch hẹn',
    title: 'Quản lý lịch hẹn',
    icon: CalendarDays,
    description: 'Theo dõi lịch khám và điều phối các cuộc hẹn.',
  },
  {
    path: '/reception/appointments',
    roles: ['RECEPTIONIST'] as readonly Role[],
    label: 'Tiếp đón',
    title: 'Bàn tiếp đón & Điều phối lịch khám',
    icon: UserCheck,
    description:
      'Quản lý lịch hẹn hôm nay, tiếp đón, xác nhận và xử lý vắng mặt.',
  },
  {
    path: '/medical-records',
    roles: ['DOCTOR'] as readonly Role[],
    label: 'Hồ sơ bệnh án',
    title: 'Hồ sơ bệnh án',
    icon: ClipboardList,
    description: 'Không gian dành cho hồ sơ khám và lịch sử điều trị.',
  },
  {
    path: '/profile',
    roles: everyone,
    label: 'Hồ sơ cá nhân',
    title: 'Hồ sơ cá nhân',
    icon: UserRound,
    description: 'Quản lý thông tin tài khoản và hồ sơ liên kết.',
  },
  {
    path: '/settings',
    roles: everyone,
    label: 'Cài đặt',
    title: 'Cài đặt không gian làm việc',
    icon: Settings2,
    description: 'Tùy chỉnh giao diện và xem các thành phần nền tảng.',
  },
  {
    path: '/booking',
    roles: ['PATIENT', 'RECEPTIONIST'] as readonly Role[],
    label: 'Đặt lịch khám',
    title: 'Đặt lịch khám',
    icon: CalendarDays,
    description: 'Không gian đặt lịch và theo dõi lịch khám của bạn.',
  },
] as const

export const roleHome = (role: Role) =>
  role === 'PATIENT' ? '/booking' : '/dashboard'
export const canAccessPath = (role: Role, path: string) =>
  navigation.some((item) => item.path === path && item.roles.includes(role))
