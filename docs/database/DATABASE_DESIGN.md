# Thiết kế database sơ bộ — CL-D01-DB

Ngày: 2026-11-20 (Asia/Bangkok). Nhánh yêu cầu: `feature/quynh`.
Trạng thái: **PROPOSED / chờ Backend review**, chưa có SQL nghiệp vụ được áp dụng.

## 1. Phạm vi và giả định cần review

Thiết kế đúng 11 bảng: users, specialties, doctors, patients, doctor_schedules,
appointments, medical_records, prescriptions, prescription_items, notifications,
audit_logs. Không thiết kế thanh toán, giá dịch vụ, hóa đơn, QR hoặc tồn kho thuốc.
Đơn thuốc và thông tin thuốc chỉ phục vụ mô phỏng, không có giá trị kê đơn hay cấp phát.

Giả định ban đầu: một phòng khám, một chuyên khoa chính/bác sĩ, một bác sĩ cho một
lượt hẹn, tối đa một hồ sơ khám/lượt hẹn và một đơn thuốc mô phỏng/hồ sơ. Lịch làm việc
là khoảng thời gian cụ thể, chưa có lịch lặp hay bảng slot. Một tài khoản có một role;
đa vai trò, đa chuyên khoa, người giám hộ và chuyển bác sĩ khi đã khám cần thiết kế bổ sung.
Không có tính năng bệnh nhân tự nhận liên kết với hồ sơ bằng email/điện thoại.

## 2. Quy ước kiểu dữ liệu

- MySQL 8.4 (dòng MySQL 8), InnoDB, mặc định `utf8mb4/utf8mb4_0900_ai_ci`.
- Mọi PK là `BIGINT` signed, `NOT NULL AUTO_INCREMENT`; mọi FK cùng kiểu signed BIGINT.
  Không dùng INT/UUID làm PK. API nên serialize ID thành chuỗi để tránh mất chính xác
  khi client JavaScript nhận BIGINT lớn.
- Mặc định cột **NOT NULL**, ngoại lệ được liệt kê rõ. `created_at`, `updated_at`
  là `DATETIME(6)` UTC do backend quản lý (bản ghi chỉ thêm có thể chỉ có created_at).
  SQL/session/JDBC phải thống nhất UTC; UI hiển thị Asia/Ho_Chi_Minh. Khoảng lịch dùng
  `[starts_at, ends_at)` để hai cuộc hẹn nối tiếp được phép.
- `BOOLEAN` dùng ngữ nghĩa 0/1, CHECK miền giá trị sau review. Trạng thái dùng
  VARCHAR + CHECK danh sách giá trị, không dùng ENUM để dễ tiến hóa migration.
- Code chuẩn hóa trim/uppercase ASCII với collation `ascii_bin`; email trim/lowercase
  theo chính sách đăng nhập đã thống nhất, dùng `utf8mb4_bin` để UNIQUE so sánh giá trị
  canonical. `request_key` dùng `ascii_bin`, fingerprint là 64 ký tự hex.
  Tên chuyên khoa UNIQUE theo collation mặc định: nhóm cần xác nhận cách phân biệt dấu.
- FK `ON DELETE RESTRICT ON UPDATE RESTRICT`, kể cả FK nullable. Không cascade xóa
  lịch sử khám. Dùng status/is_active để ngừng sử dụng; không tái sử dụng code/email
  của bản ghi đã ngừng. Xóa/ẩn danh theo chính sách lưu giữ riêng, không qua CRUD thường.

## 3. User, Doctor, Patient

`users` lưu danh tính đăng nhập và quyền; `doctors` lưu thông tin nghiệp vụ bác sĩ,
FK `user_id` bắt buộc + UNIQUE tạo quan hệ User 1 — 0..1 Doctor. Doctor bắt buộc
liên kết user role DOCTOR. Tên hiển thị bác sĩ lấy từ users.full_name.

`patients` là hồ sơ bệnh nhân, không bắt buộc có login. FK `user_id` nullable + UNIQUE
cho phép nhiều bệnh nhân chưa có tài khoản (MySQL UNIQUE cho phép nhiều NULL), nhưng
một user liên kết tối đa một hồ sơ. Nếu liên kết, user phải có role PATIENT. Bệnh nhân
vãng lai có user_id NULL; người tạo lịch có thể là lễ tân. `patients.full_name` là tên
trong hồ sơ, không tự đổi khi user sửa tên hiển thị. Liên kết sau này phải xác minh danh
tính, khóa user/patient và ghi audit; không dò ghép theo số điện thoại chung gia đình.

