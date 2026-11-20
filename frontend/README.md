# ClinicOS frontend — D01 / D02 / D03

React + TypeScript + Vite, Tailwind CSS v4, shadcn/ui, Lucide, React Router, Axios và Magic UI. Giữ scaffold Modern Medical Dashboard D01 và bổ sung auth UI/routing D02.

**Auth D02 đã nghiệm thu đủ bốn role qua HTTP/MySQL thật: READY FOR COMMIT.** Playwright MCP đạt 32/32 nhóm scenario với PATIENT/ADMIN/DOCTOR/RECEPTIONIST; 21/21 unit/contract/mock tests được báo riêng. Xem [trạng thái contract](docs/auth-contract-status.md) và [QA thật](docs/qa/d02-real/README.md).

## CL-D03-FE — Doctor & Specialty UI

**STATUS: BLOCKED cho tích hợp thật.** UI và mock QA đã hoàn thiện; `docs/API_CONTRACT.md` vẫn là D02, doctors/specialties còn PROPOSED. Chưa có DTO, giới hạn validation, pagination/filter/status API và endpoint chọn user DOCTOR đã chốt. Không gọi endpoint suy đoán hoặc gửi view model tạm như DTO được duyệt. Cần contract và Backend D03 thật trước merge.

- `/specialties`: danh sách, tìm tên, lọc active/inactive, phân trang, chi tiết, thêm/sửa và xác nhận bật/tắt. Không hard delete.
- `/doctors`: danh sách, tìm tên, lọc chuyên khoa/trạng thái, phân trang, chi tiết, thêm/sửa giới thiệu và chuyên khoa. Mock chỉ cho chọn user DOCTOR active/chưa liên kết và specialty active.
- ADMIN quản lý; RECEPTIONIST xem danh mục; DOCTOR chỉ thấy hồ sơ liên kết tài khoản của mình (policy FE tạm, chờ BE xác nhận); PATIENT chỉ thấy doctor và specialty active. Giữ ProtectedRoute/RoleGuard; FE và mock không thay bảo mật Backend.
- Kế thừa theme/shadcn, dùng Radix cho modal/confirm, không animation mới. Loading/empty/error/success rõ ràng; khóa double submit và đóng form khi đang lưu, hủy stale requests, hỗ trợ keyboard/focus và responsive.
- Validation hiện chỉ tối thiểu: tên chuyên khoa không rỗng, chọn user/specialty còn hợp lệ. Các trường name/description/userId/specialtyId/biography là **view model FE tạm**, chưa phải DTO/validation Backend D03. Không cho đổi tài khoản đã liên kết trong bản UI tạm; tên bác sĩ lấy từ tài khoản.
- Mặc định gateway pending, không HTTP hoặc DEMO fallback, khóa mutation và báo chưa kết nối. Mock chỉ opt-in khi DEV và `VITE_DIRECTORY_MOCK=true`; dữ liệu DEMO ở memory. Production loại fixtures/fault hooks kể cả khi cờ QA bật.

Từ `frontend/`, mở UI QA bằng PowerShell:

```powershell
$env:VITE_AUTH_MOCK = 'true'
$env:VITE_DIRECTORY_MOCK = 'true'
npm.cmd run dev -- --host 127.0.0.1 --port 5176 --strictPort
```

Auth mock không tự tạo tài khoản. [Runner D03](tests/e2e/directory-mock-runner.mjs) thiết lập auth state synthetic và gateway DEMO; [runner D02](tests/e2e/auth-mock-runner.mjs) intercept auth HTTP. Cả hai đã chạy qua Playwright MCP. Wrapper CLI `npm run test:e2e:mock` dùng cổng 5174 khi Chromium được cài; screenshot/trace/video off. CLI wrapper chưa được chạy trong đợt này.

