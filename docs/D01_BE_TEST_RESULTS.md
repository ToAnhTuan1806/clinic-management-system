# Kết quả bàn giao CL-D01-BE

Ngày cập nhật: **2026-11-20**, Asia/Bangkok.
Workspace: `F:\RikkeiEdu\clinic-management-system`; branch: **feature/tuan**.

**STATUS: READY FOR REVIEW — scaffold và MySQL integration validation D01.**
Schema nghiệp vụ/V1 vẫn **PROPOSED / chưa phê duyệt**, xem [SCHEMA_REVIEW_D01](SCHEMA_REVIEW_D01.md).

## Kiểm soát phạm vi

- Kiểm tra workspace, branch và Git status trước/sau. Lần khởi tạo ban đầu Git sạch;
  khi bắt đầu xác minh MySQL, 28 file D01 đã có ở trạng thái untracked từ lượt trước.
- Giữ nguyên feature/tuan; không tạo/đổi/xóa branch/worktree;
  không commit, push, pull, reset, rebase hoặc merge.
- Worktree QA feature/quynh chỉ được đọc để review ERD và kiểm tra status;
  không chỉnh Docker Compose, file DB/QA, container, volume hoặc service.
- Không tạo SQL, entity hoặc bảng nghiệp vụ; không migrate/baseline/repair/clean.
- Credentials QA lấy từ environment của container đã xác minh, chỉ truyền qua
  environment của process kiểm thử/startup; không in giá trị hoặc lưu vào repository.

## Đã triển khai

- Java 21 / Spring Boot 4.1.3 / Gradle Wrapper 9.8.1 có distribution SHA-256.
- Web MVC, Security, Data JPA, Bean Validation, MySQL Connector/J và Flyway/MySQL.
- Package gốc com.clinicmanagement với controller/service/repository/entity/dto/config/exception.
- application.yml dùng DB_URL/DB_USERNAME/DB_PASSWORD, không có credentials mặc định;
  JPA ddl-auto=validate, open-in-view=false, JDBC UTC; Flyway bật, clean bị tắt,
  baseline-on-migrate=false, SQL init never.
- GET /api/v1/health public chỉ trả UP; API khác denyAll; giữ CSRF/security headers;
  không có tài khoản mặc định, JWT hoặc nghiệp vụ đặt lịch.
- Response thành công bọc data; lỗi Problem Details an toàn cho client.
- FEATURE_SCOPE FR-01–FR-14; FR-15 QR thanh toán ngoài D01–D15;
  API contract phân biệt IMPLEMENTED/PROPOSED.
- Thêm profile **mysql-validation**: Flyway vẫn được khởi tạo nhưng startup strategy
  chỉ gọi validate, không migrate hoặc tạo flyway_schema_history.
  mysqlTest luôn dùng profile này và có thêm kiểm tra HTTP health.

## MYSQL CONNECTION: PASS

| Kiểm tra thực tế | Kết quả |
| --- | --- |
| QA container | clinic-management-d01-mysql-1, image mysql:8.4, running và healthy |
| Kết nối host/JDBC | 127.0.0.1:3307, database clinic_management_db |
| MySQL server | **8.4.11**, session timezone **+00:00** |
| Authenticated SQL trong container QA | SELECT server/database/timezone và information_schema thành công |
| JDBC từ backend trên host | mysqlTest xác nhận engine MySQL và SELECT 1 thành công |
| Metadata trước/sau test | Tables/columns/indexes/constraints không đổi; **0 bảng** |
| Sau startup boot JAR | Vẫn **0 bảng**, không có flyway_schema_history |

Blocker ở lượt trước (MySQL local cũ không sẵn sàng) **đã được giải quyết** bằng
MySQL Docker QA tại cổng 3307. Không dùng instance hoặc port của dự án khác.

## APPLICATION STARTUP: PASS

Đã chạy boot JAR **thật**, không dùng H2 hoặc test classpath:

```text
java -jar backend/build/libs/clinic-management-backend-0.0.1-SNAPSHOT.jar
```

Process nhận DB_* qua environment, SPRING_PROFILES_ACTIVE=mysql-validation và SERVER_PORT=0.
Tomcat khởi động trên port ngẫu nhiên; log xác nhận Started ClinicManagementApplication
và Flyway Successfully validated. Sau đó kiểm tra HTTP:

| Request/kiểm tra | Kết quả |
| --- | --- |
| GET /api/v1/health | **200**, body chính xác `{"data":{"status":"UP"}}` |
| Security header | X-Content-Type-Options: nosniff |
| GET /api/v1/patients không xác thực | **401**, code AUTHENTICATION_REQUIRED |
| Dừng process sau smoke test | Đã dừng đúng process Java vừa tạo, không dừng MySQL QA |
| Schema trước/sau startup | Không đổi, vẫn 0 bảng |

Profile mysql-validation chỉ thay chiến lược Flyway; không thu hồi quyền ghi của DB user.
Startup mặc định vẫn gọi migrate và **không được chạy trong lần xác minh này** vì chưa
thống nhất DDL/schema-history. Không coi validate trên schema rỗng là kiểm thử V1.

## GRADLE RESULTS: PASS

Từ backend, đã chạy với environment QA riêng cho process:

```powershell
.\gradlew.bat --no-daemon clean build mysqlTest
```

Kết quả: **BUILD SUCCESSFUL**, exit code **0**. Boot JAR được đóng gói thành công.

| Bộ test | Tests | Failures | Errors | Skipped |
| --- | --- | --- | --- | --- |
| ApiErrorHandlingTest | 4 | 0 | 0 | 0 |
| ApplicationIntegrationTest — H2/HTTP/security | 5 | 0 | 0 | 0 |
| MySqlStartupTest — MySQL thật | 2 | 0 | 0 | 0 |
| **Tổng** | **11** | **0** | **0** | **0** |

