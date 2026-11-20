# TASK: CL-D02-FE

**BRANCH:** `feature/trang`

**STATUS: READY FOR REVIEW — phạm vi Frontend và API mock. Tích hợp Backend thật đang chờ contract D02.**

## AUTH UI

- Hoàn thiện Login và thêm Register với shadcn Form/Input/Button/Alert, React Hook Form; lỗi theo trường, hiện/ẩn mật khẩu, loading, aria-busy, focus, Enter và khóa double submit.
- Public Register chỉ có tài khoản PATIENT, không chọn role nhân viên; encoder whitelist không nhận role/confirmPassword.
- Chỉ điều hướng sau khi nhận/kiểm tra response hợp lệ; không có thông báo đăng nhập thành công giả, nút bỏ qua auth hoặc tài khoản mặc định.
- Giữ màu sắc, typography, responsive, Theme Light/Dark/System và reduced motion của D01. Không khởi tạo lại React hoặc xóa scaffold D01.

## API INTEGRATION

Đã chuẩn bị đúng `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `GET /api/v1/auth/me`, envelope `data`, Problem Details theo status/code/errors, Bearer interceptor, timeout và thông báo lỗi an toàn.

**Chưa tích hợp Backend thật.** Đã đọc contract mới nhất qua GitHub trên `dev` và `feature/tuan`: cả hai vẫn D01, auth PROPOSED, chưa có DTO/validation D02. Vì vậy không tự suy đoán wire schema cho production. `backendAuthContract` để null; profile mặc định dừng trước khi gửi request và báo dịch vụ chưa sẵn sàng. Schema fixture được cô lập trong adapter **MOCK ONLY**, chỉ bật ở development có cờ riêng và không nằm trong artifact production.

[Nguồn contract, schema fixture và checklist sau merge](auth-contract-status.md).

## ROLE ROUTING

- AuthProvider/Context và session store quản lý token/user chỉ trong memory; reload yêu cầu đăng nhập lại. Không lưu JWT/user vào localStorage hoặc sessionStorage.
- Chỉ thiết lập phiên sau login và `/auth/me` thành công; role lấy từ user response được decoder kiểm tra, không tự giải mã JWT để cấp quyền.
- ProtectedRoute kiểm tra auth, RoleGuard kiểm tra quyền tại URL; Sidebar dùng cùng policy.
- PATIENT về `/booking`; ADMIN/DOCTOR/RECEPTIONIST về dashboard có nội dung/layout theo role. Phân hệ chưa có nghiệp vụ giữ DEMO.
- 401 của phiên hiện tại xóa user/token rồi về Login; 403 giữ phiên và báo thiếu quyền. Response 401 cũ không làm mất phiên mới. Logout xóa auth state và abort login đang chờ.
- RoleGuard là kiểm soát trải nghiệm phía FE; quyền/ownership/phân công tại API thật vẫn bắt buộc. Ma trận hiện tại ưu tiên quyền tối thiểu, cần đối chiếu D02 BE.

## LINT/BUILD

Đã chạy trong `frontend/`: `npm run lint`, `npm run build`, `npm run format:check` — **PASS**, exit 0. Lint không lỗi/cảnh báo. `npm run test:mock` — **16/16 PASS**.

## PLAYWRIGHT MCP

**Đã kết nối và thực thi**, Chromium. **15 nhóm kịch bản API MOCK PASS**, gồm validation, password visibility, đăng ký PATIENT, sai thông tin, unauthorized redirect, role routing, 401/403, logout/reload, mobile navigation, Light/Dark/System, keyboard/focus, network errors và reduced motion. Không có uncaught runtime error; không có request ngoài fixture.

Production preview kiểm chứng mock tắt, route bảo vệ chuyển Login, form auth không gửi request khi contract thiếu; console 0 lỗi/cảnh báo. Đây không phải kiểm thử Backend thật.

## SCREENSHOTS

7 ảnh chụp đã xem trực tiếp, không chứa token hoặc thông tin bệnh nhân thật. [Ảnh và báo cáo chi tiết](qa/d02/README.md); [kết quả mock dạng JSON](qa/d02/mock-results.json). Source test được lưu để chạy lại bằng MCP hoặc wrapper CLI; không tuyên bố đã chạy Playwright CLI.

## REAL BACKEND TEST

**NOT RUN / BLOCKED** — chưa có schema auth D02 trong contract dev, chưa xác minh các API auth thật. Không dùng kết quả mock để tuyên bố tích hợp thành công. Checklist kiểm thử lại sau khi BE merge đã được ghi trong tài liệu contract.

## RISKS/BLOCKERS

- Cần BE chốt DTO, schema login token/user/register, code lỗi và validation để điền adapter thật; hiện profile mặc định chưa đăng nhập/đăng ký được.
- Giới hạn đăng ký FE 2–100 ký tự cho họ tên, password 8–128 và email tối đa 254 là tạm thời; chưa tuyên bố khớp Bean Validation BE.
- Cần xác nhận CORS/CSRF/Bearer transport, ma trận quyền và ownership với BE. Logout hiện chỉ phía client, chưa có revoke server.
- Chưa QA Firefox/Safari, thiết bị thật hoặc screen reader. Không tuyên bố chứng nhận WCAG.

Chỉ thay đổi `frontend/`. `.gitignore` gốc là file untracked có sẵn lúc bắt đầu, không sửa. Không thao tác Backend/DB/Docker; không tạo/chuyển nhánh/worktree, commit, push, pull, fetch Git, merge, rebase hoặc reset.

## FILES CHANGED

Danh sách 56 file FE thay đổi, tính từ gốc repository; không tính .gitignore gốc có sẵn hoặc artifact bị ignore:

- frontend/.env.example
- frontend/.gitignore
- frontend/.prettierignore
- frontend/docs/auth-contract-status.md
- frontend/docs/CL-D02-FE.md
- frontend/docs/design-system.md
- frontend/docs/qa/d02/admin-dashboard-light.png
- frontend/docs/qa/d02/login-loading-desktop.png
- frontend/docs/qa/d02/login-validation-desktop.png
- frontend/docs/qa/d02/mock-results.json
- frontend/docs/qa/d02/patient-booking-mobile.png
- frontend/docs/qa/d02/patient-navigation-mobile.png
- frontend/docs/qa/d02/README.md
- frontend/docs/qa/d02/register-mobile-dark.png
- frontend/docs/qa/d02/role-forbidden.png
- frontend/docs/third-party-notices.md
- frontend/package.json
- frontend/package-lock.json
- frontend/playwright.config.ts
- frontend/README.md
- frontend/src/app.tsx
- frontend/src/auth/api.ts
- frontend/src/auth/config.ts
- frontend/src/auth/context.ts
- frontend/src/auth/errors.ts
- frontend/src/auth/guards.tsx
- frontend/src/auth/http.ts
- frontend/src/auth/provider.tsx
- frontend/src/auth/session-store.ts
- frontend/src/auth/types.ts
- frontend/src/auth/use-submission.ts
- frontend/src/auth/validation.ts
- frontend/src/components/auth/auth-feedback.tsx
- frontend/src/components/auth/auth-layout.tsx
- frontend/src/components/auth/password-input.tsx
- frontend/src/components/auth/session-card.tsx
- frontend/src/components/layout/header.tsx
- frontend/src/components/layout/main-layout.tsx
- frontend/src/components/layout/sidebar.tsx
- frontend/src/components/ui/alert.tsx
- frontend/src/components/ui/form.tsx
- frontend/src/lib/api-client.ts
- frontend/src/lib/navigation.ts
- frontend/src/pages/booking.tsx
- frontend/src/pages/dashboard.tsx
- frontend/src/pages/forbidden.tsx
- frontend/src/pages/login.tsx
- frontend/src/pages/not-found.tsx
- frontend/src/pages/register.tsx
- frontend/src/pages/settings.tsx
- frontend/src/testing/mock-auth-contract.ts
- frontend/src/vite-env.d.ts
- frontend/tests/auth.mock.test.ts
- frontend/tests/e2e/auth.mock.spec.ts
- frontend/tests/e2e/auth-mock-runner.mjs
- frontend/vitest.config.ts
