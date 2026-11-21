# CL-D05-DB FINAL REVIEW

Ngày nghiệm thu: 2026-11-21 (Asia/Bangkok). Branch `feature/quynh`, target `dev`.
HEAD/local `origin/dev` và GitHub `dev` cùng SHA `c494db88a63111cfee46408eec3937c86a51ad04`
ở thời điểm kiểm tra; ahead/behind `0/0`. Local branch `dev` còn ở `6bbbe79`.
Không fetch/merge/reset/rebase/branch/add/commit/push. Index ban đầu rỗng.

## Kết quả chạy thật

| Phạm vi | PASS | FAIL | SKIPPED | Bằng chứng |
| --- | ---: | ---: | ---: | --- |
| Backend unit/H2 | 163 | 0 | 0 | Gradle `test build`, Java 21.0.10; build thành công |
| SQL/Flyway MySQL 8.4.11 | 129 | 0 | 0 | `D05_SUMMARY`; nâng cấp và schema V4 thực |
| Backend MySQL integration | 131 | 0 | 0 | Auth 39, Catalog 45, Patient/Profile 42, migration 1, startup 4 |
| Frontend unit/contract/mock | 94 | 0 | 0 | Vitest: 7 files; không phải bằng chứng UI E2E thật |
| Postman D02 sau sửa, theo request | 15 | 0 | 4 | 15/19 request thực thi; assertions: 48 PASS / 0 FAIL |

Frontend: Node `26.13.1`, npm `11.20.0`; `npm ci`, lint, test, build PASS.
`npm run format:check` trên working tree Windows FAIL: 94 file dùng CRLF,
trong khi Prettier mặc định LF. Không có lỗi quy tắc format khác trong 94 file này.
Không thay đổi file BE/FE. Backend build PASS.

Runtime nghiệm thu sau xử lý blocker: `.qa-runtime/d05/280af8f067f2/summary.json` và log cùng thư mục.
SQL 129/129, MySQL integration 131/131 và 48 Postman assertions đã chạy lại PASS.
Chỉ 15 request Postman thực thi; không tuyên bố 19/19 PASS hay đầy đủ fixture.
Postman trước sửa FAIL ở SCF-04 `GET /api/v1/auth/me`, Bearer `{{malformedToken}}`:
collection kỳ vọng `AUTHENTICATION_REQUIRED`, API trả `INVALID_ACCESS_TOKEN` (HTTP 401 đúng).
Theo API_CONTRACT dòng 179–180 và mục D04: thiếu token → `AUTHENTICATION_REQUIRED`;
token sai/hết hạn → `INVALID_ACCESS_TOKEN`. Đã sửa đúng một assertion ở
`docs/qa/postman/CL-D02-Auth.postman_collection.json`; Backend không đổi.
Skip AUTH-D02-08/10/11/14 vì thiếu disabled-account/wrong-signature/expired-token/
other-user fixtures; không tính PASS. Các hành vi này đã có coverage HTTP integration
riêng: loginFailuresDoNotRevealAccountState, wrongSignatureReturns401OverHttp,
invalidJwtClaimsReturn401, getPatientByIdPatientOwnership; không quy đổi thành Postman PASS.

| Request SKIPPED | Biến fixture thiếu (để trống trong collection) |
| --- | --- |
| AUTH-D02-08 Disabled account | disabledEmail, disabledPassword |
| AUTH-D02-10 Wrong-signature JWT | wrongSignatureToken |
| AUTH-D02-11 Expired signed JWT | expiredToken |
| AUTH-D02-14 Other account query | otherUserId, patientUserId; qaPatientToken đã có từ login |

Flyway V1→V2→V3→V4, fresh install, validate và migrate lại no-op PASS;
history/checksum không đổi. V1–V4 giữ nguyên byte. Kiểm tra FK RESTRICT,
UNIQUE, CHECK, InnoDB/utf8mb4, tiếng Việt/emoji, users.phone/address NULL,
patients.phone không UNIQUE, soft delete/rollback PASS. Dữ liệu synthetic của
cả bốn bảng được so sánh trước/sau V4; không mất dữ liệu.

Auth/JWT/RBAC, eligible-users, CRUD qua POST/GET/PATCH, search/filter/pagination,
profile, patient self-profile, conflict/validation và cross-user isolation được chạy
qua HTTP thật trong suite MySQL. PATIENT đọc hồ sơ khác trả 404; DOCTOR bị deny
theo contract hiện tại; không cấp quyền từ token role giả; không lộ credential.
DELETE không thuộc API triển khai: kiểm tra deny; soft delete dùng PATCH isActive=false.
Đối chiếu controller và FE auth/directory/profile/patient adapters với API_CONTRACT;
test FE contract/mock được tính riêng, chưa tuyên bố browser E2E PASS.

## CI và giới hạn nghiệm thu

