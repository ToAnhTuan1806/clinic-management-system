# D02 — Trạng thái contract xác thực

## Nguồn đã đọc

Ngày 20/11/2026 (Asia/Bangkok), đã đọc `docs/API_CONTRACT.md` bằng `git show origin/dev:docs/API_CONTRACT.md` và đọc trực tiếp qua GitHub connector trên cả nhánh `dev` và `feature/tuan`. Không chạy Git fetch/pull hoặc thay đổi ref/worktree.

- [Contract trên dev](https://github.com/ToAnhTuan1806/clinic-management-system/blob/dev/docs/API_CONTRACT.md)
- [Snapshot local origin/dev a3aa73f](https://github.com/ToAnhTuan1806/clinic-management-system/blob/a3aa73f53ed5146a606154001a083ba5cb21a3ee/docs/API_CONTRACT.md)
- Blob SHA được GitHub trả về: `904e871738b7e19ac61a85ba0d3deb240379f81a`.

Cả hai nhánh trên GitHub còn là contract **CL-D01-BE**. Chỉ health được IMPLEMENTED; auth còn PROPOSED. D02 DTO, quy tắc mật khẩu và response đăng nhập/đăng ký/me chưa được mô tả. Không thể tuyên bố tương thích hoặc tích hợp Backend thật.

## Phần đã xác định

Giữ nguyên các endpoint được giao:

| Method | Endpoint                |
| ------ | ----------------------- |
| POST   | `/api/v1/auth/register` |
| POST   | `/api/v1/auth/login`    |
| GET    | `/api/v1/auth/me`       |

Response thành công dùng envelope `data`. Lỗi đọc HTTP status và Problem Details `code/errors`; không so sánh chuỗi `detail`. Đăng ký public chỉ dành cho PATIENT. Không tự thêm endpoint refresh/logout; logout hiện tại chỉ xóa state phía client theo phạm vi D02.

## Cô lập phần chưa chốt

- `src/auth/types.ts`: model nội bộ FE, không phải DTO Backend đã duyệt.
- `src/auth/config.ts`: `backendAuthContract = null`. Profile mặc định/production hiển thị dịch vụ chưa sẵn sàng và dừng trước khi gửi request auth.
- `src/auth/api.ts`: đã chuẩn bị đúng method/path. `AuthContract` tách encoder/decoder để điền chính xác theo contract D02 sau merge, không thử nhiều biến thể response.
- `src/testing/mock-auth-contract.ts`: **MOCK ONLY**, chỉ được dùng khi `import.meta.env.DEV` và `VITE_AUTH_MOCK=true`. Mock adapter bị loại khỏi production build.
- Mock chỉ định dạng DTO để browser tests intercept network. Nó không tạo server giả trong ứng dụng, tài khoản mặc định hoặc nút bỏ qua đăng nhập.
- Mọi test gọi API trong profile mock đều được Playwright chặn và trả fixture; không chạm Backend thật.

Schema fixture **không phải contract BE**:

```text
Login request:       { email, password }
Login mock response: { data: { accessToken: <runtime-generated fixture> } }
Register request:    { fullName, email, password } — không nhận role/confirmPassword
Register mock response: { data: { id, role: "PATIENT" } }
Me mock response:    { data: { id, fullName, email, role } }
```

Validation FE tạm thời: email hợp lệ tối đa 254 ký tự; họ tên sau trim 2–100 ký tự; mật khẩu đăng ký 8–128 ký tự; xác nhận khớp. Login chỉ yêu cầu password không rỗng, không áp đặt chính sách đăng ký lên tài khoản có sẵn. Không trim mật khẩu. Các giới hạn này cần đối chiếu D02 BE trước khi bật API thật.

## Ma trận route FE

Đây là điều hướng thận trọng dựa trên D01 scope, không thay cho phân quyền/ownership/phân công phía Backend.

| Route              | ADMIN                 | DOCTOR                     | RECEPTIONIST          | PATIENT                  |
| ------------------ | --------------------- | -------------------------- | --------------------- | ------------------------ |
| `/dashboard`       | Có                    | Có, không gian bác sĩ      | Có, không gian lễ tân | Không                    |
| `/doctors`         | Có                    | Có                         | Có                    | Có, placeholder danh mục |
| `/patients`        | Có                    | Không có danh sách toàn bộ | Có                    | Không                    |
| `/appointments`    | Có                    | Có                         | Có                    | Không, dùng `/booking`   |
| `/medical-records` | Không có màn lâm sàng | Có, placeholder            | Không có màn lâm sàng | Không                    |
| `/booking`         | Không                 | Không                      | Không                 | Có, trang mặc định       |
| `/settings`        | Có                    | Có                         | Có                    | Có                       |

ADMIN/RECEPTIONIST có thể cần metadata vận hành hồ sơ theo contract tương lai; không tự cho truy cập màn lâm sàng DOCTOR. Việc xem hồ sơ assigned/self và lịch hẹn riêng phải được BE kiểm tra khi nghiệp vụ được phát triển.

## Kiểm thử lại sau khi BE merge

1. Đọc contract D02 đã merge; xác nhận tên trường request, envelope/token/user/role, response đăng ký và danh sách code lỗi. Không đổi endpoint để khớp fixture.
2. Triển khai encoder/decoder thật riêng, gán `backendAuthContract`, đồng bộ validation với Bean Validation của BE và bổ sung test contract cho schema thật.
3. Cấu hình `VITE_API_BASE_URL` bằng origin Backend (không lặp `/api/v1`), tắt `VITE_AUTH_MOCK`; xác nhận CORS/CSRF/Bearer transport với BE.
4. Dùng database/tài khoản kiểm thử riêng: đăng ký PATIENT, email trùng, validation, sai mật khẩu, login rồi `/auth/me` có Bearer.
5. Kiểm tra token hết hạn/401, 403, role/ownership ở API thật; không chỉ kiểm tra menu FE. Đăng ký public không được cấp role nhân viên.
6. Xác nhận logout/reload không còn auth state; chạy lại lint/build/format/mock tests và ghi báo cáo Backend thật riêng. Không đổi kết quả mock thành kết quả tích hợp thật.
