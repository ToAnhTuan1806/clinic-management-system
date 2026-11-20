# Clinic Management Backend — D01

Java **21**, Spring Boot **4.1.3** (stable), Gradle Wrapper **9.8.1**.
Dependency versions được quản lý bởi Spring Boot BOM; dùng Spring Web MVC, Security,
Data JPA, Bean Validation, MySQL Connector/J và Flyway (kèm module MySQL).

## Cấu trúc

```text
src/main/java/com/clinicmanagement/
  ClinicManagementApplication.java
  controller/  # Health và servlet error handler
  config/      # Bảo mật mặc định
  dto/         # Response DTO
  exception/   # Problem Details và exception advice
  service/     # Biên transaction nghiệp vụ cho giai đoạn sau
  repository/  # JPA repository sau khi thống nhất ERD
  entity/      # Entity sau khi thống nhất ERD
src/main/resources/application.yml
src/main/resources/db/migration/
src/test/      # HTTP/security/startup bằng H2; task MySQL riêng
```

Không tạo entity, repository hoặc service giả cho nghiệp vụ chưa được duyệt.
`package-info.java` giữ các package nền tảng trong source control.

## Build và test

Từ thư mục `backend`, PowerShell:

```powershell
.\gradlew.bat --no-daemon clean build
```

Linux/macOS: `sh ./gradlew --no-daemon clean build`.
Wrapper có distribution SHA-256 để kiểm tra bản Gradle tải về. Lần đầu cần mạng để tải dependencies.
Test mặc định bật profile `test` với H2 in-memory, khởi động Spring context và HTTP server thật
trên port ngẫu nhiên, giữ JPA/Flyway và security. H2 chỉ nằm trong test runtime, không có trong boot JAR.
Test H2 không chứng minh MySQL tương thích; test MySQL không chạy trong task `test` mặc định.

## Khởi động với MySQL

Provision database riêng và cung cấp các biến sau bằng môi trường/secret manager:

| Biến | Bắt buộc | Ý nghĩa |
| --- | --- | --- |
| `DB_URL` | Có | MySQL JDBC URL, database đã tồn tại; không chứa username/password |
| `DB_USERNAME` | Có | Tài khoản DB của môi trường |
| `DB_PASSWORD` | Có | Mật khẩu từ secret bên ngoài repository |
| `SERVER_PORT` | Không | Mặc định 8080 |

Ví dụ định dạng URL: `jdbc:mysql://localhost:3306/clinic_management` (không phải cấu hình đã tích hợp).
Thiết lập TLS và thông số kết nối theo môi trường DB. Không đưa credentials vào URL hoặc shell history.
Spring Boot không tự đọc `.env`; cần inject biến từ terminal/IDE/CI. Không commit file cấu hình chứa secret.

Sau khi đã inject biến, chạy:

```powershell
.\gradlew.bat --no-daemon mysqlTest
```

`mysqlTest` bật profile `mysql-validation`: có kết nối MySQL thật, giữ JPA/Flyway nhưng
chỉ gọi Flyway **validate**, không migrate hoặc tạo bảng lịch sử. Test kiểm tra engine MySQL,
`SELECT 1`, Flyway validation và HTTP health; không kiểm tra nghiệp vụ vì chưa có schema.
Chỉ dùng database QA đã xác minh; không dùng DB sản xuất.
Thiếu DB_* hoặc không kết nối được MySQL phải báo BLOCKED, không coi test H2 là thay thế.

Trước khi schema/migration được duyệt, dùng cùng profile để kiểm tra startup, thay vì bootRun mặc định:

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
Các API khác bị khóa; chưa có tài khoản/JWT hoặc nghiệp vụ đặt lịch trong D01.

## Database và bảo mật

- Không có URL hoặc credentials DB mặc định ở cấu hình main; thiếu biến sẽ không khởi động thành công.
- JPA `ddl-auto=validate`, `open-in-view=false`; timestamps JDBC theo UTC.
- Flyway enabled; chưa có domain migration. DB team cần chốt ERD và V1 trước nghiệp vụ.
- Không tự baseline database có sẵn; Flyway clean bị tắt; SQL init bị tắt.
- Security `denyAll` trừ GET health; không có user/mật khẩu sinh tự động,
  Basic/form login tắt; không mở CORS, giữ CSRF và security headers mặc định.
- Khi làm JWT, thay denyAll bằng ma trận quyền và kiểm tra ownership; không mở API hàng loạt.

Phạm vi: [FEATURE_SCOPE](../docs/requirements/FEATURE_SCOPE.md).
Giao kèo FE: [API_CONTRACT](../docs/API_CONTRACT.md).
Kết quả chạy thực tế: [D01_BE_TEST_RESULTS](../docs/D01_BE_TEST_RESULTS.md).
Đối chiếu ERD và quyết định cần chốt: [SCHEMA_REVIEW_D01](../docs/SCHEMA_REVIEW_D01.md).