Repo chưa có workflow trước D05. Thêm duy nhất `.github/workflows/ci.yml`:
PR vào `dev`, push `dev`/`feature/**`; hai job BE/FE độc lập, timeout/concurrency,
`contents: read`, checkout không lưu credentials. Java 21 + Gradle wrapper;
Node theo README FE + npm ci/lint/test/build/format:check. Format vẫn là gate bắt buộc.
Không DB/secret/password trong basic CI; chưa bật MySQL job.
Workflow qua actionlint `v1.7.12` và Prettier. **GitHub Actions: NOT RUN** cho thay đổi này;
local PASS không thay thế CI run thành công. Cần chủ sở hữu commit/push và cung cấp run.
Tham chiếu cấu hình: [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax),
[setup-java](https://github.com/actions/setup-java), [setup-node](https://github.com/actions/setup-node).

## Chạy lại và dữ liệu

```powershell
cd backend
.\gradlew.bat --no-daemon test build
cd ..\frontend
npm.cmd ci
npm.cmd run lint
npm.cmd run test
npm.cmd run build
npm.cmd run format:check
cd ..
npm.cmd install --prefix .qa-runtime/d05/newman --no-audit --no-fund newman
python database/qa/validate_d05.py --newman-module .qa-runtime/d05/newman/node_modules/newman
```

Runner tạo container/volume mới, bind loopback/port động, sinh credential trong RAM,
tách schema preservation/HTTP/Postman. Dừng đúng container vừa tạo, giữ volume;
không dùng Clinic chung hay SmartExpense. Collection chỉ sửa assertion SCF-04; runner bật
collection variable `runAuthTests=true` trong RAM. Log đã lọc secret ở `.qa-runtime/d05/`;
không commit runtime, full Newman report hoặc screenshot PNG.

## File bàn giao

Năm file D05: `.github/workflows/ci.yml`, `database/qa/D05DatabaseValidation.java`,
`database/qa/validate_d05.py`, `docs/qa/CL-D05-DB.md`,
`docs/qa/postman/CL-D02-Auth.postman_collection.json`. Chưa stage/commit file nào.
Giữ nguyên 10 file QA cũ, loại khỏi D05:

- Modified chung từ trước: `.gitignore`, `database/README.md`, `docs/qa/TEST_PLAN.md`.
- Untracked D02: `database/qa/D02DatabaseValidation.java`, `database/qa/D02StaffFixtures.java`,
  `database/qa/staff_fixture_vault.py`, `database/qa/staff_role_fixtures.py`,
  `database/qa/validate_d02.py`, `docs/qa/STAFF_ROLE_FIXTURES.md`,
  `docs/qa/evidence/CL-D02-STAFF-FIXTURES.json`.

SHA-256 đối chiếu giữ nguyên cả 10 file cũ và 4 migration; không sửa BE/FE.
Blocker: LF working tree Windows chưa được chuẩn hóa khi Trang đang QA;
bốn fixture Postman vẫn thiếu; chủ sở hữu Git commit/push để chạy CI.
Chưa có GitHub Actions run thành công cho workflow D05.
**STATUS: BLOCKED**.

## Phân tích format và review CI sau xử lý blocker

Prettier `3.10.1`; `.prettierrc.json`: semi=false, singleQuote=true, trailingComma=all,
không override endOfLine. `format:check` vẫn là `prettier --check .`.
Đã kiểm tra chính xác 94 file: 57 src, 14 tests, 11 docs, 12 file ở root frontend.
**94/94 chỉ CRLF; 0 lỗi quy tắc Prettier; 0 file trong HEAD chưa format** trong tập này.
Chuẩn hóa LF trong RAM làm nội dung trùng HEAD và đạt Prettier cho từng file.
Chạy thật `prettier --check .` trên bản export HEAD/LF cô lập cũng **PASS**;
đây không phải GitHub Actions run hoặc PASS cho working tree Windows hiện tại.
Danh sách đủ 94 path và phân loại: `.qa-runtime/d05/blocker-resolution/format-analysis.json`;
log chạy thật: `head-lf-format-check.log` cùng thư mục. Chỉ ghi bản copy ở runtime, không sửa FE.

Giải pháp ít ảnh hưởng: sau khi Trang QA xong, chủ sở hữu FE chuẩn hóa EOL của đúng
94 file về LF và chạy lại check; không cần reformat logic hoặc cập nhật Prettier.
Chốt quy ước LF cho text frontend qua `.gitattributes`/editor trong thay đổi riêng để tránh tái diễn.
Không dùng endOfLine=auto, không tắt gate, không thêm ignore để che lỗi.
node_modules/dist/package-lock/test-results/playwright-report đã nằm ngoài format scope.
Trong 94 file có bốn JSON evidence lịch sử ở docs/qa; chỉ cân nhắc scope artifact cùng
chủ sở hữu ở việc riêng, không cần loại bất kỳ file nào để xử lý nguyên nhân CRLF.
Tham chiếu: [Prettier EOL](https://prettier.io/docs/options#line-feed),
[Prettier ignore](https://prettier.io/docs/ignore).

Review workflow: Java 21 trùng Gradle toolchain; wrapper 9.8.1 có checksum;
Node 26.13.1 trùng README, npm ci dùng lockfile; lint/test/build/format giữ nguyên.
Hai job độc lập, permissions contents:read, không secrets/env DB hoặc password;
không pull_request_target, không dùng DB dùng chung, chưa bật MySQL job.
Actionlint v1.7.12 chạy lại PASS; workflow không cần sửa. GitHub Actions vẫn NOT RUN.
