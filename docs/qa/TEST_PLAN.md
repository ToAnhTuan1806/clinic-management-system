# Kế hoạch kiểm thử — CL-D01-DB

Ngày: 2026-11-20 (Asia/Bangkok). Đây là kế hoạch cho giai đoạn triển khai và kiểm tra
cấu hình/runtime D01; chưa có backend/frontend/migration để xác nhận kết quả nghiệp vụ.
**Kết quả mới nhất D02 ở mục 6**; mục 4/5 giữ lịch sử D01, không mô tả trạng thái D02 hiện tại.
Tham chiếu: [DATABASE_DESIGN.md](../database/DATABASE_DESIGN.md),
[hướng dẫn dev](../../database/README.md), [ERD](../../database/erd.mmd).

## 1. Mục tiêu, dữ liệu và điều kiện vào

Mục tiêu: xác minh quyền, tính toàn vẹn quan hệ, đặt lịch đồng thời, bảo mật hồ sơ,
và khả năng vận hành/migrate/khôi phục trên MySQL 8.4. Không kiểm thử thanh toán/QR.
P0 là an toàn dữ liệu và concurrency; P1 là chức năng chính và validation;
P2 là trải nghiệm/khả năng tương thích. API path/status cụ thể sẽ theo contract Backend.

Sau khi Backend duyệt schema, chuẩn bị môi trường QA cô lập, migrate version đã duyệt,
seed thủ công hoặc fixture riêng cho test. Không chạy test trên Clinic đang dùng hoặc
SmartExpense, không dùng reset/clean để tạo fixture. Dữ liệu gồm:

- ADMIN, RECEPTIONIST, hai DOCTOR, hai PATIENT, user DISABLED và client chưa đăng nhập.
- Hai chuyên khoa, hai bác sĩ cùng/khác chuyên khoa; user có role không phù hợp để test âm.
- Ba bệnh nhân: hai có tài khoản, một user_id NULL; hai người chung số điện thoại.
- Lịch mở/đóng, lịch quá khứ, hai khoảng nối tiếp; hẹn ở mọi trạng thái.
- Hai bệnh án khác owner, DRAFT/FINAL chưa release/FINAL đã release, đơn/item giả lập.
- Dataset riêng cho kiểm thử song song và backup; mã synthetic duy nhất cho mỗi lần chạy.

## 2. Ma trận kiểm thử