Role ADMIN/RECEPTIONIST không mặc nhiên có profile Doctor/Patient. Role, trạng thái và
quan hệ liên kết là ràng buộc nhiều bảng do service thực thi trong transaction có khóa
user, vì FK đơn không kiểm tra role. Luồng đổi role phải giữ bất biến này. Backend
cần chốt đa vai trò trước khi mở rộng, không tự thêm bảng roles trong D01.

## 4. Từ điển dữ liệu

Danh sách cột đầy đủ và quan hệ trực quan: [erd.mmd](../../database/erd.mmd).
Kiểu DECIMAL của quantity trong Mermaid được chú thích độ chính xác SQL `DECIMAL(10,2)`.
Các ràng buộc sau là yêu cầu cho migration sau review.

### users

`id BIGINT`; `email VARCHAR(254)` UNIQUE; `password_hash VARCHAR(255)`;
`full_name VARCHAR(120)`; `role VARCHAR(20)` thuộc ADMIN/RECEPTIONIST/DOCTOR/PATIENT;
`status VARCHAR(16)` ACTIVE/DISABLED; `last_login_at DATETIME(6)` nullable;
created_at, updated_at. Hash mật khẩu bằng thư viện bảo mật phù hợp (Argon2id/bcrypt),
không plaintext, không mã hóa đảo ngược; không trả password_hash qua API.

### specialties

`id BIGINT`; `code VARCHAR(32)` UNIQUE; `name VARCHAR(120)` UNIQUE;
`description TEXT` nullable; `is_active BOOLEAN` mặc định true; timestamps.
Ngừng chuyên khoa khi còn bác sĩ/lượt hẹn phải qua quy tắc service, không xóa lịch sử.

### doctors

`id BIGINT`; `user_id BIGINT` FK users, UNIQUE; `specialty_id BIGINT` FK specialties;
`doctor_code VARCHAR(32)` UNIQUE; `license_number VARCHAR(100)` nullable UNIQUE;
`biography TEXT` nullable; `is_active BOOLEAN`; timestamps. License được trim/uppercase
với collation binary; dev chỉ dùng dữ liệu giả. Nếu bác sĩ/user/chuyên khoa không hoạt
động thì không nhận lịch mới, nhưng giữ tra cứu lịch sử được phân quyền.

### patients

`id BIGINT`; `user_id BIGINT` nullable FK users, UNIQUE; `patient_code VARCHAR(32)` UNIQUE;
`full_name VARCHAR(120)`; `date_of_birth DATE` nullable; `sex VARCHAR(16)` nullable
(FEMALE/MALE/OTHER/UNKNOWN); `phone VARCHAR(24)`, `address VARCHAR(255)` nullable;
`is_active BOOLEAN`; timestamps. Không UNIQUE họ tên, ngày sinh hay điện thoại.
Ngày sinh không vượt ngày hiện tại là validation service (không CHECK theo NOW()).

### doctor_schedules

`id BIGINT`; `doctor_id BIGINT` FK doctors; `starts_at`, `ends_at DATETIME(6)`;
`status VARCHAR(16)` OPEN/CLOSED; `room_label VARCHAR(64)` nullable; timestamps.
CHECK starts_at < ends_at; UNIQUE `(doctor_id, starts_at, ends_at)` ngăn bản sao chính xác;
UNIQUE `(id, doctor_id)` làm referenced key cho composite FK của appointments.
Các khoảng OPEN của một bác sĩ không được giao nhau: service khóa hàng doctors rồi
kiểm tra khoảng. Không coi UNIQUE ba cột là đủ chống overlap.

### appointments

`id BIGINT`; `appointment_code VARCHAR(32)` UNIQUE; `patient_id BIGINT` FK patients;
`doctor_id BIGINT` FK doctors; `schedule_id BIGINT`; `created_by BIGINT` FK users;
`request_key VARCHAR(64)`; `request_fingerprint CHAR(64)`; starts_at, ends_at;
`status VARCHAR(20)` thuộc BOOKED/CHECKED_IN/IN_PROGRESS/COMPLETED/CANCELLED/NO_SHOW;
`reason VARCHAR(500)` nullable; `checked_in_at DATETIME(6)`, `checked_in_by BIGINT` FK users,
`cancelled_at DATETIME(6)`, `cancellation_reason VARCHAR(255)` đều nullable; timestamps.

