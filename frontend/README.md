# ClinicOS frontend — D01 / D02 / D03

React + TypeScript + Vite, Tailwind CSS v4, shadcn/ui, Lucide, React Router, Axios và Magic UI. Giữ scaffold Modern Medical Dashboard D01 và bổ sung auth UI/routing D02.

**Auth D02 đã nghiệm thu đủ bốn role qua HTTP/MySQL thật: READY FOR COMMIT.** Playwright MCP đạt 32/32 nhóm scenario với PATIENT/ADMIN/DOCTOR/RECEPTIONIST; 21/21 unit/contract/mock tests được báo riêng. Xem [trạng thái contract](docs/auth-contract-status.md) và [QA thật](docs/qa/d02-real/README.md).

## CL-D03-FE — Final real API integration

**STATUS: READY FOR COMMIT — final real acceptance ngày 21/11/2026.** Đã kiểm chứng đủ ADMIN, RECEPTIONIST, DOCTOR và PATIENT bằng Chrome qua Playwright MCP, Backend D03 và MySQL QA thật. Contract đọc từ `docs/API_CONTRACT.md`, nhánh `feature/trang`, HEAD `3d7c43d645f101d56af952a0a654335fb44ed677`; không commit hoặc đổi nhánh. Fixture blocker cũ đã được QA giải quyết.

### Đã triển khai

- Axios thật cho GET list/detail, POST và PATCH doctor/specialty cùng GET `/api/v1/doctors/eligible-users`. Dùng `apiClient` và interceptor Auth D02; không fallback sang mock khi HTTP lỗi.
- Tách DTO chính thức khỏi view model: ID signed BIGINT giữ dạng string, success `data`, list `data.items/page/size/totalElements/totalPages`; query chỉ `q/isActive/specialtyId/page/size`, không sort tùy ý.
- Form specialty có code/name/description; doctor có user, specialty, doctorCode/licenseNumber/biography. Validation code 1–32 theo pattern chính thức, name 1–120, license tối đa 100, text tối đa 5000, q tối đa 120. Chuỗi rỗng clear optional text; code/license được canonical khi gửi.
- PATCH doctor chỉ gửi specialtyId/doctorCode/licenseNumber/biography, status action chỉ gửi isActive. Không gửi userId/fullName/role/status trong PATCH. Không tạo staff, cấp role hoặc hard delete.
- GET chi tiết lấy bản mới nhất trước xem/sửa. Eligible-users có q và phân trang; lựa chọn hết hiệu lực được xử lý 409 và tải lại. Tài khoản đã liên kết không đổi; chỉ chọn specialty active khi tạo/chuyển. Cho giữ nguyên specialty hiện tại khi chỉ sửa thông tin theo policy D03.
- ADMIN quản lý; RECEPTIONIST chỉ đọc; DOCTOR chỉ hồ sơ liên kết mình và specialties active; PATIENT chỉ active. Decoder kiểm tra projection theo role và không đưa userId/license nội bộ vào view PATIENT/RECEPTIONIST.
- Giữ layout/theme/ProtectedRoute/RoleGuard, keyboard/focus, loading/empty/error/success, modal confirmation và abort/stale session handling. Lỗi 400/401/403/404 và các mã 409 có thông báo an toàn, không echo raw detail hoặc giá trị bị từ chối.

### Kết quả thực thi — tách nguồn bằng chứng

| Nguồn                                        | Kết quả                                                                                                             | Phạm vi / giới hạn                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Unit/contract/mock, chạy lại lượt này        | **60/60 PASS**, 4 files: 21 D02 + 14 gateway mock + 25 D03 contract                                                 | Transport giả lập, không dùng làm bằng chứng tích hợp thật                                                                        |
| Real browser + HTTP/MySQL D03, chạy lượt này | **25/25 nhóm PASS**: baseline/roles 11, ADMIN 8, security/UI/Auth regression 6                                      | Chrome thật, adapter thật, cả hai mock flags=false, không fulfill response                                                        |
| Real HTTP bên trong 25 nhóm trên             | **190 phản hồi**: 189 qua browser và 1 qua APIRequestContext; đủ 9 API D03, 200/201 và negative 400/401/403/404/409 | Không cộng lại thành nhóm test mới. DELETE bị từ chối 403 qua APIRequestContext thật vì CORS trình duyệt không cho DELETE         |
| D03 gateway MOCK, lịch sử                    | **15/15 nhóm PASS**                                                                                                 | Không chạy lại UI mock lượt này; dữ liệu DEMO trong RAM                                                                           |
| D03 HTTP MOCK, lịch sử                       | **17/17 nhóm PASS** gồm 2 nhóm bổ sung 409/404                                                                      | Không phải Backend thật                                                                                                           |
| Production + HTTP MOCK, lịch sử              | PASS: fixture bị loại khỏi bundle, không fallback mock                                                              | Không chạy lại lượt nghiệm thu này                                                                                                |
| PATIENT real D03, lịch sử                    | **9/9 nhóm PASS** trên catalog rỗng cũ                                                                              | Đã bổ sung positive catalog/scope trong lượt 25 nhóm hiện tại                                                                     |
| Auth real D02, lịch sử                       | **29/29 nhóm PASS** trên stack D02/V1 riêng                                                                         | Lượt hiện tại chạy regression Login/ME, guards, logout/reload/JWT/network/theme trên D03; không tuyên bố chạy lại toàn bộ 29 nhóm |

