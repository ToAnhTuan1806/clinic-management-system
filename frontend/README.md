# ClinicOS frontend — Sprint 1 (D01–D05)

React + TypeScript + Vite, Tailwind CSS v4, shadcn/ui, Lucide, React Router, Axios và Magic UI. Giữ scaffold Modern Medical Dashboard D01 và bổ sung auth UI/routing D02.

### D11 · Final real API E2E acceptance (FR-10)

**STATUS: READY FOR COMMIT.** Branch `feature/trang`, HEAD `1277cf31cefc2eaa16cafe026920b360e694a19a`. Backend D11 commit `6210a64751add8d49b34754575d4de57a845a109`, artifact SHA-256 `89BDA49B6ED73D341CA51FE7D4B4A11D0E3E98962E3BA7F8FC36AC329FF6B369`. MySQL **8.4.11**, Flyway **V1–V10 success**, V10 checksum **-1009264399**. Migrations và source Backend/Database không sửa.

`/medical-history` dành cho DOCTOR/PATIENT, dùng layout/theme hiện có. API thật gồm GET `/api/v1/patients/{id}/medical-history`, GET `/api/v1/medical-records/{id}`, POST `/api/v1/medical-records/{id}/release` với expectedVersion. Patient tự xác định qua GET `/api/v1/me/patient-profile`. Doctor discovery đọc GET `/api/v1/appointments` đến hết trang theo scope Backend. Enrichment chỉ dùng metadata appointment, cache giới hạn theo phiên; dữ liệu discovery được dùng lại để tránh N+1. Query lỗi/abort hoặc session thay đổi không giữ timeline/clinical cũ.

#### Kết quả thực thi hiện tại

| Nguồn                                  | PASS                   | FAIL | SKIPPED |
| -------------------------------------- | ---------------------- | ---- | ------- |
| Vitest toàn FE, 14 files               | **252**                | 0    | 0       |
| Playwright MCP mock regression         | **7 nhóm**             | 0    | 0       |
| Playwright MCP real Backend/MySQL      | **FE01–FE12, 12 nhóm** | 0    | 0       |
| Lint / format:check / production build | **3 gates**            | 0    | 0       |

63 phản hồi HTTP thật được ghi nhận bằng method/path/status, gồm 46 từ browser và 17 từ APIRequestContext. Phân bố 200 × 52, 401 × 1, 403 × 3, 404 × 6, 409 × 1. Ca loading chỉ trì hoãn rồi continue request thật; ca offline dùng browser offline; lỗi ownership 404 UI đến từ Backend thật bằng credential doctor khác chỉ trong RAM của runner. Không fulfill response trong real suite. Không có uncaught runtime error, console error bất thường hoặc credential/token trong console/log đã audit. QA Backend 495/495 do bên QA bàn giao không cộng vào các số FE này.

| Case | Phạm vi đã PASS bằng HTTP thật                                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FE01 | Doctor login/ME, real adapter, tìm đủ hai bệnh nhân kể cả bệnh nhân sau appointment 100; discovery đúng hai request                                      |
| FE02 | totalElements=101, totalPages=21 ở size=5, thứ tự completedAt DESC/id DESC, page trước/sau; không gọi detail appointment dư khi discovery đã có metadata |
| FE03 | Doctor assigned xác nhận công bố bản completed, hủy dialog không ghi, success sau response và refetch                                                    |
| FE04 | PATIENT chưa release/khác owner nhận 404, history chỉ có bản published, total/count theo quyền                                                           |
| FE05 | PATIENT xem lịch sử và clinical của bản vừa công bố, không có thao tác ghi                                                                               |
| FE06 | ADMIN/RECEPTIONIST nhận metadata không clinical, ba role ngoài DOCTOR release 403, doctor khác 404, anonymous 401                                        |
| FE07 | Release cạnh tranh thành công ở phiên khác, UI version cũ 409, che detail cũ, reload version/publication mới                                             |
| FE08 | Bộ lọc tìm được record cuối trang 101; search/empty và giữ thứ tự server                                                                                 |
| FE09 | Request loading che danh sách cũ; empty và retry                                                                                                         |
| FE10 | Offline và Backend 404 không tạo hồ sơ giả, không lộ clinical, online retry khôi phục                                                                    |
| FE11 | Logout/đổi account xóa clinical; ADMIN/RECEPTIONIST bị RoleGuard chặn                                                                                    |
| FE12 | Desktop 1280px/mobile 320px, Light/Dark, không tràn ngang, Enter/Tab/Escape, focus trap/restore và ảnh synthetic                                         |

