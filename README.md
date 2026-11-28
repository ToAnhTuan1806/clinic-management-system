# ClinicOS — Clinic Management System

Hệ thống quản lý phòng khám đơn chi nhánh (**ClinicOS**), phát triển qua 3 Sprint (D01–D15), hỗ trợ đầy đủ quy trình vận hành phòng khám từ quản trị danh mục, lịch làm việc bác sĩ, đặt lịch chống trùng, tiếp đón/check-in, khám bệnh, kê đơn mô phỏng, lịch sử khám, dashboard/thông báo cho tới báo cáo lượt khám và nhật ký kiểm toán.

> **Phạm vi dự án (D01–D15):** Triển khai đầy đủ **FR-01 → FR-14**. Chức năng thanh toán QR / doanh thu (**FR-15**) nằm ngoài phạm vi và không được triển khai.

---

## 1. Công nghệ sử dụng

| Thành phần | Công nghệ |
| :--- | :--- |
| **Backend** | Java 21, Spring Boot 4.1.3, Gradle Wrapper 9.8.1, Spring Security + JWT (stateless), Spring Data JPA / Hibernate (`ddl-auto: validate`), Flyway (`V1`–`V13`), RFC 9457 Problem Details |
| **Frontend** | React 19, TypeScript, Vite 8, Tailwind CSS v4, shadcn/ui, Lucide React, Axios, React Router, Vitest, Playwright |
| **Database & CI** | MySQL 8.4 (`utf8mb4_0900_ai_ci`, `UTC`), Docker Compose, GitHub Actions (`.github/workflows/ci.yml`) |

---

## 2. Phạm vi chức năng đã triển khai (D01–D14)

- **FR-01 / FR-02:** Xác thực JWT stateless, phân quyền 4 vai trò (`ADMIN`, `DOCTOR`, `RECEPTIONIST`, `PATIENT`), quản lý hồ sơ cá nhân (`/api/v1/auth/*`, `/api/v1/me/profile`).
- **FR-03 / FR-04:** Quản lý Chuyên khoa & Bác sĩ (`/api/v1/specialties`, `/api/v1/doctors`, `/api/v1/doctors/eligible-users`).
- **FR-05:** Quản lý Bệnh nhân hành chính & liên kết tài khoản (`/api/v1/patients`, `/api/v1/me/patient-profile`).
- **FR-06:** Lịch làm việc bác sĩ & sinh khung giờ trống theo ca (`/api/v1/doctor-schedules`, `/api/v1/doctors/{id}/schedule-slots`).
- **FR-07:** Đặt lịch (chống double-booking đa tầng + idempotency qua `requestKey`), đổi giờ nguyên tử, hủy lịch (`/api/v1/appointments`, `PATCH /slot`, `POST /cancellation`).
- **FR-08:** Tiếp đón tại quầy: xác nhận lịch, check-in trong ngày (`Asia/Ho_Chi_Minh`, idempotent), đánh dấu vắng mặt (`/confirmation`, `/check-in`, `/no-show`).
- **FR-09 / FR-10:** Hồ sơ khám (tạo từ lịch đã check-in, lưu nháp, hoàn tất, công bố riêng cho bệnh nhân) & lịch sử khám phân trang theo quyền (`/api/v1/medical-records/*`, `/api/v1/patients/{id}/medical-history`).
- **FR-11:** Đơn thuốc mô phỏng (`simulation: true`) gắn 1-1 với hồ sơ khám, khóa sửa sau khi hoàn tất (`/api/v1/medical-records/{id}/prescription`).
- **FR-12 / FR-13:** Dashboard vận hành theo vai trò (`GET /api/v1/dashboard/summary`) & Trung tâm thông báo trong ứng dụng (`GET /api/v1/notifications`, `PATCH /api/v1/notifications/{id}/read`).
- **FR-14:** Báo cáo lượt khám tổng hợp tại DB theo ngày/bác sĩ/chuyên khoa/trạng thái (`GET /api/v1/reports/visits`, khớp Dashboard D13) & Nhật ký kiểm toán append-only cho `ADMIN` (`GET /api/v1/audit-logs`).

---

## 3. Hướng dẫn khởi chạy Local

### 3.1. Khởi động MySQL 8.4 bằng Docker Compose

Sao chép `.env.example` thành `.env.clinic.local` và điền mật khẩu cục bộ (không commit file env vào Git):

```bash
cp .env.example .env.clinic.local
docker compose --env-file .env.clinic.local up -d
```

MySQL lắng nghe tại `127.0.0.1:3307` (database `clinic_management_db`, user `clinic_app`).

### 3.2. Khởi chạy Backend (Spring Boot)

Thiết lập biến môi trường cục bộ (`DB_URL`, `DB_USERNAME`, `DB_PASSWORD`, `JWT_SECRET` chuỗi Base64 >= 32 bytes, `CORS_ALLOWED_ORIGINS=http://localhost:5173`) rồi chạy:

```bash
cd backend
./gradlew bootRun
```

Flyway tự động chạy migration `V1`–`V13` và Hibernate xác thực schema (`ddl-auto: validate`). Kiểm tra health tại `GET http://127.0.0.1:8080/api/v1/health`.

### 3.3. Khởi chạy Frontend (React + Vite)

Sao chép `frontend/.env.example` thành `frontend/.env.local`, cấu hình `VITE_API_BASE_URL=http://127.0.0.1:8080` và giữ các cờ `*_MOCK=false`:

```bash
cd frontend
npm ci
npm run dev
```

---

## 4. Kiểm thử tự động

### Backend
- **Unit & H2 Integration (không cần MySQL):**
  ```bash
  cd backend
  ./gradlew test build --no-daemon
  ```
- **MySQL 8.4 Integration & Flyway Fresh/Upgrade (trên DB cô lập):**
  ```bash
  cd backend
  ./gradlew mysqlTest --no-daemon
  ```

### Frontend
```bash
cd frontend
npm run lint
npm run format:check
npm run test
npm run build
npm run test:e2e:mock
```

---

## 5. Kịch bản Demo bảo vệ (4 vai trò)

1. **ADMIN — Quản trị danh mục & giám sát:**
   - Đăng nhập bằng tài khoản `ADMIN` → xem **Tổng quan** (`/dashboard`).
   - Quản lý **Chuyên khoa** (`/specialties`), **Bác sĩ** (`/doctors`) và tạo **Lịch làm việc** (`/schedules`) cho bác sĩ trong ngày/tương lai.
2. **PATIENT — Đặt lịch khám:**
   - Đăng ký/đăng nhập `PATIENT` → kiểm tra **Hồ sơ cá nhân** (`/profile`).
   - Vào **Đặt lịch khám** (`/booking`) → chọn bác sĩ, khung giờ trống → đặt lịch thành công (hiển thị trong `/appointments` với trạng thái `PENDING`).
3. **RECEPTIONIST — Tiếp đón & Check-in:**
   - Đăng nhập `RECEPTIONIST` → mở **Tiếp đón** (`/reception/appointments`).
   - Xác nhận lịch (`PENDING` → `CONFIRMED`) → Check-in bệnh nhân (`CONFIRMED` → `CHECKED_IN`). Kiểm tra thông báo cập nhật trong Trung tâm thông báo.
4. **DOCTOR — Khám bệnh, kê đơn mô phỏng & công bố:**
   - Đăng nhập `DOCTOR` → mở **Khám bệnh** (`/medical-records`) → tạo hồ sơ khám từ lịch đã `CHECKED_IN` (`IN_PROGRESS`).
   - Nhập triệu chứng, chẩn đoán, kết luận → kê **Đơn thuốc mô phỏng** (`simulation: true`) → **Hoàn tất hồ sơ** (`COMPLETED`, tự khóa sửa đơn thuốc) → **Công bố hồ sơ** (`release`).
5. **PATIENT — Tra cứu lịch sử sau công bố:**
   - Quay lại tài khoản `PATIENT` → mở **Lịch sử khám** (`/medical-history`) → xem hồ sơ và đơn thuốc mô phỏng đã được bác sĩ công bố (bản nháp chưa công bố tuyệt đối không hiển thị).
6. **ADMIN — Báo cáo & Nhật ký kiểm toán:**
   - Đăng nhập `ADMIN` → mở **Báo cáo** (`/reports`) lọc theo ngày (đối chiếu tổng lượt khám, check-in, hoàn tất, bệnh nhân duy nhất khớp `/dashboard`, xem phân rã theo ngày/bác sĩ/chuyên khoa/trạng thái).
   - Mở **Nhật ký kiểm toán** (`/audit-logs`) → lọc theo hành động (`APPOINTMENT_BOOKED`, `APPOINTMENT_CONFIRMED`, `APPOINTMENT_CHECKED_IN`, `MEDICAL_RECORD_COMPLETED`, `MEDICAL_RECORD_RELEASED`) để truy vết đầy đủ chuỗi thao tác, xác nhận chỉ đọc (không sửa/xóa) và không lộ dữ liệu nhạy cảm/lâm sàng.

---

## 6. Tài liệu chi tiết

- Phạm vi chức năng: [docs/requirements/FEATURE_SCOPE.md](docs/requirements/FEATURE_SCOPE.md)
- Hợp đồng API (D01–D14): [docs/API_CONTRACT.md](docs/API_CONTRACT.md)
- Hướng dẫn Backend: [backend/README.md](backend/README.md)
- Hướng dẫn Frontend: [frontend/README.md](frontend/README.md)
- Thiết kế & kiểm thử Database: [database/README.md](database/README.md)