Không cộng MOCK vào REAL hoặc cộng HTTP vào số nhóm browser. Các con số real là nhóm assertion trong runner chạy qua Playwright MCP, không phải Playwright Test CLI. Không có uncaught runtime error, console error bất thường hoặc credential/token/hash được phát hiện trong console; các lỗi network/status chủ động tạo cho negative tests được phân biệt. Host audit log cũng đạt. 100 assertions do QA bàn giao là bằng chứng của QA, không tính vào kết quả FE. `docs/qa/d03-results.json` là kết quả MOCK lịch sử 35 tests, giữ nguyên. Không tạo Markdown/report, screenshot, video, trace hoặc HAR mới.

### Runtime QA thật và bảo vệ fixture

QA source là project `clinic-d03-fixtures-8c29ba1f8e6b`, volume riêng, MySQL **8.4.11**, Backend D03 commit `1b20db52c6a07b611dc1893f0f9de9681d81a826`. Đối chiếu JAR SHA-256 `a212478d0bb8a8f086855c42f9a7b1e65a2fea94693d9a4975dbf58ecfd0cab2` và nội dung migration trong artifact với workspace (chuẩn hóa CRLF/LF). V1 checksum **1116148885**, V2 **196944325**, success cả hai. Không sửa Backend hoặc migration.

Credential handoff qua Windows Credential Manager target `ClinicManagement/QA/D03Catalog/fe-acceptance`, đọc bằng PowerShell host cùng tài khoản Windows. Không sửa vault hoặc đưa credentials vào VITE_*, file, log/report. Nếu host không đọc được vault, helper dừng với `HOST_VAULT_UNAVAILABLE`; không dùng mock thay thế.

[Host helper](tests/runtime/D03-Acceptance-Host.ps1) xác minh container labels, dedicated volume, artifact và baseline **7 users / 4 specialties / 3 doctors**, eligible user **ID 5**. Vì API không có unlink/hard delete để hoàn trả user eligible duy nhất, toàn bộ POST/PATCH thành công chạy trên **MySQL copy cô lập** từ snapshot QA, cùng JAR D03 đã pin. Dump/import truyền trong RAM, không xuất dump/password hash ra file, log hoặc report. Source chỉ SELECT và consistent read; không gán role, sửa fixture hoặc gọi write API vào source.

Mỗi lượt chạy dùng volume/network/container riêng có ownership label, Backend `mysql-validation` (không migrate), JWT key process riêng, Vite `127.0.0.1:5180`, Google Chrome headless/incognito qua CDP loopback. Sau chạy, đối chiếu fingerprint catalog source và counts không đổi, ID 5 vẫn eligible, history V1/V2 giữ nguyên. Bản copy sau nghiệm thu có **7 users / 11 specialties / 4 doctors**, ID 5 đã liên kết và không còn eligible đúng contract. Dữ liệu bổ sung đều synthetic qua API thật. Runtime copy/Vite/Chrome được dừng; giữ nguyên các volume, không xóa database/volume. QA source tiếp tục hoạt động.

Các nhóm real đã xác minh: CRUD specialty/doctor qua form và confirm; duplicate code/name/license, user linked/ineligible, specialty inactive và chặn deactivate khi có doctor active; GET detail trước sửa, PATCH không đổi userId; eligible search/page và biến mất sau POST; RECEPTIONIST read-only/minimized fields; DOCTOR chỉ profile mình (kể cả inactive), profile khác 404 và eligible doctor scope rỗng; PATIENT chỉ catalog active, public fields và inactive query 403. Có HTTP 400/401/403/404/409 thật, loading/empty/network retry, chống double submit và stale response, focus/modal/mobile navigation, desktop/tablet/mobile, Light/Dark, logout/reload không lưu JWT.

