# CL-D02-BE FINAL REVIEW — MySQL V1 integration

Ngày: **2026-11-20**, Asia/Bangkok.

TASK: **CL-D02-BE FINAL REVIEW**
BRANCH: **feature/tuan**
HEAD trước/sau: **3ae40b87954badf05599ec957a72ee76ea1dc4d5**
STATUS: **READY FOR COMMIT** — Backend D02 và V1 QA tương thích trên MySQL thật; chưa tự commit/merge/push.

## Phạm vi và đầu vào

- Đã kiểm tra workspace, branch, Git status và HEAD trước khi làm. Không đổi nhánh/worktree;
  không commit, push, pull, fetch, merge, reset hoặc rebase.
- Có sẵn thay đổi ở docs/SCHEMA_REVIEW_D01.md, docs/requirements/FEATURE_SCOPE.md và
  .gitignore untracked. Giữ nguyên nội dung, đối chiếu checksum cuối phiên; không tính vào file của task này.
- Không sửa main auth code, FE, Docker Compose, migration V1 hoặc tài liệu của QA.
- Không xóa database hay Docker volume. Dữ liệu test chỉ là tài khoản giả sinh ngẫu nhiên;
  không có bệnh nhân thật, account mặc định, mật khẩu cố định hoặc credential/token trong báo cáo.

## Migration provenance — không sửa V1

V1 chưa nằm trong working tree feature/tuan. Ref local origin/dev đã chứa bản được merge;
không cần và không thực hiện fetch/merge để đọc:

| Đầu vào | Giá trị |
| --- | --- |
| Commit dev được kiểm tra | 9838b44312cb62e32e846d65f03dc023ac6c3ca3 |
| Path | backend/src/main/resources/db/migration/V1__create_users.sql |
| Git blob | 56a0f6f8be55ae6769c3848a6d302abb25dc7db5 |
| SHA-256 nội dung | 27043f2c2669b8b666d4c17f9be12d14cc40a7e96451ad10b2a99f3b07955edf |

Dùng git show để đọc đúng byte của blob vào
backend/build/d02-final-inputs/migrations/V1__create_users.sql (build output đã ignore).
Không chép vào source, không viết lại SQL, không đổi checksum/version và không repair/baseline/clean.
Flyway nhận location filesystem này qua MYSQL_TEST_MIGRATIONS_LOCATION trong process kiểm thử.
Như vậy đối tượng xác minh là **BE HEAD nêu trên + V1 chính thức từ dev**, không phải một V1 tự dựng.

## MYSQL MIGRATION: PASS

| Kiểm tra thực tế | Kết quả |
| --- | --- |
| Server | MySQL **8.4.11**, 127.0.0.1:3307, container QA hiện có |
| Database kiểm thử mới | **clinic_d02_be_it_afcdd35782de**, ban đầu 0 bảng |
| Database chia sẻ | clinic_management_db; chỉ đọc metadata, không migrate hoặc ghi fixture vào đây |
| Preflight trước auth | MySqlMigrationTest: **1/1 PASS** |
| Flyway lần đầu | Áp dụng đúng một V1, tạo users và flyway_schema_history trong DB cô lập |
| Validate | Thành công |
| Migrate lặp lại | 0 migration được thực thi |
| Applied version/script | 1 / V1__create_users.sql |
| Flyway checksum | **1116148885**, success=1 |
| Sau toàn bộ test | Nội dung V1 và history giữ nguyên checksum/version/script/installed_on |
| Database chia sẻ trước/sau | Metadata tables/columns/indexes không đổi |

Credentials lấy từ environment container QA và chỉ truyền trong environment process.
Tạo database mới và cấp quyền app user chỉ trên DB mới; không đổi mật khẩu/tài khoản QA hiện có.
DB kiểm thử được giữ lại, không drop; chỉ có synthetic users/Flyway history phục vụ kiểm thử.

## HIBERNATE VALIDATION: PASS

Ứng dụng Spring Boot/Tomcat thật đã khởi động với MySQL và V1, qua cấu hình main:

- spring.jpa.hibernate.ddl-auto = **validate**, không create/update schema.
- spring.sql.init.mode = **never**; không dùng schema fixture H2 trên MySQL.
- hibernate.jdbc.time_zone = **UTC**; session MySQL **+00:00**.
  JDBC URL test dùng connectionTimeZone=UTC và forceConnectionTimeZoneToSession=true.
- Flyway main migrate/validate được chạy trước JPA; profile test mysql-integration
  không dùng bean validate-only của profile mysql-validation.
- clean-disabled=true, baseline-on-migrate=false.

Đã đối chiếu information_schema và startup JPA thành công:

| Cột | Schema V1 thực tế | Mapping BE / kết quả |
| --- | --- | --- |
| id | BIGINT signed, NOT NULL, AUTO_INCREMENT, PRIMARY | Long + IDENTITY; API id chuỗi |
| email | VARCHAR(254), utf8mb4_bin, NOT NULL, UNIQUE | trim/lowercase; CHECK canonical và duplicate test đạt |
| password_hash | VARCHAR(255), NOT NULL | BCrypt; không trả hash qua API |
| full_name | VARCHAR(120), NOT NULL | String, trim và validate DTO |
| role | VARCHAR(20), utf8mb4_0900_bin, NOT NULL | Enum STRING/JDBC VARCHAR; 4 role, không native ENUM |
| status | VARCHAR(16), utf8mb4_0900_bin, NOT NULL | ACTIVE/DISABLED, JDBC VARCHAR |
| last_login_at | DATETIME(6), nullable | Instant/JDBC TIMESTAMP, UTC |
| created_at / updated_at | DATETIME(6), NOT NULL | Instant/JDBC TIMESTAMP, UTC; BE quản lý |

PK, uk_users_email, chk_users_email_canonical, chk_users_role và chk_users_status tồn tại.
**Không phát hiện schema mismatch; không sửa User entity hoặc V1 để vượt validation.**

## AUTH API TESTS: PASS qua HTTP thật + MySQL

MySqlAuthIntegrationTest chạy **39 ca** kế thừa cùng bộ contract với H2, không mock repository,
datasource, JWT decoder hoặc SecurityFilterChain. Tomcat dùng port ngẫu nhiên.

| Nhóm yêu cầu | Bằng chứng đã chạy |
| --- | --- |
| Register PATIENT | POST register 201; PATIENT/ACTIVE, canonical email/name, BCrypt persistence, đúng 5 trường public |
| Email trùng | 409 EMAIL_ALREADY_EXISTS; hai request đồng thời chỉ một user, một 201 + một 409 |
| Không đăng ký ADMIN | role/status/id/passwordHash từ request bị 400; không tạo user trái phép |
| Validation | Email/tên/password sai, thiếu, rỗng, quá dài; giới hạn 72 byte UTF-8 |
| Login đúng | POST login 200, Bearer, expiresIn=1800, user; lastLoginAt được cập nhật |
| Login sai / DISABLED | 401 INVALID_CREDENTIALS cùng thông điệp chung; lastLoginAt không đổi khi thất bại |
| Me | GET me 200 với JWT hợp lệ, dữ liệu hiện tại từ DB, không passwordHash |
| Bảo vệ dữ liệu | Auth DTO/entity không lộ hash; Cache-Control no-store, không session cookie |

Test ghi/xóa user fixture chỉ nhận database loopback tên clinic_d02_be_it_* và kiểm tra lại URL
trước khi cleanup. Guard từ chối clinic_management_db, DB không định danh và host remote;
hai unit test mới kiểm tra cơ chế chặn này.

## JWT SECURITY TESTS: PASS

- JWT hợp lệ; chữ ký sai qua HTTP trả 401; expired, issuer sai, thiếu exp/sub,
  iat tương lai hoặc lifetime quá dài đều 401.
- Unit decoder từ chối thuật toán HS384 và unsigned JWT; HS256 hợp lệ được chấp nhận.
- Thiếu/malformed JWT, token query/cookie không xác thực; tài khoản bị khóa/xóa sau cấp token trả 401.
- Role hiện tại từ DB map ROLE_*. Claim role/roles/scope không nâng PATIENT lên ADMIN.
- API chưa triển khai, kể cả với JWT ADMIN, trả **403**; anonymous trả **401**.
- Method security được xác minh qua service fixture chỉ có trong test, không thêm endpoint quản trị.
- CORS exact origin/header allowlist được kiểm tra: allowlist thành công, origin/header khác 403
  CORS_REJECTED; allowCredentials không bật.
- Register/login chạy không cần CSRF cookie/token: phù hợp Bearer-only stateless;
  không Basic/form/cookie authentication. Health D01 vẫn 200/UP.
- Capture log auth tests không chứa password/token/hash được sinh trong test;
  rà soát stdout/stderr cuối không phát hiện mẫu JWT hoặc BCrypt hash.
- Logout vẫn client-only; không tuyên bố server revoke hoặc refresh đã triển khai.

## GRADLE RESULTS: PASS

Chạy preflight trên DB rỗng trước, sau đó clean build + toàn bộ test:

```powershell
.\gradlew.bat --no-daemon --init-script build/d02-final-inputs/output.gradle mysqlTest --tests com.clinicmanagement.MySqlMigrationTest
.\gradlew.bat --no-daemon --init-script build/d02-final-inputs/output.gradle clean build mysqlTest
```