Composite FK `(schedule_id, doctor_id)` → doctor_schedules `(id, doctor_id)` bảo đảm
lịch thuộc đúng bác sĩ. CHECK starts_at < ends_at; CHECK hai cột check-in cùng NULL
hoặc cùng khác NULL; CANCELLED yêu cầu cancelled_at khác NULL, trạng thái khác yêu cầu
cancelled_at NULL. Service kiểm tra thời gian hẹn nằm trọn trong lịch OPEN, lịch không
quá khứ, quyền actor, trạng thái hoạt động. Không đặt UNIQUE đơn giản trên giờ bắt đầu.

UNIQUE `(created_by, request_key)` chống retry tạo nhiều lịch từ cùng actor. Client
cấp key cho mỗi thao tác tạo; backend tính fingerprint từ payload canonical
(patient/doctor/schedule/start/end/reason), so với yêu cầu cũ trước khi trả cùng kết quả;
cùng key khác payload trả 409. Không lưu payload gốc vào audit. Luồng dùng key mới cho
yêu cầu mới; retry request cũ trả resource hiện tại, kể cả đã hủy.

### medical_records

`id BIGINT`; `appointment_id BIGINT` FK appointments, UNIQUE; `symptoms TEXT`,
`diagnosis TEXT`, `clinical_notes TEXT` nullable trong draft; `status VARCHAR(16)`
DRAFT/FINAL; `version BIGINT` mặc định 0, CHECK >= 0; finalized_at, released_at
DATETIME(6) nullable; timestamps. CHECK DRAFT có finalized_at/released_at NULL;
FINAL có finalized_at khác NULL; nếu released_at có giá trị thì >= finalized_at.
Service yêu cầu symptoms/diagnosis hợp lệ trước FINAL; release là hành động riêng,
mặc định không release. Không sửa FINAL trực tiếp; quy trình đính chính còn chờ review.

Bệnh nhân và bác sĩ được suy ra qua appointment, không nhân bản patient_id/doctor_id
để tránh mâu thuẫn. Appointment gắn record không được đổi patient/doctor/schedule/thời
gian. Tạo record chỉ khi IN_PROGRESS; hoàn tất hẹn cần record FINAL, cùng transaction.

### prescriptions

`id BIGINT`; `medical_record_id BIGINT` FK medical_records, UNIQUE;
`is_simulation BOOLEAN` mặc định true, CHECK = 1; `status VARCHAR(16)` DRAFT/FINAL;
`notes TEXT` nullable; timestamps. Bác sĩ/patient suy ra từ record/appointment.
Finalize record phải kiểm tra đơn (nếu có) FINAL; finalize đơn yêu cầu >= 1 item.
Đơn chỉ được sửa khi record còn DRAFT và đơn DRAFT. FINAL bất biến; mọi giao diện,
export đều ghi **“MÔ PHỎNG — KHÔNG DÙNG ĐỂ ĐIỀU TRỊ”**. Không liên kết nhà thuốc hay
cung cấp hướng dẫn điều trị thật.

### prescription_items

`id BIGINT`; `prescription_id BIGINT` FK prescriptions;
`line_no SMALLINT` CHECK > 0; `medication_name VARCHAR(160)`; `dosage_text VARCHAR(120)`;
`frequency_text VARCHAR(120)`; `duration_days SMALLINT` CHECK > 0;
`quantity DECIMAL(10,2)` CHECK > 0; `unit VARCHAR(32)`;
`instructions VARCHAR(255)` nullable; timestamps. UNIQUE `(prescription_id, line_no)`.
Tên thuốc là snapshot giả lập dạng text, không tạo danh mục thuốc/tồn kho trong D01.
Validation giới hạn độ dài, khoảng số và cấm item trên đơn đã FINAL.

### notifications

`id BIGINT`; `user_id BIGINT` FK users; `appointment_id BIGINT` nullable FK appointments;
`type VARCHAR(32)` APPOINTMENT_CREATED/APPOINTMENT_UPDATED/RECORD_RELEASED;
`title VARCHAR(160)`; `message VARCHAR(500)`; `read_at DATETIME(6)` nullable; created_at.
Chỉ thông báo chung và link ID; không chứa chẩn đoán, triệu chứng hoặc đơn thuốc.
Service xác minh recipient được phép biết appointment và notification theo ownership.
Không hard delete thông báo để né chính sách lưu giữ. D01 chưa có delivery/outbox:
ghi notification nội bộ trong transaction; gửi email/SMS sẽ cần thiết kế riêng.

