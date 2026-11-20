# ClinicOS frontend — D01 + CL-D02-FE

React + TypeScript + Vite, Tailwind CSS v4, shadcn/ui, Lucide, React Router, Axios và Magic UI. Giữ scaffold Modern Medical Dashboard D01 và bổ sung auth UI/routing D02.

**Auth D02 đã nghiệm thu đủ bốn role qua HTTP/MySQL thật: READY FOR COMMIT.** Playwright MCP đạt 32/32 nhóm scenario với PATIENT/ADMIN/DOCTOR/RECEPTIONIST; 21/21 unit/contract/mock tests được báo riêng. Xem [trạng thái contract](docs/auth-contract-status.md) và [QA thật](docs/qa/d02-real/README.md).

## Chạy và kiểm tra

Chạy từ `frontend/` (môi trường đã kiểm chứng: Node 26.13.1, npm 11.20.0):

```sh
npm ci
npm run dev
npm run lint
npm run build
npm run format:check
npm run test:mock
npm run preview
```

PowerShell chặn npm.ps1 thì dùng `npm.cmd` / `npx.cmd`.

## Auth và routing

- `/login`, `/register`: Form của shadcn + React Hook Form, lỗi theo trường, hiện/ẩn password, loading và khóa gửi lặp. Public register chỉ dành cho PATIENT, không có role picker.
- AuthProvider quản lý accessToken/user trong memory; không lưu JWT hoặc user vào localStorage/sessionStorage. Reload yêu cầu đăng nhập lại. Login chỉ tạo phiên sau khi nhận token và xác minh `/api/v1/auth/me` thành công.
- Axios thêm Bearer cho request của phiên; 401 xóa phiên/chuyển Login, 403 hiển thị thiếu quyền. Lỗi 401 cũ không xóa phiên mới. Logout chỉ xóa state/abort thao tác phía client, không tự thêm endpoint chưa có contract.
- PATIENT vào `/booking`; staff vào `/dashboard`. ProtectedRoute kiểm tra auth, RoleGuard kiểm tra role khi truy cập route. Sidebar lọc theo cùng policy; FE guard không thay thế bảo mật/ownership ở BE.
- `/doctors`, `/patients`, `/appointments`, `/medical-records`, `/settings` giữ scaffold và placeholder DEMO theo role. Có `/forbidden` và 404. Không có dữ liệu bác sĩ/bệnh nhân bịa đặt được trình bày như API thật.
- Theme Light/Dark/System của D01 được giữ, chỉ lưu `clinic-theme`; keyboard/focus và reduced motion được hỗ trợ.
- Alias `@/*` trỏ tới `src/*` đồng bộ giữa TypeScript/Vite. Khi deploy SPA cần fallback URL về `index.html`.

## Chế độ kiểm thử API mock

Không có tài khoản mặc định hoặc API giả tự chạy trong ứng dụng. Test harness intercept request và trả fixture có nhãn MOCK. Có thể chạy wrapper CLI nếu Chromium của Playwright đã được cài:

```sh
npm run test:e2e:mock
```

Playwright config khởi động Vite ở cổng 5174 với `VITE_AUTH_MOCK=true`. Chỉ profile development chủ động bật cờ này được dùng mock contract; production luôn tắt và loại mock adapter khỏi bundle. Không đặt cờ mock vào cấu hình production. Chạy Vite mock mà không có test harness sẽ không tự tạo tài khoản/phiên.

Bộ runner cũng đã được thực thi qua **Playwright MCP**; xem [bằng chứng D02](docs/qa/d02/README.md). Test mock và test Backend thật được báo cáo riêng.

## Chuẩn bị API thật

Ba method/path đã được giữ nguyên trong `src/auth/api.ts`:

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`

`AuthContract` tách encoder/decoder khỏi model FE. `src/auth/backend-contract.ts` kiểm tra response thật theo `docs/API_CONTRACT.md` D02: data/Bearer/expiresIn/user ACTIVE, id chuỗi. Cấu hình `VITE_API_BASE_URL` bằng origin Backend trong `.env.local` hoặc environment, tắt mock và cấu hình CORS origin chính xác ở BE. Không đưa bí mật vào `VITE_*`.

Ví dụ cấu hình local dùng Vite `http://127.0.0.1:5175` và Backend `http://127.0.0.1:8080` (runtime PATIENT lịch sử). Từ `frontend/`, PowerShell:

```powershell
$env:VITE_API_BASE_URL = 'http://127.0.0.1:8080'
$env:VITE_AUTH_MOCK = 'false'
npm.cmd run dev -- --host 127.0.0.1 --port 5175 --strictPort
```

Backend phải kết nối đúng DB QA Clinic, không sử dụng mù quáng DB_* toàn máy hoặc tự migrate schema. Đợt acceptance staff hiện tại dùng Vite 5173 và stack QA cô lập fixture `83710bc5bb2e`, đã đối chiếu JAR/DB/roles/V1. Credential lấy từ Windows Credential Manager qua PowerShell host, chỉ handoff trong RAM Chrome; xem cách chạy an toàn và bằng chứng trong báo cáo QA thật.

## Tài liệu bàn giao

- [Báo cáo CL-D02-FE và danh sách file thay đổi](docs/CL-D02-FE.md)
- [Contract, giới hạn và checklist sau merge](docs/auth-contract-status.md)
- [QA HTTP/MySQL thật và screenshots](docs/qa/d02-real/README.md)
- [QA mock cũ lưu lại](docs/qa/d02/README.md)
- [Design system](docs/design-system.md)
- [Báo cáo D01 lưu lại](docs/CL-D01-FE.md)
- [Giấy phép component](docs/third-party-notices.md)