Init script chỉ đặt layout.buildDirectory = build/d02-final-validation, giữ output D01/D02
đang được process khác mở. Không dừng các process đó hoặc thay Gradle Wrapper/version.

**Lần cuối: BUILD SUCCESSFUL, exit code 0.**

| Bộ test cuối | Tests | Failures | Errors | Skipped |
| --- | --- | --- | --- | --- |
| ApiErrorHandlingTest | 4 | 0 | 0 | 0 |
| ApplicationIntegrationTest | 5 | 0 | 0 | 0 |
| AuthHttpIntegrationTest — H2 | 39 | 0 | 0 | 0 |
| CorsOriginsTest | 11 | 0 | 0 | 0 |
| JwtConfigTest | 2 | 0 | 0 | 0 |
| AuthServiceTest | 1 | 0 | 0 | 0 |
| MySqlTestDatabaseTest | 2 | 0 | 0 | 0 |
| **Task test** | **64** | **0** | **0** | **0** |
| MySqlAuthIntegrationTest — HTTP/MySQL | 39 | 0 | 0 | 0 |
| MySqlMigrationTest | 1 | 0 | 0 | 0 |
| MySqlStartupTest — startup/schema/UTC/health | 4 | 0 | 0 | 0 |
| **Task mysqlTest** | **44** | **0** | **0** | **0** |
| **Tổng lần cuối** | **108** | **0** | **0** | **0** |

Preflight 1 test đã chạy riêng trước đó, **không cộng trùng** vào tổng 108 của lần cuối.
H2 và MySQL tái dùng 39 ca contract để tránh hai bộ test lệch nhau; kết quả mỗi DB được báo riêng.

Artifacts đã ignore:

```text
backend/build/d02-final-validation/reports/tests/test/index.html
backend/build/d02-final-validation/reports/tests/mysqlTest/index.html
backend/build/d02-final-validation/test-results/test/TEST-*.xml
backend/build/d02-final-validation/test-results/mysqlTest/TEST-*.xml
backend/build/d02-final-validation/libs/clinic-management-backend-0.0.1-SNAPSHOT.jar
backend/build/d02-final-inputs/preflight-migration.xml
backend/build/d02-final-inputs/preflight-gradle.log
backend/build/d02-final-inputs/final-gradle.log
backend/build/d02-final-inputs/state.json
```

Boot JAR không chứa H2, test class hoặc fixture. V1 dùng external location trong lần kiểm tra này;
JAR từ riêng feature/tuan chưa tự chứa V1, cần tree tích hợp dev hoặc location migration chính thức
khi chạy thực tế. Không phát hành/deploy JAR độc lập hoặc rollout vào DB chia sẻ trong task này.

## MYSQL INTEGRATION: PASS — phạm vi kiểm thử cô lập

BE D02 + V1 chính thức từ dev đã chạy Flyway, JPA và toàn bộ auth HTTP trên MySQL **8.4.11**.
Blocker thiếu V1/users của lần báo cáo trước đã được giải quyết cho integration validation.
Database chia sẻ clinic_management_db và các Docker volume được giữ nguyên.

## REMAINING ISSUES

- Không còn blocker về User schema, JWT hoặc auth integration trong phạm vi D02 đã kiểm thử.
- V1 đang ở dev, chưa trong working tree feature/tuan. Khi tích hợp, giữ đúng migration QA đã merge;
  không thêm bản V1 thứ hai, không sửa checksum. Việc merge/commit/push do người dùng thực hiện.
- Hai tài liệu đang sửa và .gitignore có sẵn vẫn giữ nguyên, tách khỏi 10 file của task final review.
- Không kiểm thử FE E2E, triển khai production, refresh/revoke hoặc nghiệp vụ ngoài users/auth.
  Các phần đó không được coi là PASS trong báo cáo này.

## FILES CHANGED — riêng lần final integration

**10 file: 5 sửa, 5 mới**, không tính ba file có thay đổi từ trước:

```text
backend/README.md
backend/build.gradle
backend/src/test/java/com/clinicmanagement/AuthHttpIntegrationTest.java
backend/src/test/java/com/clinicmanagement/AuthHttpTestSupport.java
backend/src/test/java/com/clinicmanagement/MySqlAuthIntegrationTest.java
backend/src/test/java/com/clinicmanagement/MySqlMigrationTest.java
backend/src/test/java/com/clinicmanagement/MySqlStartupTest.java
backend/src/test/java/com/clinicmanagement/MySqlTestDatabase.java
backend/src/test/java/com/clinicmanagement/MySqlTestDatabaseTest.java
docs/D02_BE_TEST_RESULTS.md
```
