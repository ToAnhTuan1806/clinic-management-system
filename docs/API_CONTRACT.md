# API Contract — Clinic Management System (D02)

Task hiện tại: **CL-D02-BE**; kế thừa nền tảng CL-D01-BE.
`IMPLEMENTED` chỉ áp dụng cho phần đã có code và kiểm thử; `PROPOSED` chưa phải API sử dụng được.
Phạm vi chức năng: [FR-01–FR-14](requirements/FEATURE_SCOPE.md).

## 1. Quy ước chung

- Base path: `/api/v1`; JSON UTF-8; tên trường camelCase; URL danh từ số nhiều, chữ thường có dấu `-`.
- GET đọc dữ liệu; POST tạo hoặc thực hiện chuyển trạng thái; PATCH cập nhật một phần.
  DELETE chỉ dùng khi mô hình cho phép xóa, không dùng để xóa lịch sử khám.
- User dùng PK BIGINT signed; API trả id dạng chuỗi để tránh mất chính xác ở JavaScript.
  Các entity khác chưa triển khai; schema/migration do Database/QA phụ trách.
- Ngày: `YYYY-MM-DD`; thời điểm: ISO-8601 UTC, ví dụ `2026-11-20T02:00:00Z`.
  FE hiển thị theo `Asia/Ho_Chi_Minh`, không gửi thời điểm thiếu offset.
- Danh sách dự kiến: `page=0&size=20&sort=createdAt,desc`; size tối đa 100;
  chỉ cho phép sort/filter theo danh sách BE công bố, thêm id làm thứ tự phụ ổn định.
- Không nhận trực tiếp JPA entity làm request/response; dùng DTO và Bean Validation;
  giới hạn trường có thể ghi để ngăn cập nhật role/owner trái phép.
- Không trả mật khẩu/hash/token nội bộ, stack trace, SQL hoặc URL kết nối.
- Quy ước phân trang, id, trạng thái nghiệp vụ và mẫu request nghiệp vụ dưới đây là **PROPOSED**.

## 2. HTTP status

| Status | Ý nghĩa |
| --- | --- |
| 200 | Đọc hoặc cập nhật thành công, có body |
| 201 | Tạo mới thành công; trả Location và resource |
| 204 | Thành công không có body (ví dụ logout/đánh dấu đọc khi đã thống nhất) |
| 400 | JSON sai cú pháp, kiểu dữ liệu hoặc validation thất bại |
| 401 | Chưa xác thực hoặc thông tin xác thực không hợp lệ/hết hạn |
| 403 | Đã xác thực nhưng thiếu quyền, hoặc request bị CSRF chặn |
| 404 | Không tìm thấy resource trong phạm vi người dùng được xem |
| 405 | Resource tồn tại nhưng method không được hỗ trợ, khi đã qua security |
| 409 | Trùng slot, xung đột version hoặc chuyển trạng thái không hợp lệ |
| 415 | Content-Type không được hỗ trợ |
| 429 | Vượt giới hạn request, dự kiến khi thêm rate limit |
| 500 | Lỗi không dự kiến, thông điệp an toàn cho client |
| 503 | Phụ thuộc không sẵn sàng, chỉ áp dụng khi có readiness/cơ chế tương ứng |

Không trả 200 kèm cờ lỗi. D02 dùng Bearer header, không có cookie xác thực; CSRF được tắt.
Thiếu/sai JWT ở API bảo vệ trả 401; JWT hợp lệ nhưng request không được cấp quyền trả 403.
API `PROPOSED` vẫn denyAll, có thể trả 401/403 thay vì 404; không có nghĩa API đã tồn tại.
CORS từ origin/method/header ngoài allowlist trả 403 CORS_REJECTED.

## 3. Response thành công

**IMPLEMENTED** — `GET /api/v1/health`, public, 200 `application/json`:

```json
{"data":{"status":"UP"}}
```

