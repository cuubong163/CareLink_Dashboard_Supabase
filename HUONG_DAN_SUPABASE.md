# Lưu kết quả đo của nhóm lên Supabase

## Bản đã điền sẵn máy chủ của nhóm

Bản này đã có Project URL `https://gpwwyhnpbpqooqbfdpyy.supabase.co` và khóa publishable công khai trong `dist/supabase-config.js`. Mở đúng thư mục mới, chạy web và vào **Máy chủ Supabase**. Nếu trình duyệt đã lưu cấu hình của dự án khác từ trước, thay lại URL/khóa trong màn hình này rồi bấm **Lưu cấu hình Supabase**; cấu hình lưu trong trình duyệt được ưu tiên hơn file.

Đã kiểm tra API đăng nhập trả HTTP 200, cho phép đăng ký bằng email và yêu cầu xác nhận email. Hàm `carelink_schema_version` có trên máy chủ và từ chối khách chưa đăng nhập. Các kiểm tra này xác nhận máy chủ nhận cấu hình và có hàm CareLink; chưa xác nhận lưu được kết quả bằng tài khoản của nhóm.

Tiếp theo: trong Supabase đặt **Authentication → URL Configuration → Site URL** thành `http://localhost:8001` khi thử tại máy. Trên dashboard chọn **Đăng ký tài khoản**, xác nhận email, **Đăng nhập**, **Tạo nhóm**, rồi **Lưu 1 bộ mẫu mô phỏng**. Xem lịch sử và bảng `carelink_measurements` để xác nhận có dữ liệu. Tài khoản này là tài khoản ứng dụng CareLink, được tạo riêng với tài khoản quản trị Supabase.

Bộ mã đã có kết nối Supabase, đăng nhập, nhóm, quyền đọc/ghi, hàng chờ và lịch sử trên máy chủ. Các mục bên dưới là hướng dẫn đầy đủ cho cả dự án mới. Nếu đã chạy thành công `supabase/schema.sql` trong dự án của nhóm thì tiếp tục phần đăng nhập và thử lưu; không cần tạo dự án khác.

## 1. Mở đúng bản code mới

Giải nén vào thư mục mới. Mở thư mục **CareLink_Dashboard_Supabase** bằng VS Code. Bên trong phải có `dist`, `gateway`, `supabase`, `tests`, README và hướng dẫn này.

Terminal Windows:

```powershell
py -3 -m http.server 8001 --directory dist
```

Mở http://localhost:8001 → **Máy chủ Supabase**. Giữ Terminal đang chạy. Nếu cổng đã có web cũ, dừng Terminal cũ bằng Ctrl+C trước khi chạy hoặc đổi cổng.

## 2. Tạo/mở dự án Supabase của nhóm

1. Vào https://supabase.com/dashboard và đăng nhập tài khoản Supabase.
2. Nếu chưa có dự án, chọn **New project**, chọn tổ chức, đặt tên, mật khẩu cơ sở dữ liệu và khu vực, rồi tạo. Chờ dự án sẵn sàng.
3. Lấy **Project URL** và **Publishable key** trong phần Connect/API Keys của dự án. Dự án cũ có thể dùng **anon key**.
4. Giữ riêng mật khẩu cơ sở dữ liệu và các khóa **secret/service_role**. Bộ mã này không cần chúng trên web.

Các thành viên dùng cùng Project URL và publishable key nhưng đăng nhập bằng tài khoản ứng dụng riêng. Tài khoản đăng nhập dashboard CareLink khác với tài khoản quản trị Supabase.

## 3. Tạo bảng và phân quyền

1. Mở **SQL Editor** trong dự án Supabase → tạo truy vấn mới.
2. Trong VS Code, mở `supabase/schema.sql`, nhấn Ctrl+A, Ctrl+C.
3. Dán toàn bộ vào SQL Editor → bấm **Run**.
4. Chạy thành công sẽ có bốn bảng: `carelink_teams`, `carelink_members`, `carelink_measurements`, `carelink_ecg_batches` cùng các hàm CareLink.

Cũng có thể bấm **Tải SQL tạo bảng & phân quyền** trên dashboard để lấy cùng nội dung. Script chỉ thiết lập các đối tượng mang tên CareLink; không xóa bảng ứng dụng khác. Có thể chạy lại nguyên file khi cấu trúc CareLink chưa bị sửa thủ công.

