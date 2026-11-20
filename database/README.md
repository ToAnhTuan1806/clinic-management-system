# Database và môi trường dev — CL-D01-DB

Trạng thái: **bản thiết kế chờ review**, chưa có migration nghiệp vụ hay backend.
MySQL **8.4 thuộc dòng MySQL 8**, InnoDB, UTF-8; Compose chỉ khởi tạo database
`clinic_management_db` và tài khoản dev `clinic_app`, không tự tạo 11 bảng nghiệp vụ.

- [Thiết kế, ràng buộc và bảo vệ dữ liệu](../docs/database/DATABASE_DESIGN.md)
- [ERD Mermaid](erd.mmd) — mở bằng trình xem Mermaid hỗ trợ `erDiagram`.
- [Kế hoạch QA và kết quả kiểm tra D01](../docs/qa/TEST_PLAN.md)
- [Docker Compose](../docker-compose.yml), [mẫu biến môi trường](../.env.example).

## 1. Chuẩn bị biến môi trường

Cần Docker Engine chạy Linux containers và Docker Compose hỗ trợ Compose Specification.
Chạy các lệnh từ thư mục gốc workspace, bằng PowerShell. Chỉ dùng dữ liệu giả.

```powershell
if (Test-Path -LiteralPath .env.clinic.local) {
    Write-Output '.env.clinic.local đã tồn tại; giữ nguyên và tự kiểm tra cấu hình Clinic.'
} else {
    Copy-Item -LiteralPath .env.example -Destination .env.clinic.local
}
```

Tự điền hai mật khẩu dev riêng biệt vào `.env.clinic.local`; không dùng lại mật khẩu
SmartExpense hoặc production. File đã được gitignore. Không ghi mật khẩu vào command
line, tài liệu hay ảnh chụp. Hai biến mật khẩu để trống trong mẫu và bắt buộc có giá trị
khi chạy Compose; đây là chủ ý để tránh khởi động với mật khẩu mặc định.

| Biến | Ý nghĩa |
| --- | --- |
| `CLINIC_MYSQL_ROOT_PASSWORD` | Mật khẩu quản trị, chỉ dùng cho dev/vận hành |
| `CLINIC_MYSQL_PASSWORD` | Mật khẩu tài khoản `clinic_app`, khác mật khẩu root |
| `CLINIC_MYSQL_PORT` | Cổng loopback host, mặc định `3307`; cổng container luôn `3306` |

Compose nhận biến từ shell với độ ưu tiên cao hơn file env. Kiểm tra cấu hình đúng
Clinic tại máy mình; không dùng `config` không có `--quiet` trong log dùng chung vì
có thể in mật khẩu đã nội suy. Tham khảo
[nội suy biến Compose](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/).

## 2. Cô lập khỏi SmartExpense

- Project cố định trong hướng dẫn: `clinic-management-d01`; luôn truyền `-p` và `-f`
  rõ ràng để tránh nhận `COMPOSE_PROJECT_NAME`/`COMPOSE_FILE` của dự án khác.
- Volume dự kiến: `clinic-management-d01_clinic_mysql_data`, network mặc định riêng
  của project. Không dùng external volume/network, bind mount data hay `container_name`.
- Không kết nối MySQL SmartExpense, không sửa file env của dự án khác. Không publish
  host port `3306`; cổng `3307` chỉ bind `127.0.0.1`. Nếu cổng đã bận, đổi biến Clinic,
  giữ nguyên dịch vụ đang chiếm cổng.
- Trước `up` lần đầu, kiểm tra project/volume cùng tên bên dưới. Nếu đã có tài nguyên
  không rõ nguồn gốc, dừng để xác minh; không chiếm dụng, thay thế hoặc xóa.

```powershell
docker version
docker compose version
Get-NetTCPConnection -State Listen -LocalPort 3307 -ErrorAction SilentlyContinue
docker ps -a --filter 'label=com.docker.compose.project=clinic-management-d01'
docker volume ls --filter 'name=clinic-management-d01_clinic_mysql_data'
docker compose -p clinic-management-d01 -f docker-compose.yml --env-file .env.clinic.local config --quiet
```

Không dùng `down -v`, volume prune, system prune, DROP DATABASE hay xóa thư mục data.
Các lệnh Docker dưới đây chỉ nhắm project Clinic. Việc cô lập được thiết kế trong
Compose; chưa thể xác nhận trạng thái SmartExpense thực tế khi Engine không truy cập được.

## 3. Khởi động và smoke test khi Engine khả dụng

```powershell
docker compose -p clinic-management-d01 -f docker-compose.yml --env-file .env.clinic.local up -d --wait --wait-timeout 180 mysql
docker compose -p clinic-management-d01 -f docker-compose.yml --env-file .env.clinic.local ps
docker compose -p clinic-management-d01 -f docker-compose.yml --env-file .env.clinic.local exec mysql mysql --user=clinic_app --password --database=clinic_management_db --execute="SELECT VERSION(), DATABASE(), @@session.time_zone; SHOW TABLES;"
```

Nhập mật khẩu qua prompt. Mong đợi: service `healthy`, phiên bản `8.4.x`, database đúng,
timezone `+00:00`. Trên volume mới D01, `SHOW TABLES` rỗng vì chưa có migration được duyệt;
nếu volume đã có dữ liệu, chỉ kiểm tra, không xóa bảng để đạt kỳ vọng này.

