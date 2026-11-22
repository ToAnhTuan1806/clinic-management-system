# API Contract — Clinic Management System (D01–D11)

Nghiệm thu **CL-D11-BE**, kế thừa Auth/JWT, danh mục, Profile/Patients, lịch làm việc,
đặt/đổi/hủy và tiếp nhận lịch hẹn, hồ sơ khám D10. D11 bổ sung lịch sử và công bố hồ sơ.
Contract chính thức cho FE Sprint 3, cập nhật ngày **2026-11-22**.
`IMPLEMENTED` chỉ áp dụng cho phần đã có code và kiểm thử; `PROPOSED` chưa phải API sử dụng được.
Phạm vi chức năng: [FR-01–FR-14](requirements/FEATURE_SCOPE.md).

## 1. Quy ước chung

- Base path: `/api/v1`; JSON UTF-8; tên trường camelCase; URL danh từ số nhiều, chữ thường có dấu `-`.
- GET đọc dữ liệu; POST tạo hoặc thực hiện chuyển trạng thái; PATCH cập nhật một phần.
  DELETE chỉ dùng khi mô hình cho phép xóa, không dùng để xóa lịch sử khám.
- User, Doctor, Specialty, Patient, DoctorSchedule, Appointment, MedicalRecord dùng PK BIGINT signed; API trả id và id liên kết dạng chuỗi
  để tránh mất chính xác ở JavaScript. Request id liên kết dùng chuỗi số nguyên dương trong phạm vi BIGINT signed.
  V1–V10 đã tích hợp, gồm bảng hồ sơ khám V9 và công bố/backfill V10;
  migration do Database/QA sở hữu và không bị sửa.
- Ngày: `YYYY-MM-DD`; thời điểm: ISO-8601 UTC, ví dụ `2026-11-20T02:00:00Z`.
  FE hiển thị theo `Asia/Ho_Chi_Minh`, không gửi thời điểm thiếu offset.
- Danh sách D03/D04: `page=0&size=20`, size 1–100; thứ tự cố định như mục 3.2–3.3,
  luôn có id làm thứ tự phụ ổn định. Chưa hỗ trợ query `sort` do client chọn.
- Không nhận trực tiếp JPA entity làm request/response; dùng DTO và Bean Validation;
  giới hạn trường có thể ghi để ngăn cập nhật role/owner trái phép.
- Không trả mật khẩu/hash/token nội bộ, stack trace, SQL hoặc URL kết nối.
- Quy ước cụ thể tại các mục **IMPLEMENTED D02/D03/D04/D06/D07** là contract đang sử dụng.
  Các endpoint và mẫu nghiệp vụ ghi **PROPOSED** chưa được triển khai.

## 2. HTTP status

| Status | Ý nghĩa |
| --- | --- |
| 200 | Đọc hoặc cập nhật thành công, có body |
| 201 | Tạo mới thành công; trả Location và resource |
| 204 | Thành công không có body (ví dụ logout/đánh dấu đọc khi đã thống nhất) |
| 400 | JSON sai cú pháp, kiểu dữ liệu hoặc validation thất bại |
| 401 | Chưa xác thực hoặc thông tin xác thực không hợp lệ/hết hạn |
| 403 | Đã xác thực nhưng thiếu quyền, hoặc CORS ngoài allowlist (`CORS_REJECTED`) |
| 404 | Không tìm thấy resource trong phạm vi người dùng được xem |
| 405 | Resource tồn tại nhưng method không được hỗ trợ, khi đã qua security |
| 409 | Trùng email/mã/tên/license, liên kết không hợp lệ hoặc xung đột trạng thái/ràng buộc dữ liệu |
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

Response có body thành công dùng `{"data": ...}`. **IMPLEMENTED D03/D04** cho danh sách doctor/specialty/patient và eligible-users:

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

### 3.2 Specialties và Doctors — IMPLEMENTED D03

Tám API CRUD cùng endpoint eligible-users đã triển khai. V1/V2 đã tích hợp;
kiểm thử HTTP chạy riêng trên H2 và MySQL QA cô lập. Fixture H2 không được dùng làm migration.

**Phân quyền thực tế**

| Role | Specialties GET | Doctors GET | POST/PATCH |
| --- | --- | --- | --- |
| ADMIN | Tất cả, gồm inactive | Tất cả, gồm inactive | Được phép |
| RECEPTIONIST | Tất cả để điều phối | Tất cả, response điều phối | 403 |
| DOCTOR | Chỉ specialties active | Chỉ doctor có userId trùng principal; kể cả profile inactive | 403 |
| PATIENT | Chỉ specialties active | Chỉ profile active + specialty active + user ACTIVE/DOCTOR | 403 |

Tất cả yêu cầu JWT của user ACTIVE; anonymous/sai JWT nhận 401. Detail ngoài phạm vi
đọc (doctor khác với DOCTOR, profile ẩn với PATIENT) trả 404. Không có public staff registration.
Không có DELETE API; request DELETE vẫn bị deny 403 sau xác thực.
Riêng GET `/doctors/eligible-users` chỉ ADMIN; ba role còn lại nhận 403, không dùng quyền đọc doctors chung.

**GET /specialties, GET /doctors** (tiền tố `/api/v1`)

- Query chung: `q` tối đa 120 ký tự, `isActive=true|false`, `page=0`, `size=20` (1–100).
- Specialties: q tìm code/name, thứ tự cố định code rồi id tăng dần.
- Doctors: q tìm doctorCode/fullName từ users; thêm `specialtyId` dương; thứ tự doctorCode rồi id tăng dần.
- Kết quả dùng data.items/page/size/totalElements/totalPages. Count cũng áp dụng scope theo role.
- DOCTOR/PATIENT gửi `isActive=false` cho specialties nhận 403; PATIENT gửi filter đó cho doctors cũng 403.
- `q` là chuỗi tìm literal, không cho `%`/`_` tự mở rộng LIKE; tham số không được ghép thành SQL.
- Sai page/size/q/ID/boolean nhận 400; trang vượt dữ liệu trả items rỗng.

**POST /specialties — ADMIN, 201 + Location**

```json
{"code":"ENT","name":"Tai Mũi Họng","description":"Mô tả chuyên khoa","isActive":true}
```

Code trim/uppercase, `[A-Z0-9][A-Z0-9_-]{0,31}`; name trim, không rỗng, tối đa 120 ký tự.
Code/name UNIQUE; pre-check name không phân biệt hoa thường và DB UNIQUE là lớp bảo vệ cuối.
Description tùy chọn, tối đa 5000 ký tự; isActive bỏ qua khi tạo mặc định true.
V2 dùng utf8mb4_0900_ai_ci cho specialty name: UNIQUE không phân biệt hoa thường/dấu.
DB constraint là lớp quyết định khi pre-check không bắt được xung đột; khi đó có thể trả SPECIALTY_CONFLICT.

Response create/detail/patch:

```json
{"data":{"id":"1","code":"ENT","name":"Tai Mũi Họng","description":"Mô tả chuyên khoa","isActive":true}}
```

**GET /specialties/{id} — 200**, áp dụng scope role như bảng trên.

**PATCH /specialties/{id} — ADMIN, 200**

Nhận một phần code/name/description/isActive. Ví dụ `{"isActive":false}`.
Nếu còn bất kỳ doctor.isActive=true liên kết, trả **409 SPECIALTY_HAS_ACTIVE_DOCTORS**;
phải deactivate doctor trước. Không xóa doctor, specialty hoặc lịch sử.

**POST /doctors — ADMIN, 201 + Location**

```json
{
  "userId":"21",
  "specialtyId":"1",
  "doctorCode":"DR_001",
  "licenseNumber":"LIC-001",
  "biography":"Giới thiệu bác sĩ",
  "isActive":true
}
```

- User phải tồn tại, role DOCTOR, status ACTIVE và chưa có doctor profile, kể cả profile cũ inactive.
  Không tạo/cấp quyền tài khoản staff qua API doctor hoặc public register.
- Specialty phải tồn tại và active khi tạo liên kết mới, kể cả doctor mới có isActive=false.
- Doctor code trim/uppercase, cùng format 32 ký tự như specialty code, UNIQUE.
- License tùy chọn, trim/uppercase, tối đa 100 ký tự, UNIQUE khi khác NULL; rỗng chuẩn hóa NULL.
  Nhiều doctor không có license được phép. Biography tùy chọn, tối đa 5000 ký tự.
- isActive mặc định true; fullName lấy từ users.full_name, không nhận fullName/password/role/status từ request.

Response cho ADMIN và DOCTOR xem chính mình:

```json
{
  "data": {
    "id":"1","doctorCode":"DR_001","fullName":"Tên từ tài khoản DOCTOR",
    "specialtyId":"1","specialtyName":"Tai Mũi Họng","biography":"Giới thiệu bác sĩ",
    "isActive":true,"userId":"21","userStatus":"ACTIVE","licenseNumber":"LIC-001"
  }
}
```

PATIENT chỉ nhận **id, doctorCode, fullName, specialtyId, specialtyName, biography, isActive**.
RECEPTIONIST nhận các trường đó cùng userStatus để điều phối; không userId/licenseNumber/email.
Không role nào nhận passwordHash, password, token hoặc timestamps nội bộ qua API catalog.

**GET /doctors/{id} — 200**, áp dụng scope role và response theo role như trên.

**PATCH /doctors/{id} — ADMIN, 200**

Nhận một phần specialtyId/doctorCode/licenseNumber/biography/isActive.
`userId` là liên kết bất biến trong D03; request đổi userId/fullName/role/status bị 400 do field thừa.
Chuyển specialty hoặc bật lại doctor yêu cầu specialty active và user ACTIVE/DOCTOR.
Có thể deactivate profile khi user đã bị khóa để đưa dữ liệu về trạng thái ngừng hoạt động.
Thay biography/code trong cùng specialty không tạo liên kết mới; không tự đổi tài khoản user.

PATCH không phải JSON Merge Patch: field bỏ qua hoặc NULL giữ nguyên; chuỗi rỗng cho
description/biography/licenseNumber xóa giá trị về NULL; code/name rỗng không hợp lệ.
Body không có field cần cập nhật trả 400 VALIDATION_FAILED. Field thừa bị 400 HTTP_400.

**Bảng DTO request chính thức**

| API | Field | Kiểu / validation |
| --- | --- | --- |
| POST specialty | code, name | String bắt buộc; code canonical 1–32 ký tự theo pattern nêu trên; name trim 1–120 |
| POST/PATCH specialty | description | String tùy chọn, tối đa 5000; PATCH chuỗi rỗng để clear |
| POST/PATCH specialty | isActive | Boolean tùy chọn; POST mặc định true, PATCH NULL/bỏ qua giữ nguyên |
| PATCH specialty | code, name | Tùy chọn; nếu có giá trị phải hợp lệ như POST |
| POST doctor | userId, specialtyId | ID dương, gửi dạng chuỗi số BIGINT; bắt buộc, phải tham chiếu resource hợp lệ |
| POST doctor | doctorCode | String bắt buộc, canonical 1–32 theo pattern code |
| POST/PATCH doctor | licenseNumber | String tùy chọn, tối đa 100; trim/uppercase; rỗng = NULL |
| POST/PATCH doctor | biography | String tùy chọn, tối đa 5000; PATCH chuỗi rỗng để clear |
| POST/PATCH doctor | isActive | Boolean tùy chọn; POST mặc định true, PATCH giữ nguyên nếu NULL/bỏ qua |
| PATCH doctor | specialtyId, doctorCode | Tùy chọn, validation như POST; userId/fullName/role/status không được nhận |

Path id là số nguyên dương trong phạm vi signed BIGINT; sai định dạng/0/âm/overflow trả 400.
Không có resource hoặc FK hợp lệ nhưng không tồn tại trả 404. Response ID luôn là chuỗi.

**Lỗi D03**

| HTTP | Code | Trường hợp |
| --- | --- | --- |
| 400 | VALIDATION_FAILED / HTTP_400 | Validation, payload/query/ID sai hoặc PATCH rỗng |
| 401 | AUTHENTICATION_REQUIRED / INVALID_ACCESS_TOKEN | Kế thừa D02 |
| 403 | ACCESS_DENIED / CORS_REJECTED | Thiếu quyền hoặc CORS không được phép |
| 404 | RESOURCE_NOT_FOUND | Resource/FK không tồn tại hoặc ngoài scope được đọc |
| 409 | SPECIALTY_CODE_EXISTS / SPECIALTY_NAME_EXISTS | Trùng code/name |
| 409 | DOCTOR_CODE_EXISTS / LICENSE_NUMBER_EXISTS | Trùng code/license |
| 409 | USER_ALREADY_LINKED / USER_NOT_ELIGIBLE | User đã có profile hoặc sai role/status |
| 409 | SPECIALTY_INACTIVE / SPECIALTY_HAS_ACTIVE_DOCTORS | Vi phạm policy active |
| 409 | SPECIALTY_CONFLICT / DOCTOR_CONFLICT | DB constraint phát hiện xung đột, kể cả request đồng thời |
| 409 | DOCTOR_CONCURRENT_UPDATE | Doctor đổi liên kết trong lúc xử lý; reload và thử lại |