#### Lỗi FE có regression và đã sửa

- Discovery doctor trước đây chỉ đọc 100 appointments. Đã đọc đến hết totalElements, deduplicate bệnh nhân và prime cache metadata từ các appointment hợp lệ.
- Bộ lọc trước đây chỉ xử lý 100 history records đầu. Đã đọc đủ mọi trang trong scope rồi lọc/phân trang tại FE. PATIENT mặc định RELEASED dùng paging server trực tiếp vì Backend đã lọc release theo quyền.
- Enrichment từng nuốt HTTP 404/401 thành dữ liệu dự phòng. Đã giữ status từ Axios/interceptor, từ chối kết quả phiên cũ, xóa cache khi đổi session, và kiểm tra patient/record identity trước hiển thị detail.
- Lọc ngày từng dùng UTC nên sai khi ngày Việt Nam lệch UTC. Regression tái hiện trước sửa; nay dùng cùng chuyển đổi Asia/Ho_Chi_Minh với UI.
- Fixture unit cho metadata-only được bổ sung response enrichment tường minh; không bỏ assertions. Tổng test tăng từ 248 lên 252 bằng 4 regression mới. Tất cả source/test D11 chưa commit có trước lượt này được giữ lại.

Backend hiện chỉ hỗ trợ page/size cho history; search/date/publication do FE thực hiện trên toàn tập được phép. Tập lớn sẽ cần nhiều request hơn; không mở rộng API Backend trong task này. Đã kiểm chứng 101 history records, 102 appointment thuộc doctor hiện tại và 103 appointments/records tổng dataset.

#### Runtime, evidence và chạy lại

[D11 host helper](tests/runtime/D11-Acceptance-Host.ps1) xác minh vault handoff/label/volume/artifact, tạo MySQL/network/volume mới và Backend D11, chỉ áp dụng migration đã chốt trên bản sao. Source fixture D03 chỉ được đọc để copy dữ liệu synthetic nền; process API kiểm thử là D11/V10. Tất cả mock flags=false, Vite `127.0.0.1:5194`, Chrome CDP host. [Fixture helper](tests/runtime/D11-Synthetic-Fixture.ps1) từ chối DB có appointments hoặc sai ownership label, nạp 103 lịch/hồ sơ và ba bệnh nhân synthetic trong transaction trên bản sao riêng. Không ghi credentials/token/password hash ra evidence. Source fingerprint/counts/V1–V2 và eligible user ID 5 giữ nguyên.

Chu trình chạy lại: StartClone → D11-Synthetic-Fixture.ps1 → [runHistoryReal(browser,page,origin)](tests/e2e/history-real-runner.mjs) qua Playwright MCP/CDP → Verify/Audit → Cleanup. Runtime do task tạo đã dừng, giữ mọi database/volume. Các runtime source được giữ nguyên. Mock dùng `VITE_AUTH_MOCK=true`, `VITE_HISTORY_MOCK=true` và [mock runner](tests/e2e/history-mock-runner.mjs); kết quả mock tách riêng real.

Ảnh real, chỉ dữ liệu synthetic: [desktop Light](docs/qa/d11/history-desktop-real.jpg), [mobile Dark 320px](docs/qa/d11/history-mobile-real.jpg). Ảnh mock cũ được giữ tại [desktop mock](docs/qa/d11/history-desktop-mock.jpg) và [mobile mock](docs/qa/d11/history-mobile-mock.jpg).

21 files D11 cần review/commit thủ công, chưa stage:

