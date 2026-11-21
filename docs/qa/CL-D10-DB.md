# CL-D10-DB — bàn giao V9 và FR-09

**READY FOR COMMIT** trên branch `feature/quynh`. Không thực hiện add, commit, push,
merge hoặc PR. Các thay đổi D02 có sẵn được giữ nguyên.

## Migration và DTO đã đối chiếu

V9 bổ sung `medical_records`, UNIQUE `appointment_id`, ba FK RESTRICT đến appointment,
người tạo và người hoàn tất. Doctor/patient được truy xuất qua appointment. Bốn trường
nội dung là `TEXT NULL` khi nháp. Version mặc định 0, không âm; metadata hoàn tất phải
cùng NULL hoặc cùng có giá trị và thời điểm hoàn tất không trước thời điểm tạo.
Không bổ sung bảng đơn thuốc FR-11.

V1–V9 giữ nguyên byte so với đầu task cuối. V1–V8 còn khớp HEAD. V9 khớp từng byte
với source Backend D10 và migration được đóng gói trong JAR đã chạy:

- SHA-256: `75dc648044e795c168e0bc787a3f86d112ca3d542567f23040e061eba104d1bf`.
- Flyway checksum V9: `-210924162`.
- V1–V4 giữa hai checkout chỉ khác CRLF/LF; nội dung SQL giống nhau. Không sửa file.

Contract thực tế:

- `POST /api/v1/medical-records`: chỉ `{"appointmentId":"..."}`; tạo nháp và chuyển
  CHECKED_IN → IN_PROGRESS trong cùng transaction.
- `PATCH /api/v1/medical-records/{id}`: `symptoms`, `diagnosis`, `notes`, `conclusion`
  và `expectedVersion` kiểu số nguyên không âm. Mỗi trường nội dung tối đa 5.000 ký tự.
- `POST /api/v1/medical-records/{id}/completion`: chỉ `expectedVersion`. Symptoms,
  diagnosis, conclusion phải có nội dung; hoàn tất chuyển appointment sang COMPLETED.
- `GET /api/v1/medical-records/{id}` và
  `GET /api/v1/medical-records/by-appointment/{id}` cùng kiểm tra quyền/ownership.
- Bác sĩ được phân công xem/sửa nháp. Bệnh nhân chỉ xem hồ sơ hoàn tất của mình.
  ADMIN/RECEPTIONIST chỉ nhận metadata, không có bốn trường nội dung. Response đọc
  thành công có `Cache-Control: no-store`.

## Kết quả thực thi cuối

Dùng Backend D10 thật từ bản sao source, JAR SHA-256 và fingerprint source ghi trong
[evidence API](evidence/CL-D10-API.json). MySQL **8.4.11** chạy trong container mới,
chỉ publish loopback, schema QA riêng, toàn bộ fixture synthetic. Không dùng container,
database hoặc credential Clinic chia sẻ, production hay SmartExpense.

| Nhóm | PASS | FAIL | SKIPPED |
| --- | ---: | ---: | ---: |
| Postman FR-09 (Newman 6.2.3) | 15 | 0 | 0 |
| Postman lookup by appointment | 10 | 0 | 0 |
| Backend D10 H2/unit regression | 280 | 0 | 0 |
| Backend D10 MySQL regression | 193 | 0 | 0 |
| Tổng ca Backend + Postman của lượt nghiệm thu cuối | 498 | 0 | 0 |

Collection FR-09 có 15 request, **59 assertion PASS**, không pending. Collection tự nhận ID tạo mới;
kiểm tra version 0 → 1 → 2, payload thực tế và mã HTTP chính xác:

| Ca | Nội dung | HTTP |
| --- | --- | ---: |
| 01 | Chưa xác thực đọc hồ sơ | 401 |
| 02 | Tạo từ CHECKED_IN, trả nháp IN_PROGRESS | 201 |
| 03 | Tạo trùng | 409 |
| 04 | Tạo từ PENDING | 409 |
| 05 | Tạo từ CONFIRMED | 409 |
| 06 | PATCH đủ bốn trường nội dung | 200 |
| 07 | Version cũ | 409 |
| 08 | Hoàn tất, có metadata và trạng thái COMPLETED | 200 |
| 09 | Sửa sau hoàn tất | 409 |
| 10 | Sai bác sĩ | 404 |
| 11 | Sai bệnh nhân qua endpoint by-appointment | 404 |
| 12 | Chủ sở hữu đọc bản nháp | 404 |
| 13 | Chủ sở hữu đọc hồ sơ hoàn tất theo appointment | 200 |
| 14 | ADMIN tra theo appointment, chỉ metadata | 200 |
| 15 | RECEPTIONIST tra theo record, chỉ metadata | 200 |

## Regression GET theo appointment

Đã đối chiếu contract Backend D10 hiện có: hồ sơ chưa tồn tại hoặc ngoài quyền trả
**404 RESOURCE_NOT_FOUND**, không tạo record khi GET. Fingerprint source, contract,
JAR và cả hai collection có trong evidence API. Lượt lookup chạy lại toàn bộ Backend
H2/unit, MySQL regression và build JAR từ source mới sao chép; không tái sử dụng build cũ.

[Collection lookup](postman/CL-D10-Lookup.postman_collection.json) gồm **10/10 PASS**,
**54 assertion PASS**, 0 FAIL/SKIPPED/pending. Tổng hai collection là 25 ca và 113 assertion.