Write giữ khóa transaction theo specialty (ID tăng dần nếu đổi) → user → doctor.
Disable specialty và tạo/đổi/bật doctor dùng cùng khóa parent. Test HTTP đồng thời chạy trên
cả H2 và MySQL: tạo doctor/disable specialty không cùng thành công; một user không tạo hai profile.

**GET /api/v1/doctors/eligible-users — ADMIN, IMPLEMENTED D03**

JWT hợp lệ, user hiện tại ACTIVE và role ADMIN. Bộ lọc phía BE cố định:
user ACTIVE, role DOCTOR và chưa có **bất kỳ** profile Doctor nào, kể cả profile inactive.
Client không thể nới bộ lọc bằng query role/status. Không mở `/users` chung hoặc tạo staff qua register.

| Query | Mặc định | Quy ước |
| --- | --- | --- |
| q | rỗng | Trim, tối đa 120 ký tự; tìm substring fullName hoặc email, không phân biệt hoa thường |
| page | 0 | Integer >= 0 |
| size | 20 | Integer 1–100 |

Thứ tự fullName tăng dần, sau đó id tăng dần; không hỗ trợ sort tùy ý.
Search là literal: `%`, `_`, dấu quote không trở thành wildcard/SQL. Các điều kiện role/status/unlinked
không phải filter do client cấu hình. Trang không có kết quả trả 200 với items rỗng.

Ví dụ GET `/api/v1/doctors/eligible-users?q=example&page=0&size=20`:

```json
{
  "data": {
    "items": [{"id":"21","fullName":"Tên bác sĩ","email":"doctor@example.invalid"}],
    "page":0,"size":20,"totalElements":1,"totalPages":1
  }
}
```

Mỗi item có **đúng id/fullName/email**, không passwordHash/role/status/license hoặc trường entity khác.
Backend dùng projection ba cột, không trả entity User. Query sai trả 400
VALIDATION_FAILED (range/độ dài) hoặc HTTP_400 (không parse được integer);
thiếu/sai JWT trả 401; role khác ADMIN trả 403 ACCESS_DENIED.

FE flow: gọi eligible-users bằng token ADMIN → dùng item.id làm userId khi POST doctor →
refresh danh sách sau tạo. Kết quả có thể đổi giữa GET và POST; nếu user đã được liên kết hoặc bị khóa,
POST vẫn kiểm tra lại và trả 409 USER_ALREADY_LINKED/USER_NOT_ELIGIBLE. Không tự tạo tài khoản staff.

### 3.3 Personal Profile & Patient Management (CL-D04-BE — IMPLEMENTED D04)

Bổ sung API hồ sơ cá nhân (FR-02) và quản lý bệnh nhân (FR-05) với RBAC, ownership và Flyway migration V3.

**Phân quyền thực tế D04**

| Endpoint | Method | ADMIN | RECEPTIONIST | DOCTOR | PATIENT |
| --- | --- | --- | --- | --- | --- |
| `/api/v1/me/profile` | GET, PATCH | Cho phép (self) | Cho phép (self) | Cho phép (self) | Cho phép (self) |
| `/api/v1/patients` | GET | Cho phép (toàn bộ) | Cho phép (toàn bộ) | 403 ACCESS_DENIED | 403 ACCESS_DENIED |
| `/api/v1/patients` | POST | Cho phép | Cho phép | 403 ACCESS_DENIED | 403 ACCESS_DENIED |
| `/api/v1/patients/{id}` | GET | Cho phép (toàn bộ) | Cho phép (toàn bộ) | 403 (chưa có assignment) | Chỉ profile linked (khác: 404) |
| `/api/v1/patients/{id}` | PATCH | Cho phép | Cho phép | 403 ACCESS_DENIED | 403 ACCESS_DENIED |
| `/api/v1/me/patient-profile` | GET | 403 ACCESS_DENIED | 403 ACCESS_DENIED | 403 ACCESS_DENIED | Cho phép (chưa link: 404) |

- Tất cả endpoint yêu cầu JWT Bearer hợp lệ từ user `ACTIVE`; thiếu token trả 401 `AUTHENTICATION_REQUIRED`, token sai/hết hạn trả 401 `INVALID_ACCESS_TOKEN`.
- DOCTOR chưa có cơ chế assignment trong Sprint 1: mặc định deny 403 `ACCESS_DENIED` trên `/api/v1/patients` và `/api/v1/patients/{id}`.
- PATIENT không có quyền đọc danh sách bệnh nhân chung (GET `/patients` nhận 403). Khi gọi `GET /patients/{id}`, nếu `{id}` không thuộc user của mình, trả 404 `RESOURCE_NOT_FOUND` (không làm lộ sự tồn tại của bản ghi người khác).
- PATIENT gọi `GET /me/patient-profile`: trả hồ sơ bệnh nhân liên kết chính mình. Nếu chưa có liên kết, trả 404 `RESOURCE_NOT_FOUND`; không tự tạo hoặc ghép hồ sơ giả định.

**GET /api/v1/me/profile — 200**
Trả thông tin tài khoản hiện tại từ `users`, tra theo id của JWT principal (cả 4 role):
```json
{
  "data": {
    "id": "1",
    "email": "user@example.invalid",
    "fullName": "Nguyen Van A",
    "role": "PATIENT",
    "status": "ACTIVE",
    "phone": null,
    "address": null
  }
}
```
*Ghi chú về Schema & Implementation:*
- Backend D04 đã tích hợp migration Flyway V4 (`V4__add_profile_contact_fields_to_users.sql`) do QA bàn giao.
- Response trả đủ 7 trường: `id, email, fullName, role, status, phone, address`. Trường `phone` và `address` có giá trị `null` nếu chưa được thiết lập.

**PATCH /api/v1/me/profile — 200**
Cập nhật thông tin hồ sơ của chính mình. Request body theo contract thống nhất (hỗ trợ form FE D04):
```json
{
  "fullName": "Nguyen Van B",
  "phone": "0901234567",
  "address": "123 Đường XYZ, Hà Nội"
}
```
- **Validation quy chuẩn**:
  - `fullName`: String bắt buộc, trim, 1–120 ký tự. Không được để trống hoặc chỉ chứa khoảng trắng.
  - `phone`: String nullable, tối đa 24 ký tự. Nếu gửi rỗng `""` hoặc chỉ chứa khoảng trắng thì chuẩn hóa thành `null`. Không áp dụng ràng buộc UNIQUE trên bảng `users`.
  - `address`: String nullable, tối đa 255 ký tự. Nếu gửi rỗng `""` hoặc chỉ chứa khoảng trắng thì chuẩn hóa thành `null`.
  - Đây là payload form D04: `fullName` luôn bắt buộc. `phone`/`address` bị bỏ qua hoặc gửi `null`
    cũng đặt giá trị về `null`; FE cần gửi lại giá trị hiện tại nếu muốn giữ chúng.
    Khác với PATCH patient bên dưới, endpoint này không giữ contact khi field bị bỏ qua.
- **Bảo mật và bất biến**:
  - Chỉ cập nhật tài khoản bản thân; không ảnh hưởng user khác.
  - `id`, `email`, `role`, `status`, `password`, `passwordHash`, `userId` không được nhận trong payload profile. Do cấu hình `fail-on-unknown-properties: true`, gửi các trường thừa này sẽ bị từ chối 400 `HTTP_400`; password/hash không có trong response profile.
- **Schema & Migration V4**:
  - Migration V4 do QA bàn giao đã được tích hợp:
    ```sql
    ALTER TABLE users
      ADD COLUMN phone VARCHAR(24) NULL AFTER full_name,
      ADD COLUMN address VARCHAR(255) NULL AFTER phone,
      ADD CONSTRAINT chk_users_phone CHECK (phone IS NULL OR (CHAR_LENGTH(TRIM(phone)) > 0 AND CAST(phone AS BINARY) = CAST(TRIM(phone) AS BINARY))),
      ADD CONSTRAINT chk_users_address CHECK (address IS NULL OR CHAR_LENGTH(address) <= 255);
    ```
  - Backend đã hoàn thiện ánh xạ `User.java`, `ProfilePatchRequest.java`, `UserProfileResponse.java`, `ProfileService.java` và toàn bộ bộ test tương ứng.
- **Nguyên tắc phân tách dữ liệu (No Auto-Sync)**:
  - Tuyệt đối không tự động đồng bộ (two-way sync) giữa `users.phone` / `users.address` và `patients.phone` / `patients.address`.
  - `users` đại diện cho tài khoản đăng nhập / nhân viên / người dùng hệ thống.
  - `patients` đại diện cho hồ sơ hành chính y tế tại phòng khám (có thể là hồ sơ của người thân, con nhỏ, bệnh nhân vãng lai không có tài khoản, hoặc dùng chung SĐT gia đình).

**GET /api/v1/patients — ADMIN/RECEPTIONIST, 200**
- Query: `q` (tìm substring patientCode, fullName hoặc phone, tối đa 120 ký tự, ký tự đặc biệt được escape literal), `isActive` (boolean), `page` (>= 0, mặc định 0), `size` (1–100, mặc định 20).
- Sắp xếp cố định: `patientCode` ASC, sau đó `id` ASC.
- Response bọc `data`:
```json
{
  "data": {
    "items": [
      {
        "id": "1",
        "patientCode": "PAT_001",
        "fullName": "Nguyen Van C",
        "dateOfBirth": "1990-05-15",
        "sex": "MALE",
        "phone": "0901234567",
        "address": "123 Đường ABC, Hà Nội",
        "isActive": true,
        "userId": "10"
      }
    ],
    "page": 0,
    "size": 20,
    "totalElements": 1,
    "totalPages": 1
  }
}
```

**POST /api/v1/patients — ADMIN/RECEPTIONIST, 201 + Location**
Tạo hồ sơ bệnh nhân hành chính:
```json
{
  "userId": "10",
  "patientCode": "PAT_001",
  "fullName": "Nguyen Van C",
  "dateOfBirth": "1990-05-15",
  "sex": "MALE",
  "phone": "0901234567",
  "address": "123 Đường ABC, Hà Nội",
  "isActive": true
}
```
- `patientCode`: Chuỗi canonical uppercase ASCII 1–32 ký tự theo `[A-Z0-9][A-Z0-9_-]{0,31}`, UNIQUE. Nếu bỏ qua, `null`, rỗng hoặc chỉ khoảng trắng, backend tự sinh mã `PAT` + số ngẫu nhiên 6 chữ số (fallback timestamp nếu hết lượt thử); UNIQUE ở DB vẫn bảo vệ request đồng thời, xung đột trả 409 `PATIENT_CONFLICT`.
- `fullName`: Bắt buộc, 1–120 ký tự, trim.
- `dateOfBirth`: DATE nullable (`YYYY-MM-DD`). Bắt buộc trong quá khứ hoặc hiện tại (`@PastOrPresent`), không được ở tương lai (trả 400 `VALIDATION_FAILED`).
- `sex`: `FEMALE`, `MALE`, `OTHER`, `UNKNOWN` hoặc null.
- `phone`: Tối đa 24 ký tự, nullable, **không UNIQUE** (nhiều bệnh nhân gia đình có thể dùng chung số điện thoại).
- `address`: Tối đa 255 ký tự, nullable.
- `isActive`: Boolean, mặc định true nếu bỏ qua.
- `userId`: Nullable. Bệnh nhân vãng lai (walk-in) có `userId = null`. Nếu cung cấp:
  - User phải tồn tại (404 `RESOURCE_NOT_FOUND`).
  - User phải có role `PATIENT` (409 `USER_NOT_ELIGIBLE`).
  - User phải có status `ACTIVE` (409 `USER_NOT_ACTIVE`).
  - User chưa được liên kết với bất kỳ hồ sơ patient nào khác (409 `USER_ALREADY_LINKED`).
  - Không tự động liên kết tài khoản theo email hoặc số điện thoại.

