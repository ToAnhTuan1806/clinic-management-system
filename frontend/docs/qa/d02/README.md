# CL-D02-FE — Bằng chứng kiểm thử

Ngày 20/11/2026, Asia/Bangkok. Nhánh `feature/trang`. Giữ scaffold D01; không chỉnh Backend/DB/Docker.

## Kết quả tách theo nguồn

| Nguồn                              | Kết quả                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `npm run lint`                     | PASS, exit 0, không lỗi/cảnh báo                                                |
| `npm run build`                    | PASS, exit 0, TypeScript + Vite production build                                |
| `npm run format:check`             | PASS, exit 0                                                                    |
| `npm run test:mock`                | PASS — 16 unit/API mock tests, 1 test file                                      |
| Playwright MCP, profile API MOCK   | PASS — 15 nhóm kịch bản, không có uncaught runtime error                        |
| Playwright MCP, production preview | PASS cho contract gate/redirect; 0 request auth được gửi                        |
| Backend thật                       | **NOT RUN / BLOCKED** — contract dev còn D01, auth PROPOSED, chưa có schema D02 |

Node 26.13.1, npm 11.20.0; Windows; Playwright MCP dùng Chromium 157.0.8103.79. Context7 MCP đã dùng để đối chiếu shadcn Form/Alert, Axios interceptors và React Router. Sandbox chặn ghi cache/output bằng EPERM nên các lệnh cài đặt/build đã chạy với quyền thực thi cần thiết; source chỉ sửa trong `frontend/`.

## API mock tests

[Kết quả máy đọc được](mock-results.json), [unit tests](../../../tests/auth.mock.test.ts), [runner UI dùng chung](../../../tests/e2e/auth-mock-runner.mjs).

Playwright MCP thực thi trực tiếp nội dung runner vì VM không hỗ trợ Node module import. Bộ assertion độc lập kiểm tra/poll DOM và URL, dùng cùng runner với wrapper CLI. Không tuyên bố đã chạy Playwright CLI; kết quả UI ở đây là thực thi qua **MCP**.

Fixture chặn toàn bộ request `/api/v1/**` ở profile localhost:5174. Chỉ ba endpoint auth đã nêu được phép trả fixture; request không mong đợi bị abort. Kết quả: 11 login, 5 register, 10 me, **0 request ngoài fixture**. Không có request tới Backend thật.

Các nhóm đã kiểm chứng:

1. URL bảo vệ khi chưa đăng nhập chuyển Login.
2. Login validation và focus trường lỗi; form không hợp lệ không gửi request.
3. Hiện/ẩn password; Enter submit; sai tài khoản trả lỗi chung.
4. Network error và response thành công sai schema không tạo phiên.
5. Register validation, confirm password; không có lựa chọn role nhân viên.
6. Register network error, email trùng, Problem Details theo field; từ chối response đăng ký role ADMIN.
7. Register PATIENT mới điều hướng Login, hiển thị thông báo **MOCK** rõ ràng.
8. Loading có aria-busy; khóa double submit; login chỉ thiết lập phiên sau khi `/me` xác minh danh tính.
9. API 403 giữ phiên và báo thiếu quyền; 401 xóa user/token rồi chuyển Login.
10. ADMIN/DOCTOR/RECEPTIONIST/PATIENT vào đúng không gian; guard chặn URL không được phép trong SPA, không chỉ ẩn menu.
11. Logout, history và reload không phục hồi phiên; chỉ theme được phép nằm trong localStorage, sessionStorage trống.
12. Skip link và focus bàn phím.
13. Mobile menu: focus trap, Escape, khôi phục focus, điều hướng và logout; Light/Dark/System.
14. Login/Register không tràn ngang ở 320/390/768/1440px trong Light và Dark.
15. Reduced motion tắt animation loading.

Unit tests bổ sung tình huống 401 cũ không xóa phiên mới, logout trong lúc auth không khôi phục phiên, không chuyển Bearer sang origin khác, encoder loại bỏ role/confirmPassword, không hiển thị raw Problem Details/Axios config.

Kiểm tra bổ sung riêng qua MCP: PATIENT vào URL không tồn tại, nhận 404 và bấm về không gian của mình sẽ trở lại `/booking` — PASS với API mock.

## Production preview

Kiểm tra build tại localhost:4173 bằng Playwright MCP: `/patients` chuyển Login; Login/Register hợp lệ hiển thị dịch vụ chưa sẵn sàng; **0 request API**, không có nhãn/mock adapter đang hoạt động. Console lượt production smoke: **0 error, 0 warning**. Artifact production không chứa chunk mock adapter.

Đây là kiểm tra hành vi khi contract chưa có, **không phải test Backend thật**.

## Screenshots

Đã xem ảnh trực tiếp; tất cả dùng fixture DEMO, không có token hoặc thông tin bệnh nhân thật.

- [Login validation — desktop](login-validation-desktop.png)
- [Login loading — desktop](login-loading-desktop.png)
- [Dashboard ADMIN — API MOCK](admin-dashboard-light.png)
- [Register — mobile Dark](register-mobile-dark.png)
- [Đặt lịch PATIENT — mobile](patient-booking-mobile.png)
- [Navigation PATIENT — mobile và focus](patient-navigation-mobile.png)
- [403 do RoleGuard](role-forbidden.png)

## Giới hạn và kiểm thử lại

Schema/validation auth thật chưa xác định. Xem [trạng thái contract và quy trình kiểm thử lại sau merge](../../auth-contract-status.md). Chưa kiểm tra Safari, Firefox, thiết bị thật hoặc screen reader; không tuyên bố chứng nhận accessibility đầy đủ. Console trong các tình huống mock 400/401/403/409/network có thể có thông báo HTTP thất bại dự kiến từ trình duyệt; không phải uncaught app error. Không ghi token/password/request payload vào kết quả, console ứng dụng hoặc screenshot; không bật trace/HAR/video auth.
