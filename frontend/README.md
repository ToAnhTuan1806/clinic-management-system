# ClinicOS frontend — CL-D01-FE

Nền tảng giao diện quản lý phòng khám. Bản DEMO chưa tích hợp API/xác thực và không chứa dữ liệu bệnh nhân thật.

## Chạy cục bộ

Chạy các lệnh từ thư mục `frontend/`. Môi trường đã kiểm chứng: Node 26.13.1, npm 11.20.0. Dùng Node đáp ứng trường `engines` của Vite trong lockfile.

```sh
npm ci
npm run dev
npm run lint
npm run build
npm run preview
npm run format:check
```

PowerShell chặn npm.ps1 thì dùng `npm.cmd` / `npx.cmd`. Các lệnh lint/build cũng phải chạy trong `frontend/`, không phải thư mục gốc repository.

## Công nghệ

React + TypeScript strict + Vite; Tailwind CSS v4 (Vite plugin); shadcn/ui (Radix/Nova); Lucide; React Router; Axios; Magic UI BlurFade với Motion; Geist Variable tự host. Phiên bản cài đặt chính xác nằm trong `package-lock.json`.

## Các đường dẫn

| Đường dẫn          | Màn hình                                               |
| ------------------ | ------------------------------------------------------ |
| `/`                | Chuyển tới `/dashboard`                                |
| `/login`           | Form đăng nhập DEMO, không gửi hoặc lưu thông tin nhập |
| `/dashboard`       | Tổng quan nền tảng, chưa có số liệu                    |
| `/doctors`         | Placeholder bác sĩ                                     |
| `/patients`        | Placeholder bệnh nhân                                  |
| `/appointments`    | Placeholder lịch hẹn                                   |
| `/medical-records` | Placeholder hồ sơ bệnh án                              |
| `/settings`        | Theme và các trạng thái UI DEMO                        |
| `*`                | 404 và lối về tổng quan                                |

Đây là giao diện công khai để review scaffold. Đăng nhập, phân quyền và các nghiệp vụ chưa được triển khai. Khi triển khai SPA lên hosting cần cấu hình fallback các URL frontend về `index.html` để truy cập trực tiếp/refresh route hoạt động.

## Mở rộng

- Alias `@/*` trỏ tới `src/*`, đồng bộ trong `tsconfig.json`, `tsconfig.app.json` và `vite.config.ts`.
- `src/lib/navigation.ts`: danh sách phân hệ dùng chung cho sidebar, tiêu đề và routing.
- `src/components/layout/`: MainLayout, Sidebar, Header; mobile dùng Sheet của Radix.
- `src/index.css`: tokens và quy tắc Light/Dark, typography, focus, reduced motion.
- Chỉ lưu tùy chọn theme trong localStorage (`clinic-theme`). Không lưu tài khoản hoặc hồ sơ bệnh nhân.
- Settings có nút xem loading/empty/error được gắn nhãn DEMO.

Thêm shadcn component từ thư mục này với `npx shadcn@latest add <component>`. Cấu hình v4 sử dụng `components.json` và CSS-first, không cần `tailwind.config.js`. Giữ import `cn` nhất quán từ `@/lib/utils` khi thêm component.

## Chuẩn bị tích hợp API

`src/lib/api-client.ts` cung cấp Axios instance với timeout 15 giây. Chưa có request nào từ giao diện. Khi backend sẵn sàng, sao chép `.env.example` sang `.env.local` và điền `VITE_API_BASE_URL`; khởi động lại Vite. Nếu chưa cấu hình URL, request bị chặn trước khi gửi. Không đặt bí mật trong biến `VITE_*` vì chúng được đóng gói cho trình duyệt. Auth headers, xử lý lỗi nghiệp vụ và hợp đồng API cần được bổ sung theo backend thật.

## Bàn giao

- [Design system](docs/design-system.md)
- [Báo cáo CL-D01-FE và danh sách file](docs/CL-D01-FE.md)
- [Bằng chứng Playwright MCP](docs/qa/README.md)
- [Nguồn và giấy phép component](docs/third-party-notices.md)