**GET /api/v1/patients/{id} — 200**
- ADMIN/RECEPTIONIST: Xem chi tiết bất kỳ bệnh nhân nào.
- PATIENT: Chỉ xem được hồ sơ có `userId` trùng với mình (khác trả 404).
- DOCTOR: 403 `ACCESS_DENIED`.

**PATCH /api/v1/patients/{id} — ADMIN/RECEPTIONIST, 200**
- Cập nhật một phần: `patientCode`, `fullName`, `dateOfBirth`, `sex`, `phone`, `address`, `isActive`, `userId`.
- Payload rỗng (không có trường nào) trả 400 `VALIDATION_FAILED`.
- Field bỏ qua hoặc `null` giữ nguyên. `phone`/`address` chỉ chứa khoảng trắng hoặc chuỗi rỗng
  cũng được chuẩn hóa như không cập nhật; D04 chưa hỗ trợ xóa các giá trị này qua PATCH patient.
  Nếu mọi field đều được chuẩn hóa thành không cập nhật, trả 400 `VALIDATION_FAILED`.
- `dateOfBirth` tương lai trả 400 `VALIDATION_FAILED`.
- Trùng `patientCode` với bệnh nhân khác trả 409 `PATIENT_CODE_EXISTS`.
- `phone`: Không áp dụng ràng buộc UNIQUE; nhiều bệnh nhân gia đình/người thân có thể dùng chung số điện thoại. Hệ thống KHÔNG sử dụng mã lỗi `PHONE_ALREADY_EXISTS`.
- Quyền liên kết `userId`: Chỉ ADMIN và RECEPTIONIST mới có quyền gán hoặc thay đổi `userId` qua PATCH. DOCTOR và PATIENT bị từ chối 403 `ACCESS_DENIED`.
- Kiểm tra tính hợp lệ khi gán `userId`: User phải tồn tại (404 `RESOURCE_NOT_FOUND`), có role `PATIENT` (409 `USER_NOT_ELIGIBLE`), status `ACTIVE` (409 `USER_NOT_ACTIVE`), và không được liên kết với bất kỳ hồ sơ patient nào khác (409 `USER_ALREADY_LINKED`).
- Soft delete: Đặt `isActive = false` để ngừng hoạt động; không có API hard delete (DELETE nhận 403).
- Phục hồi bằng `isActive = true`, giữ nguyên id, patientCode, userId và dữ liệu hành chính.
  Cờ này không khóa tài khoản users và không thay đổi quyền PATIENT đọc hồ sơ linked của chính mình.
- Không cho phép cập nhật mật khẩu, role hoặc dữ liệu lâm sàng qua API này.

**GET /api/v1/me/patient-profile — PATIENT, 200**
- Chỉ PATIENT được truy cập (role khác nhận 403 `ACCESS_DENIED`).
- Trả hồ sơ bệnh nhân liên kết với tài khoản hiện tại. Nếu chưa có liên kết trả 404 `RESOURCE_NOT_FOUND`.

**Bảng mã lỗi D04**

| HTTP | Code | Trường hợp |
| --- | --- | --- |
| 400 | VALIDATION_FAILED / HTTP_400 | Dữ liệu không hợp lệ, ngày sinh ở tương lai, patch rỗng, sai định dạng ID/pagination |
| 401 | AUTHENTICATION_REQUIRED / INVALID_ACCESS_TOKEN | Chưa xác thực hoặc JWT không hợp lệ/hết hạn |
| 403 | ACCESS_DENIED | Không có quyền (DOCTOR/PATIENT gọi quản lý bệnh nhân, role khác gọi me/patient-profile) |
| 404 | RESOURCE_NOT_FOUND | Bệnh nhân không tồn tại, user liên kết không tồn tại, PATIENT xem ngoài ownership |
| 409 | PATIENT_CODE_EXISTS | Mã bệnh nhân đã tồn tại |
| 409 | USER_ALREADY_LINKED | Tài khoản đã liên kết với một hồ sơ bệnh nhân khác |
| 409 | USER_NOT_ELIGIBLE | Tài khoản liên kết không có role PATIENT |
| 409 | USER_NOT_ACTIVE | Tài khoản liên kết đang bị khóa (DISABLED) |
| 409 | PATIENT_CONFLICT | Xung đột dữ liệu / ràng buộc cơ sở dữ liệu đồng thời |

### 3.4 Doctor Work Schedules & Schedule Slots (CL-D06-BE — IMPLEMENTED D06)

Bổ sung API quản lý lịch làm việc của bác sĩ (FR-06) với RBAC, chống xung đột lịch ca làm việc (pessimistic lock trên parent Doctor), kiểm soát thời lượng slot (15, 30, 60 phút) và sinh các khung giờ đặt hẹn khả dụng. Tích hợp migration Flyway V5 (`V5__create_doctor_schedules.sql`).

**Phân quyền thực tế D06**

| Endpoint | Method | ADMIN | RECEPTIONIST | DOCTOR | PATIENT |
| --- | --- | --- | --- | --- | --- |
| `/api/v1/doctor-schedules` | POST | Cho phép | Cho phép | 403 ACCESS_DENIED | 403 ACCESS_DENIED |
| `/api/v1/doctor-schedules` | GET | Cho phép (toàn bộ) | Cho phép (toàn bộ) | Chỉ xem ca của chính mình | 403 ACCESS_DENIED |
| `/api/v1/doctor-schedules/{id}` | GET | Cho phép (toàn bộ) | Cho phép (toàn bộ) | Chỉ xem ca của chính mình (khác: 404) | 403 ACCESS_DENIED |
| `/api/v1/doctor-schedules/{id}` | PATCH | Cho phép | Cho phép | 403 ACCESS_DENIED | 403 ACCESS_DENIED |
| `/api/v1/doctors/{id}/schedule-slots` | GET | Cho phép | Cho phép | Cho phép | Cho phép |

- Tất cả endpoint yêu cầu JWT Bearer hợp lệ từ user `ACTIVE`; thiếu token trả 401 `AUTHENTICATION_REQUIRED`, token sai/hết hạn trả 401 `INVALID_ACCESS_TOKEN`.
- DOCTOR chỉ được xem ca làm việc của chính mình trên `GET /doctor-schedules` (hệ thống tự lọc theo `doctorId` của user đăng nhập, query `doctorId` khác sẽ bị bỏ qua hoặc chỉ trả ca của bản thân) và `GET /doctor-schedules/{id}` (nếu ca thuộc bác sĩ khác, trả 404 `RESOURCE_NOT_FOUND` để tránh lộ dữ liệu).
- PATIENT không có quyền quản lý ca trực (trả 403 `ACCESS_DENIED`). PATIENT và các vai trò khác truy cập `GET /doctors/{id}/schedule-slots` để xem các khung giờ khám còn trống.

**Quy tắc nghiệp vụ & Ràng buộc thời gian**:
1. **Timezone & Ngày làm việc**:
   - Múi giờ chuẩn phòng khám: `Asia/Ho_Chi_Minh` (+07:00).
   - Lưu trữ DB: UTC timestamp (`DATETIME(6)` / `Instant`).
   - Ca làm việc phải bắt đầu trong tương lai (`startAt > now`).
   - `startAt < endAt`.
   - Ca làm việc phải nằm trọn trong cùng một ngày theo lịch Việt Nam (`Asia/Ho_Chi_Minh`), không được vắt qua nửa đêm.
2. **Thời lượng slot**:
   - `slotMinutes`: nhận một trong 3 giá trị `15`, `30`, `60`. Mặc định là `30` nếu không truyền.
   - Thời lượng ca (`endAt - startAt`) không được ngắn hơn `slotMinutes`.
3. **Trạng thái & Soft Deactivation**:
   - Trạng thái ca: `ACTIVE` hoặc `BLOCKED`. Mặc định khi tạo là `ACTIVE`.
   - Không xóa vật lý ca làm việc. Hủy/khóa ca bằng cách PATCH `status = "BLOCKED"`.
   - Ca có trạng thái `BLOCKED` sẽ **không** sinh ra bất kỳ khung giờ hẹn (slots) nào.
   - Khi mở lại ca (`BLOCKED` -> `ACTIVE`), hệ thống bắt buộc kiểm tra lại xung đột chồng lấn lịch.
4. **Chống chồng lấn & Race Condition**:
   - Khoảng thời gian ca được tính theo nửa mở $[startAt, endAt)$. Hai ca liền kề nhau ($end_1 = start_2$) là **hợp lệ**.
   - Bác sĩ không được có hai ca `ACTIVE` chồng lấn thời gian. Vi phạm trả 409 `SCHEDULE_OVERLAP`.
   - Chống race condition khi tạo/sửa ca đồng thời: Hệ thống thực hiện khóa bi quan (`PESSIMISTIC_WRITE`) trên bản ghi bác sĩ cha (`Doctor`) trong cùng transaction trước khi kiểm tra overlap và ghi nhận ca mới.
5. **Điều kiện Bác sĩ**:
   - Bác sĩ phải tồn tại (404 `RESOURCE_NOT_FOUND`).
   - Bác sĩ phải đang hoạt động (`doctor.isActive == true`), vi phạm trả 409 `DOCTOR_INACTIVE`.
   - Tài khoản người dùng liên kết với bác sĩ phải đang hoạt động (`user.status == ACTIVE`), vi phạm trả 409 `USER_NOT_ACTIVE`.

**POST /api/v1/doctor-schedules — ADMIN/RECEPTIONIST, 201 + Location**
Tạo ca làm việc mới cho bác sĩ:
```json
{
  "doctorId": "1",
  "startAt": "2026-11-25T08:00:00Z",
  "endAt": "2026-11-25T12:00:00Z",
  "slotMinutes": 30,
  "status": "ACTIVE"
}
```
Response 201:
```json
{
  "data": {
    "id": "100",
    "doctorId": "1",
    "doctorCode": "DOC_001",
    "doctorFullName": "Bac Si A",
    "specialtyName": "Noi Khoa",
    "startAt": "2026-11-25T08:00:00Z",
    "endAt": "2026-11-25T12:00:00Z",
    "slotMinutes": 30,
    "status": "ACTIVE",
    "createdAt": "2026-11-21T10:00:00Z",
    "updatedAt": "2026-11-21T10:00:00Z"
  }
}
```

**GET /api/v1/doctor-schedules — ADMIN/RECEPTIONIST/DOCTOR, 200**
- Query params:
  - `doctorId`: Chuỗi ID bác sĩ (tùy chọn với ADMIN/RECEPTIONIST; DOCTOR luôn bị giới hạn ở hồ sơ của mình).
  - `date`: Lọc theo ngày làm việc (`YYYY-MM-DD` theo múi giờ `Asia/Ho_Chi_Minh`).
  - `status`: `ACTIVE` hoặc `BLOCKED`.
  - `page`: Integer >= 0 (mặc định 0).
  - `size`: Integer 1–100 (mặc định 20).
- Sắp xếp cố định: `startAt` ASC, sau đó `id` ASC.
- Response bọc `data.items`, `page`, `size`, `totalElements`, `totalPages`.

**GET /api/v1/doctor-schedules/{id} — ADMIN/RECEPTIONIST/DOCTOR, 200**
- ADMIN/RECEPTIONIST: Xem bất kỳ ca nào.
- DOCTOR: Chỉ xem ca của mình; ca của bác sĩ khác trả 404 `RESOURCE_NOT_FOUND`.

**PATCH /api/v1/doctor-schedules/{id} — ADMIN/RECEPTIONIST, 200**
Cập nhật ca làm việc:
```json
{
  "startAt": "2026-11-25T08:30:00Z",
  "endAt": "2026-11-25T11:30:00Z",
  "slotMinutes": 30,
  "status": "ACTIVE"
}
```
- Không cho phép chuyển đổi ca sang bác sĩ khác (`doctorId` là bất biến, gửi field thừa bị 400).
- Payload rỗng trả 400 `VALIDATION_FAILED`.
- Kiểm tra tính hợp lệ: thời gian tương lai, cùng ngày Việt Nam, duration >= slotMinutes, không overlap với các ca ACTIVE khác của bác sĩ.

**GET /api/v1/doctors/{id}/schedule-slots — Bốn role, 200**
Lấy danh sách các khung giờ (slots) có thể đặt khám của bác sĩ:
- Path param: `{id}` ID bác sĩ.
- Query params:
  - `date`: `YYYY-MM-DD` (bắt buộc, theo múi giờ `Asia/Ho_Chi_Minh`).