Nếu web báo thiếu hàm/bảng, kiểm tra đã chạy hết file trong đúng dự án. Có thể đợi một lúc để API nhận cấu trúc mới rồi bấm **Kiểm tra bảng & nhóm**.

## 4. Cấu hình và đăng nhập trên dashboard

1. Vào **Máy chủ Supabase**, nhập Project URL và publishable/anon key → **Lưu cấu hình Supabase**.
2. Nhập email và mật khẩu ứng dụng → **Đăng ký tài khoản** nếu chưa có.
3. Nếu dự án yêu cầu xác nhận email, mở thư xác nhận rồi quay lại **Đăng nhập**. Không cần tắt xác nhận email.
4. Trong Supabase **Authentication → URL Configuration**, đặt Site URL phù hợp nơi mở web và khai báo địa chỉ chuyển hướng khi dùng liên kết email. Khi chạy tại máy, ví dụ `http://localhost:8001`; khi đưa web lên mạng, dùng địa chỉ web thật.
5. Khi đăng nhập và kiểm tra SQL thành công, trang mới hiện **Đã kết nối**. Chỉ lưu Project URL/khóa chưa được tính là đã kết nối thành công.

## 5. Tạo nhóm và cho bạn khác cùng xem

1. Người đầu tiên nhập tên nhóm → **Tạo nhóm**. Người tạo là trưởng nhóm.
2. Bạn khác mở cùng phiên bản web, nhập cùng URL/khóa, đăng ký và xác nhận email trong cùng dự án Supabase.
3. Trưởng nhóm nhập email đó trong **Thêm thành viên đã đăng ký**; chọn:
   - **Chỉ xem lịch sử**: đọc, lọc, xuất kết quả của nhóm.
   - **Xem và ghi kết quả**: có thêm quyền tải số đo lên.
4. Bạn ấy đăng nhập/bấm **Kiểm tra bảng & nhóm**, chọn đúng nhóm.

Nút thêm thành viên chỉ cập nhật quyền trong ứng dụng, không gửi thư mời. Biết mã nhóm không tự có quyền đọc dữ liệu. Người ngoài nhóm và khách chưa đăng nhập không đọc/ghi được bảng kết quả. Mã nguồn có thể công khai trên GitHub, còn dữ liệu phụ thuộc quyền trên Supabase.

## 6. Thử lưu khi chưa có mạch

1. Giữ trang ở chế độ **Mô phỏng**.
2. Đăng nhập, chọn nhóm có quyền ghi.
3. Bấm **Lưu 1 bộ mẫu mô phỏng**.
4. Khi máy chủ xác nhận, xem mục lịch sử với nguồn **Mô phỏng**: có kết quả mẫu của ba node.
5. Đóng/mở lại web, đăng nhập và lọc nguồn Mô phỏng để kiểm tra kết quả vẫn còn trên máy chủ.

Mẫu thử luôn có `source=demo`, không tự trộn vào kết quả thiết bị. Nếu gửi lỗi, dữ liệu giữ trong hàng chờ trên máy; chưa có xác nhận thì không tăng số đã lưu.

## 7. Lưu đo thật từ dashboard đang mở

Dùng cách này khi đang ghép thử mạch và chưa bật bộ gửi Supabase ở chương trình Gateway.

1. Chạy cầu nối Gateway theo README, mở web tại http://localhost:8080.
2. Vào **Kết nối & cài đặt → Thiết bị thực → Kết nối Gateway**. Cần nhìn thấy bản tin/số đo thật từ mạch.
3. Vào **Máy chủ Supabase**, đăng nhập, chọn nhóm có quyền ghi.
4. Chọn chu kỳ gom kết quả (mặc định 5 giây). Nếu cần, bật **Lưu cả các khối ECG thô**.
5. Bấm **Bắt đầu lưu đo thật**.
6. Kiểm tra số **Máy chủ đã xác nhận**, số **Đang chờ gửi** và lịch sử nguồn **Thiết bị thật**.