### audit_logs

`id BIGINT`; `actor_user_id BIGINT` nullable FK users (NULL cho system);
`action VARCHAR(64)`; `entity_type VARCHAR(64)`; `entity_id BIGINT` nullable;
`correlation_id VARCHAR(64)`; `outcome VARCHAR(16)` SUCCESS/DENIED/FAILED;
`metadata JSON` nullable; created_at. entity_id là tham chiếu logic theo entity_type,
không thể dùng một FK đa hình đến 11 bảng. Service kiểm tra type/ID khi có resource;
login fail chưa xác định tài nguyên dùng entity_type AUTH_ATTEMPT, entity_id NULL và
correlation_id để truy vết, không ghi ID giả hoặc email nhập vào metadata.

Audit append-only; không cập nhật/xóa qua API. Metadata allowlist chỉ gồm mã trạng thái,
tên trường đã đổi và lý do truy cập đã phân loại; không chứa old/new payload khám,
password/hash/token, nội dung đơn thuốc hay PII không cần thiết. Dữ liệu bị từ chối
vẫn phải có audit độc lập với transaction nghiệp vụ bị rollback; nếu chưa biết actor
thì để NULL. Chính sách lưu giữ/archival và chống sửa audit cần được duyệt.

## 5. Chỉ mục đề xuất

Ngoài PK, UNIQUE ở trên và chỉ mục cho mọi FK (tái sử dụng leftmost prefix phù hợp):

| Bảng | Index đề xuất | Truy vấn |
| --- | --- | --- |
| doctors | (specialty_id, is_active, id) | Danh sách bác sĩ theo chuyên khoa |
| doctor_schedules | (doctor_id, status, starts_at, ends_at) | Kiểm tra lịch mở/overlap |
| appointments | (doctor_id, starts_at, ends_at, status) | Overlap theo bác sĩ |
| appointments | (patient_id, starts_at, id) | Lịch sử bệnh nhân, phân trang ổn định |
| appointments | (schedule_id, doctor_id) | Composite FK |
| appointments | (checked_in_by) | FK người check-in |
| appointments | (status, starts_at, id) | Hàng đợi check-in/lịch trong ngày |
| notifications | (user_id, read_at, created_at, id), (appointment_id) | Hộp thư owner/FK |
| audit_logs | (entity_type, entity_id, created_at, id) | Lịch sử tài nguyên |
| audit_logs | (actor_user_id, created_at, id), (correlation_id) | Truy vết actor/request |

UNIQUE appointment_id của record, medical_record_id của đơn, (prescription_id, line_no)
đã phục vụ FK tương ứng. UNIQUE (created_by, request_key) phục vụ FK created_by.
Không tạo thêm index riêng trên cùng prefix một cách máy móc. EXPLAIN với dữ liệu giả
đại diện sau khi có schema; không index toàn văn nội dung bệnh án mặc định.

## 6. Chống đặt trùng lịch bác sĩ

Điều kiện giao nhau: `existing.starts_at < requested.ends_at AND existing.ends_at > requested.starts_at`.
BOOKED/CHECKED_IN/IN_PROGRESS/COMPLETED giữ khoảng đã dùng; CANCELLED/NO_SHOW giải phóng.
Chưa cho phép đặt lịch quá khứ nên giữ COMPLETED không gây cản trở đặt mới. Cùng bác sĩ
[09:00,09:30) và [09:30,10:00) hợp lệ; [09:15,09:45) xung đột. Hai bác sĩ khác nhau có
thể khám cùng giờ. Không dùng pre-check UI hoặc khóa trong bộ nhớ một backend instance.

Giao thức transaction đề xuất, cần áp dụng cho **mọi writer**, kể cả admin/import:

1. Kiểm tra quyền, định dạng và idempotency; mở transaction InnoDB, isolation đề xuất
   READ COMMITTED. FK/UNIQUE/CHECK vẫn là lớp bảo vệ bắt buộc.
2. `SELECT id FROM doctors WHERE id = :doctorId FOR UPDATE` khóa hàng bác sĩ đã tồn tại.
   Đây là điểm tuần tự hóa ngay cả khi chưa có appointment nào. Không chỉ khóa kết quả
   SELECT appointments rỗng. Giữ khóa đến COMMIT/ROLLBACK.
