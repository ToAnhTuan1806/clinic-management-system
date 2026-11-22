# CL-D11-DB — Nghiệm thu API bảo mật lịch sử khám bệnh và công bố hồ sơ

**READY FOR REVIEW** trên branch `feature/quynh` (commit `1277cf3`).
Không thực hiện `commit`, `push`, `merge`, `reset`, `rebase` hoặc `stash`. Toàn bộ các thay đổi và fixture D02 chưa commit được bảo toàn nguyên vẹn.

---

## 1. Tổng quan nghiệm thu

| Mục | Chi tiết |
| --- | --- |
| **Task** | `CL-D11-DB` (Sprint 3 / D11) |
| **Dự án** | Clinic Management System (ClinicOS) |
| **Nhánh** | `feature/quynh` |
| **HEAD commit** | `1277cf3 Merge pull request #35 from ToAnhTuan1806/feature/tuan` |
| **Database** | MySQL 8.4.11 (Isolated Docker container loopback-only) |
| **Trạng thái** | **READY FOR REVIEW** |

---

## 2. Toàn vẹn Schema và Migration V10

Migration `V10__add_medical_record_release.sql` bổ sung quản lý vòng đời công bố hồ sơ bệnh án (Medical Record Release Lifecycle):
- Cột `released_at DATETIME(6) NULL` (UTC microsecond precision).
- Cột `released_by BIGINT NULL` (Foreign key `fk_medical_records_released_by` tham chiếu `users(id)` với `ON DELETE RESTRICT ON UPDATE RESTRICT`).
- Ràng buộc toàn vẹn `chk_medical_records_release`:
  ```sql
  (released_at IS NULL AND released_by IS NULL)
  OR (
      released_at IS NOT NULL AND released_by IS NOT NULL
      AND completed_at IS NOT NULL AND completed_by IS NOT NULL
      AND released_at >= completed_at
  )
  ```
- Index hỗ trợ truy vấn và FK: `ix_medical_records_released_by (released_by)`.
- Chính sách chuyển tiếp (Legacy Backfill): Hồ sơ D10 đã hoàn tất (`COMPLETED` và có `completed_at`, `completed_by`) được sao chép `released_at = completed_at` và `released_by = completed_by` để bảo đảm bệnh nhân hợp lệ vẫn truy cập được. Bản nháp và hồ sơ chưa hoàn tất giữ `NULL`.
- Toàn bộ migrations lịch sử V1–V9 giữ nguyên 100% byte-for-byte:

| Migration | SHA-256 Checksum |
| --- | --- |
| `V1__create_users.sql` | `27043f2c2669b8b666d4c17f9be12d14cc40a7e96451ad10b2a99f3b07955edf` |
| `V2__create_specialties_and_doctors.sql` | `1f1f39cdea70eff2fa1198543ffd41b62d874d629d5c530a7c1cf45f89276973` |
| `V3__create_patients_and_profile_fields.sql` | `9a9395e048768a87cd54aeaded3cc8c59b97f5a90124a7a2cc52d566fb38e7e0` |
| `V4__add_profile_contact_fields_to_users.sql` | `c2b2f5cc9fbdc27060e426133e541c1e379df3f7d1491d33326f6bbd55d22c6f` |
| `V5__create_doctor_schedules.sql` | `65de95a05969411f0f15c9bc19d44399fff72b507da2fc2fe1fb7685b86ee71d` |
| `V6__create_appointments.sql` | `9d5e1a3742364515afc660a4635ffe73690219b45cd12d2a2947e5aea5d7cc64` |
| `V7__appointment_lifecycle.sql` | `245e8b189bb6fe4e18261dbaf5b6be746e54feaf878b32024d999ce31192f363` |
| `V8__appointment_reception_lifecycle.sql` | `3aa1e76d4e27da0342e1b4a5c7e751733d4377a035fa012955f5778e5e132a20` |
| `V9__create_medical_records.sql` | `75dc648044e795c168e0bc787a3f86d112ca3d542567f23040e061eba104d1bf` |
| `V10__add_medical_record_release.sql` | `c2d3b6ab3688701fa8454849a5b89b4ac360f7fbe1ffe5bd47c2e06fb478893b` |

- **Flyway checksum V10**: Khớp tuyệt đối `-1009264399` trên cả schema tạo mới (Fresh) và schema nâng cấp (Upgrade V9 → V10).
- **Hibernate validate**: Entity JPA khởi chạy với `ddl-auto=validate` thành công 100% trên schema V10 nâng cấp.

---

## 3. Kết quả kiểm thử hồi quy (Regression Suites)

| Bộ kiểm thử | Tổng ca | PASS | FAIL | SKIPPED |
| --- | ---: | ---: | ---: | ---: |
| Backend Default & H2 Fixture (`test`) | 283 | 283 | 0 | 0 |
| MySQL 8.4 Integration (`mysqlTest`) | 200 | 200 | 0 | 0 |
| Live API Security & Functional QA (QA01–QA12) | 12 | 12 | 0 | 0 |
| **Tổng cộng** | **495** | **495** | **0** | **0** |

---

## 4. Chi tiết 12 ca kiểm thử API D11 (QA01–QA12)

Tất cả 12 ca kiểm thử được thực thi trực tiếp bằng HTTP client trên tiến trình Backend thật (Spring Boot kết nối MySQL 8.4.11 isolated container), kiểm tra định dạng RFC 9457 Problem Details, `Cache-Control: no-store`, mã lỗi HTTP, metadata, version optimistic locking và race conditions:

| Mã ca | Mục tiêu kiểm thử | HTTP Status | Kết quả | Bằng chứng kiểm thử |
| --- | --- | :---: | :---: | --- |
| **QA01** | JWT thiếu hoặc không hợp lệ (sai chữ ký, hết hạn, sai định dạng sub) bị từ chối | `401 Unauthorized` | **PASS** | Trả về `401` và Problem Details `code: AUTHENTICATION_REQUIRED` |
| **QA02** | PATIENT xem lịch sử chính mình đúng quyền | `200 OK` | **PASS** | Phân trang `PageResponse`, `Cache-Control: no-store`, chỉ gồm hồ sơ đã release, tuyệt đối không lộ trường lâm sàng |
| **QA03** | PATIENT không xem lịch sử hoặc hồ sơ bệnh nhân khác | `404 Not Found` | **PASS** | Không lộ thông tin hoặc số lượng bản ghi của bệnh nhân khác (`RESOURCE_NOT_FOUND`) |
| **QA04** | DOCTOR được phân công xem lịch sử bệnh nhân hợp lệ | `200 OK` | **PASS** | Bác sĩ thấy toàn bộ lượt khám do mình phụ trách (`totalElements=5`), bao gồm cả các hồ sơ chưa công bố |
| **QA05** | DOCTOR không được phân công bị từ chối xem lịch sử | `404 Not Found` | **PASS** | Trả về `404 RESOURCE_NOT_FOUND`, bảo đảm phân quyền theo lượt khám thực tế |
| **QA06** | ADMIN / RECEPTIONIST chỉ nhận metadata hành chính | `200 OK` | **PASS** | Cả danh sách lịch sử và chi tiết hồ sơ đều ở dạng `Metadata` view; các trường lâm sàng `symptoms`, `diagnosis`, `notes`, `conclusion` hoàn toàn bị ẩn |
| **QA07** | Hồ sơ COMPLETED nhưng chưa release không lộ cho PATIENT | `404 Not Found` | **PASS** | Bệnh nhân gọi chi tiết `/medical-records/{id}` và `/by-appointment/{id}` đều nhận `404`; hồ sơ không xuất hiện trong danh sách lịch sử |
| **QA08** | Hồ sơ D10 đã backfill vẫn được bệnh nhân hợp lệ đọc | `200 OK` | **PASS** | Bệnh nhân đọc chi tiết và theo appointment thành công với đầy đủ nội dung lâm sàng và metadata công bố |
| **QA09** | DOCTOR release thành công với `expectedVersion` hợp lệ | `200 OK` | **PASS** | `version` tăng từ 3 lên 4; `releasedAt` chuẩn ISO-8601 UTC ('Z'); `releasedBy` khớp ID bác sĩ; non-doctors gọi nhận `403 Forbidden` |
| **QA10** | Release lặp với version hiện tại trả 200 (idempotent); version cũ trả 409 | `200 OK` / `409 Conflict` | **PASS** | Gọi lại với version 4 trả `200` không đổi timestamp/version; gọi với version cũ (3) trả `409 VERSION_CONFLICT` |
| **QA11** | Kiểm soát phân trang, thứ tự sắp xếp và phạm vi dữ liệu | `400 Bad Request` / `200 OK` | **PASS** | `size > 100`, `size = 0`, `page = -1` trả `400 VALIDATION_FAILED`; sắp xếp ổn định `completedAt DESC, id DESC`; bệnh nhân thấy 4 bản ghi, bác sĩ thấy 5 |
| **QA12** | Concurrency release race condition và truy cập sau release | `200 OK` / `409 Conflict` | **PASS** | 2 request release song song: đúng 1 request thành công `200`, 1 request nhận `409 VERSION_CONFLICT`; sau đó bệnh nhân đọc thành công `200` |

---

## 5. Kiểm thử tính bền vững sau khởi động lại (Post-restart Integrity)

- MySQL container được dừng (`docker stop`) và khởi động lại (`docker start`).
- Trạng thái kiểm tra sau restart:
  - Database sẵn sàng: `MySQL 8.4.11`.
  - Toàn bộ 6 bản ghi y tế trong schema QA được duy trì nguyên vẹn.
  - Checksum Flyway version 10 giữ nguyên `-1009264399`.

---

## 6. Danh sách các file liên quan

1. `backend/src/main/resources/db/migration/V10__add_medical_record_release.sql` (Migration chính thức V10)
2. `backend/src/test/java/com/clinicmanagement/MedicalHistorySchemaTest.java` (Schema fresh & upgrade tests)
3. `backend/src/test/java/com/clinicmanagement/MySqlD11UpgradeApiTest.java` (API integration tests trên MySQL 8.4)
4. `database/qa/validate_d11.py` (Script QA automated validation end-to-end cho D11)
5. `database/qa/benchmark_d11_history.py` (Script benchmark query plan và index)
6. `docs/qa/evidence/CL-D11-DB.json` (Bằng chứng thực thi chi tiết)
7. `docs/qa/evidence/CL-D11-INDEX.json` (Bằng chứng đánh giá hiệu năng chỉ mục)
8. `docs/database/MEDICAL_HISTORY_RELEASE_POLICY.md` (Tài liệu đặc tả chính sách bảo mật lịch sử khám)
9. `docs/qa/CL-D11-DB.md` (Báo cáo nghiệm thu hoàn thiện)