- Response 200:
```json
{
  "data": [
    {
      "startAt": "2026-11-25T08:00:00Z",
      "endAt": "2026-11-25T08:30:00Z",
      "durationMinutes": 30,
      "scheduleId": "100"
    },
    {
      "startAt": "2026-11-25T08:30:00Z",
      "endAt": "2026-11-25T09:00:00Z",
      "durationMinutes": 30,
      "scheduleId": "100"
    }
  ]
}
```
- Các ca `BLOCKED` sẽ không sinh slot.
- Slot được cắt tuần tự `[startAt + k * slotMinutes, startAt + (k+1) * slotMinutes)`. Phần dư nếu `(endAt - startAt) % slotMinutes != 0` sẽ bị bỏ qua.

**Bảng mã lỗi D06**

| HTTP | Code | Trường hợp |
| --- | --- | --- |
| 400 | VALIDATION_FAILED / HTTP_400 | Dữ liệu không hợp lệ: ca quá khứ, vắt qua đêm, start >= end, slotMinutes không thuộc 15/30/60, duration < slotMinutes, thiếu param bắt buộc |
| 401 | AUTHENTICATION_REQUIRED / INVALID_ACCESS_TOKEN | Chưa xác thực hoặc JWT không hợp lệ/hết hạn |
| 403 | ACCESS_DENIED | Không có quyền (PATIENT/DOCTOR gọi thao tác quản trị, DOCTOR xem ca người khác) |
| 404 | RESOURCE_NOT_FOUND | Bác sĩ không tồn tại, ca làm việc không tồn tại hoặc ngoài phạm vi quyền xem |
| 409 | SCHEDULE_OVERLAP | Ca làm việc bị trùng/chồng lấn với một ca ACTIVE khác của cùng bác sĩ |
| 409 | DOCTOR_INACTIVE | Bác sĩ đang ở trạng thái ngừng hoạt động (`isActive = false`) |
| 409 | USER_NOT_ACTIVE | Tài khoản người dùng liên kết với bác sĩ đang bị khóa (`DISABLED`) |

### 3.5 Appointment Booking & Slot Reservation (CL-D07-BE — IMPLEMENTED D07)

Bổ sung API đặt lịch khám trực tiếp (FR-07) với kế thừa lịch ca làm việc D06, loại bỏ các slot đã bị chiếm, cơ chế chống double booking đa tầng (transactional pessimistic lock trên parent Doctor kết hợp unique constraint tại DB), kiểm soát Idempotency (SHA-256 fingerprint trên `requestKey`), RBAC & ownership phân tách giữa PATIENT và RECEPTIONIST, bảo vệ ca làm việc D06 khi có lịch hẹn phát sinh (`SCHEDULE_HAS_APPOINTMENTS`), và tích hợp migration Flyway V6 (`V6__create_appointments.sql`).

**Phân quyền thực tế D07**

| Endpoint | Method | ADMIN | RECEPTIONIST | DOCTOR | PATIENT |
| --- | --- | --- | --- | --- | --- |
| `/api/v1/appointments` | POST | 403 ACCESS_DENIED | Cho phép (đặt thay cho bệnh nhân hợp lệ) | 403 ACCESS_DENIED | Cho phép (chỉ đặt cho profile linked của bản thân) |
| `/api/v1/appointments` | GET | Cho phép (toàn bộ lịch hẹn) | Cho phép (toàn bộ lịch hẹn) | Chỉ xem lịch hẹn thuộc bác sĩ mình | Chỉ xem lịch hẹn thuộc profile bệnh nhân linked của mình |
| `/api/v1/appointments/{id}` | GET | Cho phép (toàn bộ) | Cho phép (toàn bộ) | Chỉ xem lịch hẹn thuộc bác sĩ mình (khác: 404) | Chỉ xem lịch hẹn thuộc profile linked của mình (khác: 404) |
| `/api/v1/doctors/{id}/schedule-slots` | GET | Cho phép | Cho phép | Cho phép | Cho phép (tự động loại bỏ slot đã được đặt) |

- Tất cả endpoint yêu cầu JWT Bearer hợp lệ từ user `ACTIVE`; thiếu token trả 401 `AUTHENTICATION_REQUIRED`, token sai/hết hạn trả 401 `INVALID_ACCESS_TOKEN`.
- DOCTOR chỉ được xem danh sách và chi tiết các lịch hẹn thuộc về bác sĩ của mình. Truy cập lịch hẹn của bác sĩ khác trả 404 `RESOURCE_NOT_FOUND` (để tránh suy đoán ID bản ghi).
- PATIENT chỉ được xem và đặt lịch hẹn cho hồ sơ bệnh nhân liên kết chính mình (`GET /api/v1/me/patient-profile`). Nếu chưa liên kết hồ sơ bệnh nhân, không thể đặt lịch (trả 404 `RESOURCE_NOT_FOUND`). Truy cập lịch hẹn của bệnh nhân khác trả 404 `RESOURCE_NOT_FOUND`.
- RECEPTIONIST được quyền đặt lịch thay cho bệnh nhân tại quầy (bắt buộc truyền `patientId` hợp lệ).
- ADMIN xem toàn bộ danh sách và chi tiết phục vụ giám sát vận hành.

**Quy tắc nghiệp vụ & Bảo vệ kép chống Double Booking**:
1. **Lưới Slot & Tính toán thời gian**:
   - `scheduleId` và `startAt` là bắt buộc. Client **không** gửi `doctorId`, `endAt`, `status` hay `createdBy` để can thiệp nghiệp vụ.
   - `startAt` phải nằm trong tương lai (`startAt > now`).
   - `startAt` phải nằm trong ca làm việc (`schedule.startAt <= startAt` và `startAt + slotMinutes <= schedule.endAt`).
   - `startAt` phải khớp đúng lưới slot của ca: `(startAt - schedule.startAt) % slotMinutes == 0`.
   - `endAt` được Backend tự động tính toán: `endAt = startAt + schedule.slotMinutes`.
2. **Kiểm tra trạng thái đối tượng liên quan**:
   - Ca làm việc phải tồn tại và `status == ACTIVE`. Ca bị `BLOCKED` trả 409 `SCHEDULE_BLOCKED`.
   - Bác sĩ phải đang hoạt động (`doctor.isActive == true`), vi phạm trả 409 `DOCTOR_INACTIVE`.
   - Tài khoản người dùng liên kết với bác sĩ phải đang hoạt động (`user.status == ACTIVE`), vi phạm trả 409 `USER_NOT_ACTIVE`.
   - Bệnh nhân phải tồn tại và đang hoạt động (`patient.isActive == true`), vi phạm trả 409 `PATIENT_INACTIVE`.
3. **Chống Double Booking đa tầng (Concurrency Safety)**:
   - *Tầng 1 (Application & Transaction Lock)*: Trong cùng transaction đặt lịch, hệ thống thực hiện khóa bi quan ghi (`PESSIMISTIC_WRITE`) trên entity `Doctor` cha (`doctorRepository.findLocked(doctorId)`). Sau đó kiểm tra xem slot `[startAt, endAt)` của bác sĩ đã có lịch hẹn nào đang hoạt động (không phải `CANCELLED`) hay chưa. Nếu đã có trả 409 `SLOT_ALREADY_BOOKED`.
   - *Tầng 2 (Database Constraint)*: Unique index tại cơ sở dữ liệu `uk_appointments_doctor_start_at (doctor_id, start_at_utc)` đóng vai trò phòng vệ cuối cùng. Khi có xung đột đồng thời vượt qua application layer, DataIntegrityViolationException sẽ được bắt và chuyển thành 409 `SLOT_ALREADY_BOOKED`.
4. **Idempotency (Chống trùng lặp request)**:
   - Header/trường `requestKey` (bắt buộc, 1–64 ký tự) dùng để đảm bảo tính idempotent của request đặt lịch từ client.
   - Backend tính mã băm SHA-256 fingerprint trên canonical payload: `patientId:doctorId:scheduleId:startAt:endAt:reason`.
   - Trùng `requestKey` với **cùng** payload: Trả về bản ghi lịch hẹn đã tạo (HTTP 200 hoặc 201) một cách an toàn mà không đặt trùng lịch.
   - Trùng `requestKey` nhưng **khác** payload: Trả về lỗi 409 `IDEMPOTENCY_CONFLICT`.
   - Cơ sở dữ liệu có unique constraint `uk_appointments_created_by_request_key (created_by, request_key)`.
5. **Nâng cấp GET /api/v1/doctors/{id}/schedule-slots**:
   - Tự động lọc bỏ các slot đã bị đặt bởi các cuộc hẹn có trạng thái khác `CANCELLED`.
   - Chỉ trả về các slot thực sự còn khả dụng cho bệnh nhân đặt hẹn.
6. **Bảo vệ Schedule D06 khi có lịch hẹn**:
   - Không cho phép PATCH ca làm việc sang `BLOCKED` nếu ca đang có các lịch hẹn chưa hủy (`SCHEDULE_HAS_APPOINTMENTS`, 409).
   - Không cho phép co hẹp thời gian ca làm việc (`startAt` trễ hơn hoặc `endAt` sớm hơn) hoặc thay đổi `slotMinutes` làm ảnh hưởng đến các lịch hẹn đã được đặt trong ca (`SCHEDULE_HAS_APPOINTMENTS`, 409).
7. **Trạng thái ban đầu**:
   - Tất cả lịch hẹn tạo mới đều có trạng thái khởi tạo là `PENDING`.
   - Các luồng chuyển trạng thái tiếp theo (`CONFIRMED`, `CHECKED_IN`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`) thuộc phạm vi D08/D09.

**POST /api/v1/appointments — PATIENT/RECEPTIONIST, 201 + Location**

Payload cho PATIENT (không truyền patientId):
```json
{
  "scheduleId": "100",
  "startAt": "2026-11-25T08:00:00Z",
  "requestKey": "req-client-uuid-001",
  "reason": "Khám tổng quát định kỳ"
}
```

Payload cho RECEPTIONIST (bắt buộc patientId):
```json
{
  "scheduleId": "100",
  "patientId": "50",
  "startAt": "2026-11-25T08:00:00Z",
  "requestKey": "req-recep-uuid-002",
  "reason": "Đặt tại quầy tiếp đón"
}
```

Response 201 (hoặc 200 khi replay idempotent):
```json
{
  "data": {
    "id": "1001",
    "patientId": "50",
    "patientCode": "PAT123456",
    "patientFullName": "Nguyen Van A",
    "doctorId": "1",
    "doctorCode": "DOC_001",
    "doctorFullName": "Bac Si B",
    "specialtyName": "Noi Khoa",
    "scheduleId": "100",
    "startAt": "2026-11-25T08:00:00Z",
    "endAt": "2026-11-25T08:30:00Z",
    "status": "PENDING",
    "reason": "Khám tổng quát định kỳ",
    "createdAt": "2026-11-21T10:30:00Z",
    "updatedAt": "2026-11-21T10:30:00Z"
  }
}
```

**GET /api/v1/appointments — ADMIN/RECEPTIONIST/DOCTOR/PATIENT, 200**
- Query params:
  - `doctorId`: ID bác sĩ (tùy chọn với ADMIN/RECEPTIONIST; DOCTOR bị khóa vào ID của mình; PATIENT bị bỏ qua hoặc chỉ xem lịch của mình).
  - `patientId`: ID bệnh nhân (tùy chọn với ADMIN/RECEPTIONIST; PATIENT bị khóa vào profile của mình).
  - `date`: Lọc theo ngày khám (`YYYY-MM-DD` theo múi giờ `Asia/Ho_Chi_Minh`).
  - `status`: Lọc theo trạng thái lịch (`PENDING`, `CONFIRMED`, `CHECKED_IN`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`).
  - `page`: Integer >= 0 (mặc định 0).
  - `size`: Integer 1–100 (mặc định 20).
- Sắp xếp cố định: `startAt` ASC, sau đó `id` ASC.
- Response bọc `data.items`, `page`, `size`, `totalElements`, `totalPages`.

**GET /api/v1/appointments/{id} — ADMIN/RECEPTIONIST/DOCTOR/PATIENT, 200**
- ADMIN/RECEPTIONIST: Xem chi tiết bất kỳ cuộc hẹn nào.
- DOCTOR: Xem cuộc hẹn thuộc bác sĩ mình (khác trả 404).
- PATIENT: Xem cuộc hẹn thuộc profile bệnh nhân linked của mình (khác trả 404).

**Bảng mã lỗi D07**