3. Đọc lại schedule/doctor/user/specialty đang hoạt động và kiểm tra hẹn nằm trong
   khoảng OPEN. Các luồng ngừng hoạt động cũng cần đồng bộ với booking; thứ tự khóa
   thống nhất do Backend chốt, ví dụ specialty → users liên quan (ID tăng) → doctors
   (ID tăng) → schedules → appointments. Không lấy user lock sau doctor lock ở luồng khác.
4. Đọc overlap bằng locking read `FOR UPDATE` để dùng trạng thái hiện hành (tránh
   snapshot cũ nếu isolation khác). Bỏ chính appointment khi đổi giờ. Nếu có overlap,
   rollback và trả 409 APPOINTMENT_CONFLICT; không lưu nửa chừng.
5. Ghi appointment + notification nội bộ + audit SUCCESS trong cùng transaction,
   COMMIT. Duplicate request_key phải reload bằng locking/current read và so fingerprint;
   trả lịch đã tạo nếu cùng payload, 409 nếu khác.

Đổi lịch qua hai bác sĩ phải khóa cả bác sĩ cũ/mới theo ID tăng, rồi khóa lại appointment
và kiểm tra doctor chưa bị writer khác đổi trước đó; nếu khác thì rollback/retry từ đầu.
Tạo/sửa/đóng lịch làm việc, hủy lịch hẹn và chuyển NO_SHOW phải dùng cùng khóa doctors.
Một schedule đã có bất kỳ appointment nào thì doctor/starts_at/ends_at bất biến để giữ
lịch sử; tạo khoảng mới nếu cần đổi giờ. Không đóng lịch còn hẹn BOOKED/CHECKED_IN/
IN_PROGRESS; phải giải quyết hẹn trước. Lịch đóng vẫn giữ lịch sử đã kết thúc.
Đổi giờ appointment chỉ cho BOOKED; lịch đã check-in/khám không di chuyển.

Deadlock/lock timeout: rollback toàn bộ, retry có giới hạn với cùng request_key và
backoff; không báo thành công khi transaction thất bại. Bounded retry thất bại trả lỗi
tạm thời theo API contract, không báo nhầm conflict nghiệp vụ. Nếu traffic tăng, cân
nhắc bảng slot riêng sau review; D01 chấp nhận tuần tự hóa từng bác sĩ. Tài khoản viết
DB trực tiếp có thể bỏ qua giao thức nên phải hạn chế quyền và đường ghi dữ liệu.

MySQL cung cấp khóa locking read trong transaction; giao thức trên là đề xuất của dự án,
cần test song song thật trước khi xác nhận: [MySQL locking reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html).

## 7. Trạng thái và tính nhất quán

- BOOKED → CHECKED_IN → IN_PROGRESS → COMPLETED. BOOKED → CANCELLED hoặc NO_SHOW;
  CHECKED_IN → CANCELLED chỉ bởi lễ tân/admin trước khám và phải có lý do (chờ xác nhận).
  NO_SHOW chỉ sau thời điểm/grace period được Backend chốt. Trạng thái kết thúc không mở lại.
- Check-in bởi RECEPTIONIST/ADMIN: khóa appointment, kiểm tra BOOKED và cửa sổ thời gian;
  ghi actor/time UTC. Retry trả cùng dữ liệu check-in, không tạo lại sự kiện; không
  check-in lịch CANCELLED/NO_SHOW/COMPLETED. CHECKED_IN/IN_PROGRESS/COMPLETED bắt buộc có
  hai trường check-in; CANCELLED có thể có nếu đã check-in trước khi hủy.
- Bác sĩ được phân công mới bắt đầu/hoàn tất khám. Tạo FINAL record và chuyển COMPLETED
  cùng transaction; prescription nếu có phải FINAL. Version optimistic lock ngăn hai
  lần sửa draft ghi đè nhau; trả 409 khi version cũ.
- Sửa record/đơn/item và finalize đều khóa record cha trước, rồi đơn và item theo ID;
  kiểm tra lại trạng thái/version dưới khóa để không thêm item hoặc ghi draft sau finalize.
- Status transition, nonempty FINAL, containment giữa các bảng, role và ít nhất một item
  là validation service; CHECK/FK đơn không thể thực thi toàn bộ các luật này.