- `.env.example`, `README.md`, `playwright.config.ts`
- `src/app.tsx`, `src/lib/navigation.ts`
- `src/history/api.ts`, `src/history/gateway.ts`, `src/history/model.ts`
- `src/pages/medical-history.tsx`, `src/testing/history-mock.ts`
- `tests/history.contract.test.ts`, `tests/history.mock.test.ts`
- `tests/e2e/history-mock-runner.mjs`, `tests/e2e/history-real-runner.mjs`, `tests/e2e/history.mock.spec.ts`
- `tests/runtime/D11-Acceptance-Host.ps1`, `tests/runtime/D11-Synthetic-Fixture.ps1`
- `docs/qa/d11/history-desktop-mock.jpg`, `docs/qa/d11/history-mobile-mock.jpg`, `docs/qa/d11/history-desktop-real.jpg`, `docs/qa/d11/history-mobile-real.jpg`

Không còn blocker D11. Không add/commit/push/merge/reset/rebase/stash hoặc đổi branch/worktree.

### D10 · Không gian khám bệnh

`/medical-records` dành cho DOCTOR. Hàng đợi thật dùng GET appointments với phạm vi bác sĩ do Backend quyết định, lọc ngày Việt Nam và hai trạng thái `CHECKED_IN` / `IN_PROGRESS`. Tìm kiếm và phân trang hoạt động trên tập lịch của ngày đã chọn.

Adapter đã đối chiếu mục 3.8 trong `F:/RikkeiEdu/clinic-management-system/docs/API_CONTRACT.md` và DTO Java của Backend D10. POST chỉ gửi `appointmentId`; PATCH gửi `symptoms/diagnosis/notes/conclusion/expectedVersion`; completion gửi `expectedVersion`. Response dùng trạng thái `IN_PROGRESS/COMPLETED`. Kết luận, triệu chứng và chẩn đoán bắt buộc trước completion; validation tối đa 5000 đơn vị UTF-16 áp dụng trước trim. Khi cấu hình `VITE_API_BASE_URL`, adapter gọi HTTP thật với Axios/interceptor Auth hiện tại.

**D10 final lookup integration — READY FOR COMMIT.** Đã đọc contract chính thức, MedicalRecordController/Service và DTO tại worktree Backend. Mỗi lần mở hoặc tải lại, FE GET appointment rồi lookup `/api/v1/medical-records/by-appointment/{id}`, dùng data.id và data.version từ server. Lookup 404 chỉ cho tạo khi appointment vẫn CHECKED_IN. IN_PROGRESS + 404 hiển thị lỗi dữ liệu và chặn tạo. Đã bỏ record-link/sessionStorage, không lưu quyền sở hữu/version/nội dung khám cục bộ.

Playwright MCP **real D10 7/7 nhóm PASS** trên MySQL 8.4.11 cô lập, migrations V1–V9 success. Luồng CHECKED_IN → IN_PROGRESS → COMPLETED đã kiểm chứng bằng UI và HTTP thật. POST thực đã commit 201 rồi transport bị abort để thử mất response; UI lookup lại được hồ sơ mà không tạo lần hai. Reload và browser context độc lập tìm được hồ sơ khi sessionStorage rỗng. PATCH dùng version server, stale update 409 được tải lại trước retry; duplicate tạo 409; bản hoàn tất không sửa/hoàn tất lại được. PATIENT/ADMIN/RECEPTIONIST POST/PATCH/completion đều 403; doctor khác và PATIENT đọc nháp nhận 404; metadata staff không chứa nội dung lâm sàng; PATIENT self đọc bản COMPLETED thành công. Có negative 400/401 thật.

**Vitest 219/219 PASS**, 12 files; lint, format:check và build PASS. Mock và real được kiểm tra riêng. Mock runner kiểm tra 7 nhóm UI/RBAC/error/theme/mobile/focus. Mock IN_PROGRESS lookup 404 kiểm tra thông báo lỗi dữ liệu và chặn tạo. Dữ liệu đều synthetic; không tạo screenshot/video/trace hoặc ghi credential/token vào evidence. Các thay đổi FE cũ được giữ nguyên, không chỉnh Backend/DB source hoặc migrations, không add/commit/push/merge/PR.

