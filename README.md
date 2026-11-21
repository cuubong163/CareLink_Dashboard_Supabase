# CareLink — Dashboard 3 node và Supabase

Giao diện tiếng Việt: sinh hiệu, môi trường phòng và giường bệnh. Node 3 đã thay chức năng té ngã bằng góc nâng đầu giường, dấu hiệu co giật/kích động và nhắc xoay trở chống loét tỳ đè.


## Mới: lưu kết quả lên Supabase

Đọc **HUONG_DAN_SUPABASE.md** để ghép dự án của nhóm. Mở mục **Máy chủ Supabase** trên web để cấu hình URL/khóa, đăng ký/đăng nhập, tạo nhóm, phân quyền và đọc lịch sử.

- File tạo bảng và quyền: `supabase/schema.sql`.
- Lưu từ dashboard đang mở: nhận bản tin thật qua Gateway rồi bật lưu; dữ liệu mô phỏng chỉ lưu khi bấm nút thử có nhãn riêng.
- Lưu độc lập khi đóng web: cấu hình bộ gửi trong `gateway/supabase_sync.py` theo hướng dẫn; máy chạy Gateway vẫn phải bật.
- Có hàng chờ, xác nhận từ máy chủ, chống gửi lại trùng ID, lịch sử theo nhóm và xuất CSV.
- Giao diện chạy không cần npm; thư viện Supabase JS đã có trong `dist/vendor`.

Bộ mã chưa chứa URL/khóa hoặc tài khoản của dự án Supabase thật. Chỉ nhập publishable/anon key trên web. Chạy SQL và đăng nhập thành công mới được coi là đã kết nối. Chọn một nơi ghi cho mỗi luồng đo: web hoặc Gateway.

## 1. Mở trong VS Code, chạy ngay khi chưa có mạch

Cài Python 3.10 trở lên. Giải nén toàn bộ ZIP, chọn **File → Open Folder** trong VS Code, mở thư mục chứa README này. Chọn **Terminal → New Terminal**, chạy trên Windows:

```powershell
py -3 -m http.server 8000 --directory dist
```

Trên Linux/macOS:

```bash
python3 -m http.server 8000 --directory dist
```

Mở **http://localhost:8000** bằng trình duyệt. Giữ Terminal đang chạy; Ctrl+C để dừng. Không cần npm/Node.js để mở giao diện.

Dashboard khởi động ở **Mô phỏng**, có nhãn rõ trên giao diện. Vào **Giường bệnh**, kéo thanh góc và thử các nút kích động, nghi co giật, đến giờ xoay trở, đã xoay trở, bật/tắt còi. Vào **Cảnh báo** để tiếp nhận sự kiện; **Lịch sử dữ liệu** để xem và xuất CSV.

Trong **Thiết bị thực**, dữ liệu chưa gửi hoặc đã quá hạn sẽ hiện chờ. Web không điền dữ liệu mô phỏng vào chế độ này.

## 2. Kiến trúc theo sơ đồ mới

| Node | Chức năng | Kết nối với ESP32-S3 |
|---|---|---|
| 1: ESP32 + MAX30102 + AD8232 | Nhịp tim, SpO₂, ECG | Wi-Fi/MQTT |
| 2: ESP32 + DHT22 + relay | Nhiệt độ, độ ẩm, quạt | LoRa 433 MHz |
| 3: ESP32 + MPU6050 + buzzer | Giường bệnh, vận động, lịch chăm sóc | BLE GATT hai chiều |

ESP32-S3 xử lý BLE/LoRa và chuẩn hóa dữ liệu. Web làm việc với **một địa chỉ WebSocket của cầu nối Gateway**, không trực tiếp đọc BLE hoặc LoRa. Nhóm phần cứng thực hiện đo cảm biến, phân tích vận động và điều khiển thiết bị.

Gửi **INTEGRATION_NODE3.md** cho bạn làm Gateway để thống nhất trường dữ liệu, đơn vị và phản hồi lệnh.

## 3. Kết nối thật qua cầu nối Python

Nếu ESP32-S3/máy chủ nhóm đã có WebSocket đúng định dạng, chỉ cần nhập địa chỉ đó trong **Kết nối & cài đặt → Thiết bị thực → Kết nối Gateway**.

Nếu nhóm dùng MQTT, có thể dùng cầu nối đi kèm để chuyển MQTT đã chuẩn hóa thành WebSocket. Cầu nối không thay chương trình BLE/LoRa trên ESP32-S3.

### Windows PowerShell

Tại thư mục chứa README:

```powershell
py -3 -m venv .venv
.venv\Scripts\python.exe -m pip install -r gateway\requirements.txt
$env:GATEWAY_BRIDGE="1"
$env:MQTT_HOST="192.168.1.10"
$env:MQTT_PORT="1883"
.venv\Scripts\python.exe gateway\gateway.py
```

Thay IP ví dụ bằng IP **broker MQTT thực tế**. Broker là dịch vụ riêng mà ESP32-S3, Node 1 và cầu nối truy cập được; phần mềm không tự cài broker.

