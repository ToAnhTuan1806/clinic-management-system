# Clinic Management Backend — D02

Java **21**, Spring Boot **4.1.3** (stable), Gradle Wrapper **9.8.1**.
Dependency versions được quản lý bởi Spring Boot BOM; dùng Spring Web MVC, Security,
Data JPA, Bean Validation, MySQL Connector/J và Flyway (kèm module MySQL).

## Cấu trúc

```text
src/main/java/com/clinicmanagement/
  ClinicManagementApplication.java
  controller/  # Auth, health và servlet error handler
  config/      # JWT, CORS, SecurityFilterChain, MySQL validate-only
  dto/         # Register/Login request, public user/token response
  exception/   # Problem Details và exception advice
  service/     # Auth transactions và token issuance
  repository/  # UserRepository
  entity/      # User, Role, UserStatus
  security/    # Current ACTIVE user và ROLE_* từ DB
  validation/  # Giới hạn UTF-8 password cho BCrypt
src/main/resources/application.yml
src/main/resources/db/migration/
src/test/      # HTTP/security/startup bằng H2; task MySQL riêng
```

Chỉ triển khai users/auth. Không tạo Doctor/Patient entity, profile, dữ liệu bệnh nhân hoặc account mặc định.

## Build và test

Từ thư mục `backend`, PowerShell:

```powershell
.\gradlew.bat --no-daemon clean build
```

Linux/macOS: `sh ./gradlew --no-daemon clean build`.
Wrapper có distribution SHA-256 để kiểm tra bản Gradle tải về. Lần đầu cần mạng để tải dependencies.
Test mặc định bật profile `test`, H2 in-memory riêng cho mỗi context và fixture
`src/test/resources/fixtures/users-schema.sql`; JPA validate, Flyway tắt chỉ trong test.
HTTP integration chạy Tomcat thật trên port ngẫu nhiên, qua SecurityFilterChain thật.
Key và password test được sinh ngẫu nhiên trong bộ nhớ, không dùng secret/account mặc định.
H2 và fixture chỉ nằm trong test runtime, không có trong boot JAR; không thay thế test MySQL.
Task mysqlTest chạy riêng Flyway/schema và cùng bộ auth HTTP trên MySQL thật.
Các test ghi dữ liệu chỉ nhận URL loopback có tên database `clinic_d02_be_it_*`;
test có xóa user fixture giữa các ca, không dùng database chia sẻ.
Xem báo cáo D02 để biết output kiểm thử cuối và provenance của V1 từ dev.

## Khởi động với MySQL

Provision database riêng và cung cấp các biến sau bằng môi trường/secret manager:

| Biến | Bắt buộc | Ý nghĩa |
| --- | --- | --- |
| `DB_URL` | Có | MySQL JDBC URL, database đã tồn tại; không chứa username/password |
| `DB_USERNAME` | Có | Tài khoản DB của môi trường |
| `DB_PASSWORD` | Có | Mật khẩu từ secret bên ngoài repository |
| `JWT_SECRET` | Có | Base64 của ít nhất 32 byte ngẫu nhiên; không có giá trị mặc định |
| `JWT_ISSUER` | Không | Mặc định clinic-management; luôn được kiểm tra khi xác thực |
| `CORS_ALLOWED_ORIGINS` | Không | Origin FE chính xác phân cách dấu phẩy; rỗng = không mở cross-origin |
| `MYSQL_TEST_MIGRATIONS_LOCATION` | Chỉ test, tùy chọn | Flyway filesystem location chứa V1 QA nguyên bản khi branch BE chưa có migration; mặc định classpath:db/migration |
| `SERVER_PORT` | Không | Mặc định 8080 |

URL Clinic do QA cung cấp: `jdbc:mysql://127.0.0.1:3307/clinic_management_db`.
Đây là database chia sẻ, **không phải URL để chạy mysqlTest**.
Thiết lập TLS và thông số kết nối theo môi trường DB. Không đưa credentials vào URL hoặc shell history.
Spring Boot không tự đọc `.env`; cần inject biến từ terminal/IDE/CI. Không commit file cấu hình chứa secret.

Sau khi đã inject biến, chạy:

```powershell
.\gradlew.bat --no-daemon mysqlTest
```

**Điều kiện trước khi chạy:** provision database kiểm thử mới, loopback, tên
`clinic_d02_be_it_<unique_suffix>`; cấp quyền chỉ trên database kiểm thử và inject DB_* tương ứng.
Không trỏ test vào clinic_management_db hoặc database có dữ liệu cần giữ.
V1 đã có trên dev; feature/tuan hiện chưa chứa file này. Lần final review dùng bản sao nguyên byte
từ ref dev vào build input đã ignore và cấu hình MYSQL_TEST_MIGRATIONS_LOCATION;
không thêm/sửa migration vào source BE. Khi tree tích hợp đã có V1, có thể dùng location classpath mặc định.