| ID | Ưu tiên | Kịch bản | Kết quả mong đợi / bằng chứng |
| --- | --- | --- | --- |
| AUTH-01 | P0 | Đăng nhập đúng/sai, disabled, token hết hạn/giả, logout theo contract | Chỉ phiên hợp lệ truy cập; 401/403 đúng contract, lỗi không lộ user/hash; kiểm tra DB hash và log không có secret |
| AUTH-02 | P0 | Thử endpoint từng role, tự gửi role/created_by/checked_in_by, đổi ID user khác | Deny theo ma trận quyền; actor từ principal, không mass assignment |
| AUTH-03 | P1 | Thử brute force, sửa quyền trong khi phiên còn sống, cập nhật user đang gắn profile | Rate limit và thu hồi/quyền mới có hiệu lực theo contract; không tạo Doctor với role PATIENT |
| CRUD-01 | P1 | Tạo/sửa/danh sách/ngừng chuyên khoa, trùng code/name kể cả hoa-thường/dấu/space | Canonical + collation đúng thiết kế, conflict rõ, không bản ghi trùng, lịch sử giữ nguyên |
| CRUD-02 | P1 | CRUD bác sĩ; user_id lặp, sai role, specialty không tồn tại/inactive, license lặp | FK/UNIQUE + service validation chặn; không tạo profile dở dang |
| CRUD-03 | P1 | CRUD bệnh nhân có/không login, liên kết user lặp/sai role; cùng phone/name | Nhiều NULL hợp lệ; một user tối đa một patient; phone/name trùng được phép; không tự link theo phone |
| CRUD-04 | P0 | Xóa bản ghi đang có FK, disable doctor/user/specialty cùng lúc đặt lịch | RESTRICT và soft deactivate giữ lịch sử; không nhận hẹn mới sau điểm commit disable, không dangling FK |
| SCH-01 | P1 | Tạo/sửa lịch; start=end, end<start, lịch đóng/quá khứ, ký tự Unicode room | Reject không hợp lệ, lưu UTC và hiển thị đúng; hẹn phải nằm trọn OPEN schedule |
| SCH-02 | P0 | Tạo hai lịch bác sĩ giao nhau từ hai kết nối; thu hẹp/đóng lịch có hẹn | Tối đa một lịch OPEN giao nhau; khoảng/doctor bất biến khi đã có hẹn, không đóng khi còn hẹn hoạt động |
| APT-01 | P0 | Cùng bác sĩ: trùng hẳn, giao đầu/cuối, khoảng chứa nhau, cùng start khác end | 409 conflict, không thêm hàng hay notification/audit SUCCESS mồ côi |
| APT-02 | P0 | Hai hẹn nối tiếp; cùng giờ khác bác sĩ; hủy rồi đặt lại | Nối tiếp/khác bác sĩ được phép; CANCELLED/NO_SHOW không giữ chỗ, trạng thái còn lại giữ khoảng |
| APT-03 | P0 | Hai connection cùng bắt đầu trên lịch bác sĩ chưa có hẹn; barrier trước request | Chính xác 1 success + 1 conflict; query overlap sau commit trả 0 cặp trùng; giữ correlation IDs và timestamps |
| APT-04 | P0 | 20 request cùng doctor/interval, nhiều app instance; lặp tối thiểu 10 lượt dataset riêng | Mỗi lượt đúng 1 hẹn hợp lệ; không 500 do lỗi lock chưa xử lý; ghi latency/retry; không dựa vào lock in-memory |
| APT-05 | P0 | Cùng request_key/cùng payload gửi lại cả song song; cùng key/khác payload | Cùng payload cùng appointment_id, một row; khác payload 409; không sinh notification trùng |
| APT-06 | P0 | Đổi giờ/doctor đối nhau, hủy/NO_SHOW/sửa schedule đồng thời đặt lịch | Theo giao thức khóa, không overlap/deadlock treo; retry bounded, rollback nguyên tử; không đổi hẹn đã có record |
| APT-07 | P1 | schedule_id thuộc doctor khác, start ngoài schedule, patient inactive | Composite FK/containment/active validation từ chối, không ghi dữ liệu dở |
| CHK-01 | P1 | Check-in BOOKED trong/ngoài cửa sổ, sai role, sai trạng thái | Chỉ actor đúng quyền/thời điểm; lưu checked_in_by/time UTC; cặp cột luôn đồng bộ |
| CHK-02 | P0 | Hai lễ tân check-in cùng lúc, request retry, hủy đồng thời check-in | Một transition hiệu lực, cùng dữ liệu khi retry; không trạng thái mâu thuẫn hoặc event trùng |
| MED-01 | P0 | Doctor được phân công tạo/sửa DRAFT; doctor khác; tạo hai record cùng appointment | Chỉ doctor đúng; UNIQUE appointment_id; không sửa assignment khi đã có record |
| MED-02 | P0 | Hai editor dùng cùng version; finalize thiếu diagnosis; sửa FINAL; hoàn tất hẹn | Một update thắng, version cũ 409; finalize hợp lệ; FINAL bất biến; record FINAL và COMPLETED nguyên tử |
| MED-03 | P0 | Tạo/sửa đơn mô phỏng; quantity/duration <= 0; finalize không item; đổi simulation=false | Reject sai; unique line_no; đơn FINAL khóa sửa; hiển thị cảnh báo mô phỏng ở UI/export |
| ACL-01 | P0 | Patient A truy cập record/đơn/item/appointment/notification của B qua ID và list/filter/export | Không lộ dữ liệu kể cả nested API; 403 hoặc 404 theo policy nhất quán; có audit DENIED |
| ACL-02 | P0 | Patient xem draft/FINAL chưa release/FINAL đã release của mình | Chỉ FINAL đã release được phép; đơn cũng FINAL, liên kết đúng owner |
| ACL-03 | P0 | Lễ tân/admin xem diagnosis/notes/đơn, doctor xem record không được phân công | Deny mặc định theo thiết kế; metadata vận hành không chứa nội dung khám |
| ACL-04 | P0 | Kiểm tra API/log/cache/audit/notification sau đọc/sửa/export và request bị rollback | Không token/hash/nội dung khám; no-store; audit SUCCESS/DENIED tồn tại đúng, audit deny không mất do rollback |
| VAL-01 | P1 | Null/blank, quá độ dài, email canonical, ngày sinh tương lai, ID không tồn tại/âm/BIGINT lớn | 400/422 theo contract, không silent truncate; API ID chuỗi; FK không dangling; Unicode roundtrip |
| VAL-02 | P0 | SQL injection, stored XSS ở reason/notes, JSON thừa field, phân trang không giới hạn | Query parameterized, output escaped; chặn mass assignment; không lộ stack trace hay dump SQL nhạy cảm |
| DB-01 | P0 | Test FK/UNIQUE/CHECK trực tiếp trên schema QA được duyệt, nullable user_id, composite schedule/doctor | Constraint tồn tại và chặn đúng; đối chiếu information_schema; không chỉ tin validation ORM |
| DB-02 | P1 | Xem EXPLAIN overlap/list bằng dữ liệu giả đại diện; nhiều trang trùng timestamp | Index phù hợp, thứ tự ổn định, không N+1; đo baseline trước khi chốt SLA |
| MIG-01 | P0 | Flyway migrate trên instance mới, validate, migrate lần hai | Đúng 11 bảng nghiệp vụ + flyway_schema_history sau migration được duyệt; FK/index/CHECK đầy đủ; lần hai no-op |
| MIG-02 | P0 | Bản sao QA có version cũ; migrate lên, checksum sai, version lặp, DDL lỗi giữa chừng | Dữ liệu giữ nguyên; validate fail đúng; không repair/clean tự động; thử runbook roll-forward do DDL implicit commit |
| BAK-01 | P0 | Dump có dữ liệu giả, restore sang project/volume/port mới | Nguồn giữ nguyên; đối chiếu counts/FK/history/checksum dữ liệu mẫu, smoke API; ghi thời gian và RPO/RTO |
| BAK-02 | P0 | Backup thiếu/hỏng, credential sai, kiểm tra quyền truy cập dump và key | Phát hiện lỗi, không dùng bản hỏng, không ghi đè DB nguồn; dữ liệu và khóa được bảo vệ |
| ENV-01 | P1 | Compose config với biến hợp lệ; thiếu từng password; đổi host port | Config hợp lệ exit 0; thiếu password fail; port đổi đúng, bind loopback và database cố định |
| ENV-02 | P0 | Start MySQL, authenticated SELECT, restart/recreate riêng Clinic sau khi có dữ liệu test | Healthy, MySQL 8.4, UTC, volume giữ dữ liệu; chỉ thực hiện trên môi trường test đã xác minh |
| ENV-03 | P0 | SmartExpense đang chạy; kiểm tra port/name/volume/network trước và sau start Clinic | Không restart/sửa/mount tài nguyên SmartExpense; nếu trùng port thì đổi port Clinic |
| E2E-01 | P1 | Login lễ tân → tạo patient → chọn doctor/schedule → đặt lịch → check-in | UI/API/DB thống nhất; refresh không đặt lặp; loading/error rõ |
| E2E-02 | P0 | Hai browser context đặt cùng giờ bác sĩ; stale UI; doctor khám và patient đọc sau release | Một booking thắng; UI conflict rõ; chỉ owner thấy record sau release, cảnh báo đơn mô phỏng luôn có |
| E2E-03 | P1 | Deep-link trái quyền, đổi role, logout, back button/cache, mobile và bàn phím | Không hiển thị lại bệnh án trái quyền, route guard + server auth, flow cơ bản dùng được |