Healthcheck dùng tài khoản ứng dụng thực thi `SELECT 1` qua TCP trên đúng database,
không chỉ kiểm tra process còn sống. `$$` giữ biến cho shell trong container nội suy.
Sai mật khẩu/tên database sẽ làm healthcheck thất bại. `MYSQL_PWD` chỉ được dùng nội bộ
cho healthcheck dev; người có quyền Docker vẫn có thể xem environment của container.
Production cần secret manager, TLS và quản trị quyền riêng.

Thông tin kết nối backend chạy trên host:

```text
JDBC URL: jdbc:mysql://127.0.0.1:<CLINIC_MYSQL_PORT>/clinic_management_db
Username: clinic_app
Password: lấy từ biến Clinic, không ghi trong repository
```

Backend chạy cùng Compose network sau này dùng `mysql:3306`, không dùng host port.
Không thêm tùy chọn tắt TLS hoặc đổi authentication plugin mặc định vào cấu hình production.

## 4. Persistent volume và thay đổi mật khẩu

Volume giữ dữ liệu qua restart/recreate container. Chỉ trên data directory mới,
entrypoint của image mới tạo database/user từ biến môi trường. Sửa `.env.clinic.local`
không tự đổi mật khẩu trong volume cũ. Nếu lệch mật khẩu, giữ volume, dùng quy trình
đổi credential đã xác minh với người quản trị; không xóa volume để khởi tạo lại.
Chi tiết: [MySQL official image](https://github.com/docker-library/docs/blob/master/mysql/README.md).

Có thể dừng riêng service, không xóa dữ liệu:

```powershell
docker compose -p clinic-management-d01 -f docker-compose.yml --env-file .env.clinic.local stop mysql
```

Tag `mysql:8.4` cho phép cập nhật patch. Khi Backend chốt phiên bản, pin patch/digest
đã kiểm thử và ghi lại phiên bản backup. Không downgrade hay đổi image major trên volume cũ.

## 5. Flyway sau review

Thư mục chính thức dự kiến: `backend/src/main/resources/db/migration`.
**D01 không tạo thư mục backend giả, file SQL nghiệp vụ hoặc init SQL.**

Quy ước: `V<NNN>__<mo_ta_snake_case>.sql`, ví dụ minh họa
`V001__create_users.sql` (không tạo file). Backend cấp version tăng dần, duy nhất;
không sửa migration đã áp dụng lên môi trường dùng chung. Chạy `info`, `validate`,
`migrate` trong pipeline sau phê duyệt, theo dõi `flyway_schema_history`.

Khi tích hợp Spring Boot: dự kiến `spring.flyway.locations=classpath:db/migration`,
`spring.jpa.hibernate.ddl-auto=validate`, `spring.flyway.clean-disabled=true`,
`spring.flyway.baseline-on-migrate=false`. Đây là định hướng, chưa phải cấu hình backend
đã chạy. Không dùng `ddl-auto=update/create/create-drop` làm migration production.
Chi tiết thứ tự tạo bảng và rollback xem tài liệu thiết kế.

## 6. Backup/restore an toàn

Chưa chạy backup/restore ở D01. Quy trình sẽ được QA kiểm tra trên dữ liệu giả khi có schema:

1. Xác minh instance, database nguồn Clinic, phiên bản MySQL và quyền của người vận hành;
   tạo file backup mới, tên duy nhất, tại `database/backups/` đã được ignore.
2. Dùng tài khoản backup riêng và `mysqldump --single-transaction --quick --no-tablespaces`
   cho InnoDB, không dùng `--all-databases`; lấy mật khẩu qua prompt hoặc secret file được
   bảo vệ. Không chạy DDL trong lúc dump; thêm flags cho routines/events nếu sau này có.
3. Mã hóa file, checksum, lưu ngoài máy với quyền hạn hẹp. Ghi phiên bản server/schema,
   thời điểm UTC và lịch sử Flyway; không đưa dump vào Git hoặc CI artifact công khai.
4. Restore vào **instance/volume mới, project restore riêng, port riêng**. Xem lại nội
   dung dump để bảo đảm không có lệnh chuyển sang database nguồn ngoài ý muốn.
   Không import đè Clinic đang dùng hoặc SmartExpense.
5. Đối chiếu số dòng, FK, dữ liệu mẫu, quyền truy cập và Flyway validate; chạy smoke test.
   Đo RPO/RTO để nhóm chốt mục tiêu. Chỉ chuyển kết nối sau khi được xác nhận theo quy trình vận hành.

## 7. Kết quả thực tế D01

Kết quả mới nhất ở **mục 5** của [TEST_PLAN.md](../docs/qa/TEST_PLAN.md): Engine và MySQL
8.4.11 healthy; SQL có xác thực qua host 3307 đã pass. Persistence pass trên project/volume
thử nghiệm riêng ở host 13307; container thử nghiệm đã dừng, volume còn được giữ. Clinic
hiện có và SmartExpense không bị restart/recreate hoặc thay mount trong kiểm tra.

Schema nghiệp vụ vẫn chưa áp dụng; rà soát ERD/UNIQUE/FK mới ở mức thiết kế. Chưa có nguồn
đặc tả FR-01–FR-14 để xác nhận traceability; không tạo migration V1 trước Backend phê duyệt.
Mục 4 QA giữ lịch sử blocker Engine lần đầu, không mô tả trạng thái runtime mới nhất.
