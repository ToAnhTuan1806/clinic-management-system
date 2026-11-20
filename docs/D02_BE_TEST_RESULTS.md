# CL-D02-BE — JWT Authentication & Authorization

Ngày: **2026-11-20**, Asia/Bangkok.

TASK: **CL-D02-BE**
BRANCH: **feature/tuan**
HEAD trước/sau: **58f72a7ebf744a5d8d450bcf8b16d732affb544c**
STATUS: **READY FOR REVIEW — implementation và test H2/HTTP; auth MySQL integration PENDING QA V1.**

## Kiểm soát thay đổi

- Đã kiểm tra workspace, branch, Git status và HEAD trước khi làm; không đổi nhánh/worktree.
- `.gitignore` đã untracked từ trước, được giữ nguyên; không coi là file D02 tạo ra.
- Không commit, push, pull, fetch, merge, rebase hoặc reset.
- Không sửa FE, Docker Compose, tài liệu nguồn QA hoặc migration của Database/QA.
- Chưa có `docs/database/DATABASE_DESIGN.md` trong branch BE. Đã đọc và đối chiếu bản
  `docs/database/DATABASE_DESIGN.md` trong worktree QA `F:\RikkeiEdu\clinic-management-system-QA`;
  đồng thời đọc FEATURE_SCOPE, API_CONTRACT và SCHEMA_REVIEW_D01 của BE.
- Có tiến trình khác đang giữ JAR/log D01 trong backend/build. Đã kiểm tra PID/thời điểm
  nhưng không in command line/credential, không dừng tiến trình hoặc thay thế runtime đó.

## API IMPLEMENTED

| API | Authentication | Thành công | Hành vi |
| --- | --- | --- | --- |
| POST /api/v1/auth/register | Public | 201 | Chỉ PATIENT/ACTIVE, email canonical UNIQUE, BCrypt, không tự cấp JWT |
| POST /api/v1/auth/login | Public | 200 | Kiểm tra mật khẩu/ACTIVE, cập nhật lastLoginAt, trả Bearer/expiresIn/user |
| GET /api/v1/auth/me | JWT hợp lệ + ACTIVE | 200 | Đúng 5 trường id/email/fullName/role/status, không passwordHash |
| GET /api/v1/health | Public | 200 | Giữ body D01 `{"data":{"status":"UP"}}` |

Response thành công bọc data; lỗi application/problem+json có status/code.
Register/Login không nhận role/status; JSON field thừa trả 400.
Email được trim/lowercase Locale.ROOT; fullName trim; password không trim.
Register dùng @Size 12–72 ký tự, tối đa 72 byte UTF-8; BCrypt cost 12.
Login sai email/password hoặc DISABLED trả cùng INVALID_CREDENTIALS/401.
Email trùng kể cả race trả EMAIL_ALREADY_EXISTS/409 nhờ pre-check và UNIQUE ở DB.
Không có Doctor/Patient entity/profile, account mặc định hoặc dữ liệu bệnh nhân thật.

## JWT CONFIGURATION

| Biến môi trường | Quy ước |
| --- | --- |
| JWT_SECRET | Bắt buộc; Base64 của ít nhất 32 byte ngẫu nhiên; không có key mặc định |
| JWT_ISSUER | Mặc định clinic-management; không được rỗng, luôn được xác minh |
| CORS_ALLOWED_ORIGINS | Origin HTTP(S) chính xác phân cách dấu phẩy; mặc định rỗng |
| DB_URL / DB_USERNAME / DB_PASSWORD | Giữ lấy từ environment, không hardcode |

- Chỉ HS256. Claims tối thiểu iss/sub/iat/exp; sub là user id dạng chuỗi.
- Expiry 30 phút/1800 giây; kiểm tra chữ ký, issuer, exp/iat/sub, token thiếu exp,
  iat tương lai hoặc lifetime dài hơn 30 phút đều bị từ chối. Không có grace sau exp.
- Trên mỗi request, load user từ DB và yêu cầu ACTIVE. Role hiện tại của DB map sang
  ROLE_ADMIN/ROLE_DOCTOR/ROLE_RECEPTIONIST/ROLE_PATIENT; bỏ qua role/roles/scope trong token.