**Kết quả:** 35/35 unit/contract/mock tests (21 D02 + 14 D03); 15/15 nhóm D03 MOCK UI; 15/15 nhóm Auth D02 MOCK regression; 0 uncaught runtime errors trong các lượt đạt. Đây là nhóm assertion, không phải 30 Playwright Test cases độc lập. [Bằng chứng JSON](docs/qa/d03-results.json). Không tạo screenshot mới.

[Production pending runner](tests/e2e/directory-pending-runner.mjs) PASS qua MCP: build với mock flags=true vẫn không có directory mock, khóa mutation và không gửi HTTP D03. Ca này **chỉ mock D02 auth transport** tới origin QA 59999, không phải Backend thật. Đã rà bundle loại fixtures/fault hooks D03.

Đã sửa focus regression D02 khi lỗi Login trả nhanh: focus thông báo sau pending=false/fieldset được bật trong DOM, áp dụng Login/Register; sau đó UI Auth D02 chạy lại đủ 15 nhóm PASS. Sửa focus đóng modal D03 và assumption của harness về deep-link redirect; không đổi routing D02 để test đạt. Một lượt unit chạy cùng cờ browser QA=true đã lỗi `window is not defined`; chạy lại với cờ mock=false đã đạt. Không lấy lượt lỗi làm PASS.

Lint/build/format/test đều PASS. Unit Node dùng mock=false; flags=true chỉ dành cho Vite/browser QA. 401/403/network của D03 hiện là mock fault injection. **Real D03: NOT TESTED**, chưa nghiệm thu DTO/validation hay quyền/ownership server.

Files D03: `.env.example`, `README.md`, `playwright.config.ts`, `src/app.tsx`, `src/lib/navigation.ts`, `src/vite-env.d.ts`, `src/pages/{directory,login,register}.tsx`, `src/components/ui/dialog.tsx`, `src/components/directory/editor.tsx`, `src/directory/{model,gateway}.ts`, `src/testing/directory-mock.ts`, `tests/directory.mock.test.ts`, `tests/e2e/{directory-mock-runner,directory-pending-runner}.mjs`, `tests/e2e/directory.mock.spec.ts`, `docs/qa/d03-results.json`. Giữ nguyên thay đổi/bằng chứng D02 sẵn có; không sửa BE/DB/migration hoặc thực hiện Git mutation.

## Chạy và kiểm tra

Chạy từ `frontend/` (môi trường đã kiểm chứng: Node 26.13.1, npm 11.20.0):

```sh
npm ci
npm run dev
npm run lint
npm run build
npm run format:check
npm run test
npm run preview
```

PowerShell chặn npm.ps1 thì dùng `npm.cmd` / `npx.cmd`.

## Auth và routing

- `/login`, `/register`: Form của shadcn + React Hook Form, lỗi theo trường, hiện/ẩn password, loading và khóa gửi lặp. Public register chỉ dành cho PATIENT, không có role picker.
- AuthProvider quản lý accessToken/user trong memory; không lưu JWT hoặc user vào localStorage/sessionStorage. Reload yêu cầu đăng nhập lại. Login chỉ tạo phiên sau khi nhận token và xác minh `/api/v1/auth/me` thành công.
- Axios thêm Bearer cho request của phiên; 401 xóa phiên/chuyển Login, 403 hiển thị thiếu quyền. Lỗi 401 cũ không xóa phiên mới. Logout chỉ xóa state/abort thao tác phía client, không tự thêm endpoint chưa có contract.
- PATIENT vào `/booking`; staff vào `/dashboard`. ProtectedRoute kiểm tra auth, RoleGuard kiểm tra role khi truy cập route. Sidebar lọc theo cùng policy; FE guard không thay thế bảo mật/ownership ở BE.
- `/doctors` và `/specialties` dùng UI D03 nêu trên; `/patients`, `/appointments`, `/medical-records`, `/settings` giữ scaffold/placeholder theo role. Có `/forbidden` và 404. Không có dữ liệu giả được trình bày như API thật.
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