[Real runner](tests/e2e/examination-real-runner.mjs) chạy trên Chrome CDP của [D10 host helper](tests/runtime/D10-Acceptance-Host.ps1), với Backend artifact bàn giao SHA-256 `2BDB7C3324408561482BDA6401ED993E31E15E4F28DC948024E131164D1B8482`, Vite `127.0.0.1:5192`, tất cả mock flags=false. Source QA D03 chỉ dùng làm dữ liệu nền để copy vào volume riêng; runtime kiểm thử là Backend D10 và DB V9. Source không đổi, ID 5 vẫn eligible. Runtime riêng được dừng sau QA, các volume được giữ lại. Credential Manager handoff chỉ dùng trong host/Chrome RAM, host log audit PASS.

Để chạy lại mock, dùng Vite development với VITE_AUTH_MOCK=true, VITE_EXAMINATION_MOCK=true rồi gọi runExaminationMock(page, origin) từ [mock runner](tests/e2e/examination-mock-runner.mjs). Để chạy lại real, dùng StartClone của D10 helper, chạy real runner, Verify/Audit rồi Cleanup. Real runner có thể nhận existingAppointmentId của fixture QA đang CHECKED_IN để tiếp tục sau gián đoạn setup. Mọi thao tác ghi chỉ được chạy trên bản sao QA có scope được helper xác minh.

**Auth D02 đã nghiệm thu đủ bốn role qua HTTP/MySQL thật: READY FOR COMMIT.** Playwright MCP đạt 32/32 nhóm scenario với PATIENT/ADMIN/DOCTOR/RECEPTIONIST; 21/21 unit/contract/mock tests được báo riêng. Xem [trạng thái contract](docs/auth-contract-status.md) và [QA thật](docs/qa/d02-real/README.md).

## CL-D05-FE — Sprint 1 integration QA

**STATUS: READY FOR REVIEW — 21/11/2026.** Tích hợp/kiểm thử D02 Auth, D03 Doctors/Specialties và D04 Profile/Patients. Không bổ sung nghiệp vụ D06+, dependency hoặc endpoint mới.

### Git và phạm vi

Nhánh `feature/trang`, target `dev`; HEAD `c494db88a63111cfee46408eec3937c86a51ad04` trùng ref `origin/dev` hiện có. Đã kiểm tra ancestry của FE D04 `fd1d17a` và BE D04 `abc3572`, cả hai nằm trong HEAD. Local `dev` vẫn là `6bbbe79`, không dùng ref này để chạy QA. Đây là đối chiếu ref cục bộ; không fetch/pull/stash/merge/rebase/reset/đổi nhánh/worktree. Workspace sạch trước D05, không có local conflict. Không add/commit/push.

### Kết quả hiện tại — phân biệt nguồn

| Nguồn                                                | Kết quả thực thi D05                                                                                                                                                                                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit/contract/mock                                   | **95/95 PASS**, 7 files; baseline 94 tests và 1 regression mới cho Profile 404. Transport giả lập, không phải bằng chứng Backend thật.                                                                                                    |
| Chrome + Spring Boot + MySQL thật qua Playwright MCP | **49/49 nhóm PASS**, không skip: D03 baseline/RBAC 11, D03 ADMIN 8, Profile 9, Patients 10, D04 security/UI 5, D02 regression/UI 6.                                                                                                       |
| HTTP thật trong các nhóm trên                        | **352 phản hồi**: 350 qua browser và 2 qua APIRequestContext. Status: 200 × 256, 201 × 23, 400 × 16, 401 × 4, 403 × 26, 404 × 12, 409 × 15. Không cộng HTTP thành nhóm browser riêng.                                                     |
| Lỗi tải module giao diện                             | **1/1 PASS** trên Chrome context riêng: mất mạng khi mở route chưa tải, fallback an toàn, Tab/Enter reload và khôi phục public form. Không dùng credential hoặc mock response; đây là UI transport-fault test, không phải API thành công. |
| Lint / format / build                                | `npm run lint`, `npm run format:check`, `npm run build`: **PASS**.                                                                                                                                                                        |

