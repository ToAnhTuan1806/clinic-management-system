# TASK: CL-D01-FE

**BRANCH:** `feature/trang`

**STATUS: READY FOR REVIEW**

## IMPLEMENTED

- Khởi tạo `frontend/` bằng Vite + React + TypeScript strict.
- Tailwind CSS v4 với plugin Vite, CSS-first design tokens xanh dương/trắng, Geist tự host.
- shadcn/ui khởi tạo qua CLI, Radix/Nova, Lucide; alias `@/*` thống nhất TypeScript/Vite.
- MainLayout, Sidebar desktop, Header, menu mobile bằng Sheet có focus trap, ThemeToggle.
- React Router: Login, Dashboard, Doctors, Patients, Appointments, Medical Records, Settings; thêm root redirect và 404.
- Dashboard không dùng số liệu bịa đặt. Phân hệ nghiệp vụ có placeholder và nhãn DEMO/chưa tích hợp API rõ ràng.
- Theme Light/Dark/System, lưu riêng preference, đồng bộ hệ thống, xử lý storage bị chặn và tránh flash khi tải trang.
- Magic UI BlurFade cho một banner, chỉ opacity/translation khi dùng; hỗ trợ reduced motion.
- Loading, empty, error dùng chung; trang Settings có preview DEMO.
- Axios client timeout 15 giây, biến môi trường mẫu và chặn request khi URL API chưa cấu hình.
- Form Login có label, kiểm tra native, hiện/ẩn mật khẩu và thông báo chưa xác thực; không gửi/lưu credential.
- Tài liệu chạy ứng dụng, design system, giấy phép và ảnh QA.

## TEST RESULTS

`npm run lint`, `npm run build`, `npm run format:check`: **PASS**, exit code 0. Lint không còn cảnh báo.

## UI QA

Playwright MCP đã kết nối và kiểm thử thực tế trên Chromium. Routing, keyboard/focus, menu mobile, theme persistence/system/storage fallback, reduced motion, các trạng thái UI, form DEMO và Axios guard đã được kiểm chứng.

Cả 7 màn không tràn ngang tại Light 320/390/768/1024/1440px và Dark 390/768px. Có 6 ảnh chụp; [chi tiết QA và screenshots](qa/README.md).

## RISKS/BLOCKERS

Không có blocker cho phạm vi scaffold. Chưa có tích hợp API/xác thực/phân quyền/nghiệp vụ. Hosting production cần SPA fallback về `index.html`. Chưa kiểm tra Safari/Firefox, thiết bị thật hoặc screen reader. Không sử dụng dữ liệu bệnh nhân thật.

Không tạo/chuyển nhánh, commit, push, merge, pull hoặc reset. Không thay đổi backend/database. Mọi thay đổi nằm trong workspace, gồm `frontend/` và `.gitignore` ở gốc để bỏ qua cache/tool artifacts.

## FILES CHANGED

Tất cả là file mới so với repository ban đầu chỉ có README. Danh sách đường dẫn tính từ gốc repository:

- .gitignore
- frontend/.env.example
- frontend/.gitignore
- frontend/.oxlintrc.json
- frontend/.prettierignore
- frontend/.prettierrc.json
- frontend/README.md
- frontend/components.json
- frontend/docs/CL-D01-FE.md
- frontend/docs/design-system.md
- frontend/docs/qa/README.md
- frontend/docs/qa/dashboard-desktop-dark.png
- frontend/docs/qa/dashboard-desktop-light.png
- frontend/docs/qa/dashboard-mobile-light.png
- frontend/docs/qa/login-desktop-dark.png
- frontend/docs/qa/navigation-mobile.png
- frontend/docs/qa/settings-tablet-error.png
- frontend/docs/third-party-notices.md
- frontend/index.html
- frontend/package-lock.json
- frontend/package.json
- frontend/src/app.tsx
- frontend/src/components/brand.tsx
- frontend/src/components/layout/header.tsx
- frontend/src/components/layout/main-layout.tsx
- frontend/src/components/layout/sidebar.tsx
- frontend/src/components/page-states.tsx
- frontend/src/components/theme-provider.tsx
- frontend/src/components/theme-toggle.tsx
- frontend/src/components/ui/badge.tsx
- frontend/src/components/ui/blur-fade.tsx
- frontend/src/components/ui/button.tsx
- frontend/src/components/ui/card.tsx
- frontend/src/components/ui/input.tsx
- frontend/src/components/ui/label.tsx
- frontend/src/components/ui/separator.tsx
- frontend/src/components/ui/sheet.tsx
- frontend/src/components/ui/skeleton.tsx
- frontend/src/index.css
- frontend/src/lib/api-client.ts
- frontend/src/lib/navigation.ts
- frontend/src/lib/theme-context.ts
- frontend/src/lib/utils.ts
- frontend/src/main.tsx
- frontend/src/pages/dashboard.tsx
- frontend/src/pages/login.tsx
- frontend/src/pages/module-placeholder.tsx
- frontend/src/pages/not-found.tsx
- frontend/src/pages/settings.tsx
- frontend/src/vite-env.d.ts
- frontend/tsconfig.app.json
- frontend/tsconfig.json
- frontend/tsconfig.node.json
- frontend/vite.config.ts