| Ca | GET by-appointment | Kết quả |
| --- | --- | --- |
| L01 | DOCTOR assigned đọc bản IN_PROGRESS có đủ nội dung | 200, đúng record/appointment ID, version 1 |
| L02 | Tải lại cùng bản nháp | 200, toàn bộ DTO và timestamp giống lần trước, version 1 |
| L03 | Appointment tồn tại, chưa có medical record | 404 RESOURCE_NOT_FOUND |
| L04 | PATIENT chủ sở hữu đọc bản IN_PROGRESS | 404 RESOURCE_NOT_FOUND |
| L05 | PATIENT chủ sở hữu đọc bản COMPLETED | 200, clinical data đúng, version 2 |
| L06 | PATIENT khác đọc bản COMPLETED | 404 RESOURCE_NOT_FOUND |
| L07 | ADMIN đọc bản nháp có nội dung | 200, chỉ đúng 11 khóa metadata, không có clinical marker |
| L08 | RECEPTIONIST đọc bản nháp có nội dung | 200, chỉ đúng 11 khóa metadata, không có clinical marker |
| L09 | DOCTOR khác đọc bản nháp | 404 RESOURCE_NOT_FOUND |
| L10 | DOCTOR assigned tải bản COMPLETED | 200, đúng version 2 và metadata hoàn tất |

Mọi response thành công được kiểm tra no-store. Snapshot SQL trước/sau collection
GET so sánh **toàn bộ cột của toàn bộ hàng** trong users, specialties, doctors,
patients, doctor_schedules, appointments và medical_records. Kết quả hoàn toàn giống
nhau, gồm nội dung, FK/ownership, status, version và timestamps. Snapshot chỉ giữ trong
bộ nhớ; evidence chỉ ghi tên bảng, số hàng và kết quả so sánh. Không ghi password/hash,
JWT hay nội dung y khoa vào evidence. MySQL QA 8.4.11 độc lập; runtime đã dừng và volume
được giữ nguyên. Không sửa Backend hay migrations V1–V9.

Kiểm tra bổ sung qua HTTP thật và SQL (không cộng trùng vào 498 ca):

- 11 request ghi sai role/bác sĩ bị từ chối đúng 403/404.
- Lỗi insert do trigger integrity ở schema QA: request trả 409, không lưu record và
  appointment vẫn CHECKED_IN. Trigger được gỡ trong finally.
- Lỗi update lúc hoàn tất: request trả 409, appointment vẫn IN_PROGRESS, version và
  metadata hoàn tất không đổi. Trigger được gỡ trong finally.
- Hai request tạo đồng thời trả 201/409; hai PATCH cùng version trả 200/409; hai
  completion cùng version trả 200/409. SQL xác nhận trạng thái/version cuối nhất quán.
- SQL xác nhận các request PENDING/CONFIRMED không tạo record, sửa lỗi version và sửa
  sau hoàn tất không ghi đè nội dung đã lưu.
- Response lỗi không chứa marker y khoa; metadata không có trường clinical. Log
  Backend không chứa marker được kiểm tra, password, BCrypt hash hoặc JWT đã dùng.

Hibernate `ddl-auto=validate` PASS với entity D10. Flyway history có đủ V1–V9 thành công.
Kết quả fresh, upgrade V8 → V9, validate, checksum, no-op và parity H2 ở lượt kiểm tra
schema trước được giữ trong [evidence DB](evidence/CL-D10-DB.json). Frontend trước đó
208/208 unit/contract PASS, lint/build PASS; lượt cuối không sửa/rerun Frontend.

## Chạy lại an toàn

Cần Java 21, Docker Linux với image `mysql:8.4`, Python, Node và Newman 6.2.3 cài ngoài
Git. Tham số Backend trỏ đến thư mục `backend` có source D10. Runner chỉ đọc source,
không đọc `.env`, không sửa checkout BE. Ví dụ PowerShell:

```powershell
npm install --prefix "$env:TEMP/clinic-d10-newman" --no-save newman@6.2.3
python database/qa/validate_d10_api.py --backend F:/RikkeiEdu/clinic-management-system/backend --newman "$env:TEMP/clinic-d10-newman/node_modules/newman"
```

Mặc định runner chạy lại cả regression và build. `--validated-build` chỉ dành cho
snapshot QA cũ có evidence regression PASS, input source và SHA-256 JAR khớp; không
bỏ qua việc kiểm chứng artifact. Collection mặc định `enableD10=false`, token trống.
Runner truyền token qua stdin vào Newman trong bộ nhớ, chỉ xuất kết quả đã lọc.
Không export environment/token hoặc full Newman report. Runner kết thúc bằng cách
dừng process Backend và container MySQL do chính nó tạo; giữ nguyên volume để đối chiếu.
Các runtime, snapshot, dependency và log trong `.qa-runtime/` không đưa vào Git.

## File D10 bàn giao riêng

Lượt lookup bổ sung collection GET, mở rộng runner API, cập nhật evidence API/DB và
báo cáo này. Toàn bộ phạm vi D10 đang chờ commit gồm **11 file**:

- `backend/src/main/resources/db/migration/V9__create_medical_records.sql`
- `backend/src/test/java/com/clinicmanagement/MedicalRecordSchemaTest.java`
- `backend/src/test/resources/fixtures/medical-record-schema.sql`
- `backend/src/test/resources/application-test.yml`
- `database/qa/validate_d10.py`
- `database/qa/validate_d10_api.py`
- `docs/qa/postman/CL-D10-Medical-Records.postman_collection.json`
- `docs/qa/postman/CL-D10-Lookup.postman_collection.json`
- `docs/qa/evidence/CL-D10-DB.json`
- `docs/qa/evidence/CL-D10-API.json`
- `docs/qa/CL-D10-DB.md`

Không gom các thay đổi D02 có sẵn (`.gitignore`, database README, TEST_PLAN, staff
fixtures/vault và evidence D02) vào phạm vi D10. Không có blocker nghiệm thu FR-09
trong các ca đã chạy. Không thay đổi migration V1–V9 trong lượt final.