- Không đổi danh tính/assignment của hẹn đã có hồ sơ; ngừng hoạt động bác sĩ không làm
  mất quyền tra cứu lịch sử đã được cho phép. Quy tắc hủy sau khi khám cần review riêng.

## 8. Bảo vệ dữ liệu khám bệnh

Phân quyền kết hợp role và ownership/assignment ngay tại service/query, kể cả list,
search, export và API con; không dựa vào ẩn nút UI hay ID khó đoán.

| Vai trò | Dữ liệu được truy cập theo đề xuất |
| --- | --- |
| ADMIN | Quản lý user/chuyên khoa/bác sĩ, metadata vận hành; không mặc nhiên đọc nội dung bệnh án |
| RECEPTIONIST | Hồ sơ liên hệ tối thiểu, lịch và check-in; không xem diagnosis/clinical_notes/đơn |
| DOCTOR | Lịch được phân công; tạo/sửa draft của lượt khám mình; lịch sử khám khác bác sĩ mặc định từ chối |
| PATIENT | Lịch/hồ sơ liên kết users.id của mình; chỉ đọc record FINAL đã released_at và đơn FINAL mô phỏng tương ứng |
| User chưa đăng nhập/disabled | Không truy cập dữ liệu riêng; chính sách thư mục bác sĩ công khai chờ review |

Không có quyền “break glass” ngầm. Nếu cần bác sĩ xem lịch sử bệnh nhân toàn phòng khám,
phải review cơ sở cấp quyền, mục đích truy cập và audit trước khi nới chính sách.
IDOR phải kiểm tra cả appointment/record/prescription/item/notification và chống gửi
patient_id/doctor_id/role/created_by tùy ý; created_by/check-in actor lấy từ principal.

TLS khi truyền dữ liệu ở môi trường chia sẻ/production; mã hóa disk/backup, khóa nằm
ngoài repo và tách khỏi backup. Cân nhắc mã hóa trường nhạy cảm theo threat model,
có rotation và đánh giá ảnh hưởng tìm kiếm. Không dùng dữ liệu bệnh nhân thật cho dev/CI.
Log/audit chỉ metadata tối thiểu; phản hồi API allowlist field, không lộ password/hash.
Ngăn cache công khai (`Cache-Control: no-store` cho nội dung bệnh án), làm sạch đầu vào
và escape đầu ra chống stored XSS; SQL parameterized, giới hạn phân trang/rate limit.

DB app production chỉ quyền DML cần thiết; audit chỉ INSERT/SELECT theo phạm vi cần thiết,
không UPDATE/DELETE; tài khoản migration và backup riêng. `clinic_app` do official image
tạo có quyền rộng trên database dev nên chưa đạt mô hình phân quyền production.
Ghi audit cho xem/xuất/sửa bệnh án, release, đổi quyền, liên kết patient và truy cập bị từ chối.
Schema D01 không tự đảm bảo tính bất biến audit ở tầng DB.

Thời hạn lưu hồ sơ, cơ sở pháp lý, đồng ý chia sẻ, quyền đính chính/ẩn danh, RPO/RTO
và quy trình xử lý sự cố cần đơn vị vận hành chốt; đây không phải tuyên bố tuân thủ pháp lý.

## 9. Flyway và rollout sau phê duyệt

- Đích: `backend/src/main/resources/db/migration`. D01 không tạo SQL nghiệp vụ, seed
  tự động hoặc script trong `/docker-entrypoint-initdb.d` trước Backend xác nhận.
- Tên `V<NNN>__<mo_ta_snake_case>.sql` với version duy nhất tăng dần do Backend cấp;
  hai dấu gạch dưới; không sửa/đổi tên version đã áp dụng, thay bằng migration tiến mới.
  Repeatable chỉ dành cho đối tượng phù hợp sau review, không tạo bảng nghiệp vụ bằng R__.
- Thứ tự phụ thuộc: users + specialties → doctors + patients → doctor_schedules →
  appointments → medical_records → prescriptions → prescription_items; notifications
  sau users/appointments, audit_logs sau users. Đây là thứ tự dự kiến, chưa cấp version.
- Flyway validate checksum trước migrate; kiểm tra `flyway_schema_history`, chạy lần hai
  không đổi schema. Không tự baseline database có dữ liệu hoặc bật out-of-order để né lỗi.
