# Bằng chứng QA — CL-D01-FE

Ngày kiểm chứng: **20/11/2026**, múi giờ Asia/Bangkok. Nhánh: `feature/trang`.

## Môi trường

- Node `26.13.1`, npm `11.20.0`, Windows.
- Playwright **MCP đã kết nối và được sử dụng**, Chromium `157.0.8103.79`.
- UI QA chạy trên Vite dev server tại `http://127.0.0.1:5173`.
- Context7 MCP đã kết nối, dùng để tra tài liệu shadcn/ui, Tailwind v4 và Magic UI.

## Kiểm tra bằng lệnh

Chạy trong `frontend/`:

| Lệnh                   | Kết quả đã kiểm chứng                       |
| ---------------------- | ------------------------------------------- |
| `npm run lint`         | Exit 0, không lỗi hoặc cảnh báo             |
| `npm run build`        | Exit 0, TypeScript và Vite build thành công |
| `npm run format:check` | Exit 0, các file phù hợp Prettier           |

PowerShell sử dụng `npm.cmd` do chính sách execution của máy chặn `npm.ps1`. Sandbox chặn ghi cache/output với `EPERM`; các lệnh cài đặt và build đã chạy lại với quyền thực thi cần thiết, vẫn ghi file trong workspace. Đây là vấn đề môi trường đã được xử lý trong phiên này.

## Playwright MCP

Các kiểm tra dưới đây dùng assertions trên DOM, trạng thái focus, browser media, storage và network, không suy đoán từ source code.

| Kịch bản                                                                                                              | Kết quả |
| --------------------------------------------------------------------------------------------------------------------- | ------- |
| `/` chuyển tới `/dashboard`                                                                                           | PASS    |
| Mở trực tiếp cả 7 route được yêu cầu, kiểm tra heading cấp 1                                                          | PASS    |
| URL không tồn tại hiển thị 404; nút về tổng quan hoạt động                                                            | PASS    |
| Sidebar: active route có `aria-current=page`; điều hướng đưa focus về main                                            | PASS    |
| Mobile menu: mở, nhận focus, Tab không thoát dialog, Escape đóng và trả focus về trigger                              | PASS    |
| Mobile menu: chọn Bệnh nhân đóng menu và focus main của trang đích                                                    | PASS    |
| Skip link đứng đầu thứ tự Tab và đưa focus tới main                                                                   | PASS    |
| Light/Dark toggle, lưu theme sau reload                                                                               | PASS    |
| System theo thay đổi media sáng/tối                                                                                   | PASS    |
| Theme vẫn hoạt động khi localStorage bị chặn                                                                          | PASS    |
| Loading có `role=status`, `aria-busy=true`                                                                            | PASS    |
| Error DEMO có `role=alert`; thao tác khôi phục về empty                                                               | PASS    |
| Reduced motion: skeleton không animate, Magic UI hiển thị với opacity 1, transform none, không có animation đang chạy | PASS    |
| Login: required email, hiện/ẩn mật khẩu, submit hiển thị thông báo chưa kết nối xác thực                              | PASS    |
| Login: không gửi credential; app storage chỉ có thể lưu theme, sessionStorage trống                                   | PASS    |
| Lối vào DEMO mở dashboard                                                                                             | PASS    |
| Axios thiếu URL API từ chối request trước khi gửi ra network                                                          | PASS    |
| Không có uncaught runtime error ở các lượt kiểm tra route                                                             | PASS    |
| Console cuối lượt QA: không error hoặc warning                                                                        | PASS    |

## Responsive

Kiểm tra `document.documentElement.scrollWidth <= clientWidth` trên toàn bộ 7 màn hình:

| Chế độ | Chiều rộng viewport         | Số màn mỗi kích thước | Kết quả          |
| ------ | --------------------------- | --------------------- | ---------------- |
| Light  | 320, 390, 768, 1024, 1440px | 7                     | Không tràn ngang |
| Dark   | 390, 768px                  | 7                     | Không tràn ngang |

Trong QA đã tìm và sửa lỗi tràn ngang ở 320px do min-width kết hợp scrollbar. Favicon cũng đã được bổ sung để loại bỏ lỗi 404 ban đầu. Các kết quả trên là lượt kiểm tra lại sau sửa.

Khi bật reduced motion, Motion có thể ghi cảnh báo development rằng animation đã bị tắt theo thiết bị; đây là thông báo dự kiến. Lượt reload cuối với media mặc định không có console error/warning.

## Screenshots

Ảnh chụp từ trình duyệt thật, dữ liệu DEMO, không chứa thông tin bệnh nhân. Reduced motion bật khi chụp để ảnh ổn định.

- [Dashboard desktop Light — 1440px](dashboard-desktop-light.png)
- [Dashboard desktop Dark — 1440px](dashboard-desktop-dark.png)
- [Dashboard mobile Light — 390px](dashboard-mobile-light.png)
- [Menu mobile — 390px](navigation-mobile.png)
- [Login desktop Dark — 1440px](login-desktop-dark.png)
- [Settings và lỗi DEMO trên tablet — 768px](settings-tablet-error.png)

## Giới hạn

Đã kiểm tra Chromium bằng Playwright MCP và xem trực tiếp các screenshot. Chưa kiểm tra Firefox, Safari, thiết bị thật hoặc screen reader; đây không phải chứng nhận WCAG đầy đủ. API, xác thực và nghiệp vụ chưa tồn tại trong scaffold nên chưa kiểm thử tích hợp backend. Build production đã thành công; UI QA chạy trên dev server.