| HTTP | Code | Trường hợp |
| --- | --- | --- |
| 400 | VALIDATION_FAILED / HTTP_400 | Dữ liệu không hợp lệ: startAt quá khứ, startAt lệch lưới slot, requestKey rỗng/quá dài, PATIENT truyền patientId, RECEPTIONIST thiếu patientId |
| 401 | AUTHENTICATION_REQUIRED / INVALID_ACCESS_TOKEN | Chưa xác thực hoặc JWT không hợp lệ/hết hạn |
| 403 | ACCESS_DENIED | Không có quyền (ADMIN/DOCTOR gọi POST đặt hẹn, CORS không hợp lệ) |
| 404 | RESOURCE_NOT_FOUND | Ca làm việc, bệnh nhân không tồn tại; PATIENT chưa có hồ sơ liên kết; xem lịch hẹn ngoài ownership |
| 409 | SLOT_ALREADY_BOOKED | Khung giờ (slot) của bác sĩ đã được người khác đặt trước |
| 409 | SCHEDULE_BLOCKED | Ca làm việc đang bị khóa (BLOCKED), không nhận đặt hẹn |
| 409 | DOCTOR_INACTIVE | Bác sĩ của ca làm việc đang ngừng hoạt động (`isActive = false`) |
| 409 | USER_NOT_ACTIVE | Tài khoản người dùng liên kết với bác sĩ đang bị khóa (`DISABLED`) |
| 409 | PATIENT_INACTIVE | Hồ sơ bệnh nhân đang ngừng hoạt động (`isActive = false`) |
| 409 | IDEMPOTENCY_CONFLICT | Dùng lại `requestKey` nhưng nội dung payload đặt hẹn khác với lần gửi trước |
| 409 | SCHEDULE_HAS_APPOINTMENTS | Không thể khóa hoặc điều chỉnh thời gian ca làm việc khi đã có lịch hẹn phát sinh |

### 3.6. Quản lý Đổi lịch và Hủy lịch khám (CL-D08-BE) — IMPLEMENTED D08

Chức năng hoàn thiện quy trình đổi lịch và hủy lịch khám (FR-07/FR-08 foundation), kế thừa cấu trúc từ D07 với bảo vệ concurrency và optimistic locking:

| Endpoint | Method | ADMIN | RECEPTIONIST | DOCTOR | PATIENT |
| --- | --- | --- | --- | --- | --- |
| `/api/v1/appointments/{id}/slot` | PATCH | 403 ACCESS_DENIED | Cho phép (đổi lịch mọi cuộc hẹn) | 403 ACCESS_DENIED | Cho phép (chỉ đổi lịch cuộc hẹn linked của mình) |
| `/api/v1/appointments/{id}/cancellation` | POST | 403 ACCESS_DENIED | Cho phép (hủy lịch mọi cuộc hẹn) | 403 ACCESS_DENIED | Cho phép (chỉ hủy lịch cuộc hẹn linked của mình) |

**PATCH /api/v1/appointments/{id}/slot — PATIENT/RECEPTIONIST, 200**

Payload đổi slot:
```json
{
  "scheduleId": "100",
  "startAt": "2026-11-25T09:00:00Z",
  "expectedVersion": 0
}
```

Response 200:
```json
{
  "data": {
    "id": "1001",
    "appointmentCode": "APP123456",
    "patientId": "50",
    "patientCode": "PAT123456",
    "patientFullName": "Nguyen Van A",
    "patientPhone": "0901234567",
    "doctorId": "1",
    "doctorCode": "DOC_001",
    "doctorFullName": "Bac Si B",
    "specialtyName": "Noi Khoa",
    "scheduleId": "100",
    "startAt": "2026-11-25T09:00:00Z",
    "endAt": "2026-11-25T09:30:00Z",
    "status": "PENDING",
    "reason": "Khám tổng quát định kỳ",
    "cancelledAt": null,
    "cancelledBy": null,
    "cancellationReason": null,
    "rescheduledAt": "2026-11-21T11:00:00Z",
    "rescheduledBy": "50",
    "previousScheduleId": "99",
    "previousStartAt": "2026-11-25T08:00:00Z",
    "createdBy": "50",
    "version": 1,
    "createdAt": "2026-11-21T10:30:00Z",
    "updatedAt": "2026-11-21T11:00:00Z"
  }
}
```

**POST /api/v1/appointments/{id}/cancellation — PATIENT/RECEPTIONIST, 200**

Payload hủy lịch:
```json
{
  "reason": "Không thể đến khám đúng giờ",
  "expectedVersion": 0
}
```

Response 200:
```json
{
  "data": {
    "id": "1001",
    "appointmentCode": "APP123456",
    "patientId": "50",
    "patientCode": "PAT123456",
    "patientFullName": "Nguyen Van A",
    "patientPhone": "0901234567",
    "doctorId": "1",
    "doctorCode": "DOC_001",
    "doctorFullName": "Bac Si B",
    "specialtyName": "Noi Khoa",
    "scheduleId": "100",
    "startAt": "2026-11-25T09:00:00Z",
    "endAt": "2026-11-25T09:30:00Z",
    "status": "CANCELLED",
    "reason": "Khám tổng quát định kỳ",
    "cancelledAt": "2026-11-21T11:05:00Z",
    "cancelledBy": "50",
    "cancellationReason": "Không thể đến khám đúng giờ",
    "rescheduledAt": null,
    "rescheduledBy": null,
    "previousScheduleId": null,
    "previousStartAt": null,
    "createdBy": "50",
    "version": 1,
    "createdAt": "2026-11-21T10:30:00Z",
    "updatedAt": "2026-11-21T11:05:00Z"
  }
}
```

**Quy tắc nghiệp vụ & Concurrency D08**:
1. **Trạng thái hợp lệ**: Chỉ cho phép đổi slot hoặc hủy khi cuộc hẹn có trạng thái `PENDING` hoặc `CONFIRMED` và thời gian khám chưa bắt đầu (`startAt > now`). Vi phạm trả 409 `INVALID_STATE_TRANSITION`.
2. **Đổi slot**:
   - Đổi slot thành công luôn chuyển trạng thái cuộc hẹn về `PENDING` để xác nhận lại.
   - Ghi nhận đầy đủ metadata đổi lịch theo migration V7: `rescheduled_at` (thời điểm UTC), `rescheduled_by` (người thực hiện), `previous_schedule_id` (ca cũ) và `previous_start_at_utc` (slot cũ).
   - Không thay đổi `doctorId`, `patientId`, `createdBy`, `requestKey`, `requestFingerprint` hoặc `reason` ban đầu.
   - Không cho phép đổi sang ca của bác sĩ khác trong D08 (slot mới phải thuộc ca `ACTIVE` của cùng bác sĩ; đổi sang bác sĩ khác trả 400 `VALIDATION_FAILED`).
   - Slot mới phải khớp lưới slot (`(startAt - schedule.startAt) % slotMinutes == 0`) và nằm trong khung giờ làm việc của ca.
   - Slot cũ được giải phóng ngay khi chuyển sang slot mới. Nếu đổi slot thất bại, toàn bộ giao dịch rollback, giữ nguyên vẹn lịch cũ.
3. **Hủy lịch & Giải phóng slot**:
   - Chuyển trạng thái sang `CANCELLED`.
   - Ghi nhận đầy đủ metadata hủy theo migration V7: `cancelled_at` (thời điểm UTC), `cancelled_by` (người thực hiện) và `cancellation_reason` (lý do hủy, bắt buộc, tối đa 255 ký tự; 255 ký tự hợp lệ, 256 ký tự trả 400 `VALIDATION_FAILED`).
   - Giữ nguyên `reason` đặt khám ban đầu của cuộc hẹn (không bị ghi đè bởi lý do hủy).
   - Cột sinh `active_slot_start_utc` của migration V6 tự động nhận giá trị `NULL` khi `status = 'CANCELLED'`, giải phóng slot cho người khác đặt lại mà vẫn bảo toàn đầy đủ dữ liệu lịch sử cuộc hẹn.
   - Không xóa bản ghi `appointments` khỏi cơ sở dữ liệu.
4. **Optimistic Locking & Xử lý hủy lặp**:
   - Request bắt buộc truyền `expectedVersion` (số nguyên >= 0).
   - Nếu `expectedVersion` không khớp với version hiện tại trong DB: trả 409 `VERSION_CONFLICT`.
   - Nếu gửi yêu cầu hủy lặp lại:
     - Gửi lại với `expectedVersion` cũ (stale version): trả 409 `VERSION_CONFLICT`.
     - Gửi với `expectedVersion` mới trên cuộc hẹn đã `CANCELLED`: trả 409 `INVALID_STATE_TRANSITION` ("Appointment is already cancelled.").
5. **Serialization qua Khóa Doctor**:
   - Mọi thao tác đổi lịch và hủy lịch đều tái sử dụng khóa bi quan `PESSIMISTIC_WRITE` trên entity `Doctor` cha (`doctorRepository.findLocked(doctorId)`).
   - Đảm bảo chống race condition hoàn toàn giữa:
     - Reschedule vs Booking đồng thời.
     - Reschedule vs Cancellation đồng thời.
     - Reschedule vs Schedule PATCH (`BLOCKED`/thay đổi giờ).
6. **Bảo mật và Phân quyền (RBAC & Ownership)**:
   - `RECEPTIONIST`: Được phép đổi slot và hủy bất kỳ cuộc hẹn nào.
   - `PATIENT`: Chỉ được phép đổi slot và hủy cuộc hẹn thuộc về hồ sơ bệnh nhân liên kết chính mình (`GET /api/v1/me/patient-profile`). Truy cập vào cuộc hẹn của bệnh nhân khác trả về 404 `RESOURCE_NOT_FOUND` (không rò rỉ sự tồn tại của cuộc hẹn).
   - `ADMIN` và `DOCTOR`: Chỉ có quyền đọc (GET); gọi PATCH slot hoặc POST cancellation trả về 403 `ACCESS_DENIED`.

**Bảng mã lỗi D08 bổ sung**

| HTTP | Code | Trường hợp |
| --- | --- | --- |
| 400 | VALIDATION_FAILED / HTTP_400 | `scheduleId` rỗng/sai định dạng; `startAt` quá khứ/lệch lưới/ngoài ca; `expectedVersion` âm; `reason` hủy rỗng/vượt quá 500 ký tự; đổi ca sang bác sĩ khác |
| 401 | AUTHENTICATION_REQUIRED / INVALID_ACCESS_TOKEN | Chưa xác thực hoặc Bearer token không hợp lệ/hết hạn |
| 403 | ACCESS_DENIED | ADMIN hoặc DOCTOR thực hiện đổi slot hoặc hủy cuộc hẹn |
| 404 | RESOURCE_NOT_FOUND | Cuộc hẹn không tồn tại; PATIENT đổi/hủy cuộc hẹn nằm ngoài sở hữu; ca mới không tồn tại |
| 409 | VERSION_CONFLICT | Phiên bản `expectedVersion` không khớp với phiên bản hiện tại (bị sửa đồng thời hoặc stale update) |
| 409 | INVALID_STATE_TRANSITION | Cuộc hẹn không ở trạng thái `PENDING`/`CONFIRMED`, hoặc thời gian khám đã trôi qua/đang diễn ra, hoặc hủy lặp trên lịch đã `CANCELLED` |
| 409 | SLOT_ALREADY_BOOKED | Slot mới khi đổi lịch đã có cuộc hẹn khác đang hoạt động chiếm chỗ |
| 409 | SCHEDULE_BLOCKED | Ca làm việc mới đang bị khóa (BLOCKED) |
| 409 | DOCTOR_INACTIVE | Bác sĩ của cuộc hẹn ngừng hoạt động |
| 409 | USER_NOT_ACTIVE | Tài khoản người dùng của bác sĩ bị khóa |
| 409 | PATIENT_INACTIVE | Hồ sơ bệnh nhân của cuộc hẹn ngừng hoạt động |

### 3.7. Tiếp nhận, Xác nhận lịch, Check-in và Đánh dấu Vắng mặt (CL-D09-BE) — IMPLEMENTED D09

Hoàn thiện quy trình tiếp đón và quản lý trạng thái tiếp nhận bệnh nhân tại phòng khám (FR-08), kế thừa cấu trúc từ D07/D08 với bảo vệ concurrency, optimistic locking và Flyway migration V8:

| Endpoint | Method | ADMIN | RECEPTIONIST | DOCTOR | PATIENT |
| --- | --- | --- | --- | --- | --- |
| `/api/v1/appointments/{id}/confirmation` | POST | 403 ACCESS_DENIED | Cho phép | 403 ACCESS_DENIED | 403 ACCESS_DENIED |
| `/api/v1/appointments/{id}/check-in` | POST | 403 ACCESS_DENIED | Cho phép | 403 ACCESS_DENIED | 403 ACCESS_DENIED |
| `/api/v1/appointments/{id}/no-show` | POST | 403 ACCESS_DENIED | Cho phép | 403 ACCESS_DENIED | 403 ACCESS_DENIED |