Tổng **50 nhóm browser PASS** gồm 49 nhóm tích hợp thật và 1 lỗi transport có chủ đích; không cộng kết quả lịch sử D02/D03/D04 hoặc UI mock vào lượt này. Không chạy lại UI mock/CLI wrapper. Các nhóm tích hợp không có uncaught runtime error, console error bất thường hoặc credential/token/hash trong console. Kiểm tra cold-module có **2 console error reports dự kiến** từ lỗi mạng được bắt bởi Error Boundary, **0 uncaught runtime errors**, phục hồi thành công. Host log audit PASS. Không tạo screenshot/video/trace/HAR, Markdown QA hoặc báo cáo D02 mới.

### Luồng đã kiểm chứng

- Auth: Register PATIENT thật, duplicate email, Login đúng/sai, Bearer/ME, token sai và JWT hết hạn được ký bằng key của runtime QA; 401 xóa phiên. Logout/reload chỉ giữ theme, không lưu token/user trong localStorage/sessionStorage. ProtectedRoute/RoleGuard cả bốn role giữ nguyên.
- Doctors/Specialties: ADMIN tạo/sửa/trạng thái; search/filter/pagination và eligible-users, 409 nghiệp vụ, userId doctor bất biến; RECEPTIONIST read-only, DOCTOR chỉ profile mình, PATIENT chỉ active/public projection. Không hard delete.
- Profile: cả bốn role GET/PATCH fullName/phone/address, validation và whitelist request; id/email/role/status chỉ đọc, không có input password. Tên sau PATCH/ME đồng bộ Header và Sidebar. Loading/chống submit lặp, lỗi mạng không báo thành công, retry tải lại, phone ngắn hợp lệ và chuỗi trắng clear thành null.
- Patients: ADMIN/RECEPTIONIST tạo/sửa bằng UI thật; search theo tên/mã/phone, active/inactive, pagination, duplicate code 409, phone trùng được chấp nhận, soft delete/reactivate. Sai liên kết 404/409, payload sai 400; DELETE thực bị 403.
- Ownership: danh sách `/patients` trên FE giữ ADMIN/RECEPTIONIST. DOCTOR/PATIENT bị RoleGuard chặn route chung; DOCTOR cũng bị API 403. PATIENT xem hồ sơ linked tại `/profile`, API detail ngoài ownership 404; user chưa linked thấy empty đúng 404. Không tự đồng bộ personal contact sang patient contact hoặc làm lộ hồ sơ khác.
- UI: desktop **1280 px**, mobile **375 px** cho Profile/Patients, Light/Dark, không tràn ngang, keyboard/Enter/Escape, focus trap/restore, loading/double-submit và khóa đóng modal khi đang lưu. Regression layout/navigation cả bốn role còn kiểm tra 320/768/1440 px. Loading/stale-response D03 tiếp tục đạt.

### Lỗi FE đã sửa

1. GET Profile 404 từng bị che bằng hồ sơ dựng từ session. Đã bỏ fallback; regression contract tái hiện thất bại trước sửa và đạt sau sửa.
2. Lỗi tải linked patient profile từng bị gộp thành “chưa liên kết”. Chỉ 404 mới là empty; lỗi mạng có thông báo/retry. Không hiển thị form lưu khi chưa tải được personal profile; dùng submission lock/abort và xóa success cũ khi sửa draft.
3. Phone validation FE từng bắt tối thiểu 7 ký tự/pattern riêng, trái contract D04. Đã đối chiếu Backend thật chấp nhận `123`; cả Profile/Patients dùng nullable, trim và tối đa 24 ký tự.
4. Header/Sidebar chưa hiển thị identity đã cập nhật. Đã dùng auth state hiện tại, tên có truncate và link Profile hoạt động trên mobile.
5. Lỗi lazy-import khi offline có thể để trang trắng. Đã thêm Error Boundary với thông báo an toàn và nút reload bằng bàn phím; không hiển thị raw exception/auth data.

Lỗi locator/pagination trong harness được sửa riêng: tìm mã patient mới trước khi edit vì record có thể nằm ngoài trang đầu. Không sửa ứng dụng hoặc response để giả PASS. Không phát hiện lỗi đóng modal trong probe, nên không sửa phần đó.