Trong mỗi khoảng gom, lưu giá trị hợp lệ mới nhất của từng trường được nhận. Bản ghi không phải mọi mẫu số đo tại mọi thời điểm. Thay đổi còi, quạt, trạng thái vận động, cờ xoay trở được tách để giữ các chuyển trạng thái. Thời điểm `observed_at` là lúc web/cầu nối nhận bản tin, chưa phải thời gian đã đồng bộ chính xác từ cảm biến.

ECG thô mặc định không lưu để giảm dung lượng. Khi bật, giữ các gói mẫu theo thứ tự, tần số `rate` và thời gian nhận; gộp thành khối trong bảng riêng. Tần số phải có trong từng gói, nhận 125/200/250/500 Hz. Khối tự tách trước 6000 mẫu. Gói thiếu tần số, có số không hợp lệ hoặc quá dài không được dùng làm ECG thô; số đo hợp lệ khác vẫn có thể lưu. Không tự quy đổi ADC thành mV hoặc bổ sung mẫu mất.

**Khi lưu từ web, cần giữ web mở, đăng nhập và nhận bản tin.** Bấm **Dừng lưu**, sau đó **Gửi dữ liệu đang chờ** trước khi đóng. Hàng chờ IndexedDB giữ những bản ghi đã gom khi mạng lỗi; phần đang gom trong khoảng cuối vẫn ở bộ nhớ cho đến lần gom/dừng tiếp theo. Mỗi nơi ghi có tối đa 5000 bản ghi chờ; đầy hàng chờ sẽ báo lỗi/dừng thu thay vì báo đã lưu.

## 8. Lưu từ Gateway kể cả khi đóng trình duyệt

Để vận hành độc lập với web, dùng chương trình `gateway/gateway.py` đi kèm. Máy tính chạy chương trình Gateway vẫn phải bật, nhận bản tin và có mạng hoặc còn chỗ trong hàng chờ. ESP32-S3 vẫn làm phần BLE/LoRa; Python nhận MQTT đã chuẩn hóa. Bộ này không thay firmware của nhóm.

Chọn **một nơi ghi cho mỗi luồng đo**: web hoặc Gateway. Nếu bật Gateway lưu, bấm Dừng lưu trên web; web vẫn đọc lịch sử được. Hai nơi gom gói ở các thời điểm khác nhau có thể tạo bản ghi chồng nhau.

1. Tạo một tài khoản ứng dụng riêng để Gateway ghi kết quả; xác nhận email. Trưởng nhóm thêm tài khoản đó với quyền **Xem và ghi kết quả**.
2. Sao chép mã nhóm từ ô **Mã nhóm dùng cho Gateway**.
3. Cài thư viện trong VS Code:

```powershell
py -3 -m venv .venv
.venv\Scripts\python.exe -m pip install -r gateway\requirements.txt
```

4. Đặt biến môi trường trong **cùng Terminal PowerShell**, thay các giá trị ví dụ bằng thông tin của nhóm:

```powershell
$env:GATEWAY_BRIDGE="1"
$env:MQTT_HOST="IP_BROKER_CUA_NHOM"
$env:MQTT_PORT="1883"
$env:SUPABASE_URL="https://TEN_DU_AN.supabase.co"
$env:SUPABASE_PUBLISHABLE_KEY="PUBLISHABLE_KEY_CUA_NHOM"
$env:SUPABASE_TEAM_ID="MA_NHOM_SAO_CHEP_TREN_WEB"
$env:SUPABASE_EMAIL="EMAIL_TAI_KHOAN_GHI"
$carelinkPassword = Read-Host "Mat khau tai khoan ghi" -AsSecureString
$env:SUPABASE_PASSWORD = [System.Net.NetworkCredential]::new("", $carelinkPassword).Password
$env:SUPABASE_SAVE_INTERVAL="5"
$env:SUPABASE_SAVE_ECG="0"
.venv\Scripts\python.exe gateway\gateway.py
```

`SUPABASE_PASSWORD` là mật khẩu tài khoản ứng dụng có quyền ghi, không phải mật khẩu cơ sở dữ liệu. Đổi `SUPABASE_SAVE_ECG="1"` để lưu cả ECG thô. Không đưa thông tin đăng nhập thật lên GitHub.