**POST /api/v1/appointments/{id}/confirmation — RECEPTIONIST, 200**

Payload:
```json
{
  "expectedVersion": 0
}
```

- Chuyển trạng thái từ `PENDING` -> `CONFIRMED`.
- Thời điểm thực hiện phải trước giờ khám (`startAtUtc > now`). Vi phạm trả 409 `INVALID_STATE_TRANSITION`.
- Ghi nhận `confirmed_at` (UTC) và `confirmed_by` (ID lễ tân) trong cùng transaction.
- Tăng `version` để bảo vệ optimistic locking.
- Trả về 200 `{"data": AppointmentResponse}`.

**POST /api/v1/appointments/{id}/check-in — RECEPTIONIST, 200**

Payload:
```json
{
  "expectedVersion": 1
}
```

- Chuyển trạng thái từ `CONFIRMED` -> `CHECKED_IN`.
- Không cho phép check-in trực tiếp từ `PENDING` (trả 409 `INVALID_STATE_TRANSITION`).
- Thời điểm check-in hợp lệ: trong ngày khám theo múi giờ `Asia/Ho_Chi_Minh` và trước khi ca/slot khám kết thúc (`now < endAtUtc`). Vi phạm trả 409 `INVALID_STATE_TRANSITION`.
- Check-in lặp: Gửi lại yêu cầu check-in trên lịch đã `CHECKED_IN` sẽ trả về lịch hiện tại (HTTP 200), không ghi nhận thêm lần check-in hay tăng version.
- Ghi nhận `checked_in_at` (UTC) và `checked_in_by` (ID lễ tân) trong cùng transaction.
- Tăng `version` với thao tác chuyển trạng thái mới.
- Cuộc hẹn đã `CHECKED_IN` không được phép đổi slot hoặc hủy lịch.
- Trả về 200 `{"data": AppointmentResponse}`.

**POST /api/v1/appointments/{id}/no-show — RECEPTIONIST, 200**

Payload:
```json
{
  "expectedVersion": 1
}
```

- Chuyển trạng thái từ `CONFIRMED` -> `NO_SHOW`.
- Thời điểm thực hiện phải sau khi slot khám đã kết thúc (`now > endAtUtc`). Vi phạm trả 409 `INVALID_STATE_TRANSITION`.
- Ghi nhận `no_show_at` (UTC) và `no_show_by` (ID lễ tân) trong cùng transaction.
- Tăng `version` để bảo vệ optimistic locking.
- Không thể chuyển lùi hoặc đổi slot/hủy trên lịch đã `NO_SHOW`.
- Trả về 200 `{"data": AppointmentResponse}`.

**Quy tắc nghiệp vụ & Concurrency D09**:
1. **Phân quyền nghiêm ngặt**: Chỉ `RECEPTIONIST` có quyền thực hiện. Các vai trò `ADMIN`, `DOCTOR`, `PATIENT` đều bị từ chối với 403 `ACCESS_DENIED`. Chưa đăng nhập trả 401 `AUTHENTICATION_REQUIRED`.
2. **Khóa đồng thời đa tầng**: Tái sử dụng khóa bi quan `PESSIMISTIC_WRITE` trên entity `Doctor` cha và kiểm soát phiên bản lạc quan qua `@Version`.
3. **Idempotency & Check-in trùng request**: Hai request check-in đồng thời hoặc check-in lặp đều trả về 200 OK với trạng thái `CHECKED_IN` mà không gây xung đột hay lỗi dữ liệu.
4. **Bảo toàn dữ liệu**: Không can thiệp hoặc thay đổi `appointment.reason` khám ban đầu, không tạo hồ sơ bệnh án (medical record) tại D09.
5. **Schema Migration V8**: Thêm các cột `confirmed_at`, `confirmed_by`, `checked_in_at`, `checked_in_by`, `no_show_at`, `no_show_by` cùng các khóa ngoại và check constraints tương ứng, giữ nguyên vẹn logic generated column và unique slot của V6.

### 3.8 Hồ sơ khám (CL-D10-BE) — IMPLEMENTED D10

| Method | Path dưới `/api/v1` | Thành công |
| --- | --- | --- |
| POST | `/medical-records` | 201, Location, hồ sơ nháp |
| GET | `/medical-records/{id}` | 200, DTO theo quyền |
| GET | `/medical-records/by-appointment/{id}` | 200, DTO theo quyền, tra bằng appointmentId |
| PATCH | `/medical-records/{id}` | 200, hồ sơ sau cập nhật |
| POST | `/medical-records/{id}/completion` | 200, hồ sơ hoàn tất |

- POST tạo nhận `{"appointmentId":"100"}`. DOCTOR được phân công mới có thể tạo từ
  appointment `CHECKED_IN`. Tạo hồ sơ version 0 và chuyển appointment sang `IN_PROGRESS`
  trong cùng transaction. Một appointment có tối đa một hồ sơ, kể cả khi gửi đồng thời.
- FE tải lại appointment đang IN_PROGRESS bằng GET `/medical-records/by-appointment/{appointmentId}`.
  Response dùng cùng DTO và RBAC với GET theo record ID. `data.id` là medicalRecordId,
  `data.version` là expectedVersion để lưu tiếp. Chưa có hồ sơ hoặc ngoài scope trả 404
  RESOURCE_NOT_FOUND, thiếu JWT trả 401, ID không hợp lệ trả 400. ADMIN/RECEPTIONIST chỉ nhận metadata.
  Khi gặp 409 sau lưu/hoàn tất, FE tải lại hồ sơ và đối chiếu thay đổi trước khi gửi lại.
  Không dùng POST tạo để tiếp tục hồ sơ đã mở. POST chỉ nhận appointmentId, trường thừa trả 400 HTTP_400.
- PATCH nhận `expectedVersion` (số nguyên không âm, bắt buộc) và ít nhất một trường khác
  null trong `symptoms`, `diagnosis`, `notes`, `conclusion`. Bỏ qua hoặc gửi null
  giữ nguyên trường. Chuỗi rỗng hoặc toàn khoảng trắng xóa giá trị. Mỗi chuỗi tối đa
  5.000 đơn vị UTF-16 trước khi bỏ khoảng trắng đầu/cuối. Hồ sơ phải đang `IN_PROGRESS`.
- POST completion nhận `{"expectedVersion":1}`. Bắt buộc có triệu chứng, chẩn đoán
  và kết luận khác rỗng. Backend ghi `completedAt`, `completedBy` cùng với chuyển
  appointment sang `COMPLETED` trong cùng transaction. Bản hoàn tất không cho sửa trực tiếp.
- DOCTOR chỉ đọc và ghi hồ sơ của appointment được phân công. Từ D11, PATIENT chỉ đọc hồ sơ đã
  hoàn tất và công bố của patient đang liên kết với chính tài khoản JWT. ADMIN và RECEPTIONIST chỉ
  đọc metadata. Backend lấy bác sĩ, bệnh nhân và người ghi từ DB, không nhận các ID đó trong payload ghi.

`data` của mọi response thành công chứa metadata
`id`, `appointmentId`, `doctorId`, `patientId`, `status`, `createdBy`, `completedBy`,
`createdAt`, `updatedAt`, `completedAt`, `version`. ID là chuỗi, timestamp ISO-8601 UTC.
`completedAt` và `completedBy` là null trước khi hoàn tất. `status` lấy từ appointment.
Từ D11, metadata còn có `releasedAt` và `releasedBy`, cùng null trước khi công bố.
DOCTOR và PATIENT đủ quyền còn nhận bốn trường lâm sàng ở cùng cấp trong `data`.
DTO của ADMIN/RECEPTIONIST không chứa các trường lâm sàng. Response có `Cache-Control: no-store`.
PATCH và completion thành công tăng phiên bản hồ sơ. Phiên bản này độc lập với version của appointment.

| HTTP | Code | Trường hợp |
| --- | --- | --- |
| 400 | VALIDATION_FAILED / HTTP_400 | ID, JSON, version hoặc nội dung sai, thiếu trường khi hoàn tất |
| 401 | AUTHENTICATION_REQUIRED / INVALID_ACCESS_TOKEN | JWT thiếu hoặc không hợp lệ |
| 403 | ACCESS_DENIED | Role không được phép thực hiện thao tác |
| 404 | RESOURCE_NOT_FOUND | Không tìm thấy hoặc ngoài quyền đọc/ghi, gồm PATIENT đọc nháp |
| 409 | INVALID_STATE_TRANSITION | Sai trạng thái, tạo lặp hoặc sửa/hoàn tất lại hồ sơ đã hoàn tất |
| 409 | VERSION_CONFLICT / MEDICAL_RECORD_CONFLICT | Phiên bản đã đổi hoặc xung đột ràng buộc DB |

Lỗi dùng Problem Details hiện có, không trả nội dung lâm sàng hay chi tiết SQL.

### 3.9 Lịch sử khám và công bố hồ sơ — IMPLEMENTED D11

D11 thay đổi quyền PATIENT so với SRS/D10 ở mục 3.8. Chính sách đích yêu cầu hồ sơ
vừa COMPLETED vừa được bác sĩ công bố trước khi PATIENT đọc nội dung. Completion
không tự công bố. Policy chuyển đổi V10 của QA giữ quyền đọc D10 bằng backfill hồ sơ
cũ của appointment COMPLETED có completed_at/completed_by hợp lệ. Các hồ sơ này có
released_at = completed_at và released_by = completed_by, giữ nội dung, version và
timestamps cũ. Đây là ghi nhận quyền lịch sử, không khẳng định bác sĩ đã bấm release.
Hồ sơ mới sau V10 cần công bố riêng. Điều kiện đọc áp dụng đồng thời cho GET theo
record ID, lookup theo appointment và lịch sử khám.

Đã tích hợp nguyên bản QA `V10__add_medical_record_release.sql`, blob Git
`5fb22038f4fafd55dff64d72d654666d4b75b03c`, có trên remote dev tại commit
`bbdd149e30948904e1fe7ac5a1d92109ed54eed3`. SHA-256
`c2d3b6ab3688701fa8454849a5b89b4ac360f7fbe1ffe5bd47c2e06fb478893b`.
Đã bỏ cơ chế fixture thay schema MySQL. Fixture H2 chỉ phục vụ test H2.

| Endpoint D11 | Mục đích | Trạng thái |
| --- | --- | --- |
| GET `/api/v1/patients/{id}/medical-history` | Lịch sử phân trang trong phạm vi quyền | IMPLEMENTED D11 |
| POST `/api/v1/medical-records/{id}/release` | DOCTOR assigned công bố bản hoàn tất với expectedVersion | IMPLEMENTED D11 |

Quyết định BE D11 theo yêu cầu tiếp tục triển khai

- V10 do QA sở hữu. BE giữ Hibernate ddl-auto validate.
- DOCTOR chỉ nhận lịch sử của lượt do chính mình được phân công. Phân công chỉ gồm
  appointment khác CANCELLED/NO_SHOW. Không có phân công hợp lệ trả 404. PATIENT
  đổi patientId sang người khác nhận 404. ADMIN/RECEPTIONIST đọc metadata.
- Công bố lặp với expectedVersion hiện tại trả 200, không thay thời điểm/người công bố
  hoặc tăng version. Version cũ trả 409 VERSION_CONFLICT. Hai request cùng version
  chỉ một request ghi thành công. API lỗi tiếp tục dùng 400/401/403/404/409 và Problem Details.

Mapping theo V10

- V10 bổ sung `released_at DATETIME(6) NULL`, `released_by BIGINT NULL` FK users,
  hai giá trị cùng null hoặc cùng có giá trị, khi công bố phải có completed_at/completed_by,
  thời điểm công bố không trước completed_at. FK users dùng ON DELETE/UPDATE RESTRICT,
  có index released_by. Bản nháp và bản hoàn tất mới sau V10 giữ null đến khi release.
- Release nhận `{"expectedVersion":1}`, trả 200 `{"data":{...}}` với metadata công bố
  và version mới. Kiểm tra version trước ghi, version cũ trả 409.
- History nhận `page=0&size=20`, size 1–100, chỉ liệt kê lượt đã hoàn tất trong phạm vi
  quyền, sắp xếp `completedAt DESC, id DESC`. Envelope dùng
  `{"data":{"items":[],"page":0,"size":20,"totalElements":0,"totalPages":0}}`.
  Dùng projection metadata và count có cùng bộ lọc quyền để tránh N+1 và lộ tổng số bản ghi ngoài scope.