Test mặc định vẫn là 9 test; mysqlTest chạy riêng 2 test tag mysql, không đếm trùng.

- H2/HTTP/security: health chính xác, không session cookie, có security header; chặn
  API bảo vệ kể cả principal ADMIN giả lập; POST thiếu CSRF bị 403; cấu hình Flyway an toàn.
- Xử lý lỗi: validation không trả rejectedValue; JSON sai trả 400; lỗi bất ngờ trả 500
  không lộ nội dung nội bộ; method không hỗ trợ giữ HTTP 405 và header Allow.
- MySQL: Spring context với MySQL thật, SELECT 1, xác nhận engine MySQL, Flyway validation;
  HTTP health trên server thật trả đúng 200 và UP.

Bằng chứng máy sinh nằm trong **build output đã gitignore**, không đưa log/secret vào Git:

```text
backend/build/reports/tests/test/index.html
backend/build/reports/tests/mysqlTest/index.html
backend/build/test-results/test/TEST-*.xml
backend/build/test-results/mysqlTest/TEST-*.xml
backend/build/mysql-validation-gradle.log
backend/build/mysql-schema-evidence.json
backend/build/mysql-application-startup.log
backend/build/mysql-application-evidence.json
```

## SCHEMA REVIEW: REVIEWED, CHƯA PHÊ DUYỆT V1

Đã đọc DATABASE_DESIGN.md, erd.mmd và database/README.md từ worktree QA.
[SCHEMA_REVIEW_D01](SCHEMA_REVIEW_D01.md) lưu nguồn, SHA-256, các điểm phù hợp,
khác biệt và phân công đề xuất. Không sao chép schema hoặc sửa ERD QA.
Thiết kế 11 bảng, BIGINT/ID chuỗi, UTC, FK RESTRICT và đơn mô phỏng phù hợp định hướng.
Database thật hiện rỗng: chưa kiểm thử FK/UNIQUE/CHECK/index hoặc JPA entity mapping.

## REMAINING ISSUES

| Chủ đề | Quyết định còn cần thống nhất | Phối hợp |
| --- | --- | --- |
| User/Doctor/Patient | Single-role; Doctor bắt buộc user DOCTOR, Patient user nullable/unique; liên kết vãng lai, đổi role và tên hồ sơ | BE + DB/QA + nghiệp vụ |
| Appointment conflict | SlotId hay khoảng schedule; PENDING/CONFIRMED hay BOOKED; khóa doctors, isolation/thứ tự khóa/retry; request key và conflict code; hủy sau check-in | BE + DB/QA + FE |
| Medical record access | FINAL hay FINAL+released_at; ai release; bác sĩ đọc lịch sử khác bác sĩ; tạo record từ CHECKED_IN hay IN_PROGRESS; đính chính FINAL | BE + DB/QA + nghiệp vụ + FE |
| Migration V1 ownership | QA chuẩn bị SQL/constraint; BE cấp version/vị trí và review; hai bên duyệt trước DDL; thống nhất V1/V001 không trùng version | BE + DB/QA |

CORS origin, token/cookie/CSRF, thời lượng slot, thời hạn đổi/hủy/check-in, audit retention
và quyền production còn là thiết kế cho ngày sau. Các mục này chặn triển khai schema/nghiệp vụ
kế tiếp, không phải lỗi kết nối/startup D01. Mọi API nghiệp vụ hiện vẫn denyAll.

## Files changed

Lượt xác minh MySQL thêm **MySqlValidationConfig.java**, **SCHEMA_REVIEW_D01.md**;
cập nhật **MySqlStartupTest.java**, backend/README.md, migration/README.md,
API_CONTRACT.md, FEATURE_SCOPE.md và báo cáo này.

Tổng từ đầu D01: **30 file mới**; README.md gốc không đổi:

```text
.gitignore
backend/README.md
backend/build.gradle
backend/settings.gradle
backend/gradlew
backend/gradlew.bat
backend/gradle/wrapper/gradle-wrapper.jar
backend/gradle/wrapper/gradle-wrapper.properties
backend/src/main/java/com/clinicmanagement/ClinicManagementApplication.java
backend/src/main/java/com/clinicmanagement/config/MySqlValidationConfig.java
backend/src/main/java/com/clinicmanagement/config/SecurityConfig.java
backend/src/main/java/com/clinicmanagement/controller/ApiErrorController.java
backend/src/main/java/com/clinicmanagement/controller/HealthController.java
backend/src/main/java/com/clinicmanagement/dto/ApiResponse.java
backend/src/main/java/com/clinicmanagement/dto/HealthResponse.java
backend/src/main/java/com/clinicmanagement/entity/package-info.java
backend/src/main/java/com/clinicmanagement/exception/ApiProblems.java
backend/src/main/java/com/clinicmanagement/exception/GlobalExceptionHandler.java
backend/src/main/java/com/clinicmanagement/repository/package-info.java
backend/src/main/java/com/clinicmanagement/service/package-info.java
backend/src/main/resources/application.yml
backend/src/main/resources/db/migration/README.md
backend/src/test/java/com/clinicmanagement/ApiErrorHandlingTest.java
backend/src/test/java/com/clinicmanagement/ApplicationIntegrationTest.java
backend/src/test/java/com/clinicmanagement/MySqlStartupTest.java
backend/src/test/resources/application-test.yml
docs/API_CONTRACT.md
docs/requirements/FEATURE_SCOPE.md
docs/SCHEMA_REVIEW_D01.md
docs/D01_BE_TEST_RESULTS.md
```