5. Khi có số đo, Terminal báo **Supabase xác nhận** sau phản hồi từ máy chủ. Nếu thiếu biến/sai thông tin, Terminal báo chưa bật hoặc gửi lỗi; kiểm tra lại trước khi coi là đang lưu.
6. Hàng chờ SQLite nằm ở `gateway/data/supabase-outbox.sqlite3`, được tách theo dự án, nhóm và tài khoản. Gửi thất bại không xóa hàng chờ; gửi lại cùng ID không tạo thêm kết quả trùng. Thư mục dữ liệu được loại khỏi Git/ZIP. Không xóa file hàng chờ khi còn bản ghi chưa gửi.
7. Khi dừng bằng Ctrl+C, phần đang gom được đưa vào hàng chờ nếu còn dung lượng. Máy bị tắt đột ngột có thể mất phần đang gom cuối cùng. Khi hàng chờ đầy cần khôi phục mạng, gửi hết phần chờ và khởi động lại bộ gửi nếu nó đã dừng thu.

Biến môi trường không tự được đọc từ `.env`; hãy đặt trong Terminal hoặc cấu hình dịch vụ chạy Gateway của nhóm. Không cần thêm Raspberry Pi hay service_role key.

## 9. Đọc lại, xuất kết quả và phạm vi hiện tại

- Lịch sử máy chủ lọc theo node, nguồn thiết bị/mô phỏng và khoảng thời gian; thời gian bộ lọc theo máy đang mở web.
- Mỗi trang tối đa 100 bản ghi, phân trang theo thời gian/ID. Trang mới nhất tự đọc lại khoảng 10 giây; có thể bấm Làm mới.
- **Xuất CSV trang này** chỉ xuất các bản ghi đang xem, có mã bản ghi, nguồn, người ghi và thời gian. Phần ECG thô được tải riêng bằng nút ECG ở dòng Node 1 nếu đã bật lưu.
- Supabase lưu kết quả và trạng thái gửi lên, không tự đo cảm biến/nhận LoRa/BLE hoặc xác định bệnh lý. Nhãn nghi co giật vẫn do Gateway cung cấp.
- Các nút điều khiển còi/quạt của trang chính giữ đường WebSocket Gateway và cơ chế ACK cũ. Bản này chưa chuyển lệnh điều khiển qua Supabase và chưa đẩy số liệu Supabase vào biểu đồ trực tiếp của trang chính. Mở Máy chủ Supabase để xem lịch sử từ xa.
- Cảnh báo/nhật ký thao tác tạo trong trình duyệt vẫn là nhật ký của phiên; các cờ trạng thái trong bản tin thiết bị được lưu cùng kết quả đo.
- Trạng thái thành viên và dữ liệu được bảo vệ bởi RLS. Kiểm tra quyền của dự án trước khi dùng ngoài phạm vi bài tập; không dùng bộ này như thiết bị giám sát lâm sàng đã được chứng nhận.

## 10. Kiểm tra và cấu trúc

Chạy web không cần npm. Để chạy bộ kiểm tra JS/SQL bằng PostgreSQL nhúng:

```bash
npm ci --include=dev
npm test
python -m unittest discover -s gateway -p "test_*.py" -v
```

Kiểm tra SQL dùng PGlite với vai trò tương ứng Supabase để xác nhận quyền đọc/ghi, cách ly nhóm, gửi lại không trùng và dữ liệu ECG. Đây không thay thế kiểm tra trên dự án Supabase thật hoặc mạch thật. Thư viện Supabase JS đã được đóng gói tại `dist/vendor`, không cần CDN khi chạy.

Tài liệu chính thức: https://supabase.com/docs/guides/getting-started/api-keys · https://supabase.com/docs/guides/database/postgres/row-level-security · https://supabase.com/docs/guides/auth/passwords

Có thể cấu hình sẵn Project URL và publishable/anon key trong `dist/supabase-config.js` để các bạn mở cùng bản web không cần nhập lại hai trường. Mỗi thành viên vẫn phải đăng nhập và có quyền nhóm. Chỉ dùng khóa công khai dành cho ứng dụng, không đặt mật khẩu/secret/service_role trong file này. Cấu hình lưu riêng trong trình duyệt được ưu tiên hơn giá trị mặc định.