- OAuth2 Resource Server xử lý Bearer trong SecurityFilterChain; không có JWT filter ngoài chain.
- Không xác thực bằng cookie/query/form; stateless, không Basic/form login/session.
- CSRF tắt vì credential chỉ gửi chủ động qua Authorization header, không có cookie xác thực.
  Nếu đổi transport sang cookie phải đánh giá lại CSRF.
- CORS exact allowlist, không wildcard/null/pattern; GET/POST/OPTIONS,
  Authorization/Content-Type, expose Location, allowCredentials=false.
- API nghiệp vụ chưa triển khai vẫn denyAll kể cả ADMIN. Không tạo endpoint quản trị để demo quyền.
- Logout D02 chỉ xóa token phía client; **không server revoke, refresh hoặc logout endpoint đã triển khai**.
  Token cũ còn hiệu lực đến exp nếu user vẫn ACTIVE.
- DTO chứa password/accessToken có toString redacted; error/log không echo request hoặc credential;
  Hibernate bind logging tắt. JWT secret không dùng binding validation có thể echo giá trị lỗi.

## SECURITY TESTS

Đã chạy unit và integration qua HTTP thật/Tomcat ngẫu nhiên với H2 riêng mỗi context:

| Test class | Tests | Failures | Errors | Skipped |
| --- | --- | --- | --- | --- |
| ApiErrorHandlingTest | 4 | 0 | 0 | 0 |
| ApplicationIntegrationTest | 5 | 0 | 0 | 0 |
| AuthHttpIntegrationTest | 39 | 0 | 0 | 0 |
| CorsOriginsTest | 11 | 0 | 0 | 0 |
| JwtConfigTest | 2 | 0 | 0 | 0 |
| AuthServiceTest | 1 | 0 | 0 | 0 |
| **Tổng bộ test mặc định** | **62** | **0** | **0** | **0** |

Các kiểm tra đã thực hiện:

- Register PATIENT thành công, canonical email/tên, BCrypt persistence và không rò hash;
  duplicate email, 2 request đăng ký đồng thời chỉ tạo 1 user/1 conflict.
- Email/password/fullName sai, rỗng, thiếu, quá dài; password UTF-8 vượt 72 byte.
- Từ chối role ADMIN/status/id/passwordHash qua payload register.
- Login đúng/sai, email không tồn tại, DISABLED cùng thông điệp chung; lastLoginAt chỉ cập nhật khi thành công.
- JWT hợp lệ; sai chữ ký (unit và HTTP), hết hạn, issuer sai, thiếu exp/sub, iat tương lai,
  lifetime quá dài; từ chối HS384/unsigned JWT ở decoder.
- Thiếu/malformed JWT trả 401; cookie/query không xác thực; user bị khóa/xóa sau khi cấp token trả 401.
- Cả 4 role map đúng ROLE_*; kiểm tra method security trên service fixture test-only,
  và HTTP 403 cho API chưa triển khai; claim role/roles/scope không nâng PATIENT thành ADMIN.
- Unit test mô phỏng disable giữa BCrypt và conditional login update: không cấp token.
  Đây không phải kiểm thử transaction/concurrency MySQL thật.
- CORS origin/header allowlist, không cookie credentials, lỗi CORS dạng Problem Details;
  health D01 vẫn 200; không có session cookie.
- Capture stdout/stderr ở auth HTTP tests: không chứa password/token/hash được tạo trong test.
  Rà soát stdout/stderr cuối không thấy mẫu JWT hoặc BCrypt hash.

Fixture duy nhất: `backend/src/test/resources/fixtures/users-schema.sql`, chỉ H2/test classpath.
Test profile tắt Flyway, SQL init fixture và JPA validate. Main vẫn ddl-auto=validate,
Flyway enabled; không copy fixture vào migration hoặc boot JAR.

## GRADLE RESULTS

Lệnh yêu cầu `.\gradlew.bat --no-daemon clean build` đã được chạy nhưng **FAIL do file lock**:
JAR D01 và mysql-application-startup.log trong backend/build đang mở bởi process khác.
Không xóa cưỡng bức hoặc dừng process đó.