Ví dụ response công bố (các trường lâm sàng chỉ có với DOCTOR được phép)

```json
{"data":{"id":"10","appointmentId":"100","doctorId":"2","patientId":"3","status":"COMPLETED","createdBy":"8","completedBy":"8","completedAt":"2026-11-22T03:00:00Z","createdAt":"2026-11-22T02:00:00Z","updatedAt":"2026-11-22T04:00:00Z","version":2,"releasedAt":"2026-11-22T04:00:00Z","releasedBy":"8","symptoms":"Synthetic symptoms","diagnosis":"Synthetic diagnosis","notes":null,"conclusion":"Synthetic conclusion"}}
```

Ví dụ history item (mọi role nhận DTO metadata, không có nội dung lâm sàng)

```json
{"data":{"items":[{"id":"10","appointmentId":"100","doctorId":"2","completedAt":"2026-11-22T03:00:00Z","releasedAt":"2026-11-22T04:00:00Z","version":2}],"page":0,"size":20,"totalElements":1,"totalPages":1}}
```

Lịch sử cần lọc quyền tại truy vấn trước count/phân trang, sắp xếp thời gian kèm ID
để thứ tự ổn định. DTO danh sách chỉ chứa metadata cần thiết, các trường ID là string,
timestamp UTC, response data wrapper và Cache-Control no-store. PATIENT chỉ thấy
bản thân và các hồ sơ đã công bố. ADMIN/RECEPTIONIST không nhận nội dung lâm sàng.

### 3.10 Quản lý Đơn thuốc Mô phỏng (CL-D12-BE) — IMPLEMENTED D12

Triển khai API quản lý đơn thuốc mô phỏng (FR-11) liên kết 1-1 với hồ sơ khám (MedicalRecord D10–D11). Phục vụ kê đơn mô phỏng trong quá trình khám chữa bệnh tại phòng khám.

> [!NOTE]
> Nghiêm cấm quản lý kho dược, xuất nhập tồn, bán lẻ thuốc, liên thông đơn thuốc điện tử quốc gia hoặc gợi ý AI tự động kê đơn. Dữ liệu mang tính chất mô phỏng nghiệp vụ (`simulation: true`).

| Endpoint D12 | Method | Quyền truy cập | Mục đích | Trạng thái |
| --- | --- | --- | --- | --- |
| `/api/v1/medical-records/{id}/prescription` | `GET` | DOCTOR assigned / PATIENT self đã công bố | Đọc thông tin đơn thuốc mô phỏng | **IMPLEMENTED D12** |
| `/api/v1/medical-records/{id}/prescription` | `PUT` | DOCTOR assigned | Tạo mới / Cập nhật toàn bộ đơn thuốc mô phỏng | **IMPLEMENTED D12** |

#### Quy tắc nghiệp vụ và ràng buộc:
- **Phân quyền & Kiểm soát truy cập (RBAC & Ownership):**
  - `DOCTOR (assigned)`: Được phép `GET` và `PUT` khi ca khám đang diễn ra (`IN_PROGRESS`). Khi ca khám đang diễn ra, cờ `editable: true`. Khi hồ sơ đã hoàn tất (`COMPLETED`), `editable: false` và không được phép `PUT` nữa (trả 409 `INVALID_STATE_TRANSITION`).
  - `PATIENT (self)`: Chỉ được phép `GET` khi hồ sơ khám đồng thời đạt hai điều kiện: `COMPLETED` và đã được công bố (`releasedAt != null`). Nếu hồ sơ chưa hoàn tất hoặc chưa công bố, trả 404 `NOT_FOUND` (ngăn rò rỉ thông tin trước khi bác sĩ phát hành). Bệnh nhân luôn nhận `editable: false`.
  - `ADMIN` & `RECEPTIONIST`: Bị từ chối truy cập (403 `ACCESS_DENIED`).
  - Bác sĩ khác hoặc bệnh nhân khác: Trả 404 `NOT_FOUND` (ngăn rò rỉ ID và sự tồn tại của hồ sơ).
- **Concurrency & Khóa bi quan/lạc quan (Optimistic Locking):**
  - Request `PUT` bắt buộc mang `expectedVersion` tương ứng với version hiện tại của `MedicalRecord`. Nếu version không khớp, trả 409 `VERSION_CONFLICT`.
  - Khi lưu đơn thuốc thành công, version của `MedicalRecord` được tự động tăng lên 1 (touch entity version).
  - Hai request `PUT` đồng thời mang cùng `expectedVersion` thì chỉ 1 request thành công (200), request còn lại bị xung đột phiên bản (409).
  - Request `PUT` đồng thời với `POST /completion` thì chỉ 1 thao tác thành công (200), thao tác còn lại trả 409.
- **Ràng buộc dữ liệu (Validation):**
  - `expectedVersion`: Bắt buộc, số nguyên không âm (`min = 0`).
  - `items`: Danh sách từ 0 đến tối đa 50 thuốc. Cho phép gửi danh sách rỗng `[]` để xóa toàn bộ thuốc trong đơn.
  - Mỗi item trong danh sách:
    - `medicationName`: Bắt buộc, chuỗi không trống, độ dài 1–200 ký tự (tự động cắt khoảng trắng thừa).
    - `quantity`: Bắt buộc, số nguyên từ 1 đến 10,000.
    - `dosage`: Bắt buộc, chuỗi không trống, độ dài 1–100 ký tự.
    - `frequency`: Bắt buộc, chuỗi không trống, độ dài 1–100 ký tự.
    - `durationDays`: Bắt buộc, số nguyên từ 1 đến 365 ngày.
    - `instructions`: Tùy chọn, tối đa 1,000 ký tự (chuỗi rỗng được chuẩn hóa thành `null`).
  - Vi phạm bất kỳ điều kiện nào ở trên trả 400 `VALIDATION_FAILED` theo chuẩn Problem Details.
- **Header & Cache:** Cả hai endpoint đều trả header `Cache-Control: no-store`.

#### Ví dụ Request PUT `/api/v1/medical-records/{id}/prescription`:
```json
{
  "expectedVersion": 1,
  "items": [
    {
      "medicationName": "Paracetamol 500mg",
      "quantity": 10,
      "dosage": "500mg",
      "frequency": "2 lần/ngày",
      "durationDays": 5,
      "instructions": "Uống sau khi ăn"
    },
    {
      "medicationName": "Vitamin C 100mg",
      "quantity": 20,
      "dosage": "100mg",
      "frequency": "1 lần/ngày",
      "durationDays": 10,
      "instructions": null
    }
  ]
}
```

#### Ví dụ Response (200 OK):
```json
{
  "data": {
    "id": "1",
    "medicalRecordId": "10",
    "recordVersion": 2,
    "editable": true,
    "simulation": true,
    "items": [
      {
        "id": "1",
        "medicationName": "Paracetamol 500mg",
        "quantity": 10,
        "dosage": "500mg",
        "frequency": "2 lần/ngày",
        "durationDays": 5,
        "instructions": "Uống sau khi ăn"
      },
      {
        "id": "2",
        "medicationName": "Vitamin C 100mg",
        "quantity": 20,
        "dosage": "100mg",
        "frequency": "1 lần/ngày",
        "durationDays": 10,
        "instructions": null
      }
    ]
  }
}
```

Khi chưa có đơn thuốc nào được lưu, `GET` trả `id: null`, `items: []`, `editable: true` (hoặc `false` nếu đã hoàn tất), `simulation: true`:
```json
{
  "data": {
    "id": null,
    "medicalRecordId": "10",
    "recordVersion": 1,
    "editable": true,
    "simulation": true,
    "items": []
  }
}
```

### 3.11 Dashboard và thông báo trong ứng dụng — IMPLEMENTED D13, MySQL V12 PENDING

#### Dashboard

`GET /api/v1/dashboard/summary?from=2026-11-22&to=2026-11-22`

- ADMIN và RECEPTIONIST nhận số liệu toàn phòng khám. DOCTOR chỉ nhận appointment
  có doctor.user.id trùng principal. PATIENT nhận 403. Tham số doctorId do client
  gửi không thay đổi phạm vi của DOCTOR.
- from/to là ngày ISO tại Asia/Ho_Chi_Minh, mỗi tham số bỏ qua mặc định ngày hiện tại
  tại Việt Nam. from <= to, khoảng gồm hai đầu tối đa 366 ngày. Để biểu diễn được
  toàn bộ khoảng UTC trong MySQL DATETIME, hỗ trợ ngày từ 1000-01-02 đến 9999-12-31.
  Ngày hoặc khoảng sai trả 400.
- Backend chuyển sang [đầu ngày from UTC, đầu ngày sau to UTC), lọc theo startAt.
  appointmentsByStatus gồm đầy đủ bảy trạng thái, kể cả CANCELLED/NO_SHOW, tổng bằng
  totalAppointments. checkedInCount đếm checkedInAt khác null trong tập đã lọc,
  completedCount đếm status COMPLETED, uniquePatients dùng COUNT(DISTINCT patient_id).
  Hai truy vấn aggregate trong cùng transaction REPEATABLE_READ, không load entities
  để đếm và không JOIN bảng notifications.
- Response không có thông tin định danh bệnh nhân hoặc nội dung lâm sàng.

```json
{"data":{"from":"2026-11-22","to":"2026-11-22","timezone":"Asia/Ho_Chi_Minh","totalAppointments":0,"appointmentsByStatus":{"PENDING":0,"CONFIRMED":0,"CHECKED_IN":0,"IN_PROGRESS":0,"COMPLETED":0,"CANCELLED":0,"NO_SHOW":0},"checkedInCount":0,"completedCount":0,"uniquePatients":0}}
```

#### Notifications

`GET /api/v1/notifications?page=0&size=20` cho cả bốn role có JWT hợp lệ.
Chỉ trả người nhận hiện tại, page >= 0, size 1–100, sắp createdAt DESC rồi id DESC.
unreadCount là tổng chưa đọc của chính người dùng, không phụ thuộc trang hiện tại.
Trang vượt dữ liệu trả items rỗng, giữ totalElements/totalPages/unreadCount.

```json
{"data":{"items":[{"id":"1","appointmentId":"100","appointmentCode":"APP123456","eventType":"APPOINTMENT_CREATED","title":"Appointment booked","body":"Appointment booked: APP123456","createdAt":"2026-11-22T02:00:00Z","readAt":null}],"page":0,"size":20,"totalElements":1,"totalPages":1,"unreadCount":1}}
```

`PATCH /api/v1/notifications/{id}/read` không yêu cầu request body hoặc recipientUserId.
Trả 200 với data là notification DTO ở trên và readAt UTC. Lần đầu ghi readAt,
các lần sau giữ nguyên giá trị. Khóa row theo id và recipient bảo đảm hai request
đồng thời cùng nhận kết quả đã đọc. ID người khác hoặc không tồn tại trả 404.

#### Mutation và migration

- Booking sinh APPOINTMENT_CREATED, đổi lịch sinh APPOINTMENT_RESCHEDULED, hủy lịch sinh
  APPOINTMENT_CANCELLED, xác nhận sinh APPOINTMENT_CONFIRMED. Không sinh event từ check-in/no-show.
- Người nhận là user PATIENT liên kết và user DOCTOR được phân công, status ACTIVE,
  role đúng. Khi chuyển bác sĩ, publisher xét cả bác sĩ cũ và mới rồi dedupe theo user ID.
  Luồng reschedule D08 hiện vẫn chỉ cho đổi slot cùng bác sĩ. Không phát hàng loạt cho staff.
- Chỉ dùng template title/body cố định với appointmentCode. Không chép reason, tên bệnh nhân,
  triệu chứng, chẩn đoán hoặc thuốc vào thông báo.
- Sau saveAndFlush appointment, event key là
  `appointment:{id}:version:{postChangeVersion}:event:{eventType}`.
  UNIQUE(recipient_user_id,event_key) bảo vệ DB. Notification dùng transaction MANDATORY
  chung mutation. Lỗi ghi notification trả 409 NOTIFICATION_CONFLICT và rollback toàn bộ.
  Booking replay không phát event, kể cả appointment đã có version mới.
- Reschedule PENDING tới đúng schedule/start/end hiện tại trả resource hiện có, giữ
  version và không phát event. Xác nhận/hủy sai trạng thái hoặc version vẫn bị từ chối
  theo D08/D09. Không backfill thông báo lịch sử.
- Mapping đối chiếu file V12 của QA gồm notifications với recipient_user_id, appointment_id,
  event_type VARCHAR(32), event_key VARCHAR(128), title VARCHAR(160), body VARCHAR(500) nullable,
  created_at DATETIME(6), read_at DATETIME(6) nullable, hai FK RESTRICT và unique recipient/event.
  V12 hiện chưa đồng bộ vào BE. MySQL V12 PENDING, fixture H2 không thay thế nghiệm thu migration thật.

