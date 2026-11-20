# Đối chiếu ERD Database/QA — CL-D01-BE

Ngày: **2026-11-20**, Asia/Bangkok. Backend: `feature/tuan`; nguồn Database/QA:
worktree `F:\RikkeiEdu\clinic-management-system-QA`, nhánh `feature/quynh`.
Các nguồn đang là file chưa commit tại thời điểm đọc; không sao chép, chỉnh sửa hoặc merge worktree QA.

**Kết luận:** thiết kế QA là cơ sở review phù hợp cho một phòng khám, nhưng **chưa phê duyệt
schema/migration V1**. Các khác biệt bên dưới phải chốt trước khi triển khai nghiệp vụ.
Kết quả kết nối/startup MySQL không đồng nghĩa 11 bảng hoặc constraint đã tồn tại.

## Nguồn đã đối chiếu

| File trong worktree QA | SHA-256 tại thời điểm review |
| --- | --- |
| `docs/database/DATABASE_DESIGN.md` | `6c9fc6334e025896a04a9cc28309e669f7766d1bf6d06ad0d483a5eb17350aaa` |
| `database/erd.mmd` | `9b3bf5970b55bc59e587059e09217d0247c800251ef80aebfa3ab1f713b0a0fa` |
| `database/README.md` | `994c0e68176ce8a2cef66fc8a3168af37d728e49aeddc80028f7a8ed25ade6a3` |

Đối chiếu với [FEATURE_SCOPE](requirements/FEATURE_SCOPE.md),
[API_CONTRACT](API_CONTRACT.md) và cấu hình backend hiện tại. ERD đã được đọc và
đối chiếu nội dung/quan hệ; không tuyên bố đã render sơ đồ hoặc chạy schema nghiệp vụ.

## Các điểm phù hợp

- QA đề xuất đúng 11 bảng: users, specialties, doctors, patients, doctor_schedules,
  appointments, medical_records, prescriptions, prescription_items, notifications, audit_logs.
  Không có bảng thanh toán/QR, giá dịch vụ hoặc kho thuốc; đúng phạm vi D01–D15.
- MySQL 8.4, BIGINT signed cho PK/FK, serialize ID thành chuỗi ở API, DATETIME(6) UTC,
  InnoDB, utf8mb4 và FK RESTRICT phù hợp định hướng nền tảng. Backend chưa có entity nên
  `ddl-auto=validate` hiện chưa xác minh mapping/constraint của 11 bảng.
- Một hồ sơ khám cho mỗi appointment; một đơn mô phỏng cho mỗi hồ sơ; không xóa lịch sử.
  Role kết hợp ownership/assignment, metadata tối thiểu và audit không chứa clinical payload.
- Flyway cùng đường dẫn `backend/src/main/resources/db/migration`, clean bị tắt,
  không tự baseline và Hibernate không tự create/update schema.

## 1. User / Doctor / Patient relationships — CHỜ THỐNG NHẤT

QA đề xuất:

- `users 1 — 0..1 doctors`: doctors.user_id bắt buộc, UNIQUE, FK users; user phải có role DOCTOR.
- `users 0..1 — 0..1 patients`: patients.user_id nullable, UNIQUE; nhiều bệnh nhân vãng lai
  có NULL; nếu có user thì role PATIENT. Không tự liên kết theo email/điện thoại.
- Một user chỉ có một role; ADMIN/RECEPTIONIST không mặc nhiên có profile Doctor/Patient.
- Tên hiển thị bác sĩ lấy từ users; patients.full_name là thông tin hồ sơ, không tự ghi đè
  khi cập nhật users.full_name. FK không tự kiểm tra được role.

**Đề xuất BE:** dùng các quan hệ này cho bản đầu; service phải kiểm tra role và liên kết trong
transaction có khóa, không cho client đổi user_id/role qua cập nhật profile. Trước V1 cần
BE/DB xác nhận single-role, chính sách đổi role/khóa user, liên kết bệnh nhân vãng lai và
quyền sửa thông tin định danh. Đa vai trò/người giám hộ không tự thêm vào D01.

## 2. Appointment conflict prevention — CHỜ THỐNG NHẤT

QA dùng khoảng `[starts_at, ends_at)`, schedule_id + doctor_id có composite FK;
không có bảng slot. UNIQUE theo giờ bắt đầu **không đủ** chống khoảng giao nhau.
Giao thức đề xuất khóa hàng doctors đã tồn tại bằng `FOR UPDATE`, đọc lại điều kiện
hoạt động/schedule và overlap trong cùng transaction; mọi writer phải tuân thủ.
Khóa chỉ các appointment hiện có không bảo vệ được trường hợp kết quả rỗng.

Đối chiếu contract BE hiện tại:

| Chủ đề | API/Scope BE sơ bộ | QA đề xuất | Quyết định cần chốt |
| --- | --- | --- | --- |
| Mô hình thời gian | POST appointment dùng slotId; có available-slots | Schedule + starts_at/ends_at, không có slot table | Slot được tính từ schedule hay thêm bảng slot sau review; thời lượng và payload thống nhất với FE |
| Trạng thái | PENDING → CONFIRMED → CHECKED_IN | BOOKED → CHECKED_IN | Có bước xác nhận riêng hay không; mapping enum/cột và endpoint confirmation |
| Người check-in | RECEPTIONIST | RECEPTIONIST/ADMIN | Ma trận quyền chính thức |
| Hủy sau check-in | Không có transition này trong contract | CHECKED_IN → CANCELLED có điều kiện, còn chờ duyệt | Cho phép hay từ chối; actor, lý do và cửa sổ thời gian |
| Conflict code | APPOINTMENT_SLOT_UNAVAILABLE | APPOINTMENT_CONFLICT | Một mã FE/BE/QA dùng chung; HTTP 409 giữ nguyên |
| Retry/idempotency | Chưa định nghĩa request key | UNIQUE(created_by, request_key) + fingerprint | Header/body key, TTL/lưu giữ, canonical payload và 409 khi key khác payload |