Health chỉ phản ánh HTTP process đã phục vụ được request (**liveness**); không kiểm tra DB
trong mỗi request, không phải readiness probe và không trả version, profile, hostname hay cấu hình.
Ứng dụng mặc định vẫn cần DB khi khởi động vì JPA/Flyway được bật.

**PROPOSED** — mọi response có body thành công dùng `{"data": ...}`; danh sách:

```json
{
  "data": {
    "items": [],
    "page": 0,
    "size": 20,
    "totalElements": 0,
    "totalPages": 0
  }
}
```

### 3.1 Authentication — IMPLEMENTED D02

Chỉ có ba API auth dưới đây đã triển khai. Ví dụ dùng placeholder, không chứa mật khẩu/token thật.
Register/login phải gửi `Content-Type: application/json`; không gửi Bearer cũ/hết hạn đến API public.
Spring Security vẫn kiểm tra Bearer nếu client tự gửi header đó, kể cả trên route public.

**POST /api/v1/auth/register — public**

```json
{
  "email": "patient@example.invalid",
  "password": "<password entered by user>",
  "fullName": "Synthetic Example"
}
```

- Email trim/lowercase với Locale.ROOT, hợp lệ theo @Email, tối đa 254 ký tự và UNIQUE.
- fullName trim, không rỗng, tối đa 120 ký tự.
- Password không trim; @NotBlank, @Size 12–72 ký tự và tối đa **72 byte UTF-8** để không
  bị BCrypt cắt bớt dữ liệu. Không có mật khẩu mặc định; hash bằng BCrypt cost 12.
- Chỉ nhận email/password/fullName. Trường thừa như role/status/id/passwordHash trả 400 HTTP_400.
  Client không thể tự cấp role; BE luôn tạo **PATIENT + ACTIVE**.
- Không tạo Doctor/Patient profile hoặc tự liên kết hồ sơ bệnh nhân trong D02.

Thành công **201**, Location `/api/v1/auth/me` (đọc sau khi đăng nhập), Cache-Control `no-store`:

```json
{
  "data": {
    "id": "1",
    "email": "patient@example.invalid",
    "fullName": "Synthetic Example",
    "role": "PATIENT",
    "status": "ACTIVE"
  }
}
```

Không tự đăng nhập hoặc cấp token sau register. Email trùng sau chuẩn hóa trả
**409 EMAIL_ALREADY_EXISTS**; payload/validation lỗi trả 400.
UNIQUE ở DB bảo vệ cả hai request đăng ký đồng thời.

**POST /api/v1/auth/login — public**

```json
{"email":"patient@example.invalid","password":"<password entered by user>"}
```

Email được chuẩn hóa như register. Password bắt buộc không rỗng, tối đa 72 byte UTF-8;
không trim. Sai email/password hoặc tài khoản DISABLED đều trả cùng
**401 INVALID_CREDENTIALS**, detail `Invalid email or password.`; không tiết lộ tài khoản có tồn tại.
Payload sai định dạng/thiếu trường trả 400, không phải lỗi xác thực.

Thành công **200**, Cache-Control `no-store`, không Set-Cookie:

```json
{
  "data": {
    "accessToken": "<access token returned only to the client>",
    "tokenType": "Bearer",
    "expiresIn": 1800,
    "user": {
      "id": "1",
      "email": "patient@example.invalid",
      "fullName": "Synthetic Example",
      "role": "PATIENT",
      "status": "ACTIVE"
    }
  }
}
```

BE cập nhật last_login_at/updated_at khi login thành công; cập nhật có điều kiện ACTIVE,
chỉ ghi timestamps để không ghi đè role/status/password bị thay đổi đồng thời.
Không trả passwordHash, hash hay timestamps nội bộ trong UserResponse.

**GET /api/v1/auth/me — Bearer bắt buộc**

```http
Authorization: Bearer <accessToken>
```

Thành công **200** có `data` với đúng 5 trường id/email/fullName/role/status như register,
Cache-Control `no-store`. Cả ADMIN/DOCTOR/RECEPTIONIST/PATIENT ACTIVE đều dùng được.
BE kiểm tra DB trên mỗi request; token của user đã xóa/khóa bị từ chối 401.