Mọi response thành công dùng data wrapper, ID string, timestamp UTC và Cache-Control no-store.
401 cho thiếu/sai JWT, 403 cho sai quyền Dashboard, 404 cho notification ngoài owner,
400 cho ngày/pagination/ID sai. Lỗi tiếp tục dùng Problem Details.

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
  D02 đã có RegisterRequest/LoginRequest; D07 đã có AppointmentBookRequest.

Ví dụ validation **trên endpoint nghiệp vụ**:

```json
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "detail": "Bad Request",
  "instance": "/api/v1/appointments",
  "code": "VALIDATION_FAILED",
  "errors": [{"field":"scheduleId","message":"Schedule ID is required."}]
}
```

D03 đã triển khai `RESOURCE_NOT_FOUND` và các mã catalog ở mục 3.2; D06 có `SCHEDULE_OVERLAP`;
D07 có `SLOT_ALREADY_BOOKED`, `IDEMPOTENCY_CONFLICT`, `SCHEDULE_HAS_APPOINTMENTS`.
`INVALID_STATE_TRANSITION` và `VERSION_CONFLICT` đã dùng trong luồng lịch hẹn và hồ sơ khám.

## 5. Phân quyền và trạng thái bảo mật

| Vai trò | Quyền dự kiến | Giới hạn dữ liệu |
| --- | --- | --- |
| ADMIN | Quản trị tài khoản, danh mục, lịch, dashboard, báo cáo, audit | Không mặc nhiên sửa hồ sơ chuyên môn hoặc đơn thuốc |
| DOCTOR | Xem lịch được phân công, khám, đơn thuốc mô phỏng | Hồ sơ do mình khám; lịch sử cần thiết của bệnh nhân được phân công theo policy đã duyệt |
| RECEPTIONIST | Hồ sơ hành chính bệnh nhân, lịch, xác nhận, check-in | Chỉ metadata vận hành của hồ sơ khám; không sửa chẩn đoán/đơn thuốc |
| PATIENT | Hồ sơ cá nhân, đặt/đổi/hủy lịch và lịch sử của mình | Kiểm tra ownership ở BE; không tin patientId từ client |

**IMPLEMENTED đến D11:** GET health và POST register/login public; GET auth/me, GET/PATCH me/profile,
GET/POST patients, GET/PATCH patients/{id}, GET me/patient-profile, GET eligible-users,
GET/POST/PATCH doctors và specialties, POST/GET/PATCH doctor-schedules, GET schedule-slots
(đã loại bỏ slot bị chiếm), POST/GET/GET-{id} appointments theo đúng RBAC, ownership,
double booking prevention (pessimistic lock + DB unique constraint), idempotency và scope bảo mật đã duyệt.
Các thao tác đổi/hủy, tiếp nhận, hồ sơ khám, lịch sử và công bố có quyền riêng ở mục 3.6–3.9.
Mọi API khác denyAll, kể cả ADMIN. HTTP Basic/form login/session cookie không dùng;
không có tài khoản mặc định. Session policy stateless, request cache tắt.
CSRF tắt vì credential chỉ được gửi chủ động qua Authorization header, không dùng cookie xác thực.
Nếu sau này đổi sang cookie/session phải đánh giá và bật lại bảo vệ CSRF phù hợp.
Security headers mặc định của Spring Security được giữ (HSTS chỉ trên HTTPS).
`/error` là handler nội bộ khi servlet error dispatch; gọi trực tiếp vẫn bị bảo vệ.

JWT được xử lý bởi OAuth2 Resource Server trong SecurityFilterChain, không có filter xác thực nằm ngoài chain.
Authority map nhất quán ROLE_ADMIN/ROLE_DOCTOR/ROLE_RECEPTIONIST/ROLE_PATIENT từ role DB hiện tại.
CORS_ALLOWED_ORIGINS là danh sách origin chính xác, phân cách dấu phẩy; mặc định rỗng.
Không cho wildcard/null/pattern/path; chỉ HTTP(S), methods GET/POST/PATCH/OPTIONS,
headers Authorization/Content-Type, exposed Location, allowCredentials=false.
Origin FE thực tế cần cấu hình ở môi trường; không có origin localhost mặc định ở main.

**PROPOSED:** quyền chi tiết API nghiệp vụ chuyển trạng thái khám, ownership/phân công chẩn đoán, refresh/revoke và quản lý tài khoản nhân viên.
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
| FR-02 | GET, PATCH | `/me/profile` | Đã xác thực, self | **IMPLEMENTED D04** (`fullName`, `phone`, `address`) |
| FR-03 | GET | `/doctors`, `/doctors/{id}` | Bốn role theo scope mục 3.2; DOCTOR self, PATIENT active | **IMPLEMENTED D03** |
| FR-03 | GET | `/doctors/eligible-users` | Chỉ ADMIN; ACTIVE/DOCTOR/unlinked cố định | **IMPLEMENTED D03** |
| FR-03 | POST | `/doctors` | ADMIN | **IMPLEMENTED D03** |
| FR-03 | PATCH | `/doctors/{id}` | ADMIN | **IMPLEMENTED D03** |
| FR-04 | GET | `/specialties`, `/specialties/{id}` | Bốn role theo scope mục 3.2 | **IMPLEMENTED D03** |
| FR-04 | POST | `/specialties` | ADMIN | **IMPLEMENTED D03** |
| FR-04 | PATCH | `/specialties/{id}` | ADMIN | **IMPLEMENTED D03** |
| FR-05 | GET, POST | `/patients` | ADMIN/RECEPTIONIST cho dữ liệu hành chính | **IMPLEMENTED D04** |
| FR-05 | GET | `/patients/{id}` | ADMIN/RECEPTIONIST hành chính; PATIENT self linked | **IMPLEMENTED D04** |
| FR-05 | PATCH | `/patients/{id}` | ADMIN/RECEPTIONIST hành chính | **IMPLEMENTED D04** |
| FR-05 | GET | `/me/patient-profile` | PATIENT self | **IMPLEMENTED D04** |
| FR-06 | POST | `/doctor-schedules` | ADMIN/RECEPTIONIST | **IMPLEMENTED D06** |
| FR-06 | GET | `/doctor-schedules`, `/doctor-schedules/{id}` | ADMIN/RECEPTIONIST; DOCTOR self | **IMPLEMENTED D06** |
| FR-06 | PATCH | `/doctor-schedules/{id}` | ADMIN/RECEPTIONIST | **IMPLEMENTED D06** |
| FR-06 | GET | `/doctors/{id}/schedule-slots` | Cả bốn role; sinh slot khả dụng | **IMPLEMENTED D06** |
| FR-07 | GET | `/appointments`, `/appointments/{id}` | ADMIN/RECEPTIONIST; DOCTOR self; PATIENT self linked | **IMPLEMENTED D07** |
| FR-07 | POST | `/appointments` | PATIENT self / RECEPTIONIST thay tại quầy (idempotent qua requestKey) | **IMPLEMENTED D07** |
| FR-07 | PATCH | `/appointments/{id}/slot` | PATIENT self / RECEPTIONIST | **IMPLEMENTED D08** |
| FR-07 | POST | `/appointments/{id}/cancellation` | PATIENT self / RECEPTIONIST | **IMPLEMENTED D08** |
| FR-08 | POST | `/appointments/{id}/confirmation` | RECEPTIONIST | **IMPLEMENTED D09** |
| FR-08 | POST | `/appointments/{id}/check-in` | RECEPTIONIST | **IMPLEMENTED D09** |
| FR-08 | POST | `/appointments/{id}/no-show` | RECEPTIONIST | **IMPLEMENTED D09** |
| FR-09 | POST | `/medical-records` | DOCTOR assigned, lịch đã check-in | **IMPLEMENTED D10** |
| FR-09 | GET | `/medical-records/{id}` | DOCTOR assigned; PATIENT self bản hoàn tất và công bố; ADMIN/RECEPTIONIST metadata | **IMPLEMENTED D10, policy D11** |
| FR-09 | GET | `/medical-records/by-appointment/{id}` | Cùng quyền GET hồ sơ, id là appointmentId | **IMPLEMENTED D10** |
| FR-09 | PATCH | `/medical-records/{id}` | DOCTOR assigned, bản nháp | **IMPLEMENTED D10** |
| FR-09 | POST | `/medical-records/{id}/completion` | DOCTOR assigned | **IMPLEMENTED D10** |
| FR-09 | POST | `/medical-records/{id}/release` | DOCTOR assigned, bản hoàn tất, expectedVersion | **IMPLEMENTED D11** |
| FR-10 | GET | `/patients/{id}/medical-history` | PATIENT self đã công bố / DOCTOR assigned; ADMIN/RECEPTIONIST metadata | **IMPLEMENTED D11** |
| FR-11 | GET | `/medical-records/{id}/prescription` | DOCTOR assigned / PATIENT self bản hoàn tất và công bố | **IMPLEMENTED D12** |
| FR-11 | PUT | `/medical-records/{id}/prescription` | DOCTOR assigned, thay toàn bộ đơn nháp mô phỏng, expectedVersion | **IMPLEMENTED D12** |
| FR-12 | GET | `/dashboard/summary` | ADMIN/RECEPTIONIST toàn phòng khám; DOCTOR self; PATIENT 403 | IMPLEMENTED D13 H2, MySQL V12 PENDING |
| FR-13 | GET | `/notifications` | Đã xác thực, chỉ người nhận | IMPLEMENTED D13 H2, MySQL V12 PENDING |
| FR-13 | PATCH | `/notifications/{id}/read` | Người nhận | IMPLEMENTED D13 H2, MySQL V12 PENDING |
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

- FR-09 D10 tạo hồ sơ khám và chuyển CHECKED_IN sang IN_PROGRESS trong cùng transaction.
  Hoàn tất hồ sơ và chuyển IN_PROGRESS sang COMPLETED cũng trong cùng transaction.
- Chỉ đổi slot ở PENDING/CONFIRMED; đổi slot đưa lịch về PENDING để xác nhận lại.
- CANCELLED, COMPLETED, NO_SHOW là trạng thái kết thúc; không cho chuyển lùi tùy ý.
- Check-in lại lịch đã CHECKED_IN trả kết quả hiện có, không tạo lượt khám mới.
- Đặt trùng slot hoặc đổi trạng thái trái phép trả 409; DB phải có constraint/khóa phù hợp.
  Đổi slot phải atomic. Mốc thời gian được hủy/check-in/no-show cần phòng khám xác nhận.

Ví dụ POST `/appointments` **IMPLEMENTED D07**, PATIENT dùng danh tính từ principal:

```json
{
  "scheduleId": "100",
  "startAt": "2026-11-25T08:00:00Z",
  "requestKey": "req-client-uuid-001",
  "reason": "Khám tổng quát định kỳ"
}
```

RECEPTIONIST đặt thay cần thêm `patientId` được BE kiểm tra quyền. Các trường id, trạng thái (`PENDING`),
bác sĩ, thời điểm kết thúc (tự động tính theo `slotMinutes`) và createdBy do BE quản lý; không nhận các giá trị này từ client.

## 8. Điểm cần đồng bộ

- **FE:** health/register/login/me, tám API catalog, eligible-users, bảy API Profile/Patients, năm API Doctor Schedules/Slots và ba API Appointments đã có code;
  dùng Bearer header, expiresIn tính bằng giây, id chuỗi, data/Problem Details và logout client-only.
  DTO/query params/response/errors D03/D04/D06/D07 chính thức ở mục 3.2–3.5; chú ý khác biệt PATCH profile/patient/schedule và POST appointments.
  Không dùng các API PROPOSED như API đã có.
- **FE + BE:** cấu hình origin chính xác; không gửi credentials cookie; refresh/revoke chưa có;
  UI ẩn nút theo role không thay thế quyền phía BE.
- **DB + BE:** MySQL version, database rỗng/riêng để kiểm thử, tài khoản qua secret của môi trường,
  quyền Flyway, ERD, loại id, index, timezone, charset/collation và concurrency cho slot.
- **DB:** V1–V5 của QA đã tích hợp trên origin/dev; `V6__create_appointments.sql` đã được chuẩn bị tại Backend tương thích schema đã thống nhất với QA.
  User/Doctor/Specialty/Patient/DoctorSchedule/Appointment map theo DATABASE_DESIGN; MySQL suite dùng DB cô lập, không dùng fixture H2 thay schema.
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
