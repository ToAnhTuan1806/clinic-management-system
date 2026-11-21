# API Contract — Clinic Management System (Sprint 1: D02–D04)

Rà soát ổn định: **CL-D06-BE**; phạm vi API đã triển khai gồm Auth/JWT D02,
Doctors/Specialties D03, Profile/Patients D04 và Doctor Work Schedules D06, kế thừa nền tảng D01.
Contract chính thức cho FE Sprint 2, cập nhật ngày **2026-11-21**.
`IMPLEMENTED` chỉ áp dụng cho phần đã có code và kiểm thử; `PROPOSED` chưa phải API sử dụng được.
Phạm vi chức năng: [FR-01–FR-14](requirements/FEATURE_SCOPE.md).

## 1. Quy ước chung

- Base path: `/api/v1`; JSON UTF-8; tên trường camelCase; URL danh từ số nhiều, chữ thường có dấu `-`.
- GET đọc dữ liệu; POST tạo hoặc thực hiện chuyển trạng thái; PATCH cập nhật một phần.
  DELETE chỉ dùng khi mô hình cho phép xóa, không dùng để xóa lịch sử khám.
- User, Doctor, Specialty, Patient dùng PK BIGINT signed; API trả id và id liên kết dạng chuỗi
  để tránh mất chính xác ở JavaScript. Request id liên kết dùng chuỗi số nguyên dương trong phạm vi BIGINT signed.
  V1 users, V2 doctor/specialty, V3 patients và V4 profile contacts đã tích hợp;
  migration do Database/QA sở hữu và không bị sửa.
- Ngày: `YYYY-MM-DD`; thời điểm: ISO-8601 UTC, ví dụ `2026-11-20T02:00:00Z`.
  FE hiển thị theo `Asia/Ho_Chi_Minh`, không gửi thời điểm thiếu offset.
- Danh sách D03/D04: `page=0&size=20`, size 1–100; thứ tự cố định như mục 3.2–3.3,
  luôn có id làm thứ tự phụ ổn định. Chưa hỗ trợ query `sort` do client chọn.
- Không nhận trực tiếp JPA entity làm request/response; dùng DTO và Bean Validation;
  giới hạn trường có thể ghi để ngăn cập nhật role/owner trái phép.
- Không trả mật khẩu/hash/token nội bộ, stack trace, SQL hoặc URL kết nối.
- Quy ước cụ thể tại các mục **IMPLEMENTED D02/D03/D04/D06** là contract đang sử dụng.
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

D03 đã triển khai `RESOURCE_NOT_FOUND` và các mã catalog ở mục 3.2.
`APPOINTMENT_SLOT_UNAVAILABLE`, `INVALID_STATE_TRANSITION`, `VERSION_CONFLICT`
vẫn là đề xuất cho các nghiệp vụ ngày sau.

## 5. Phân quyền và trạng thái bảo mật

| Vai trò | Quyền dự kiến | Giới hạn dữ liệu |
| --- | --- | --- |
| ADMIN | Quản trị tài khoản, danh mục, lịch, dashboard, báo cáo, audit | Không mặc nhiên sửa hồ sơ chuyên môn hoặc đơn thuốc |
| DOCTOR | Xem lịch được phân công, khám, đơn thuốc mô phỏng | Hồ sơ do mình khám; lịch sử cần thiết của bệnh nhân được phân công theo policy đã duyệt |
| RECEPTIONIST | Hồ sơ hành chính bệnh nhân, lịch, xác nhận, check-in | Chỉ metadata vận hành của hồ sơ khám; không sửa chẩn đoán/đơn thuốc |
| PATIENT | Hồ sơ cá nhân, đặt/đổi/hủy lịch và lịch sử của mình | Kiểm tra ownership ở BE; không tin patientId từ client |

**D06 IMPLEMENTED:** GET health và POST register/login public; GET auth/me, GET/PATCH me/profile,
GET/POST patients, GET/PATCH patients/{id}, GET me/patient-profile, GET eligible-users,
GET/POST/PATCH doctors và specialties, POST/GET/PATCH doctor-schedules và GET schedule-slots
theo đúng RBAC, ownership, pessimistic lock và scope bảo mật đã duyệt.
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

- **FE:** health/register/login/me, tám API catalog, eligible-users, bảy API Profile/Patients và năm API Doctor Schedules/Slots đã có code;
  dùng Bearer header, expiresIn tính bằng giây, id chuỗi, data/Problem Details và logout client-only.
  DTO/query params/response/errors D03/D04/D06 chính thức ở mục 3.2–3.4; chú ý khác biệt PATCH profile/patient/schedule.
  Không dùng các API PROPOSED như API đã có.
- **FE + BE:** cấu hình origin chính xác; không gửi credentials cookie; refresh/revoke chưa có;
  UI ẩn nút theo role không thay thế quyền phía BE.
- **DB + BE:** MySQL version, database rỗng/riêng để kiểm thử, tài khoản qua secret của môi trường,
  quyền Flyway, ERD, loại id, index, timezone, charset/collation và concurrency cho slot.
- **DB:** V1–V5 của QA đã tích hợp, không sửa migration đã áp dụng.
  User/Doctor/Specialty/Patient/DoctorSchedule map theo DATABASE_DESIGN; MySQL suite dùng DB cô lập, không dùng fixture H2 thay schema.
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