**JWT và logout**

- HS256 duy nhất; bắt buộc chữ ký hợp lệ, issuer đúng và sub/iat/exp hợp lệ.
  Lifetime **30 phút / 1800 giây**, không có grace sau exp; không nhận token thiếu exp,
  iat tương lai hoặc lifetime dài hơn 30 phút.
- JWT chứa iss/sub/iat/exp; sub là user id. Không chứa passwordHash, email hoặc nội dung bệnh án.
  Role/status được đọc từ DB; các claim role/roles/scope không cấp quyền trong D02.
- JWT_SECRET là Base64 của ít nhất 32 byte ngẫu nhiên, lấy từ environment, không có key mặc định.
  JWT_ISSUER mặc định `clinic-management`, có thể cấu hình và phải khớp khi xác minh.
- Chỉ nhận token qua Authorization header; không đọc query parameter, form hoặc cookie.
- Logout D02 **chỉ xóa token phía client**. Không có logout/revoke/refresh endpoint đã triển khai;
  token còn hiệu lực đến exp nếu tài khoản vẫn ACTIVE. Không tuyên bố server đã revoke token.

**Lỗi auth thực tế**

| HTTP | Code | Trường hợp |
| --- | --- | --- |
| 400 | VALIDATION_FAILED | Email/fullName/password không hợp lệ |
| 400 | HTTP_400 | JSON sai, thiếu body hoặc trường thừa |
| 401 | INVALID_CREDENTIALS | Login sai hoặc tài khoản DISABLED |
| 401 | AUTHENTICATION_REQUIRED | API bảo vệ thiếu Bearer |
| 401 | INVALID_ACCESS_TOKEN | Token sai chữ ký/hết hạn/sai issuer/claims/thuật toán; user không ACTIVE hoặc không còn tồn tại |
| 403 | ACCESS_DENIED | JWT hợp lệ nhưng thiếu quyền; API chưa triển khai vẫn denyAll |
| 403 | CORS_REJECTED | Cross-origin request ngoài allowlist |
| 409 | EMAIL_ALREADY_EXISTS | Email canonical đã tồn tại |

Lỗi từ Bearer authentication có header `WWW-Authenticate: Bearer`, không echo token hoặc lỗi parser.

## 4. Error response

Dùng Problem Details theo [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html),
`Content-Type: application/problem+json`. Không bọc lỗi trong `data`.

**IMPLEMENTED** — anonymous GET `/api/v1/patients`:

```json
{
  "type": "about:blank",
  "title": "Unauthorized",
  "status": 401,
  "detail": "Authentication is required.",
  "instance": "/api/v1/patients",
  "code": "AUTHENTICATION_REQUIRED"
}
```

- `status`: trùng HTTP status; `instance`: path, không gồm query có thể chứa dữ liệu riêng tư.
- FE xử lý theo `status` + `code`, không so sánh chuỗi `detail`.
- Nền tảng có `AUTHENTICATION_REQUIRED`, `ACCESS_DENIED`, `INTERNAL_ERROR`,
  `HTTP_<status>` và handler `VALIDATION_FAILED` cho DTO có `@Valid`.
- Validation handler chỉ trả tên trường và thông điệp an toàn, không trả giá trị bị từ chối.
  D02 đã có RegisterRequest/LoginRequest; DTO nghiệp vụ khám/đặt lịch chưa triển khai.

Ví dụ validation **PROPOSED trên endpoint nghiệp vụ**:

```json
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "detail": "Bad Request",
  "instance": "/api/v1/appointments",
  "code": "VALIDATION_FAILED",
  "errors": [{"field":"slotId","message":"Invalid value."}]
}
```

Mã nghiệp vụ dự kiến: `APPOINTMENT_SLOT_UNAVAILABLE`, `INVALID_STATE_TRANSITION`,
`VERSION_CONFLICT`, `RESOURCE_NOT_FOUND`. Chưa triển khai trong D01.

