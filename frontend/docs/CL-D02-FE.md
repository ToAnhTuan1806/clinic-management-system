# TASK: CL-D02-FE FINAL ACCEPTANCE

**BRANCH:** `feature/trang`

**STATUS: READY FOR COMMIT**

Nghiệm thu auth D02 với đủ PATIENT, ADMIN, DOCTOR và RECEPTIONIST qua Backend/MySQL QA thật: **32/32 nhóm scenario PASS** qua Playwright MCP. **21/21 unit/contract/mock tests PASS** được báo riêng. Không commit hoặc push.

## BACKEND CONNECTION

PASS. FE Vite `http://127.0.0.1:5173`, mock tắt, kết nối Backend D02 trong stack QA cô lập fixture `83710bc5bb2e`. Đã đọc lại `docs/API_CONTRACT.md`; không đổi endpoint/envelope. Health 200; không lấy health làm bằng chứng DB sẵn sàng duy nhất.

PowerShell host đọc Windows Credential Manager theo quyền tài khoản được cấp. Sandbox riêng không thấy vault; bước này đã chạy thành công trên host. Đối chiếu label/network/container/loopback port, DB config, dedicated MySQL volume, CORS và JAR SHA-256 với artifact QA. Backend artifact từ commit `ba0941f96a79453f03ecf80e235f303bcde0f8d4`; không tuyên bố rebuild artifact đó từ HEAD FE.

SELECT chỉ đọc xác minh ba staff đúng email fixture, id, role, ACTIVE và BCrypt cost 12; Login và ME được đối chiếu cùng id/role. Không in các giá trị credential/hash. Flyway vẫn `1 / V1__create_users.sql / 1116148885 / success 1`; SHA-256 V1 trong workspace không đổi. Không sửa Backend/DB/Docker/V1, không SQL gán role hoặc sửa secret, không ghi vào DB dùng chung.

## PATIENT / ADMIN / DOCTOR / RECEPTIONIST

| Role         | HTTP thật                                                   | Điều hướng và quyền FE đã kiểm tra                             | Kết quả       |
| ------------ | ----------------------------------------------------------- | -------------------------------------------------------------- | ------------- |
| PATIENT      | Register 201, duplicate 409, sai password 401; Login/ME 200 | `/booking`; `/dashboard` bị chặn                               | 7/7 nhóm PASS |
| ADMIN        | Login 200, Bearer ME 200, id/role khớp DB                   | Dashboard quản trị; patients được vào, medical-records bị chặn | 6/6 nhóm PASS |
| DOCTOR       | Login 200, Bearer ME 200, id/role khớp DB                   | Dashboard bác sĩ; medical-records được vào, patients bị chặn   | 6/6 nhóm PASS |
| RECEPTIONIST | Login 200, Bearer ME 200, id/role khớp DB                   | Dashboard lễ tân; patients được vào, medical-records bị chặn   | 6/6 nhóm PASS |

Mỗi role đã kiểm tra ProtectedRoute sau logout, RoleGuard với URL SPA trực tiếp, thông báo thiếu quyền và link quay về đúng không gian, API 403 giữ phiên, JWT sai 401 xóa phiên, mobile menu/focus/Light/Dark và logout. Các màn nghiệp vụ vẫn placeholder DEMO.

Luồng PATIENT hiện tại tạo **một** tài khoản QA synthetic qua Register thật trong stack staff cô lập; không có thông tin bệnh nhân thật. Ba staff đã provision được giữ nguyên role/status/credential; login chỉ có thể cập nhật timestamps theo contract. Không xóa tài khoản QA.

## JWT SECURITY

PASS thêm 4 nhóm security và 3 nhóm public regression:

- JWT sai signature cho cả bốn role, JWT ký hợp lệ nhưng đã hết hạn cho ba staff: ME thật trả 401 INVALID_ACCESS_TOKEN; FE xóa token/user, về Login. Token hết hạn được tạo trong RAM PowerShell bằng key QA hiện hữu, không sửa secret/clock và không chờ 30 phút.
- Sửa role trong state FE thành ADMIN vẫn nhận ME từ server là PATIENT; API `/users` trả 403. FE state có thể bị sửa bởi người dùng, quyền và identity trên Backend không đổi. D02 API ngoài auth vẫn denyAll kể cả ADMIN; đây không phải bằng chứng quyền nghiệp vụ/ownership đã triển khai.
- Token chỉ ở memory; localStorage chỉ có theme, sessionStorage trống; logout và reload xóa phiên. Logout client-only, không có revoke/refresh endpoint.
- Form validation, lỗi UTF-8 password, hiện/ẩn password, Enter/focus; loading/reduced-motion và khóa double submit; offline thật và khôi phục kết nối đều đạt.
- Đã rà credential/key/token/hash trong source/docs/tests FE, log text của phiên QA và log Backend QA. Không thấy giá trị nhạy cảm. Inputs được mask trong screenshot; không bật trace/HAR/video. Cuối test auth state rỗng, QA handoff không còn trong window; Chrome QA riêng được đóng sau kiểm tra.

## PLAYWRIGHT MCP

**32/32 nhóm PASS, uncaught runtime errors = 0.** Google Chrome headless `157.0.8103.79`, Playwright MCP điều khiển qua loopback CDP. HTTP thật tới đúng Backend QA; không `route.fulfill`, không mock response. Ca loading chỉ giữ request rồi `route.continue()`; offline là lỗi mạng trình duyệt thật.

Desktop 1440px, mobile 390px, form 320/768/1440px; Light/Dark, focus trap, Escape, return focus và route focus đã kiểm tra. Có **21 screenshots mới**, cùng 14 ảnh PATIENT lịch sử được giữ riêng.

[Bằng chứng và cách chạy an toàn](qa/d02-real/README.md) · [JSON nghiệm thu hiện tại](qa/d02-real/staff/results.json).

## UNIT / CONTRACT TESTS — LINT / BUILD / FORMAT

| Gate                   | Kết quả thực thi                                                            |
| ---------------------- | --------------------------------------------------------------------------- |
| `npm run lint`         | PASS, exit 0, không cảnh báo                                                |
| `npm run build`        | PASS, exit 0                                                                |
| `npm run format:check` | PASS, exit 0                                                                |
| `npm run test`         | PASS, 21/21 tests, 2 files; unit/contract/mock, không phải HTTP integration |

Build ban đầu bị sandbox từ chối ghi cache TypeScript; chạy lại trên host đã thành công. Đã bỏ biến không dùng trong runner. Chỉ sửa harness QA về quoting/readiness khi khởi động, chờ route/focus và đọc log đang mở; các phase cuối đều đã chạy đạt. Không cần sửa ứng dụng hoặc nới contract/quyền để vượt test trong đợt acceptance này.

## BLOCKERS / GIỚI HẠN

Không còn blocker trong phạm vi FE D02 đã yêu cầu. Chưa QA Firefox/Safari, thiết bị thật hoặc screen reader; chưa chờ expiration tự nhiên 30 phút. Business API/ownership và server revoke nằm ngoài D02. Kết quả 15 nhóm PATIENT lịch sử và mock được giữ tách riêng, không cộng vào 32 nhóm hiện tại.

HEAD vẫn `07b821f9a85547db76370be9c62655785fe22bc3`. Working tree đã có thay đổi D02 trước đợt này và được giữ nguyên. Chỉ sửa file thuộc `frontend/`; không commit, push, fetch, pull, merge, rebase, reset hoặc đổi nhánh/worktree.

## FILES CHANGED

Trong đợt staff acceptance: cập nhật 4 tài liệu (`README.md`, báo cáo này, `auth-contract-status.md`, `qa/d02-real/README.md`); thêm runner, PowerShell host helper, JSON kết quả và 21 ảnh dưới `qa/d02-real/staff/`. Các source/contract và bằng chứng PATIENT từ đợt trước được giữ lại.

