# Phạm vi chức năng — Clinic Management System

Task nền tảng: **CL-D01-BE**. Phạm vi hệ thống: **một phòng khám**, không có đa chi nhánh.
Đây là yêu cầu dự kiến cho D01–D15; danh sách FR không có nghĩa chức năng đã được triển khai.
D01 chỉ tạo backend scaffold, health endpoint, bảo mật mặc định và tài liệu.
JWT, tài khoản, bảng nghiệp vụ, đặt lịch và giao diện chưa được triển khai trong D01.

## Quy ước

- P0: bắt buộc cho luồng khám cơ bản; P1: cần cho quản trị/vận hành; P2: có thể làm sau các luồng chính.
- ADMIN: quản trị phòng khám; DOCTOR: bác sĩ; RECEPTIONIST: lễ tân; PATIENT: bệnh nhân.
- Vai trò là điều kiện đầu tiên. Mọi truy cập dữ liệu phải kiểm tra thêm chủ sở hữu/phân công;
  ADMIN không mặc nhiên được sửa nội dung chuyên môn của bác sĩ.
- Tất cả điều kiện nghiệm thu dưới đây là **sơ bộ**, cần FE/BE/DB thống nhất trước khi triển khai.
- Không xóa vật lý hồ sơ khám hoặc lịch đã phát sinh; ưu tiên trạng thái và audit.
- Thời điểm trao đổi qua API dùng ISO-8601 UTC; giao diện hiển thị theo `Asia/Ho_Chi_Minh`.

## FR-01 — Xác thực và phân quyền

- **Mục tiêu:** xác định đúng người dùng, giới hạn API và dữ liệu theo vai trò.
- **Vai trò:** cả bốn vai trò; ADMIN quản lý cấp quyền và khóa tài khoản.
- **Chức năng con:** đăng ký PATIENT; đăng nhập/đăng xuất; xem danh tính hiện tại;
  đổi mật khẩu; quản lý trạng thái tài khoản; kiểm tra role và quyền sở hữu phía BE.
  Client không được tự cấp role nhân viên qua đăng ký hoặc cập nhật hồ sơ.
- **Ưu tiên:** P0.
- **Nghiệm thu sơ bộ:** mật khẩu được băm; sai thông tin đăng nhập trả lỗi chung;
  anonymous không truy cập API bảo vệ; sai quyền trả 403; không đọc được dữ liệu bệnh nhân khác.
  Cơ chế token, refresh/revoke và vòng đời phiên phải chốt trước khi làm JWT ở ngày sau.

## FR-02 — Hồ sơ cá nhân

- **Mục tiêu:** người dùng xem và cập nhật thông tin cá nhân hợp lệ.
- **Vai trò:** ADMIN, DOCTOR, RECEPTIONIST, PATIENT cho hồ sơ của mình.
- **Chức năng con:** xem hồ sơ; cập nhật tên, số điện thoại, thông tin liên hệ;
  hiển thị role/trạng thái chỉ đọc; không nhận mật khẩu qua API hồ sơ.
- **Ưu tiên:** P0.
- **Nghiệm thu sơ bộ:** dữ liệu bắt buộc và định dạng được kiểm tra; trường role/id/trạng thái
  không bị ghi đè qua payload; cập nhật không ảnh hưởng hồ sơ người khác.

## FR-03 — Bác sĩ

- **Mục tiêu:** quản lý danh sách bác sĩ phục vụ phân công và chọn lịch.
- **Vai trò:** ADMIN quản lý; RECEPTIONIST xem để điều phối; DOCTOR xem bản thân;
  PATIENT xem danh mục bác sĩ đang hoạt động sau đăng nhập.
- **Chức năng con:** tạo/cập nhật thông tin công tác; liên kết chuyên khoa và tài khoản DOCTOR;
  tìm kiếm, phân trang, bật/tắt nhận lịch; chỉ công khai trường phù hợp cho PATIENT.
- **Ưu tiên:** P0.
- **Nghiệm thu sơ bộ:** bác sĩ phải gắn chuyên khoa hợp lệ; bác sĩ ngừng hoạt động không nhận lịch mới;
  thao tác vô hiệu hóa không xóa lịch sử khám và phải kiểm tra lịch tương lai.

## FR-04 — Chuyên khoa