**Đề xuất BE:** dùng khóa DB theo bác sĩ, không dùng khóa trong memory hoặc chỉ pre-check UI.
Chốt READ COMMITTED, thứ tự khóa toàn hệ thống, bounded retry/backoff và cách phân biệt
lock timeout với conflict nghiệp vụ. Đổi lịch phải atomic; nếu đổi bác sĩ phải khóa cả hai
theo thứ tự ID ổn định. Cần quyết định thêm xung đột lịch của cùng bệnh nhân.
QA phải kiểm thử hai connection đồng thời và trường hợp bác sĩ chưa có lịch hẹn sau khi
schema/booking được triển khai; D01 **chưa kiểm thử concurrency nghiệp vụ**.

## 3. Medical record access control — CHỜ THỐNG NHẤT

QA thêm điều kiện PATIENT chỉ đọc record **FINAL và released_at khác NULL**;
đơn cũng phải FINAL. Contract BE sơ bộ mới yêu cầu hồ sơ hoàn tất, chưa có hành động release.
QA mặc định từ chối bác sĩ đọc hồ sơ của bác sĩ khác; Scope BE có nhu cầu đọc lịch sử cần
cho bệnh nhân được phân công nhưng chưa chốt ranh giới quyền này.

**Đề xuất BE:** giữ deny mặc định cho dữ liệu lâm sàng; BE/DB/nghiệp vụ cần duyệt:

- Ai được release, release tách khỏi finalize hay tự động, có thu hồi không;
  sau đó mới thêm endpoint và cập nhật điều kiện hiển thị FE.
- Phạm vi bác sĩ đọc lịch sử khác bác sĩ, căn cứ assignment hiện tại và audit truy cập;
  ADMIN/RECEPTIONIST chỉ nhận metadata vận hành, không mặc nhiên có diagnosis/notes/đơn.
- Tạo record: BE dự kiến tạo từ CHECKED_IN rồi chuyển IN_PROGRESS cùng transaction;
  QA mô tả chỉ tạo khi IN_PROGRESS. Chọn một luồng, không để appointment mồ côi giữa các bước.
- Finalize record/đơn và COMPLETED phải nguyên tử; draft có optimistic version;
  record FINAL không sửa trực tiếp, quy trình đính chính cần duyệt riêng.
- Query/list/nested resource đều kiểm tra ownership; no-store cho nội dung bệnh án,
  audit SUCCESS/DENIED, thông báo không chứa clinical payload.

Các điều kiện này là thiết kế cần xác nhận, không phải authorization đã triển khai trong D01.
Hiện mọi API nghiệp vụ vẫn denyAll.

## 4. Migration V1 ownership — CHỜ THỐNG NHẤT

**Đề xuất phân công để nhóm xác nhận:**

| Trách nhiệm | Owner đề xuất |
| --- | --- |
| ERD, kiểu dữ liệu, FK/UNIQUE/CHECK/index và bản SQL đề xuất | Database/QA chuẩn bị |
| Cấp version duy nhất, tên file, vị trí migration và mapping entity/API | Backend quản lý |
| Review trước khi đưa V1 vào repository và chạy DDL | Backend + Database/QA cùng duyệt; nghiệp vụ chốt các mục 1–3 |
| Migrate trên DB QA cô lập, chạy lại no-op, validate và kiểm tra constraint | QA xác minh, BE phối hợp |
| Quyền migration/production, backup và rollout | Người vận hành được phân công; chưa có trong D01 |

BE trước đây nhắc `V1__initial_schema.sql`, QA minh họa `V001__create_users.sql`.
Flyway coi 1 và 001 là cùng version; phải chọn **một** quy ước và một migration đầu tiên,
không tạo cả hai. Chưa cấp version hoặc tạo SQL trong lần xác minh này.
Không sửa version/checksum đã áp dụng, không tự clean/repair/baseline.

## Bằng chứng runtime và giới hạn

MySQL QA `127.0.0.1:3307/clinic_management_db` trả version **8.4.11**, session UTC `+00:00`.
`mysqlTest` có **2/2 PASS**; boot JAR khởi động và GET health trả 200 với UP.
Profile `mysql-validation` giữ datasource/JPA/Flyway nhưng thay migrate bằng validate.
Metadata tables/columns/indexes/constraints trước và sau test không đổi;
database vẫn **0 bảng**, kể cả không tạo flyway_schema_history.

Đây là xác minh tích hợp driver/configuration/startup/HTTP. Chưa có V1, nên chưa chứng minh
11 bảng, FK/CHECK/index, mapping entity, luồng nghiệp vụ, concurrency hoặc quyền dữ liệu lâm sàng.
Các mục chờ thống nhất chặn việc viết/chạy migration và nghiệp vụ ở ngày sau;
không chặn review scaffold và kết quả kết nối D01.
