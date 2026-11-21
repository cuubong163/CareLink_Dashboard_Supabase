# Bàn giao kết nối CareLink cho nhóm Gateway

## 1. Đường truyền

Theo sơ đồ mới: Node 1 Wi-Fi/MQTT, Node 2 LoRa 433 MHz, Node 3 BLE GATT; Gateway phần cứng ESP32-S3. ESP32-S3 giải mã BLE/LoRa và phân tích tín hiệu trước khi gửi dữ liệu đã chuẩn hóa cho web.

Quy ước dưới đây là **đề xuất tích hợp cho phần web**. Nhóm firmware cần thực hiện hoặc ánh xạ từ định dạng đang dùng. UUID BLE, khung nhị phân LoRa và thuật toán phân tích không nằm trong bộ mã này.

Với cầu nối Python: MQTT → `gateway/gateway.py` ở chế độ `GATEWAY_BRIDGE=1` → WebSocket `/ws`. Có thể dùng máy chủ WebSocket khác nếu giữ cùng định dạng JSON. Broker là dịch vụ riêng, không mặc nhiên có sẵn trên ESP32-S3.

Blynk trong slide chưa kết nối tự động với web này. Nếu chỉ có Blynk, nhóm cần bổ sung đường MQTT/WebSocket hoặc adapter Blynk.

## 2. Node 3 gửi trạng thái giường lên

```json
{
  "type": "telemetry",
  "node": 3,
  "boot_id": "bed03-boot-001",
  "seq": 1,
  "data": {
    "head_angle": 35.0,
    "motion_status": "normal",
    "motion_hz": 0.2,
    "vibration_rms": 0.012,
    "last_reposition_at": 1794913200000,
    "reposition_due": false,
    "buzzer": false,
    "battery": 86,
    "reason": "Đã nhận dữ liệu giường 03"
  }
}
```

Thời gian trên chỉ là ví dụ; khi chạy dùng thời điểm thật.

| Trường trong `data` | Kiểu/đơn vị | Ý nghĩa |
|---|---|---|
| `head_angle` | Số, độ; -20..90 | Góc đầu giường với phương ngang, đã hiệu chuẩn |
| `motion_status` | Chuỗi | `normal`, `agitation`, `suspected_seizure` |
| `motion_hz` | Số, Hz; tùy chọn | Tần số rung do Gateway tính, không phải tần số lấy mẫu |
| `vibration_rms` | Số, g; tùy chọn | Gia tốc rung RMS do Gateway tính |
| `reason` | Chuỗi; tùy chọn | Mô tả ngắn kết quả phân tích, hiển thị tối đa 180 ký tự |
| `last_reposition_at` | Số; UNIX milliseconds UTC | Lần xoay trở đã ghi nhận; không dùng số giây hoặc `millis()` ESP32 |
| `reposition_due` | Boolean | Gateway báo đến giờ hỗ trợ xoay trở |
| `buzzer` | Boolean | Trạng thái thực Node 3 đã xác nhận |
| `battery` | Số, %; tùy chọn | Chỉ gửi khi thiết bị thực sự đo/ước tính được pin |

Web tiếp nhận cờ **nghi ngờ** co giật/kích động từ Gateway, không suy ra chẩn đoán từ riêng tần số rung. Nếu chỉ có góc và cờ cảnh báo, bỏ các trường Hz/RMS/pin chưa có; web hiện dấu “—”.

Gửi trạng thái đầy đủ định kỳ, ví dụ mỗi 1–2 giây và ngay khi có sự kiện. Mốc mất liên lạc mặc định của web 15 giây. Góc, vận động, lịch và còi có hạn dữ liệu độc lập: bản tin chỉ cập nhật còi không làm góc cũ trở thành phép đo mới.

Không gửi 0 thay cho dữ liệu không có. MQTT dùng QoS 1, `retain=false` cho dữ liệu hiện tại và lệnh. `seq` tăng dần cùng `boot_id` mới sau mỗi lần khởi động giúp cầu nối loại gói lặp.

## 3. Lịch xoay trở

Chu kỳ mặc định của web là 120 phút, có thể chỉnh trong trình duyệt. Bộ đếm tính từ `last_reposition_at`; cảnh báo khi hết thời gian **hoặc** nhận `reposition_due: true`.

Người chăm sóc xác nhận hoàn thành bằng cơ chế do nhóm thiết bị/Gateway thống nhất. Sau đó Gateway gửi đồng thời `last_reposition_at` mới và `reposition_due: false`. Đổi góc đầu giường hoặc tiếp nhận cảnh báo không tự đặt lại lịch.

Chưa có thời điểm thì bỏ trường đó. Cờ `reposition_due: true` vẫn hiển thị đến giờ nhưng không tự tạo thời điểm chăm sóc.

Nếu đổi chu kỳ trên web, cần đồng bộ riêng tại Gateway để lịch/còi tự động thống nhất. Bản này chỉ gửi lệnh xuống bật/tắt còi, không gửi lệnh đổi lịch và không điều khiển mô tơ nâng giường.

## 4. Web điều khiển còi xuống Node 3

Web gửi vào WebSocket:

```json
{"type":"command","id":"bed03-cmd-001","node":3,"action":"set_buzzer","value":true}
```

`value: false` để tắt. Mã `id` do web sinh, giữ nguyên trên toàn đường truyền.

Cầu nối chuyển nguyên bản tin sang `carelink/node3/command`, QoS 1, `retain=false`. ESP32-S3 nhận lệnh, điều khiển đặc tính BLE của Node 3 và chờ thiết bị xác nhận thực hiện. Nên xử lý lệnh theo trạng thái đích, lưu mã lệnh ngắn hạn để nhận lặp không thực hiện hành động ngoài ý muốn.

Gateway gửi vào MQTT `carelink/node3/ack`:

```json
{"type":"ack","id":"bed03-cmd-001","node":3,"ok":true}
```

Nếu thiết bị không thực hiện hoặc mất BLE:

```json
{"type":"ack","id":"bed03-cmd-001","node":3,"ok":false,"error":"Node 3 chưa phản hồi qua BLE"}
```

Không trả thành công chỉ vì MQTT publish/BLE write thành công. `ok` phải là Boolean, không phải chuỗi `"true"`. Gửi tiếp `telemetry.data.buzzer` đúng trạng thái để các trình duyệt khác cùng cập nhật.

Cầu nối chờ 6 giây, web chờ 8 giây. Nhóm BLE cần phản hồi trong mốc đó hoặc điều chỉnh cả hai. Web chỉ đổi trạng thái theo dữ liệu thiết bị hoặc ACK đúng mã; ACK lỗi/hết hạn không tự đổi trạng thái còi. Web chưa tự kết nối lại; có thể bấm kết nối lại trong cài đặt.

## 5. Topic và hai node còn lại

| Node | Dữ liệu lên | Lệnh xuống | Xác nhận |
|---|---|---|---|
| 1 | `carelink/node1/telemetry` | `carelink/node1/command` | `carelink/node1/ack` |
| 2 | `carelink/node2/telemetry` | `carelink/node2/command` | `carelink/node2/ack` |
| 3 | `carelink/node3/telemetry` | `carelink/node3/command` | `carelink/node3/ack` |

Node 1 có thể publish trực tiếp. ESP32-S3 chuyển LoRa/BLE của Node 2/3 thành JSON/topic trên. Nếu firmware/slide dùng `hospital/node_X`, nhóm thống nhất đổi topic hoặc sửa cầu nối; web chỉ thấy WebSocket.

Node 1 theo sơ đồ lấy ECG 200 Hz, ví dụ 20 mẫu mỗi 100 ms. JSON dưới rút ngắn mảng ECG:

```json
{"type":"telemetry","node":1,"data":{"hr":76,"spo2":98,"rate":200,"measuring":true,"ecg":[0.01,0.02,0.10,0.95,-0.20]}}
```

Nhịp tim bpm, SpO₂ %. ECG có thể là ADC/đơn vị nhóm chuẩn hóa; biểu đồ chưa được hiệu chuẩn thành thiết bị chẩn đoán. Lệnh `set_rate` nhận số nguyên 125/200/250/500 Hz; `set_measuring` nhận Boolean. ACK như Node 3.

Node 2 sau khi ESP32-S3 giải mã LoRa:

```json
{"type":"telemetry","node":2,"data":{"temp":26.1,"humidity":60.0,"fan":false}}
```

Nhiệt độ °C, độ ẩm %, quạt Boolean. Lệnh:

```json
{"type":"command","id":"fan-001","node":2,"action":"set_fan","value":true}
```

Lệnh đi MQTT → ESP32-S3 → LoRa → Node 2, ACK sau phản hồi Node 2.

## 6. Ghép thử

1. Chạy web và cầu nối theo README; chọn Thiết bị thực.
2. Gửi trạng thái Node 3 từ mạch: đối chiếu góc web với số đo tại giường.
3. Chủ động gửi cờ kích động/nghi co giật trong môi trường thử, kiểm tra cảnh báo/nhật ký.
4. Gửi mốc xoay trở hoặc tình huống đến giờ đã thống nhất, kiểm tra lịch.
5. Bật/tắt còi từ web, đối chiếu mã lệnh, ACK BLE và còi thật.
6. Chặn ACK/ngắt BLE: web phải báo không thành công/chưa xác nhận, không tự đổi trạng thái theo nút bấm.
7. Ngắt dữ liệu quá 15 giây: web chuyển chờ/mất liên lạc; gửi bản tin mới để khôi phục.

Đây là quy ước phần mềm cho bài tập; cảm biến và thuật toán phát hiện cần được nhóm đánh giá riêng bằng dữ liệu và đo thử thực tế.


## Bổ sung Supabase

Bản tin của firmware giữ nguyên. Cầu nối Python có thể gom/lưu số đo lên Supabase theo HUONG_DAN_SUPABASE.md, kể cả khi không mở web. Cần cấu hình tài khoản ứng dụng có quyền ghi và mã nhóm; không dùng khóa quản trị. Chọn một nơi ghi (Gateway hoặc web), không cùng bật cho cùng luồng đo. Lệnh còi vẫn dùng MQTT/WebSocket và ACK như quy ước trên; chưa chuyển lệnh qua Supabase.