- **Mục tiêu:** có danh mục chuyên khoa thống nhất để lọc bác sĩ và lịch khám.
- **Vai trò:** ADMIN quản lý; các vai trò còn lại xem danh mục hoạt động.
- **Chức năng con:** tạo, sửa tên/mô tả; xem danh sách; vô hiệu hóa chuyên khoa.
- **Ưu tiên:** P0.
- **Nghiệm thu sơ bộ:** mã chuyên khoa duy nhất; không liên kết bác sĩ mới vào chuyên khoa bị khóa;
  vô hiệu hóa phải xử lý tham chiếu hiện có và không làm mất lịch sử.

## FR-05 — Bệnh nhân

- **Mục tiêu:** quản lý định danh bệnh nhân thống nhất cho đặt lịch và khám.
- **Vai trò:** RECEPTIONIST tạo/tìm/cập nhật thông tin hành chính; PATIENT xem bản thân;
  DOCTOR xem bệnh nhân được phân công; ADMIN quản lý thông tin hành chính và trạng thái.
- **Chức năng con:** tạo hồ sơ tại quầy; liên kết tài khoản PATIENT khi có;
  tìm kiếm theo mã/tên/điện thoại có phân trang; cập nhật thông tin cơ bản; cảnh báo trùng.
- **Ưu tiên:** P0.
- **Nghiệm thu sơ bộ:** mã bệnh nhân duy nhất; ngày sinh hợp lệ; số điện thoại không bị coi là
  định danh duy nhất vì người thân có thể dùng chung; không trả danh sách toàn bộ bệnh nhân cho PATIENT.

## FR-06 — Lịch làm việc

- **Mục tiêu:** xác định thời gian bác sĩ nhận khám và các khung còn trống.
- **Vai trò:** ADMIN/RECEPTIONIST quản lý; DOCTOR xem lịch mình; PATIENT xem khung có thể đặt.
- **Chức năng con:** tạo ca, cập nhật ca tương lai, khóa ca; xem theo bác sĩ/ngày;
  sinh hoặc liệt kê slot theo thời lượng cấu hình đã thống nhất.
- **Ưu tiên:** P0.
- **Nghiệm thu sơ bộ:** bắt đầu trước kết thúc; không chồng ca của cùng bác sĩ;
  không tạo ca trong quá khứ; ca có lịch hẹn không được âm thầm xóa/thu hẹp;
  lịch trống không tiết lộ danh tính bệnh nhân khác.

## FR-07 — Đặt / đổi / hủy lịch

- **Mục tiêu:** đặt lịch nhất quán, tránh hai người giữ cùng slot.
- **Vai trò:** PATIENT thao tác lịch của mình; RECEPTIONIST thao tác thay tại quầy;
  ADMIN giám sát; DOCTOR xem lịch được phân công.
- **Chức năng con:** tạo lịch; xem danh sách/chi tiết; đổi slot; hủy kèm lý do;
  lọc theo ngày, trạng thái và bác sĩ trong phạm vi được phép.
- **Ưu tiên:** P0.
- **Nghiệm thu sơ bộ:** kiểm tra bác sĩ/slot hoạt động, thời điểm tương lai và trạng thái lịch;
  hai yêu cầu đồng thời cho một slot chỉ một yêu cầu thành công, yêu cầu còn lại nhận 409;
  đổi slot phải atomic để lỗi không làm mất lịch cũ; không đổi/hủy lịch đã khám xong.
  Thời hạn đổi/hủy, giới hạn đặt và cách xử lý đến muộn cần phòng khám chốt.

## FR-08 — Xác nhận và check-in

- **Mục tiêu:** lễ tân kiểm soát danh sách đến khám và tình trạng tiếp nhận.
- **Vai trò:** RECEPTIONIST thực hiện; DOCTOR xem hàng đợi của mình;
  PATIENT xem trạng thái lịch của mình; ADMIN giám sát.
- **Chức năng con:** xác nhận lịch, check-in, đánh dấu vắng; ghi người và thời điểm thao tác.
- **Ưu tiên:** P0.
- **Nghiệm thu sơ bộ:** chuyển trạng thái theo sơ đồ được chấp thuận trong API contract;
  không check-in lịch hủy; check-in lặp không tạo lượt khám thứ hai;
  cập nhật đồng thời phát hiện xung đột thay vì ghi đè.