Mở **http://localhost:8080** → **Kết nối & cài đặt** → **Thiết bị thực** → nhập `ws://localhost:8080/ws` → **Kết nối Gateway**. Khi dùng cầu nối, mở web ở cổng 8080 để cùng nguồn với WebSocket; không cần giữ máy chủ cổng 8000.

### Linux/macOS

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r gateway/requirements.txt
export GATEWAY_BRIDGE=1
export MQTT_HOST=192.168.1.10
export MQTT_PORT=1883
.venv/bin/python gateway/gateway.py
```

Có thể đặt `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_TLS=1` và cổng TLS phù hợp khi broker yêu cầu. Không đưa mật khẩu lên GitHub.

Bản web trực tuyến HTTPS cần địa chỉ **wss://** truy cập được từ máy người xem. Để thực hành, chạy web và cầu nối cùng máy như trên. Cầu nối mặc định chỉ nghe `127.0.0.1:8080`; bản mẫu chưa có xác thực để mở trực tiếp ra Internet. Nếu dùng máy chủ riêng, nhóm cần cấu hình WSS, xác thực và `ALLOWED_ORIGINS` khớp nguồn web.

## 4. Hành vi Node 3

- Hiển thị góc nâng đầu giường; khoảng minh họa 30–45°, có thể chỉnh.
- Nhận cờ `normal`, `agitation`, `suspected_seizure` do Gateway phân tích. Web hiển thị **nghi ngờ**, không tự chẩn đoán từ tần số rung.
- Nhắc xoay trở theo thời điểm Gateway ghi nhận; chu kỳ minh họa 120 phút, có thể chỉnh theo kế hoạch chăm sóc.
- Điều khiển bật/tắt còi qua Gateway → BLE → Node 3; chỉ cập nhật theo dữ liệu thiết bị hoặc ACK thành công đúng mã lệnh.
- MQTT publish thành công chưa có nghĩa còi đã bật. Gateway chỉ trả ACK thành công sau phản hồi thực hiện từ Node 3.
- Sai ACK, bị từ chối hoặc hết thời gian chờ: ghi nhật ký, không tự báo còi đã đổi trạng thái.
- Tiếp nhận cảnh báo không tự tắt còi, không đánh dấu đã xoay trở. Đổi góc đầu giường không tự tính là xoay trở người bệnh.
- Trong chế độ thật, lần xoay trở được Gateway cập nhật sau xác nhận của người chăm sóc. Nút đã xoay trở trên trang thử chỉ dành cho mô phỏng.

Ngưỡng cài trên web áp dụng cho phiên web. Nếu Gateway tự nhắc/hú còi khi web đóng, nhóm cần đặt và đồng bộ cùng ngưỡng tại Gateway. Bản này không điều khiển mô tơ nâng giường.

## 5. Phạm vi bàn giao

Bộ mã có giao diện, mô phỏng, quy ước bản tin và cầu nối Python. Chưa kèm firmware ESP32/ESP32-S3, định dạng nhị phân LoRa hoặc UUID BLE của mạch nhóm. Chưa ghép thử phần cứng thật.

Blynk trong slide là nền tảng khác. Web tùy chỉnh này chưa tự đọc dữ liệu Blynk/chân ảo Blynk; cần bổ sung đường MQTT/WebSocket hoặc adapter Blynk riêng nếu nhóm chỉ dùng Blynk.

Nhật ký cục bộ vẫn theo phiên mở trang. Mục Máy chủ Supabase có lịch sử đo lưu theo nhóm khi đã cấu hình và bật bộ gửi. Chưa có thông báo khi đóng web. Tự bật quạt ở web chỉ chạy khi trang đang mở; quy tắc độc lập cần chạy ở Gateway.

Adapter RS485/LoRa Serial cũ vẫn giữ trong `gateway.py` cho dự án trước. Chúng chỉ chạy khi `GATEWAY_BRIDGE` khác `1`; **không dùng chúng cho sơ đồ BLE/LoRa mới**. Quy ước Node 3 té ngã cũ không được web sử dụng.

## 6. Các file chính

| File/thư mục | Nội dung |
|---|---|
| `dist/index.html`, `styles.css`, `app.js` | Giao diện chung |
| `dist/bed-model.js`, `bed-ui.js` | Dữ liệu và giao diện giường bệnh |
| `gateway/gateway.py` | Cầu nối MQTT–WebSocket |
| `gateway/requirements.txt` | Thư viện Python |
| `INTEGRATION_NODE3.md` | Bản tin để bàn giao cho nhóm Gateway |
| `tests/`, `gateway/test_gateway.py` | Kiểm tra phần mềm |

Chỉ cần sửa `dist/` khi làm giao diện. Phông trực tuyến có phông hệ thống dự phòng.

Kiểm tra mô hình giường và luồng lệnh bằng Node.js 18 trở lên, không cần npm install:

```bash
node --test tests/*.test.cjs
```

Sau khi cài thư viện Python:

```bash
python -m unittest discover -s gateway -p "test_*.py" -v
```

Các kiểm tra bao gồm dữ liệu thiếu/quá hạn, lịch xoay trở, tách mô phỏng/thực, ACK đúng/sai/từ chối/hết hạn và MQTT–WebSocket. Kết quả phần mềm không thay cho đo thử mạch thật.