## 5. Phân quyền và trạng thái bảo mật

| Vai trò | Quyền dự kiến | Giới hạn dữ liệu |
| --- | --- | --- |
| ADMIN | Quản trị tài khoản, danh mục, lịch, dashboard, báo cáo, audit | Không mặc nhiên sửa hồ sơ chuyên môn hoặc đơn thuốc |
| DOCTOR | Xem lịch được phân công, khám, đơn thuốc mô phỏng | Hồ sơ do mình khám; lịch sử cần thiết của bệnh nhân được phân công theo policy đã duyệt |
| RECEPTIONIST | Hồ sơ hành chính bệnh nhân, lịch, xác nhận, check-in | Chỉ metadata vận hành của hồ sơ khám; không sửa chẩn đoán/đơn thuốc |
| PATIENT | Hồ sơ cá nhân, đặt/đổi/hủy lịch và lịch sử của mình | Kiểm tra ownership ở BE; không tin patientId từ client |

**D02 IMPLEMENTED:** GET health và POST register/login được public; GET auth/me cần JWT hợp lệ.
Mọi API còn lại denyAll, kể cả ADMIN. HTTP Basic/form login/session cookie không dùng;
không có tài khoản mặc định. Session policy stateless, request cache tắt.
CSRF tắt vì credential chỉ được gửi chủ động qua Authorization header, không dùng cookie xác thực.
Nếu sau này đổi sang cookie/session phải đánh giá và bật lại bảo vệ CSRF phù hợp.
Security headers mặc định của Spring Security được giữ (HSTS chỉ trên HTTPS).
`/error` là handler nội bộ khi servlet error dispatch; gọi trực tiếp vẫn bị bảo vệ.

JWT được xử lý bởi OAuth2 Resource Server trong SecurityFilterChain, không có filter xác thực nằm ngoài chain.
Authority map nhất quán ROLE_ADMIN/ROLE_DOCTOR/ROLE_RECEPTIONIST/ROLE_PATIENT từ role DB hiện tại.
CORS_ALLOWED_ORIGINS là danh sách origin chính xác, phân cách dấu phẩy; mặc định rỗng.
Không cho wildcard/null/pattern/path; chỉ HTTP(S), methods GET/POST/OPTIONS,
headers Authorization/Content-Type, exposed Location, allowCredentials=false.
Origin FE thực tế cần cấu hình ở môi trường; không có origin localhost mặc định ở main.

**PROPOSED:** quyền chi tiết API nghiệp vụ, ownership/phân công, refresh/revoke và quản lý tài khoản nhân viên.
Role không thay thế kiểm tra dữ liệu ở service/query khi các API đó được triển khai.

## 6. Danh mục endpoint

Tất cả path dưới đây có tiền tố `/api/v1`. `self` = bản thân;
`assigned` = bác sĩ được phân công; quyền chi tiết phải áp dụng theo bảng trên.
Các dòng có nhiều method mô tả các API riêng cùng trạng thái triển khai.

