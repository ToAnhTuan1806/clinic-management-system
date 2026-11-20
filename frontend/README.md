# ClinicOS frontend — D01 + CL-D02-FE

React + TypeScript + Vite, Tailwind CSS v4, shadcn/ui, Lucide, React Router, Axios và Magic UI. Giữ scaffold Modern Medical Dashboard D01 và bổ sung auth UI/routing D02.

**Backend auth chưa tích hợp thật.** Contract mới nhất trên dev vẫn là D01 và các API auth còn PROPOSED. Profile mặc định không gửi request auth theo schema chưa được duyệt. Xem [trạng thái contract](docs/auth-contract-status.md).

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

`AuthContract` tách encoder/decoder khỏi model FE. `backendAuthContract` đang null vì contract D02 chưa có DTO. Không sao chép schema fixture sang Backend thật theo suy đoán. Sau khi BE merge, đối chiếu contract, điền adapter thật và đồng bộ validation; cấu hình `VITE_API_BASE_URL` bằng origin Backend trong `.env.local`, tắt mock, xác minh CORS/CSRF và chạy lại checklist tích hợp. Không đưa bí mật vào `VITE_*`.

## Tài liệu bàn giao

- [Báo cáo CL-D02-FE và danh sách file thay đổi](docs/CL-D02-FE.md)
- [Contract, giới hạn và checklist sau merge](docs/auth-contract-status.md)
- [QA D02 và screenshots](docs/qa/d02/README.md)
- [Design system](docs/design-system.md)
- [Báo cáo D01 lưu lại](docs/CL-D01-FE.md)
- [Giấy phép component](docs/third-party-notices.md)