- `ddl-auto=validate` (hoặc none khi có cơ chế schema validation riêng), không update
  ở production. Tắt Flyway clean trong môi trường có dữ liệu; không dùng clean/repair
  để vượt checksum lỗi. Backend cần xác nhận phiên bản Flyway và module hỗ trợ MySQL.
- MySQL DDL có implicit commit; không giả định toàn bộ file DDL rollback như DML.
  Chia bước nhỏ, kiểm thử trên bản sao cô lập, backup trước rollout; xử lý thất bại
  theo runbook. Rollback app chỉ khi schema tương thích; ưu tiên roll-forward,
  restore chỉ vào instance mới sau xác minh, không ghi đè database đang dùng.
- Thay đổi phá vỡ tương thích dùng add nullable → backfill có kiểm soát → đổi app →
  siết constraint/loại cột ở đợt sau. Dùng EXPLAIN và đánh giá lock trước index/DDL lớn.

Quy tắc version/checksum tham khảo [Flyway versioned migrations](https://documentation.red-gate.com/fd/versioned-migrations-273973333.html).

## 10. Các quyết định cần Backend review

1. Role đơn/đa vai trò, một/đa chuyên khoa, quyền bác sĩ xem lịch sử và luồng release bệnh án.
2. Khoảng lịch, thời lượng/grace period, cùng bệnh nhân hẹn hai bác sĩ cùng giờ có được phép
   không (D01 chỉ bắt buộc chống overlap bác sĩ), điều kiện hủy sau check-in.
3. Thứ tự khóa thống nhất cho booking/đổi role/disable/sửa schedule; isolation, retry và API lỗi.
4. Chính sách đính chính FINAL, lưu giữ dữ liệu/audit, mã hóa, RPO/RTO và quyền production.
5. Chốt collation tên chuyên khoa/license, version MySQL patch/digest, Flyway/module/phiên bản
   backend trước khi viết migration chính thức; chốt danh mục action/entity_type audit.

## 11. Rà soát ERD/UNIQUE/FK sau kiểm thử runtime

Ngày 2026-11-20: kiểm tra cấu trúc ERD xác nhận 11 entity, mọi PK/FK được khai báo BIGINT.
Đây là **review thiết kế**, không phải chứng nhận constraint đã tồn tại trong database.
SELECT metadata trên Clinic hiện có trả về 0 bảng và 0 constraint trong clinic_management_db;
đúng với việc chưa áp dụng migration nghiệp vụ. Không tạo V1/V001 trong lần kiểm tra này.

### Danh mục UNIQUE cần Backend xác nhận

Ngoài 11 PRIMARY KEY, có **15 UNIQUE key đề xuất**:

| Bảng | UNIQUE đề xuất | Mục đích / lưu ý review |
| --- | --- | --- |
| users | (email) | Sau canonicalization, không tái sử dụng email tài khoản đã disabled |
| specialties | (code), (name) | Cần chốt so sánh dấu/hoa thường cho name |
| doctors | (user_id), (doctor_code), (license_number) | License nullable; không dùng tên bác sĩ làm unique |
| patients | (user_id), (patient_code) | user_id nullable cho bệnh nhân vãng lai; không unique phone/name |
| doctor_schedules | (doctor_id, starts_at, ends_at), (id, doctor_id) | Key thứ nhất chỉ chặn khoảng trùng hẳn; key thứ hai phục vụ composite FK |
| appointments | (appointment_code), (created_by, request_key) | Idempotency theo actor, cần so fingerprint trước khi trả kết quả cũ |
| medical_records | (appointment_id) | Tối đa một hồ sơ cho một lượt hẹn |
| prescriptions | (medical_record_id) | Tối đa một đơn mô phỏng cho một hồ sơ theo giả định D01 |
| prescription_items | (prescription_id, line_no) | Không trùng số dòng trong một đơn |

### Danh mục FOREIGN KEY cần Backend xác nhận

Có **15 FK đề xuất** (composite FK tính là một constraint). Tất cả dùng cùng BIGINT
signed và RESTRICT khi DELETE/UPDATE như quy ước mục 2:

| Bảng con | Cột FK → bảng/cột cha |
| --- | --- |
| doctors | user_id → users.id; specialty_id → specialties.id |
| patients | user_id nullable → users.id |
| doctor_schedules | doctor_id → doctors.id |
| appointments | patient_id → patients.id; doctor_id → doctors.id; (schedule_id, doctor_id) → doctor_schedules.(id, doctor_id); created_by → users.id; checked_in_by nullable → users.id |
| medical_records | appointment_id → appointments.id |
| prescriptions | medical_record_id → medical_records.id |
| prescription_items | prescription_id → prescriptions.id |
| notifications | user_id → users.id; appointment_id nullable → appointments.id |
| audit_logs | actor_user_id nullable → users.id |

Không có FK đa hình cho audit_logs.entity_id. Không thêm patient_id/doctor_id trùng
lặp vào medical_records/prescriptions; suy ra từ appointment. Cardinality trên ERD
phù hợp các key nói trên, kể cả patient chưa có user và đơn DRAFT chưa có item.

### Kết luận review và giới hạn

- Không phát hiện mâu thuẫn PK/FK/UNIQUE trong bản đề xuất hiện tại; vẫn phải Backend
  phê duyệt cardinality và kiểm thử constraint thật sau khi có migration được duyệt.
- UNIQUE lịch làm việc/giờ bắt đầu không thay được giao thức khóa chống overlap.
  Mục 6 và các case SCH/APT là bắt buộc trước khi xác nhận đặt lịch an toàn.
- FK không kiểm tra role/ownership, containment thời gian, ít nhất một item khi FINAL,
  hoặc tính bất biến bệnh án. Các luật đó phải được service kiểm tra trong transaction.
- Giới hạn cần chốt: một role/user, một specialty/doctor, một record/appointment,
  một prescription/record; chưa thể xác nhận các giả định này phù hợp FR khi chưa có đặc tả.
- Chưa kiểm thử ghi dữ liệu nghiệp vụ, quyền API, migration hay backup/restore; bảng probe
  persistence chỉ nằm ở instance thử nghiệm riêng, không phải schema Clinic được duyệt.

## 12. Đối chiếu FR-01–FR-14: chờ nguồn đặc tả

Workspace hiện chỉ có README gốc và các tài liệu/cấu hình D01; tìm kiếm trong các file
đó chưa thấy định nghĩa FR-01–FR-14. Không tự gán số FR cho danh sách chức năng trong
task trước vì không có bằng chứng số hiệu tương ứng. Đã yêu cầu đường dẫn/link hoặc
nội dung đặc tả; chưa nhận được tại thời điểm cập nhật báo cáo.

| FR | Nội dung chuẩn | Ánh xạ bảng/ràng buộc/QA | Kết quả |
| --- | --- | --- | --- |
| FR-01 | Chưa được cung cấp | Chưa thể xác định | BLOCKED |
| FR-02 | Chưa được cung cấp | Chưa thể xác định | BLOCKED |
| FR-03 | Chưa được cung cấp | Chưa thể xác định | BLOCKED |
| FR-04 | Chưa được cung cấp | Chưa thể xác định | BLOCKED |
| FR-05 | Chưa được cung cấp | Chưa thể xác định | BLOCKED |
| FR-06 | Chưa được cung cấp | Chưa thể xác định | BLOCKED |
| FR-07 | Chưa được cung cấp | Chưa thể xác định | BLOCKED |
| FR-08 | Chưa được cung cấp | Chưa thể xác định | BLOCKED |
| FR-09 | Chưa được cung cấp | Chưa thể xác định | BLOCKED |
| FR-10 | Chưa được cung cấp | Chưa thể xác định | BLOCKED |
| FR-11 | Chưa được cung cấp | Chưa thể xác định | BLOCKED |
| FR-12 | Chưa được cung cấp | Chưa thể xác định | BLOCKED |
| FR-13 | Chưa được cung cấp | Chưa thể xác định | BLOCKED |
| FR-14 | Chưa được cung cấp | Chưa thể xác định | BLOCKED |

Theo phạm vi D01 đã được cung cấp (chưa phải traceability theo FR), thiết kế có nền
tảng cho authentication/role qua users, chuyên khoa/bác sĩ/bệnh nhân qua ba bảng profile,
lịch/booking/check-in qua doctor_schedules và appointments, hồ sơ/đơn mô phỏng qua
medical_records/prescriptions/prescription_items, thông báo và audit qua hai bảng còn lại.
Thanh toán/QR vẫn ngoài D01. Khi có FR chuẩn, cần ánh xạ từng acceptance criterion tới
cột/key/quy tắc service và test ID; đánh dấu gap trước khi Backend chốt migration.