| FR | Method | Path | Quyền dự kiến | Trạng thái |
| --- | --- | --- | --- | --- |
| Nền tảng | GET | `/health` | Public | **IMPLEMENTED** |
| FR-01 | POST | `/auth/register` | Public, chỉ PATIENT | **IMPLEMENTED D02** |
| FR-01 | POST | `/auth/login` | Public | **IMPLEMENTED D02** |
| FR-01 | POST | `/auth/logout` | Chưa có endpoint; D02 logout ở client | PROPOSED sau D02 |
| FR-01 | GET | `/auth/me` | JWT hợp lệ, ACTIVE, self | **IMPLEMENTED D02** |
| FR-01 | PATCH | `/me/password` | Đã xác thực, self | PROPOSED |
| FR-01 | GET, POST | `/users` | ADMIN; POST tạo tài khoản nhân viên | PROPOSED |
| FR-01 | PATCH | `/users/{id}/status`, `/users/{id}/role` | ADMIN | PROPOSED |
| FR-02 | GET, PATCH | `/me/profile` | Đã xác thực, self | PROPOSED |
| FR-03 | GET | `/doctors`, `/doctors/{id}` | Cả bốn role; PATIENT chỉ danh mục hoạt động | PROPOSED |
| FR-03 | POST | `/doctors` | ADMIN | PROPOSED |
| FR-03 | PATCH | `/doctors/{id}` | ADMIN | PROPOSED |
| FR-04 | GET | `/specialties`, `/specialties/{id}` | Cả bốn role | PROPOSED |
| FR-04 | POST | `/specialties` | ADMIN | PROPOSED |
| FR-04 | PATCH | `/specialties/{id}` | ADMIN | PROPOSED |
| FR-05 | GET, POST | `/patients` | ADMIN/RECEPTIONIST cho dữ liệu hành chính | PROPOSED |
| FR-05 | GET | `/patients/{id}` | ADMIN/RECEPTIONIST hành chính; DOCTOR assigned; PATIENT self | PROPOSED |
| FR-05 | PATCH | `/patients/{id}` | ADMIN/RECEPTIONIST hành chính | PROPOSED |
| FR-05 | GET | `/me/patient-profile` | PATIENT self | PROPOSED |
| FR-06 | GET | `/work-schedules` | ADMIN/RECEPTIONIST; DOCTOR self | PROPOSED |
| FR-06 | POST | `/work-schedules` | ADMIN/RECEPTIONIST | PROPOSED |
| FR-06 | PATCH | `/work-schedules/{id}` | ADMIN/RECEPTIONIST | PROPOSED |
| FR-06 | GET | `/doctors/{id}/available-slots` | Cả bốn role; chỉ slot có thể đặt | PROPOSED |
| FR-07 | GET | `/appointments`, `/appointments/{id}` | ADMIN/RECEPTIONIST; DOCTOR assigned; PATIENT self | PROPOSED |
| FR-07 | POST | `/appointments` | PATIENT self / RECEPTIONIST thay tại quầy | PROPOSED |
| FR-07 | PATCH | `/appointments/{id}/slot` | PATIENT self / RECEPTIONIST | PROPOSED |
| FR-07 | POST | `/appointments/{id}/cancellation` | PATIENT self / RECEPTIONIST | PROPOSED |
| FR-08 | POST | `/appointments/{id}/confirmation` | RECEPTIONIST | PROPOSED |
| FR-08 | POST | `/appointments/{id}/check-in` | RECEPTIONIST | PROPOSED |
| FR-08 | POST | `/appointments/{id}/no-show` | RECEPTIONIST | PROPOSED |
| FR-09 | POST | `/medical-records` | DOCTOR assigned, lịch đã check-in | PROPOSED |
| FR-09 | GET | `/medical-records/{id}` | DOCTOR assigned; PATIENT self bản hoàn tất; ADMIN/RECEPTIONIST metadata | PROPOSED |
| FR-09 | PATCH | `/medical-records/{id}` | DOCTOR assigned, bản nháp | PROPOSED |
| FR-09 | POST | `/medical-records/{id}/completion` | DOCTOR assigned | PROPOSED |
| FR-10 | GET | `/patients/{id}/medical-history` | PATIENT self / DOCTOR assigned; ADMIN/RECEPTIONIST metadata | PROPOSED |
| FR-11 | GET | `/medical-records/{id}/prescription` | DOCTOR assigned / PATIENT self bản hoàn tất | PROPOSED |
| FR-11 | PUT | `/medical-records/{id}/prescription` | DOCTOR assigned, thay toàn bộ đơn nháp mô phỏng | PROPOSED |
| FR-12 | GET | `/dashboard/summary` | ADMIN/RECEPTIONIST theo phạm vi; DOCTOR self | PROPOSED |
| FR-13 | GET | `/notifications` | Đã xác thực, chỉ người nhận | PROPOSED |
| FR-13 | PATCH | `/notifications/{id}/read` | Người nhận | PROPOSED |
| FR-14 | GET | `/reports/visits` | ADMIN; RECEPTIONIST tiếp nhận; DOCTOR self nếu policy cho phép | PROPOSED |
| FR-14 | GET | `/audit-logs` | ADMIN | PROPOSED |

