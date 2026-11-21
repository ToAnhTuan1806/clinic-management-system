# CL-D02-DB — Postman Auth Security QA

[Collection v2.1](CL-D02-Auth.postman_collection.json) có 19 request:
5 request scaffold đã chạy bằng Newman và 14 ca Auth D02 còn **PENDING**.
Evidence: [CL-D02-DB.json](../evidence/CL-D02-DB.json).

## Chạy phần hiện khả dụng

Import collection vào Postman hoặc dùng Newman; chỉ chạy folder
`01 Available scaffold` trên backend QA đã khởi động. `baseUrl` không gồm `/api/v1`.
Không chọn một server không rõ nguồn gốc. Lệnh mẫu không chứa secret:

```powershell
newman run docs/qa/postman/CL-D02-Auth.postman_collection.json --folder '01 Available scaffold' --env-var 'baseUrl=http://127.0.0.1:<QA_PORT>'
```

Các ca gồm health 200, anonymous users/auth-me/profile 401 và bearer sai định dạng 401.
Mọi response được kiểm tra không có trường password/passwordHash/password_hash.
Scaffold denyAll có thể trả 401 dù endpoint chưa tồn tại; các kết quả này **không**
chứng minh register/login, JWT hay phân quyền role đã hoạt động.

## Chuẩn bị khi BE D02 tích hợp

Folder `02 PENDING BE D02 integration` mặc định bỏ qua toàn bộ request qua
`runAuthTests=false`. Chỉ bật `true` sau khi xác minh backend/database QA riêng và
BE chốt DTO, status, transport/CSRF. Folder này có POST tạo tài khoản; không chạy
trên Clinic dùng chung/production. Không lưu credential/token thật trong collection,
file env hoặc JSON report dùng chung; dùng biến local hoặc secret store của công cụ.

| Case | Nội dung | Trạng thái hiện tại |
| --- | --- | --- |
| AUTH-D02-01 | Register PATIENT, không tạo Doctor/Patient profile | PENDING API; việc không tạo profile cần thêm DB assertion khi BE tích hợp |
| AUTH-D02-02 | Email trùng → 409 | PENDING |
| AUTH-D02-03 | Email không hợp lệ → 400 | PENDING |
| AUTH-D02-04 | Password rỗng → 400; min/max theo policy BE cần bổ sung | PENDING |
| AUTH-D02-05 | Payload role ADMIN: reject 400 hoặc tạo đúng PATIENT, tuyệt đối không cấp ADMIN | PENDING |
| AUTH-D02-06 | Login đúng → 200 | PENDING |
| AUTH-D02-07 | Login sai → 401, thông điệp chung | PENDING |
| AUTH-D02-08 | Disabled account → 401 theo giả định QA chờ BE chốt | PENDING; cần fixture disabled riêng |
| AUTH-D02-09 | Thiếu JWT → 401 trên API đã tích hợp | PENDING; scaffold 401 là bằng chứng khác |
| AUTH-D02-10 | JWT sai chữ ký → 401 | PENDING; cần token fixture đúng định dạng, sai chữ ký |
| AUTH-D02-11 | JWT đã hết hạn → 401 | PENDING; cần token đã được BE ký, exp trong quá khứ |
| AUTH-D02-12 | PATIENT gọi GET /users → 403 | PENDING; cần authenticated principal thực |
| AUTH-D02-13 | Identity self không chứa passwordHash | PENDING; kiểm tra global cũng áp dụng cho mọi request |
| AUTH-D02-14 | Thêm userId khác vào /auth/me không đổi danh tính/trả dữ liệu người khác | PENDING; cần hai account riêng và kiểm tra thêm endpoint dữ liệu theo contract sau này |

Request body `email/password/fullName`, envelope `data.role`, token `data.accessToken`
và duplicate 409 là giả định để BE review, chưa được API_CONTRACT hiện tại định nghĩa
DTO Auth chi tiết. Không coi mismatch với giả định là bằng chứng endpoint đã triển khai.
Fixture disabled/expired/wrongSignature/otherUserId/ID self để trống; thiếu fixture thì
skip, phải ghi PENDING, không tính PASS. Token thực không được gắn vào tham số command line.

Khi chạy tuần tự, collection sinh email `@example.test` và password synthetic vào biến
local của collection run; login dùng account vừa register. Biến token cũng chỉ local,
không export report đầy đủ sau khi bật Auth vì report có thể chứa request/response nhạy cảm.
Không có admin mặc định hoặc seed password. Role check ở DB cho phép ADMIN để nội bộ
provision sau review; service public phải ép PATIENT bất kể payload, không đổi role
và không tự liên kết patient theo email/phone.

## Chạy lại DB/Flyway + scaffold bằng bộ QA cô lập

Build `bootJar`, cài Newman vào thư mục tạm nếu chưa có; không sửa dependency project:

```powershell
Push-Location backend
.\gradlew.bat --no-daemon bootJar
Pop-Location
npm install --prefix "$env:TEMP/clinic-d02-newman" --no-audit --no-fund newman
python database/qa/validate_d02.py --newman "$env:TEMP/clinic-d02-newman/node_modules/newman/bin/newman.js"
```

Cần Docker Engine/Java 21 và quyền truy cập Docker named pipe. Runner dùng project,
port và volume mới; chỉ đọc metadata Clinic dùng chung, không kết nối SmartExpense.
Runner dùng Flyway/JDBC từ boot JAR (đúng BOM của BE), kiểm tra 46 assertion, chạy
5 request Postman, dừng app/container test và giữ volume. Không dùng clean/repair/baseline,
DROP DATABASE hay xóa volume. Chạy lại tạo instance mới, không migrate lại DB QA cũ.