## 3. Phương pháp và tiêu chí hoàn thành

Backend unit/service tests cho canonicalization/state transition; integration tests dùng
MySQL 8.4 thật cho transaction/FK/CHECK/Flyway (không thay bằng H2/SQLite để kết luận
concurrency). API tests theo contract; UI E2E dùng Playwright khi frontend khả dụng.
Không cài framework test chưa cần thiết trong D01.

Concurrency test dùng barrier và tối thiểu hai connection/transaction độc lập, không
chỉ gửi request tuần tự. Sau mỗi run truy vấn các cặp appointment cùng doctor với
`a.id < b.id`, khoảng giao nhau và cả hai status khác CANCELLED/NO_SHOW: kỳ vọng 0 cặp.
Thử đầu tiên khi bác sĩ chưa có hẹn để bắt lỗi khóa trên tập kết quả rỗng. Log test chỉ
ID synthetic, status, correlation_id và timing; không ghi clinical payload/password.

Điều kiện ra giai đoạn triển khai: toàn bộ P0/P1 pass, không còn lỗi nghiêm trọng về
mất/trùng/lộ dữ liệu; Backend duyệt schema và contract, Flyway validate pass, backup
restore đã chứng minh trên instance khác; P2 còn lại có người nhận và quyết định rõ.
Từng test lưu môi trường, version image/schema/app, dữ liệu synthetic, steps, expected/
actual và evidence đã che thông tin. **Kế hoạch này không đồng nghĩa test nghiệp vụ đã pass.**