Không phát hiện lỗi ứng dụng FE cần sửa trong lượt retest. Runner được sửa locator nút xóa để phân biệt “Xóa bộ lọc”, reset bộ lọc trước pagination và tách DELETE server denial khỏi CORS preflight của trình duyệt. Đây là sửa harness; không sửa response/API để đạt PASS.

### Chạy FE và kiểm tra

Từ `frontend/`, cấu hình `VITE_API_BASE_URL` bằng origin D03 thực tế, `VITE_AUTH_MOCK=false`, `VITE_DIRECTORY_MOCK=false`; CORS BE phải khớp origin FE. Không đưa secret vào VITE_*. Khi origin chưa cấu hình gateway báo pending; khi đã cấu hình luôn dùng adapter thật.

Mock chỉ opt-in ở DEV bằng hai cờ QA. `npm run test:e2e:mock` giữ screenshot/trace/video off. [Gateway UI runner](tests/e2e/directory-mock-runner.mjs), [HTTP mock fixture](tests/e2e/directory-http-mock-runner.mjs), [production runner](tests/e2e/directory-pending-runner.mjs), [PATIENT real runner lịch sử](tests/e2e/directory-real-patient-runner.mjs).

[Final real runner](tests/e2e/d03-real-acceptance-runner.mjs) export `runD03Acceptance(page, { phase })`, chạy lần lượt `baseline`, `admin`, `security` trên Chrome của host helper qua Playwright MCP/CDP. Chu trình host: `VerifySource` → `StartClone` → ba phase → `Verify` / `Audit` → `Cleanup`. Không khởi chạy runner vào source hoặc chạy lại phase ADMIN trên copy đã tiêu thụ eligible fixture; tạo copy mới từ source được bảo vệ. Ca loading/stale chỉ giữ rồi continue request thật; network error dùng offline thực. Sau reload cuối cùng, auth memory và credential handoff đều biến mất; storage chỉ còn theme.

`npm run lint`, `npm run build`, `npm run format:check`, `npm run test`: **PASS trong lượt này**. Unit Node dùng hai mock flags=false; test 60/60 giữ đủ 35 tests ban đầu và thêm 25 contract tests. Không commit/push/fetch/pull/merge/rebase/reset/đổi nhánh/worktree. Giữ nguyên thay đổi D02/D03 chưa commit; không tạo Markdown mới.

Files bổ sung/cập nhật trong lượt **final acceptance retest**: `README.md`, `tests/e2e/d03-real-acceptance-runner.mjs`, `tests/runtime/D03-Acceptance-Host.ps1`. Không sửa app source trong lượt này. Các file integration dưới đây đã thay đổi từ trước và được giữ nguyên.

Files của lượt integration: `README.md`, `src/auth/errors.ts`, `src/directory/{model,gateway,api}.ts`, `src/components/directory/{editor,record}.tsx`, `src/pages/directory.tsx`, `src/testing/directory-mock.ts`, `tests/{directory.mock,directory.contract}.test.ts`, `tests/e2e/{directory-mock-runner,directory-http-mock-runner,directory-pending-runner,directory-real-patient-runner}.mjs`, `tests/runtime/{D03-Runtime.ps1,d03-build.gradle}`. Thay đổi/bằng chứng D02 đã có trước lượt này được giữ nguyên.

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

Backend phải kết nối đúng DB QA Clinic, không sử dụng mù quáng DB_* toàn máy hoặc tự migrate schema. Đợt acceptance staff D02 lịch sử dùng Vite 5173 và stack QA cô lập fixture `83710bc5bb2e`, đã đối chiếu JAR/DB/roles/V1. D03 final acceptance dùng source fixture và bản copy nêu ở phần D03 phía trên. Credential lấy từ Windows Credential Manager qua PowerShell host, chỉ handoff trong RAM Chrome.

## Tài liệu bàn giao

- [Báo cáo CL-D02-FE và danh sách file thay đổi](docs/CL-D02-FE.md)
- [Contract, giới hạn và checklist sau merge](docs/auth-contract-status.md)
- [QA HTTP/MySQL thật và screenshots](docs/qa/d02-real/README.md)
- [QA mock cũ lưu lại](docs/qa/d02/README.md)
- [Design system](docs/design-system.md)
- [Báo cáo D01 lưu lại](docs/CL-D01-FE.md)
- [Giấy phép component](docs/third-party-notices.md)