Sau đó chạy đủ clean/build/test với output riêng bằng init script tạm, chỉ chứa:

```groovy
allprojects { layout.buildDirectory = layout.projectDirectory.dir('build/d02-validation') }
```

```powershell
.\gradlew.bat --no-daemon --init-script <temporary-init-script> clean build
```

**Kết quả cuối: BUILD SUCCESSFUL, exit 0, 9 actionable tasks / 9 executed, 62 tests PASS.**
Init script tạm được xóa sau khi chạy; không đổi build.gradle để né file lock.
Một lần tạo init script bằng UTF-8 BOM bị Groovy từ chối; đã tạo lại dạng ASCII và chạy thành công.
Lần test auth đầu có một assertion đọc issuer qua URL accessor không phù hợp issuer dạng chuỗi;
đã sửa đọc claim iss và chạy lại toàn bộ bộ test thành công.

Artifacts cuối, đã gitignore:

```text
backend/build/d02-validation/libs/clinic-management-backend-0.0.1-SNAPSHOT.jar
backend/build/d02-validation/reports/tests/test/index.html
backend/build/d02-validation/test-results/test/TEST-*.xml
```

Đã kiểm tra boot JAR có OAuth2/JWT dependencies, không chứa H2, test class, fixture schema,
application-test.yml hoặc migration SQL nghiệp vụ. Không thay JAR D01 đang chạy.

## MYSQL INTEGRATION: PENDING QA V1

Đã kiểm tra **chỉ đọc** metadata container QA: MySQL **8.4.11**, database clinic_management_db,
**0 bảng**, users chưa tồn tại. Không chạy DDL hoặc ghi dữ liệu vào MySQL thật.
BE và QA chưa có SQL V1 được cung cấp trong workspace tại thời điểm kiểm tra.

**mysqlTest D02 chưa chạy, không có kết quả PASS cho auth MySQL.**
Task vẫn giữ profile mysql-validation và key test ngẫu nhiên; khi có users/V1, JPA validate
sẽ kiểm tra mapping users thay vì chỉ startup schema rỗng như D01.
QA V1 là điều kiện trước khi chạy mysqlTest và kiểm thử register/login/me trên MySQL test thật.
Không dùng kết quả H2 hoặc startup MySQL D01 để kết luận auth/MySQL đã đạt.

## FE HANDOFF

- Xem request/response/status thực tế tại [API_CONTRACT](API_CONTRACT.md), mục Authentication D02.
- Register không auto-login; POST login rồi dùng Authorization Bearer cho GET me.
- expiresIn tính bằng giây, id là chuỗi; xử lý 400/401/403/409 theo code, không so chuỗi detail.
- Không gửi role/status, cookie credentials hoặc token trong URL; không log response login.
- Logout xóa token/danh tính khỏi client, không thông báo đã server revoke; chưa có refresh.
- Cần cung cấp origin FE chính xác cho CORS_ALLOWED_ORIGINS. Môi trường main không mặc định localhost.
- Runtime D01 hiện có không được thay thế trong task này; chạy bản D02 cần JWT_SECRET và users/V1 của QA.

## DB HANDOFF

V1 do **Database/QA** sở hữu. BE chỉ thêm User mapping, không tạo/sửa SQL V1:

| Java / cột | SQL dự kiến từ QA | Nullable / ghi chú |
| --- | --- | --- |
| id | BIGINT signed AUTO_INCREMENT | PK, NOT NULL; API serialize chuỗi |
| email | VARCHAR(254) | NOT NULL, UNIQUE; canonical trim/lowercase, collation binary theo QA |
| passwordHash / password_hash | VARCHAR(255) | NOT NULL; BCrypt, không trả qua API |
| fullName / full_name | VARCHAR(120) | NOT NULL |
| role | VARCHAR(20) | NOT NULL, ADMIN/DOCTOR/RECEPTIONIST/PATIENT; không native ENUM |
| status | VARCHAR(16) | NOT NULL, ACTIVE/DISABLED; không native ENUM |
| lastLoginAt / last_login_at | DATETIME(6) UTC | Nullable |
| createdAt / created_at | DATETIME(6) UTC | NOT NULL, BE quản lý |
| updatedAt / updated_at | DATETIME(6) UTC | NOT NULL, BE quản lý |