## 4. Kết quả kiểm tra D01 lần đầu (lịch sử, đã có cập nhật ở mục 5)

Đã chạy tại workspace trên nhánh `feature/quynh`, ngày 2026-11-20. Các lệnh Docker dùng
thư mục config tạm riêng, chỉ khai báo đường dẫn plugin Compose đã cài sẵn. Không đọc
Docker config/credential cá nhân. Dùng `.env.example` với mật khẩu giả chỉ trong process
kiểm tra; không tạo `.env` thật và không khởi tạo database/volume.

| Kiểm tra | Kết quả thực tế |
| --- | --- |
| Docker CLI | Có: 29.9.2, Windows/amd64 |
| Docker Compose | Có: v5.6.1 |
| Compose config hợp lệ | **PASS** — `docker --config <temp> compose -p clinic-management-d01 -f docker-compose.yml --env-file .env.example config --quiet`, mật khẩu giả truyền qua process, exit 0 |
| Config sau nội suy | **PASS** — project clinic-management-d01, image mysql:8.4, DB clinic_management_db, user clinic_app, loopback 127.0.0.1:3307 → 3306, volume clinic-management-d01_clinic_mysql_data; healthcheck SELECT 1 hiện diện |
| Đổi cổng host | **PASS** — CLINIC_MYSQL_PORT=13307 cho published port 13307, không đổi cổng container |
| Thiếu root/app password và mẫu trống | **PASS (negative test)** — 3 lần config đều exit 1 và nêu đúng biến mật khẩu còn thiếu; không dùng mật khẩu mặc định |
| Kiểm tra file tĩnh | **PASS** — 7 file mới; 11 entity, mỗi PK/FK dùng BIGINT; 36 test case ID duy nhất; link Markdown nội bộ hợp lệ, không whitespace cuối dòng, password mẫu rỗng, không có migration SQL |
| Git và ignore | **PASS** — nhánh vẫn feature/quynh; .env.clinic.local và database/backups/example.sql được ignore, .env.example không bị ignore; không commit/push hay đổi nhánh |
| Docker Engine | **BLOCKED** — `docker info` exit 1, không có named pipe docker_engine; pipe dockerDesktopLinuxEngine cũng không tồn tại |
| Container/SQL/healthcheck/persistence | **NOT RUN** — Engine chưa truy cập được; không chạy up/restart/recreate/restore |
| SmartExpense thực tế trước/sau | **NOT VERIFIED** — chưa truy cập Engine; Compose không tham chiếu tài nguyên SmartExpense, không có lệnh sửa/xóa tài nguyên cũ |
| API/UI/concurrency/migration/backup-restore | **NOT RUN** — mới là kế hoạch; chưa có ứng dụng/schema được duyệt và Engine chưa khả dụng |

Lần thử đầu với config tạm rỗng không tìm thấy plugin Compose (exit 125); đã sửa thiết
lập **config tạm** để trỏ tới plugin đã cài rồi chạy lại thành công. Lỗi đó không được
tính là kết quả config của dự án. Không sửa cấu hình Docker cá nhân.

Điều kiện chạy phần còn lại: Docker Desktop/Engine Linux containers hoạt động, điền
credential dev Clinic riêng, kiểm tra project/volume/port trước `up`; Backend duyệt
schema trước khi có migration nghiệp vụ. Các điều kiện này không ngăn review tài liệu
và Compose, nhưng chưa đủ bằng chứng để kết luận môi trường runtime sẵn sàng.
ERD đã kiểm tra cấu trúc entity/kiểu ID bằng kiểm tra tĩnh; chưa render qua Mermaid engine.

## 5. Docker runtime validation — kết quả mới nhất

Ngày 2026-11-20 (Asia/Bangkok), nhánh vẫn `feature/quynh`. Lần kiểm tra này thay thế
blocker Docker ở mục 4: Docker Desktop/backend đang chạy. Lệnh trong sandbox bị
`permission denied` với named pipe, không được diễn giải thành Engine ngừng chạy.
Kiểm tra được cấp quyền ngoài sandbox đã kết nối Engine thành công.