Không có endpoint QR thanh toán hoặc doanh thu. **FR-15 ngoài D01–D15.**

## 7. Luồng lịch hẹn và ví dụ đề xuất

Trạng thái lịch dự kiến:

```text
PENDING -> CONFIRMED -> CHECKED_IN -> IN_PROGRESS -> COMPLETED
PENDING | CONFIRMED -> CANCELLED
CONFIRMED -> NO_SHOW
```

- Tạo hồ sơ khám chuyển CHECKED_IN sang IN_PROGRESS trong cùng transaction;
  hoàn tất hồ sơ chuyển IN_PROGRESS sang COMPLETED.
- Chỉ đổi slot ở PENDING/CONFIRMED; đổi slot đưa lịch về PENDING để xác nhận lại.
- CANCELLED, COMPLETED, NO_SHOW là trạng thái kết thúc; không cho chuyển lùi tùy ý.
- Check-in lại lịch đã CHECKED_IN trả kết quả hiện có, không tạo lượt khám mới.
- Đặt trùng slot hoặc đổi trạng thái trái phép trả 409; DB phải có constraint/khóa phù hợp.
  Đổi slot phải atomic. Mốc thời gian được hủy/check-in/no-show cần phòng khám xác nhận.

Ví dụ POST `/appointments` **PROPOSED**, PATIENT dùng danh tính từ principal:

```json
{"slotId":"slot-example","reason":"Khám định kỳ"}
```

RECEPTIONIST đặt thay cần thêm `patientId` được BE kiểm tra quyền. Các trường id, trạng thái,
bác sĩ, thời điểm và version do BE quản lý; không tin các giá trị này từ client.
Payload/response chi tiết của từng API nghiệp vụ sẽ chốt cùng ERD và màn hình FE ở ngày sau.

## 8. Điểm cần đồng bộ

- **FE:** health/register/login/me đã có code; dùng Bearer header, expiresIn tính bằng giây,
  id chuỗi, data/Problem Details và logout client-only. Cần QA V1 trước khi dùng auth trên MySQL.
- **FE + BE:** cấu hình origin chính xác; không gửi credentials cookie; refresh/revoke chưa có;
  UI ẩn nút theo role không thay thế quyền phía BE.
- **DB + BE:** MySQL version, database rỗng/riêng để kiểm thử, tài khoản qua secret của môi trường,
  quyền Flyway, ERD, loại id, index, timezone, charset/collation và concurrency cho slot.
- **DB:** Flyway đã được cấu hình nhưng chưa có SQL domain migration;
  Hibernate chỉ validate, không tự tạo/cập nhật schema. Xem [hướng dẫn backend](../backend/README.md).
- **Phạm vi:** ma trận quyền xem dữ liệu lâm sàng, slot duration, thời hạn đổi/hủy, audit retention
  và chính sách điều chỉnh hồ sơ hoàn tất còn cần chốt.

## Tài liệu nền tảng

Đã đối chiếu ERD QA trong [SCHEMA_REVIEW_D01](SCHEMA_REVIEW_D01.md). Trạng thái
PENDING/CONFIRMED so với BOOKED, slotId so với khoảng lịch, release hồ sơ và quyền
đọc lịch sử khác bác sĩ còn cần thống nhất. Các đề xuất nghiệp vụ trong contract này
chưa được coi là schema/API đã duyệt; không tạo migration để tự giải quyết các khác biệt.

- [Spring Boot 4.1 — system requirements](https://docs.spring.io/spring-boot/4.1/system-requirements.html)
- [Spring Boot — data initialization / Flyway](https://docs.spring.io/spring-boot/how-to/data-initialization.html)
- [Spring Security — CSRF](https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html)
- [Spring Security — JWT Resource Server](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html)