`mysqlTest` dùng profile `mysql-integration`: datasource/JPA/Flyway main, SQL init never,
Hibernate validate, Flyway **migrate + validate** trên database cô lập. Không dùng H2 fixture.
MySqlMigrationTest kiểm tra migrate, validate, migrate lại no-op và history bất biến;
MySqlStartupTest kiểm tra schema/UTC/config/health; MySqlAuthIntegrationTest chạy bộ auth HTTP.
Key/password/token test sinh trong bộ nhớ, không yêu cầu JWT_SECRET thật cho test Spring context.
Không dùng ddl-auto=update/create hoặc tự sửa V1 để vượt lỗi. Schema mismatch phải báo BLOCKED.

Sau khi có users/V1 đã được QA thống nhất, có thể dùng profile mysql-validation để kiểm tra startup
mà không tự apply migration từ BE:

```powershell
$env:SPRING_PROFILES_ACTIVE = 'mysql-validation'
.\gradlew.bat --no-daemon bootRun
```

Profile này thay chiến lược Flyway, không thu hồi quyền ghi của tài khoản DB và không thay thế
kiểm soát quyền production. Khi không bật profile này, cấu hình mặc định vẫn tự migrate lúc startup;
chỉ chạy chế độ đó sau khi migration và việc tạo flyway_schema_history đã được thống nhất.
Không chạy migrate, baseline, repair hoặc clean trong lần xác minh D01 này.

Sau khi app chạy, GET `http://localhost:8080/api/v1/health` phải trả
`{"data":{"status":"UP"}}`. Đây là liveness; không cung cấp thông tin cấu hình hay readiness DB.
Auth D02 đã có register/login/me; API nghiệp vụ khác vẫn bị khóa. Chưa có nghiệp vụ đặt lịch.

## JWT và FE

- POST `/api/v1/auth/register`: chỉ PATIENT/ACTIVE, BCrypt cost 12, email canonical UNIQUE.
- POST `/api/v1/auth/login`: trả accessToken/tokenType/expiresIn=1800/user; không Set-Cookie.
- GET `/api/v1/auth/me`: Authorization Bearer, user ACTIVE; role/status lấy từ DB mỗi request.
- Chỉ HS256, kiểm tra signature/issuer/sub/iat/exp; thời hạn 30 phút, không refresh/revoke.
- Logout chỉ xóa token phía client; token cũ chưa bị revoke tại server.
- CSRF tắt cho Bearer API không dùng cookie; CORS exact allowlist, allowCredentials=false.
- JSON field thừa bị từ chối; không nhận role/status qua register hoặc profile DTO.
  D02 chưa triển khai endpoint cập nhật profile.
- Không log body auth, Authorization header hoặc response login; giữ bind logging tắt.

Ví dụ tạo key dev trong environment của process PowerShell, không in/lưu giá trị:

```powershell
$jwtKeyBytes = New-Object byte[] 32
$jwtRandom = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $jwtRandom.GetBytes($jwtKeyBytes)
    $env:JWT_SECRET = [Convert]::ToBase64String($jwtKeyBytes)
} finally {
    $jwtRandom.Dispose()
    [Array]::Clear($jwtKeyBytes, 0, $jwtKeyBytes.Length)
}
```

Môi trường chia sẻ phải inject key ổn định qua secret manager; thay key làm token cũ mất hiệu lực.
Không đưa secret vào Git, command-line argument, shell output hoặc tài liệu.

## Database và bảo mật

- Không có URL hoặc credentials DB mặc định ở cấu hình main; thiếu biến sẽ không khởi động thành công.
- JPA `ddl-auto=validate`, `open-in-view=false`; timestamps JDBC theo UTC.
- Flyway enabled ở main; V1 thuộc Database/QA. BE không tạo/sửa migration hoặc schema thật.
- Không tự baseline database có sẵn; Flyway clean bị tắt; SQL init bị tắt.
- Security chỉ mở health/register/login/me đúng điều kiện; Basic/form/session login tắt,
  không có mật khẩu sinh tự động; JWT filter nằm trong SecurityFilterChain.
- API nghiệp vụ chưa triển khai giữ denyAll kể cả ADMIN; quyền ownership sẽ làm theo nghiệp vụ sau.

Phạm vi: [FEATURE_SCOPE](../docs/requirements/FEATURE_SCOPE.md).
Giao kèo FE: [API_CONTRACT](../docs/API_CONTRACT.md).
Kết quả hiện tại: [D02_BE_TEST_RESULTS](../docs/D02_BE_TEST_RESULTS.md).
Lịch sử D01: [D01_BE_TEST_RESULTS](../docs/D01_BE_TEST_RESULTS.md).
Đối chiếu ERD và quyết định cần chốt: [SCHEMA_REVIEW_D01](../docs/SCHEMA_REVIEW_D01.md).