Không đọc/in file .env thật, password hoặc token. Dùng Docker config tạm chỉ chứa
đường dẫn plugin, không đọc credential Docker cá nhân. Credential app của container
Clinic chỉ được dùng trong bộ nhớ khi xác thực; không đưa vào argv/log hay lưu vào báo cáo.

### Kết quả Engine, Compose, MySQL và kết nối

| Kiểm tra | Kết quả thực tế / bằng chứng |
| --- | --- |
| Docker Engine | **PASS** — server 29.9.2, OS linux, docker-desktop; truy cập danh sách container thành công |
| Compose | **PASS** — v5.6.1; `config --quiet` exit 0 với biến kiểm tra riêng, không in config chứa mật khẩu |
| Compose ↔ .env.example | **PASS** — đúng 3 biến CLINIC_MYSQL_ROOT_PASSWORD/CLINIC_MYSQL_PASSWORD/CLINIC_MYSQL_PORT; hai password mẫu rỗng; thiếu từng password đều bị từ chối |
| Cấu hình | **PASS** — mysql:8.4, clinic_management_db, clinic_app, 127.0.0.1:3307 → 3306, named volume clinic-management-d01_clinic_mysql_data |
| Container hiện có | **PASS** — clinic-management-d01-mysql-1, ID 9f7910155a5e, project/service label đúng; health healthy; volume đúng gắn /var/lib/mysql |
| Runtime ↔ Compose | **PASS** — image, command và toàn bộ healthcheck test/timing khớp Compose; failing streak=0, lần healthcheck gần nhất exit 0 |
| MySQL startup | **PASS** — container healthy, SQL trả VERSION()=8.4.11; không restart/recreate container Clinic hiện có |
| Database | **PASS** — DATABASE()=clinic_management_db; session timezone +00:00; database charset utf8mb4, collation utf8mb4_0900_ai_ci |
| Kết nối nội bộ | **PASS** — tài khoản ứng dụng thực thi SELECT metadata qua TCP 127.0.0.1:3306 trong container |
| Kết nối host 3307 | **PASS** — Windows Python/PyMySQL xác thực bằng clinic_app đến 127.0.0.1:3307, START TRANSACTION READ ONLY và SELECT VERSION()/DATABASE()/timezone, sau đó rollback |
| TLS của kết nối host | Có cipher TLS; kiểm tra dev loopback dùng chứng chỉ self-signed không verify CA/hostname, không phải bằng chứng cấu hình TLS production |
| Schema nghiệp vụ | **NOT APPLIED** — information_schema trả 0 bảng, 0 constraint trong database Clinic; không tạo V1/V001 hay schema nghiệp vụ |

PyMySQL chỉ được cài trong thư mục tạm để kiểm tra kết nối host; không thêm dependency
vào project. Không xuất dữ liệu ứng dụng hoặc nội dung bảng từ Clinic hiện có.

### Persistence test cô lập

Dùng chính docker-compose.yml và .env.example, truyền password ngẫu nhiên qua environment
của tiến trình; không lưu/in giá trị. Project mới được kiểm tra chưa có container/volume
trùng tên trước khi khởi tạo. `--pull never` dùng image đã có trên máy, không thay image
của các container cũ.

| Thuộc tính | Giá trị / kết quả |
| --- | --- |
| Project thử nghiệm | clinic-d01-runtime-20261120-48f46681 |
| Volume riêng | clinic-d01-runtime-20261120-48f46681_clinic_mysql_data |
| Cổng riêng | 127.0.0.1:13307 → 3306; không chiếm host 3307 đang dùng |
| Khởi động | **PASS** — compose up --wait thành công, MySQL 8.4 healthy, database mới ban đầu 0 bảng |
| Dữ liệu giả | Một bảng kỹ thuật d01_persistence_probe (BIGINT PK, marker UNIQUE), một hàng synthetic; không phải bảng nghiệp vụ/migration |
| Container trước | 95d2b5fdba8b |
| Thao tác | compose up -d --pull never --no-deps --force-recreate --wait, chỉ service mysql của project thử nghiệm |
| Container sau | add3d1b5899a, khác ID trước, healthy |
| Kết quả | **PASS** — tên volume không đổi, row count=1, marker trước/sau bằng nhau |
| Sau kiểm tra | Đã stop container thử nghiệm; giữ container ở trạng thái exited và giữ volume/marker để đối chiếu; không xóa database/volume |