## FR-09 — Hồ sơ khám

- **Mục tiêu:** ghi nhận nội dung khám gắn với một lượt tiếp nhận.
- **Vai trò:** DOCTOR được phân công tạo/sửa/hoàn tất/công bố; PATIENT đọc bản đã hoàn tất và công bố của mình;
  RECEPTIONIST chỉ xem trạng thái vận hành; ADMIN xem metadata phục vụ vận hành/audit.
- **Chức năng con:** tạo hồ sơ từ lịch đã check-in; lưu triệu chứng, chẩn đoán, ghi chú;
  lưu nháp và hoàn tất; liên kết bác sĩ, bệnh nhân và lịch hẹn.
- **Ưu tiên:** P0.
- **Nghiệm thu sơ bộ:** mỗi lịch hẹn tối đa một hồ sơ khám; không khám lịch của bác sĩ khác;
  bản hoàn tất không được sửa trực tiếp; điều chỉnh sau hoàn tất cần quy trình/audit riêng;
  payload phải kiểm tra độ dài và trường bắt buộc trước khi hoàn tất.

## FR-10 — Lịch sử khám

**Thay đổi policy D11 so với SRS/D10:** PATIENT chỉ đọc nội dung hồ sơ của mình sau
khi hồ sơ đã hoàn tất và được công bố riêng bởi DOCTOR được phân công. Hoàn tất
không tự công bố. Policy áp dụng cho cả GET hồ sơ, lookup theo appointment và lịch sử.
BE triển khai phạm vi bác sĩ chỉ xem lượt do chính mình được phân công. Công bố lặp
với version hiện tại trả kết quả đã công bố, version cũ trả 409. Hồ sơ cũ chưa có
metadata công bố không được PATIENT đọc. V10 của QA backfill riêng các hồ sơ D10
đã hoàn tất hợp lệ để bảo toàn quyền đọc cũ, dùng thời điểm/người hoàn tất làm metadata
công bố lịch sử và giữ version, nội dung, timestamps cũ. Các hồ sơ hoàn tất sau V10
vẫn phải được công bố riêng. Mapping công bố theo V10 do Database/QA sở hữu.

- **Mục tiêu:** tra cứu các lượt khám trước theo quyền truy cập.
- **Vai trò:** PATIENT xem lịch sử bản thân; DOCTOR xem lịch sử cần cho bệnh nhân đang được
  phân công; RECEPTIONIST/ADMIN xem metadata vận hành, không tự động xem nội dung lâm sàng.
- **Chức năng con:** danh sách theo thời gian, phân trang/lọc; xem chi tiết hồ sơ hoàn tất
  và đơn thuốc mô phỏng theo quyền; trả trường dữ liệu khác nhau theo vai trò.
- **Ưu tiên:** P0.
- **Nghiệm thu sơ bộ:** kết quả đúng bệnh nhân, thứ tự thời gian ổn định;
  không lộ bản nháp cho PATIENT; không thể đổi patientId để xem lịch sử người khác.

## FR-11 — Đơn thuốc mô phỏng

- **Mục tiêu:** mô phỏng ghi nhận chỉ định thuốc trong phạm vi đồ án.
- **Vai trò:** DOCTOR được phân công lập/sửa bản nháp; PATIENT xem đơn đã hoàn tất của mình.
- **Chức năng con:** thêm thuốc, liều, tần suất, số ngày và hướng dẫn;
  liên kết hồ sơ khám; khóa sửa khi hồ sơ hoàn tất; hiển thị nhãn mô phỏng.
- **Ưu tiên:** P1.
- **Nghiệm thu sơ bộ:** số lượng/số ngày hợp lệ; đơn phải thuộc lượt khám của bác sĩ;
  API không bán thuốc, không trừ kho, không phát hành đơn điện tử pháp lý;
  không có tư vấn kê đơn tự động.

## FR-12 — Dashboard

- **Mục tiêu:** cung cấp số liệu vận hành theo vai trò.
- **Vai trò:** ADMIN xem toàn phòng khám; RECEPTIONIST xem vận hành trong khoảng ngày được chọn;
  DOCTOR xem lịch/khám của mình; PATIENT dùng danh sách lịch riêng thay dashboard quản trị.