### Runtime và chạy lại an toàn

[D05 host helper](tests/runtime/D05-Acceptance-Host.ps1) dùng credential handoff Windows Credential Manager hiện có `ClinicManagement/QA/D03Catalog/fe-acceptance`, cùng tài khoản Windows có quyền. Không sửa credential/secret hoặc đưa chúng vào log/report/VITE_*. Truy cập vault cần host PowerShell; sandbox không có quyền thì báo blocker.

Backend D04 được build từ HEAD qua [init script chỉ ghi output FE](tests/runtime/d05-build.gradle), JAR SHA-256 `E97FC2B976A68A2250336456DC726514EAF083A078DE8BB8F616C54B5CF7B4D2`. Không sửa Backend/build file/migration. Artifact có đủ Profile/Patient/Doctor controllers; V1–V4 trong JAR được đối chiếu nội dung với source. MySQL thật **8.4.11**, Flyway checksum lần lượt **1116148885 / 196944325 / -886210658 / 298891223**, cả bốn success.

Fixture source `clinic-d03-fixtures-8c29ba1f8e6b` chỉ đọc, giữ nguyên **7 users / 4 specialties / 3 doctors**, catalog fingerprint và V1/V2; ID **5** vẫn eligible. Helper tạo MySQL/network/volume mới có ownership label, copy source qua RAM rồi chạy **migration V3/V4 đã merge chỉ trên copy** bằng Backend D04. Không SQL gán role hoặc sửa DB chia sẻ. Sau test, copy có **8 users / 11 specialties / 4 doctors / 14 patients**, đều synthetic; không tự tạo patient profile khi Register. Không dùng dữ liệu bệnh nhân thật.

Vite origin `127.0.0.1:5185`; cả `VITE_AUTH_MOCK`, `VITE_DIRECTORY_MOCK`, `VITE_PROFILE_MOCK`, `VITE_PATIENT_MOCK` đều `false`. Không fulfill response, không fallback mock. Hai DELETE negative dùng APIRequestContext thật do CORS browser không cho DELETE. Ca loading chỉ giữ rồi continue request thật; lỗi mạng dùng offline thực. Docker default pool đã đầy; helper cấp subnet QA riêng không trùng, không xóa network/volume để giải phóng chỗ.

Chu trình: `VerifySource` → `StartClone` → [D03 runner](tests/e2e/d03-real-acceptance-runner.mjs) `baseline`, `admin` → [Sprint 1 runner](tests/e2e/sprint1-real-runner.mjs) `profiles`, `patients`, `security` → D03 `security` → `runColdRouteRecovery` → `Verify` / `Audit` → `Cleanup`. Thực thi qua Playwright MCP nối CDP Chrome host. Lượt final không dùng tùy chọn `skip`; lựa chọn này chỉ phục vụ debug harness và không được tính PASS cho nhóm đã bỏ qua. Nếu chạy lại ADMIN/create, tạo copy sạch vì doctor eligible đã bị tiêu thụ trong copy cũ. Không chạy write tests vào source.

Sau kiểm tra, auth/handoff đã được xóa bằng reload; Vite/Chrome/Backend/MySQL **do D05 tạo** được dừng, giữ nguyên mọi volume/database và runtime source. Không commit runtime state/cache/log trong `test-results/`.

### Files D05 để review/commit thủ công

- `README.md`
- `src/components/app-error-boundary.tsx`, `src/main.tsx`
- `src/components/layout/header.tsx`, `src/components/layout/sidebar.tsx`
- `src/pages/profile.tsx`, `src/profile/api.ts`, `src/profile/model.ts`, `src/patient/model.ts`
- `tests/profile.contract.test.ts`, `tests/patient.contract.test.ts`
- `tests/e2e/sprint1-real-runner.mjs`
- `tests/runtime/D05-Acceptance-Host.ps1`, `tests/runtime/d05-build.gradle`

Không còn blocker D05. Các kết quả D02/D03 phía dưới là lịch sử, không thay thế hoặc cộng vào số nghiệm thu Sprint 1 hiện tại.

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