Không tạo file credential hoặc ghi credential vào repository/log; như các container
dùng environment, Docker vẫn lưu biến của instance thử nghiệm trong metadata container.
Container đã dừng nhưng được giữ để đối chiếu cùng volume. Nếu cần chạy lại test,
dùng project/volume mới với credential mới, không tái khởi tạo hay chiếm dụng volume
đã có. Mọi cleanup sau này chỉ thực hiện trong phạm vi được xác nhận; lần này không
chạy down -v/prune/DROP DATABASE hay xóa tài nguyên cũ.

### Không ảnh hưởng tài nguyên có sẵn

Đã chụp metadata tối thiểu cho **32 container có sẵn** trước test và so lại sau test:
ID, status, StartedAt, RestartCount và mount đều giữ nguyên. Bao gồm Clinic hiện có,
các container SmartExpense và các project khác. Không đọc environment của các project đó.
Đây là bằng chứng không recreate/restart/thay mount; không phải kiểm thử toàn vẹn nội
dung database SmartExpense, vì không truy cập dữ liệu ngoài phạm vi.

SmartExpense có một container test đang exited được cấu hình host 3307. Không khởi động
container đó; nếu sau này cần chạy đồng thời, phải đổi cổng một project theo cấu hình
được xác nhận. Lần validation này Clinic đang sở hữu 127.0.0.1:3307 và kết nối đã pass.

### Schema review và phạm vi FR

Đã rà soát 11 entity, 11 BIGINT PK, **15 UNIQUE đề xuất** và **15 FK đề xuất**; danh mục
chi tiết ở mục 11 của [DATABASE_DESIGN.md](../database/DATABASE_DESIGN.md).
Không thấy mâu thuẫn tham chiếu trong bản nháp. FK/UNIQUE chỉ mới review trên tài liệu;
chưa có constraint nghiệp vụ để chạy DB-01/MIG-01. Chưa render ERD bằng Mermaid engine.

**BLOCKED: đối chiếu FR-01–FR-14.** Workspace chưa có nội dung hoặc nguồn đặc tả này.
Đã yêu cầu nguồn; không tự gán FR theo suy đoán. Mục 12 tài liệu thiết kế ghi đủ 14 FR
ở trạng thái chờ, chưa có FR nào được đánh dấu covered/pass.

API/UI, chống overlap dưới tải, phân quyền bệnh án, constraint thật, Flyway migrate và
backup/restore vẫn **NOT RUN** vì chưa có backend/schema được duyệt; persistence probe
không thay thế các kiểm thử đó.

### Báo cáo D01 tại thời điểm đó (đã được cập nhật bởi D02 ở mục 6)

- **DOCKER ENGINE:** PASS.
- **MYSQL HEALTH:** PASS — Clinic hiện có và instance test khởi động thành công, MySQL 8.4.11.
- **DATABASE CONNECTION:** PASS — đúng database, SQL có xác thực qua host 3307.
- **PERSISTENCE TEST:** PASS — recreate instance cô lập giữ nguyên marker/volume; không sửa dữ liệu cũ.
- **SCHEMA REVIEW:** Hoàn thành review ERD/UNIQUE/FK ở mức tài liệu; chưa có schema nghiệp vụ triển khai.
- **BLOCKERS:** Thiếu đặc tả FR-01–FR-14; Backend chưa phê duyệt schema cho migration.
- **STATUS:** BLOCKED cho toàn bộ task do chưa thể hoàn tất traceability FR; Docker runtime validation đã PASS.

## 6. CL-D02-DB — users V1 & Auth Security QA

### Đầu vào, quyết định và phạm vi

Đã xác minh branch `feature/quynh`, Git status sạch lúc bắt đầu D02; không tạo/chuyển
nhánh/worktree, không commit/push/pull/fetch/merge/rebase/reset. Đã đọc đủ:
FEATURE_SCOPE.md, API_CONTRACT.md, SCHEMA_REVIEW_D01.md, DATABASE_DESIGN.md, erd.mmd.
Nguồn FR-01–FR-14 nay đã có; blocker thiếu nguồn D01 đã được gỡ, mapping ở mục 12
[DATABASE_DESIGN.md](../database/DATABASE_DESIGN.md).

Yêu cầu D02 chốt một User/một role ADMIN/DOCTOR/RECEPTIONIST/PATIENT; public register
chỉ PATIENT, không tự đổi role hay link patient theo email/phone. Chưa triển khai
Doctor/Patient profile; ERD giữ quan hệ đề xuất cho D03/D04. Các khác biệt về slot,
appointment status/release bệnh án vẫn chờ review riêng, không đưa vào V1.