- **Chức năng con:** số lịch theo trạng thái; lượt check-in/hoàn tất; tổng bệnh nhân trong phạm vi;
  bộ lọc khoảng thời gian; không có doanh thu thanh toán trong phạm vi hiện tại.
- **Ưu tiên:** P1.
- **Nghiệm thu sơ bộ:** số đếm đối chiếu được với dữ liệu nguồn cùng múi giờ và khoảng thời gian;
  bác sĩ không xem số liệu của bác sĩ khác; không đưa thông tin nhạy cảm vào thẻ tổng hợp.

## FR-13 — Thông báo

- **Mục tiêu:** người dùng nhận biết các thay đổi quan trọng của lịch khám.
- **Vai trò:** PATIENT và DOCTOR nhận thông báo liên quan; RECEPTIONIST/ADMIN nhận theo nghiệp vụ.
  Baseline D13 chỉ tự phát cho PATIENT/DOCTOR hợp lệ có liên kết, chưa phát hàng loạt
  cho ADMIN/RECEPTIONIST khi chưa có quy tắc người nhận xác định.
- **Chức năng con:** thông báo trong ứng dụng khi tạo/đổi/hủy/xác nhận lịch;
  danh sách phân trang; đếm chưa đọc; đánh dấu đã đọc theo người nhận.
  Email/SMS/push và nhắc lịch theo giờ là mở rộng cần chốt kênh, chi phí và lịch chạy.
- **Ưu tiên:** P2.
- **Nghiệm thu sơ bộ:** chỉ người nhận đọc/cập nhật được thông báo; retry không tạo bản trùng;
  giao dịch đặt lịch thất bại không sinh thông báo thành công; không chứa chẩn đoán trong tiêu đề.

## FR-14 — Báo cáo và audit log

- **Mục tiêu:** tổng hợp hoạt động và truy vết thao tác quan trọng.
- **Vai trò:** ADMIN xem báo cáo/audit; RECEPTIONIST chỉ xem báo cáo tiếp nhận;
  DOCTOR xem thống kê cá nhân khi được cho phép; PATIENT không truy cập audit hệ thống.
- **Chức năng con:** báo cáo lượt khám theo ngày/chuyên khoa/bác sĩ/trạng thái;
  audit thay đổi tài khoản, lịch, check-in, hoàn tất hồ sơ; lọc theo người/thời gian/hành động.
- **Ưu tiên:** P1.
- **Nghiệm thu sơ bộ:** audit ghi actor, thời điểm UTC, loại đối tượng, id, hành động và kết quả;
  không ghi mật khẩu, token, payload hồ sơ lâm sàng hoặc thông tin kết nối;
  audit không có API sửa/xóa cho người dùng; số liệu báo cáo khớp dashboard theo cùng bộ lọc.
  CSV/export và thời hạn lưu dữ liệu cần thống nhất riêng trước khi bổ sung.

## Mở rộng tương lai — FR-15: QR thanh toán

**Ngoài phạm vi D01–D15, không triển khai.** Chỉ ghi nhận ý tưởng tạo QR thanh toán,
đối soát và trạng thái thanh toán ở giai đoạn sau. Không tạo endpoint, bảng thanh toán,
tích hợp ngân hàng hoặc logic doanh thu trong D01. FR-15 không phải điều kiện nghiệm thu D01–D15.

## Điểm cần chốt trước triển khai nghiệp vụ

Đối chiếu cụ thể với ERD Database/QA, các khác biệt và owner đề xuất cho migration V1:
[SCHEMA_REVIEW_D01](../SCHEMA_REVIEW_D01.md). Đây là các quyết định còn mở,
không phải schema được phê duyệt qua kiểm thử kết nối D01.

- FE/BE: cơ chế đăng nhập, token/cookie và CSRF/CORS, danh mục trường hiển thị theo role,
  message lỗi, phân trang và hiển thị múi giờ.
- BE/DB: ERD, loại id, unique constraint chống đặt trùng, khóa/optimistic locking, thời lượng slot,
  chuyển trạng thái, lịch sử điều chỉnh hồ sơ và trách nhiệm viết Flyway migration.
- Phòng khám: giờ làm, thời hạn đổi/hủy/check-in, quyền đọc lịch sử của bác sĩ và thời hạn lưu audit.