Toàn bộ 58 file FE đang thay đổi/chưa track so với HEAD (gồm thay đổi có sẵn):

- frontend/.env.example
- frontend/README.md
- frontend/docs/CL-D02-FE.md
- frontend/docs/auth-contract-status.md
- frontend/docs/design-system.md
- frontend/docs/qa/d02/README.md
- frontend/src/auth/api.ts
- frontend/src/auth/config.ts
- frontend/src/auth/errors.ts
- frontend/src/auth/types.ts
- frontend/src/auth/validation.ts
- frontend/src/components/auth/auth-layout.tsx
- frontend/src/pages/register.tsx
- frontend/tests/auth.mock.test.ts
- frontend/tests/e2e/auth-mock-runner.mjs
- frontend/docs/qa/d02-real/README.md
- frontend/docs/qa/d02-real/duplicate-email-real.png
- frontend/docs/qa/d02-real/invalid-jwt-401-real.png
- frontend/docs/qa/d02-real/login-error-real.png
- frontend/docs/qa/d02-real/login-final-real.png
- frontend/docs/qa/d02-real/login-loading-real.png
- frontend/docs/qa/d02-real/mobile-navigation-real.png
- frontend/docs/qa/d02-real/offline-error-ui.png
- frontend/docs/qa/d02-real/patient-booking-real.png
- frontend/docs/qa/d02-real/patient-role-guard-real.png
- frontend/docs/qa/d02-real/permission-403-real.png
- frontend/docs/qa/d02-real/register-loading-real.png
- frontend/docs/qa/d02-real/register-success-real.png
- frontend/docs/qa/d02-real/register-validation-desktop.png
- frontend/docs/qa/d02-real/results.json
- frontend/docs/qa/d02-real/settings-mobile-dark-real.png
- frontend/docs/qa/d02-real/staff/admin-desktop-real.png
- frontend/docs/qa/d02-real/staff/admin-mobile-dark.png
- frontend/docs/qa/d02-real/staff/admin-mobile-navigation.png
- frontend/docs/qa/d02-real/staff/admin-role-guard.png
- frontend/docs/qa/d02-real/staff/doctor-desktop-real.png
- frontend/docs/qa/d02-real/staff/doctor-mobile-dark.png
- frontend/docs/qa/d02-real/staff/doctor-mobile-navigation.png
- frontend/docs/qa/d02-real/staff/doctor-role-guard.png
- frontend/docs/qa/d02-real/staff/expired-jwt-login.png
- frontend/docs/qa/d02-real/staff/final-public-login.png
- frontend/docs/qa/d02-real/staff/patient-desktop-real.png
- frontend/docs/qa/d02-real/staff/patient-mobile-dark.png
- frontend/docs/qa/d02-real/staff/patient-mobile-navigation.png
- frontend/docs/qa/d02-real/staff/patient-role-guard.png
- frontend/docs/qa/d02-real/staff/public-validation.png
- frontend/docs/qa/d02-real/staff/real-login-loading.png
- frontend/docs/qa/d02-real/staff/real-network-error.png
- frontend/docs/qa/d02-real/staff/receptionist-desktop-real.png
- frontend/docs/qa/d02-real/staff/receptionist-mobile-dark.png
- frontend/docs/qa/d02-real/staff/receptionist-mobile-navigation.png
- frontend/docs/qa/d02-real/staff/receptionist-role-guard.png
- frontend/docs/qa/d02-real/staff/results.json
- frontend/src/auth/backend-contract.ts
- frontend/tests/auth-contract.test.ts
- frontend/tests/e2e/real-auth-runner.mjs
- frontend/tests/e2e/staff-acceptance-runner.mjs
- frontend/tests/runtime/Staff-Acceptance-Host.ps1