Migration duy nhất:
[V1__create_users.sql](../../backend/src/main/resources/db/migration/V1__create_users.sql).
Chưa có V1 trước task này; không sửa migration đã áp dụng, không tạo V001.
Quyền chạy migration lần này chỉ áp dụng instance QA mới; **chưa migrate Clinic dùng chung**.

### Môi trường và cách kiểm tra

Evidence đã lọc thông tin nhạy cảm: [CL-D02-DB.json](evidence/CL-D02-DB.json).
Java 21, Spring Boot 4.1.3; Flyway core/mysql **12.4.0** lấy từ boot JAR/BOM BE,
không dùng phiên bản Flyway tự chọn khác với BE.

| Mục | Kết quả thực tế |
| --- | --- |
| Docker Engine/Compose | **PASS** — Engine 29.9.2 Linux, Compose 5.6.1; config --quiet thành công |
| Clinic MySQL có sẵn | **PASS** — healthy, chỉ đọc metadata trước/sau; không restart/recreate/migrate |
| Instance QA | Project clinic-d02-db-f5df4c1242, container cb4a7a596024, loopback host 63493, named volume riêng clinic-d02-db-f5df4c1242_clinic_mysql_data |
| MySQL QA | **PASS** — 8.4.x, healthy; schema mới hoàn toàn trước migrate; session UTC, strict mode |
| Build | **PASS** — gradlew --no-daemon bootJar |
| SQL/Flyway validation | **PASS — 46/46**, qua Java harness/JDBC thật, chi tiết các PASS ID trong evidence |
| Flyway lần đầu | **PASS** — migrationsExecuted=1, version 1, script V1__create_users.sql |
| Flyway lần hai | **PASS** — migrationsExecuted=0, history SQL vẫn 1 row, checksum không đổi, validate thành công |
| Checksum | Flyway 1116148885; SHA-256 27043f2c2669b8b666d4c17f9be12d14cc40a7e96451ad10b2a99f3b07955edf; V1 không bị sửa sau apply |
| Postman scaffold | **PASS — 5 request, 15 assertion**, không lỗi, chạy bằng Newman trên boot JAR + MySQL QA đã migrate |
| Guard Auth collection | **PASS** — runAuthTests mặc định false gửi 0 HTTP request khi chọn folder PENDING; không tính thành Auth API PASS |
| H2 HTTP/security regression | **PASS — 9 test**, 0 failure/error/skipped, sau khi tách Flyway location H2 khỏi migration MySQL |
| Migration static review | **PASS** — một CREATE TABLE users; không seed/admin/password thật, không IF NOT EXISTS che drift, không payment/QR, không câu lệnh xóa/clean/repair/baseline |
| Shared Clinic | **UNCHANGED** — trước/sau 0 bảng, 0 constraint; ID/status/StartedAt/RestartCount/mount container không đổi |
| Kết thúc QA | Đã dừng app process và container QA; giữ container/volume/schema/history; không xóa DB/volume và không kết nối database SmartExpense |

Runner: [validate_d02.py](../../database/qa/validate_d02.py),
harness: [D02DatabaseValidation.java](../../database/qa/D02DatabaseValidation.java).
Runner chỉ dùng `.env.example` không chứa secret, password ngẫu nhiên trong environment
tiến trình/container; không đọc/in .env thật, không đưa credential vào URL/argv/evidence.
Docker vẫn giữ environment trong metadata container; không in metadata chứa credential.

### Schema và các ca SQL đã chạy

Schema QA sau migrate có đúng `users` và `flyway_schema_history`; users có đúng **9 cột**
theo yêu cầu, BIGINT signed/IDENTITY, InnoDB/utf8mb4. Không có FK hay bảng profile khác.
Metadata xác nhận email UNIQUE, ba CHECK ENFORCED, độ dài/nullable/precision đúng.

- Insert đủ bốn role và ACTIVE/DISABLED; ID auto increment, last_login_at NULL hợp lệ,
  full_name Unicode có ký tự bốn byte roundtrip, DATETIME(6) giữ microsecond và UTC.
- Email duplicate bị chặn bằng 1062; uppercase/padded/rỗng bị CHECK canonical chặn 3819.
  UNIQUE so email canonical binary, không theo accent-insensitive của table default.