Hibernate enum mapping được ép JDBC VARCHAR cho đúng thiết kế QA; timestamp không mang timezone,
JDBC time_zone=UTC. UNIQUE email là bắt buộc để bảo vệ đăng ký đồng thời, không chỉ dựa pre-check.
Chưa tạo liên kết Patient/Doctor; đăng ký user PATIENT không tự tạo patient profile.
QA cần cung cấp V1 có constraints/collation và test DB riêng; sau đó xác minh JPA/Flyway,
email canonical/duplicate concurrency, BCrypt và toàn bộ HTTP auth trên MySQL.

## RISKS/BLOCKERS

- Auth MySQL pending vì thiếu V1/users; mapping/type/collation chưa được chứng minh trên MySQL.
- Default clean build bị file lock môi trường; isolated clean build đã PASS, process ngoài phạm vi giữ nguyên.
- Refresh/revoke, quản lý nhân viên/profile, rate limiting và quyền nghiệp vụ chưa thuộc phần triển khai D02 này.
- Không có thay đổi ngoài phạm vi source phát hiện thêm; `.gitignore` có sẵn giữ nguyên.

## FILES CHANGED

**40 file D02: 15 sửa, 25 mới**; không tính `.gitignore` untracked có sẵn:

```text
backend/README.md
backend/build.gradle
backend/src/main/java/com/clinicmanagement/config/CorsOrigins.java
backend/src/main/java/com/clinicmanagement/config/JwtConfig.java
backend/src/main/java/com/clinicmanagement/config/SecurityConfig.java
backend/src/main/java/com/clinicmanagement/controller/AuthController.java
backend/src/main/java/com/clinicmanagement/dto/LoginRequest.java
backend/src/main/java/com/clinicmanagement/dto/LoginResponse.java
backend/src/main/java/com/clinicmanagement/dto/RegisterRequest.java
backend/src/main/java/com/clinicmanagement/dto/UserResponse.java
backend/src/main/java/com/clinicmanagement/entity/Role.java
backend/src/main/java/com/clinicmanagement/entity/User.java
backend/src/main/java/com/clinicmanagement/entity/UserStatus.java
backend/src/main/java/com/clinicmanagement/entity/package-info.java
backend/src/main/java/com/clinicmanagement/exception/ApiProblems.java
backend/src/main/java/com/clinicmanagement/exception/AuthApiException.java
backend/src/main/java/com/clinicmanagement/exception/GlobalExceptionHandler.java
backend/src/main/java/com/clinicmanagement/repository/UserRepository.java
backend/src/main/java/com/clinicmanagement/repository/package-info.java
backend/src/main/java/com/clinicmanagement/security/ActiveUserJwtConverter.java
backend/src/main/java/com/clinicmanagement/security/AuthenticatedUser.java
backend/src/main/java/com/clinicmanagement/service/AuthService.java
backend/src/main/java/com/clinicmanagement/service/JwtTokenService.java
backend/src/main/java/com/clinicmanagement/service/package-info.java
backend/src/main/java/com/clinicmanagement/validation/Utf8Size.java
backend/src/main/java/com/clinicmanagement/validation/Utf8SizeValidator.java
backend/src/main/resources/application.yml
backend/src/test/java/com/clinicmanagement/ApplicationIntegrationTest.java
backend/src/test/java/com/clinicmanagement/AuthHttpIntegrationTest.java
backend/src/test/java/com/clinicmanagement/MySqlStartupTest.java
backend/src/test/java/com/clinicmanagement/TestSecurityProperties.java
backend/src/test/java/com/clinicmanagement/config/CorsOriginsTest.java
backend/src/test/java/com/clinicmanagement/config/JwtConfigTest.java
backend/src/test/java/com/clinicmanagement/service/AuthServiceTest.java
backend/src/test/resources/application-test.yml
backend/src/test/resources/fixtures/users-schema.sql
docs/API_CONTRACT.md
docs/SCHEMA_REVIEW_D01.md
docs/requirements/FEATURE_SCOPE.md
docs/D02_BE_TEST_RESULTS.md
```
