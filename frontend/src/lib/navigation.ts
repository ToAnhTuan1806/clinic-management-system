import {
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  Settings2,
  Stethoscope,
  UsersRound,
} from 'lucide-react'

export const navigation = [
  {
    path: '/dashboard',
    label: 'Tổng quan',
    title: 'Tổng quan phòng khám',
    icon: LayoutDashboard,
    description: 'Không gian làm việc của phòng khám.',
  },
  {
    path: '/doctors',
    label: 'Bác sĩ',
    title: 'Đội ngũ bác sĩ',
    icon: Stethoscope,
    description: 'Quản lý đội ngũ và thông tin chuyên môn tại một nơi.',
  },
  {
    path: '/patients',
    label: 'Bệnh nhân',
    title: 'Quản lý bệnh nhân',
    icon: UsersRound,
    description: 'Không gian dành cho danh sách và thông tin bệnh nhân.',
  },
  {
    path: '/appointments',
    label: 'Lịch hẹn',
    title: 'Quản lý lịch hẹn',
    icon: CalendarDays,
    description: 'Theo dõi lịch khám và điều phối các cuộc hẹn.',
  },
  {
    path: '/medical-records',
    label: 'Hồ sơ bệnh án',
    title: 'Hồ sơ bệnh án',
    icon: ClipboardList,
    description: 'Không gian dành cho hồ sơ khám và lịch sử điều trị.',
  },
  {
    path: '/settings',
    label: 'Cài đặt',
    title: 'Cài đặt không gian làm việc',
    icon: Settings2,
    description: 'Tùy chỉnh giao diện và xem các thành phần nền tảng.',
  },
] as const