- Role/status ngoài danh sách, lowercase hoặc khoảng trắng dư bị CHECK chặn 3819.
- NULL vào email/hash/name/role/status/created_at/updated_at bị chặn 1048;
  duplicate PK bị chặn 1062; bỏ timestamps bắt buộc bị chặn 1364.
- Tất cả fixture được rollback; users cuối test 0 hàng. Hash fixture chỉ là text synthetic
  không dùng đăng nhập; đây không phải kiểm thử thuật toán băm password của BE.

Không sửa V1 sau khi chạy trên QA. Muốn thay đổi sau review phải phối hợp version mới,
không dùng sửa checksum/repair để bỏ qua lịch sử đã áp dụng.

### H2 regression: nguyên nhân và xử lý giới hạn ở QA

Lần chạy đầu `gradlew test` thất bại 5/9 do profile H2 cố migrate SQL MySQL (collation/
engine syntax); các test context không boot được. Đã cập nhật riêng application-test.yml
để Flyway vẫn enabled nhưng đọc location trống `classpath:db/h2-scaffold-only` và test
xác nhận đúng location. Không tạo SQL thay thế cho H2, không sửa main application.yml
hoặc logic Service/Controller/Entity; test HTTP/security và error handling sau đó 9/9 PASS.
H2 không còn được dùng làm bằng chứng V1; 46 checks trên MySQL thật là validation chính.

### Auth API: kết quả khả dụng và các ca còn chờ

Hiện source BE chỉ có health/error handler, không có User Entity, Auth Controller/Service,
request DTO, JWT hay account fixture thật. **Không kết luận toàn bộ Auth API PASS.**

Collection: [CL-D02-Auth.postman_collection.json](postman/CL-D02-Auth.postman_collection.json).
Hướng dẫn và 14 case chi tiết: [postman/README.md](postman/README.md).

| Nhóm | Trạng thái |
| --- | --- |
| Health public, anonymous GET users/auth-me/profile, malformed bearer boundary | **PASS** — scaffold 5 request/15 assertion; 401 có thể do denyAll trước routing |
| Register PATIENT; email trùng; email/password sai; giả mạo ADMIN | **PENDING** — chưa có Auth API/DTO; DB CHECK role không thay quyền register |
| Login đúng/sai; disabled account | **PENDING** — cần BE hash/authentication/status checks |
| JWT thiếu/sai chữ ký/hết hạn trên API tích hợp | **PENDING** — chưa có JWT filter/transport; cần token fixture ký thật để chứng minh expiry |
| Wrong role 403 / authenticated access | **PENDING** — cần principal thật, denyAll không chứng minh role matrix |
| Không passwordHash, không lộ account khác với principal thật | **PENDING** — global no-hash check đã pass trên scaffold nhưng response chưa có account |
| Compatibility với User Entity | **PENDING** — Entity chưa có; startup hiện tại không chứng minh mapping users |

Collection không chứa credential thật. Folder Auth có opt-in, biến local synthetic và
fixture trống; thiếu fixture phải skip/PENDING. DTO/status (đặc biệt data.accessToken,
register response, disabled response) là đề xuất QA cần BE review trước khi chạy tích hợp.

### BE handoff / kết luận D02

- Review V1 trước default startup/migrate shared Clinic; giữ ddl-auto=validate,
  clean-disabled=true, baseline-on-migrate=false. Không chạy mysqlTest profile validate
  trên shared DB rỗng rồi tự migrate để “sửa” pending V1.
- Implement mapping enum STRING/Long IDENTITY/UTC timestamps theo mục 13 tài liệu thiết kế;
  DB không tự hash password, tự điền timestamps hay xác minh quyền public register.
- Chốt canonicalization/Unicode email, password policy, DTO/token/CSRF/CORS và lỗi 409/401/403.
  Provision fixture QA riêng và chạy lại 14 ca Auth sau BE D02; không tự tạo admin mặc định.
- Chưa triển khai các bảng/FK Doctor/Patient, lịch/booking/record/đơn/notification/audit;
  chưa chạy test business concurrency, backup/restore hoặc rollout shared database.

**STATUS: READY FOR REVIEW** cho V1 users, DB validation và bộ Auth QA bàn giao.
Không có blocker runtime D02; các ca Auth/JPA và chạy shared DB vẫn chờ Backend/review
theo phạm vi cho phép PENDING trong task, không được tính PASS.
