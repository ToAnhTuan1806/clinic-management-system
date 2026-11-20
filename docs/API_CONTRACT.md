# API Contract sơ bộ — Clinic Management System

Task: **CL-D01-BE**. Tài liệu phục vụ FE/BE/DB thống nhất trước khi làm nghiệp vụ.
`IMPLEMENTED` chỉ áp dụng cho phần đã có code và kiểm thử; `PROPOSED` chưa phải API sử dụng được.
Phạm vi chức năng: [FR-01–FR-14](requirements/FEATURE_SCOPE.md).

## 1. Quy ước chung

- Base path: `/api/v1`; JSON UTF-8; tên trường camelCase; URL danh từ số nhiều, chữ thường có dấu `-`.
- GET đọc dữ liệu; POST tạo hoặc thực hiện chuyển trạng thái; PATCH cập nhật một phần.
  DELETE chỉ dùng khi mô hình cho phép xóa, không dùng để xóa lịch sử khám.
- Id nghiệp vụ trao đổi dưới dạng chuỗi opaque; BE/DB cần chốt UUID/BIGINT trước migration đầu tiên.
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

Không trả 200 kèm cờ lỗi cho request thất bại. Trong D01, GET đến API bảo vệ trả 401;
POST/PATCH/DELETE thiếu CSRF token có thể bị chặn 403 trước bước xác thực/định tuyến.
Vì vậy API `PROPOSED` có thể trả 401/403 thay vì 404, không có nghĩa API đã tồn tại.

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
- D01 có `AUTHENTICATION_REQUIRED`, `ACCESS_DENIED`, `INTERNAL_ERROR`,
  `HTTP_<status>` và handler `VALIDATION_FAILED` cho DTO có `@Valid`.
- Validation handler chỉ trả tên trường và thông điệp an toàn, không trả giá trị bị từ chối.
  Chưa có DTO request nghiệp vụ trong D01.

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

**D01 IMPLEMENTED:** chỉ GET health được permit; tất cả request còn lại `denyAll`, kể cả
principal có role ADMIN. Không có đăng nhập, HTTP Basic, form login, tài khoản mặc định hoặc JWT.
Session policy là stateless, request cache tắt; CSRF giữ mặc định; CORS chưa mở origin nào.
Security headers mặc định của Spring Security được giữ (HSTS chỉ trên HTTPS).
`/error` là handler nội bộ khi servlet error dispatch; gọi trực tiếp vẫn bị bảo vệ.

**PROPOSED:** JWT và mapping `ROLE_ADMIN/ROLE_DOCTOR/ROLE_RECEPTIONIST/ROLE_PATIENT` ở giai đoạn sau.
Chốt transport, refresh/logout/revoke, CORS allowlist và CSRF với FE trước khi mở endpoint.
Role không thay thế kiểm tra ownership/phân công ở service và truy vấn repository.
Đăng ký public chỉ tạo PATIENT; API ADMIN tạo nhân viên không nhận role từ người chưa xác thực.

## 6. Danh mục endpoint

Tất cả path dưới đây có tiền tố `/api/v1`. `self` = bản thân;
`assigned` = bác sĩ được phân công; quyền chi tiết phải áp dụng theo bảng trên.
Các dòng có nhiều method mô tả các API riêng cùng trạng thái triển khai.

| FR | Method | Path | Quyền dự kiến | Trạng thái |
| --- | --- | --- | --- | --- |
| Nền tảng | GET | `/health` | Public | **IMPLEMENTED** |
| FR-01 | POST | `/auth/register` | Public, chỉ PATIENT | PROPOSED |
| FR-01 | POST | `/auth/login` | Public | PROPOSED |
| FR-01 | POST | `/auth/logout` | Đã xác thực | PROPOSED |
| FR-01 | GET | `/auth/me` | Đã xác thực, self | PROPOSED |
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

- **FE:** base URL/port, envelope `data`, Problem Details, pagination từ 0,
  UTC và role/ownership; D01 chỉ gọi được health, chưa có API login hoặc dữ liệu demo.
- **FE + BE:** origin chạy FE, transport xác thực, CSRF/CORS, refresh/revoke và thông điệp lỗi;
  không mở wildcard credentials hoặc tắt CSRF trước khi quyết định transport.
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
