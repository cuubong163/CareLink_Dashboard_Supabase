"use strict";

function bedView() {
  return BedModel.view(S.bed, {
    now: Date.now(),
    staleSeconds: config.stale,
    connected: hasData(3),
    angleLow: config.bedAngleLow,
    angleHigh: config.bedAngleHigh,
    turnMinutes: config.turnMinutes,
  });
}

function bedMotionBadge(view) {
  const color = view.motionAlarm
    ? view.motionSeverity
    : view.motionKnown
      ? ""
      : "gray";
  return `<span class="pill ${color}">${esc(view.motionLabel)}</span>`;
}

function bedTimer(view) {
  if (!view.scheduleKnown) return "Chờ dữ liệu";
  if (view.due) {
    return view.remainingMs !== null && view.remainingMs < 0
      ? `Quá giờ ${BedModel.duration(view.remainingMs)}`
      : "Đến giờ xoay trở";
  }
  return view.remainingMs !== null
    ? BedModel.duration(view.remainingMs)
    : "Theo lịch Gateway";
}

function bedBuzzerLabel(view) {
  if (!view.buzzerKnown) return "Chưa có xác nhận";
  return S.bed.buzzer ? "Đang bật" : "Đang tắt";
}

function bedFigure(view) {
  const angle = view.angleKnown ? S.bed.headAngle : 0;
  return `<svg class="bed-diagram" viewBox="0 0 460 225" role="img" aria-label="Minh họa góc nâng đầu giường">
    <defs><linearGradient id="bed-fill" x2="0" y2="1"><stop stop-color="#b9ded0"/><stop offset="1" stop-color="#eaf5ef"/></linearGradient></defs>
    <ellipse cx="225" cy="204" rx="182" ry="12" fill="#e9f1ec"/>
    <path d="M47 156v-30M47 156h181M62 158v36M360 155v39M354 157h40v-35" fill="none" stroke="#6e9781" stroke-width="6" stroke-linecap="round"/>
    <rect x="51" y="144" width="178" height="14" rx="6" fill="url(#bed-fill)" stroke="#87b69c" stroke-width="2"/>
    <g data-bed-head transform="rotate(${-angle} 226 150)">
      <rect x="226" y="136" width="162" height="19" rx="7" fill="url(#bed-fill)" stroke="#689f80" stroke-width="2"/>
      <rect x="348" y="124" width="34" height="12" rx="5" fill="#fff" stroke="#9dbba8"/>
      <path d="M239 134h106" stroke="#c4dcd0" stroke-width="2"/>
    </g>
    <circle cx="226" cy="150" r="5" fill="#3e8d6a"/>
    <path d="M230 150h136" stroke="#c1cfc5" stroke-dasharray="4 4"/>
    <text x="43" y="37" fill="#8c9e92" font-size="11">MPU6050 · Góc tương đối với phương ngang</text>
    <text x="43" y="65" fill="#277451" font-size="24" font-weight="600" data-value="bed-angle-figure">${view.angleKnown ? S.bed.headAngle.toFixed(1) + "°" : "—"}</text>
    <circle cx="62" cy="198" r="6" fill="#7e9d89"/><circle cx="360" cy="198" r="6" fill="#7e9d89"/>
  </svg>`;
}

function bedSnapshot() {
  const view = bedView();
  return `<div class="section-heading"><h2>Node 3 · Giường bệnh thông minh</h2><a class="text-button" href="#bed">Theo dõi giường ↗</a></div>
    <div class="bed-summary-grid">
      <a href="#bed" class="card bed-summary"><span>Góc nâng đầu giường</span><strong data-value="bed-angle">${view.angleKnown ? S.bed.headAngle.toFixed(1) + "°" : "—"}</strong><small data-value="bed-angle-status">${view.angleOutside ? "Ngoài khoảng cài đặt" : view.angleKnown ? "Trong khoảng cài đặt" : "Chờ Node 3"}</small></a>
      <a href="#bed" class="card bed-summary"><span>Co giật / kích động</span><strong class="bed-summary-text" data-value="bed-motion">${esc(view.motionLabel)}</strong><small>Cờ phân tích từ Gateway</small></a>
      <a href="#bed" class="card bed-summary"><span>Nhắc xoay trở</span><strong class="bed-summary-text" data-value="bed-timer">${bedTimer(view)}</strong><small>Chu kỳ ${config.turnMinutes} phút · có thể điều chỉnh</small></a>
      <a href="#bed" class="card bed-summary"><span>Còi tại giường</span><strong class="bed-summary-text" data-value="bed-buzzer">${bedBuzzerLabel(view)}</strong><small>Điều khiển qua Gateway → BLE</small></a>
    </div>`;
}

function bedAlertBanner() {
  return `<div id="bed-alert-banner">${bedAlertContent()}</div>`;
}

function bedAlertContent() {
  const view = bedView();
  const active = view.motionAlarm || view.due || view.angleOutside;
  if (!active) return "";
  const text = view.motionAlarm
    ? view.motionLabel
    : view.due
      ? "Đến giờ hỗ trợ xoay trở"
      : "Góc đầu giường ngoài khoảng cài đặt";
  return `<div class="alert-banner" role="status"><span>${icon("bell")} Node 3 · ${esc(text)}</span><a class="button danger" href="#bed">Kiểm tra giường</a></div>`;
}

function bed() {
  const view = bedView();
  const pending = [...S.pending.values()].some((item) => item.node === 3);
  return (
    header(
      "Giường bệnh thông minh",
      "Node 3 · ESP32, MPU6050 và còi báo · BLE GATT hai chiều",
    ) +
    patientStrip() +
    bedAlertBanner() +
    `<div class="bed-detail-grid">
      <div class="bed-stack">
        <section class="card padded">
          <div class="bed-card-heading"><h3>Góc nâng đầu giường</h3>${status(3)}</div>
          ${bedFigure(view)}
          <div class="bed-angle-track"><span>0°</span><div><i data-angle-marker style="left:${Math.max(0, Math.min(100, (S.bed.headAngle / 90) * 100))}%"></i></div><span>90°</span></div>
          <div class="bed-angle-caption"><span>Khoảng cài đặt ${config.bedAngleLow}–${config.bedAngleHigh}°</span><span class="pill ${view.angleOutside ? "amber" : view.angleKnown ? "" : "gray"}" id="bed-angle-badge">${view.angleKnown ? (view.angleOutside ? "Cần kiểm tra" : "Trong khoảng") : "Chờ dữ liệu"}</span></div>
          <p class="help">Góc do Gateway gửi lên sau khi đọc MPU6050. Khoảng đang hiển thị là cấu hình minh họa của bài tập.</p>
        </section>
        <section class="card padded">
          <div class="bed-card-heading"><h3>Co giật / kích động</h3><span id="bed-motion-badge">${bedMotionBadge(view)}</span></div>
          <div class="bed-signal-grid"><div><small>Tần số rung</small><strong data-value="bed-motion-hz">${view.motionKnown && Number.isFinite(S.bed.motionHz) ? S.bed.motionHz.toFixed(1) + " Hz" : "—"}</strong></div><div><small>Gia tốc rung RMS</small><strong data-value="bed-rms">${view.motionKnown && Number.isFinite(S.bed.vibrationRms) ? S.bed.vibrationRms.toFixed(3) + " g" : "—"}</strong></div></div>
          <p class="help" data-value="bed-reason">${esc(view.motionKnown && S.bed.reason ? S.bed.reason : "Chờ kết quả phân tích vận động từ Gateway.")}</p>
          <div class="notice green" style="margin:12px 0 0">Hiển thị dấu hiệu nghi ngờ để người chăm sóc kiểm tra tại giường. Web tiếp nhận kết quả phân tích từ Gateway.</div>
        </section>
        <section class="card padded">
          <div class="bed-card-heading"><h3>Nhắc xoay trở chống loét tỳ đè</h3><span class="pill ${view.due ? "amber" : "gray"}" id="bed-turn-badge">${view.due ? "Đến giờ" : "Lịch chăm sóc"}</span></div>
          <div class="bed-countdown" data-value="bed-timer">${bedTimer(view)}</div>
          <div class="bed-progress"><div data-turn-progress style="width:${turnProgress(view)}%"></div></div>
          <div class="system-row"><span>Lần xoay trở được Gateway ghi nhận</span><strong data-value="bed-last-turn">${view.scheduleKnown && S.bed.lastRepositionAt ? clock(S.bed.lastRepositionAt) : "Chưa có thông tin"}</strong></div>
          <div class="system-row"><span>Chu kỳ nhắc</span><strong>${config.turnMinutes} phút</strong></div>
          <p class="help">Thời điểm xoay trở do nhóm Gateway đồng bộ sau khi người chăm sóc xác nhận. Chu kỳ có thể điều chỉnh theo kế hoạch chăm sóc.</p>
        </section>
      </div>
      <div class="bed-stack">
        <section class="card padded bed-control-card">
          <span class="eyebrow">ĐIỀU KHIỂN HAI CHIỀU</span><h3>Còi cảnh báo tại giường</h3>
          <p class="help">Web gửi lệnh đến Gateway. Gateway chuyển lệnh qua BLE để Node 3 bật hoặc tắt còi.</p>
          <div class="bed-buzzer-state"><span class="event-icon">${icon("bell")}</span><strong data-value="bed-buzzer">${bedBuzzerLabel(view)}</strong></div>
          <div class="bed-control-buttons"><button class="button primary" data-action="bed-buzzer-on" ${pending ? "disabled" : ""}>${icon("bell")}Bật còi cảnh báo</button><button class="button" data-action="bed-buzzer-off" ${pending ? "disabled" : ""}>Tắt còi</button></div>
          <p class="pending-label" id="bed-command-status" role="status">${pending ? "Đang chờ Node 3 xác nhận lệnh…" : S.mode === "demo" ? "Lệnh đang chạy trong mô phỏng." : "Trạng thái đổi sau khi nhận ACK từ thiết bị."}</p>
          <div class="separator"></div>
          <div class="system-row"><span>Đường truyền node</span><strong>BLE GATT</strong></div>
          <div class="system-row"><span>Gateway trung tâm</span><strong>ESP32-S3</strong></div>
          <div class="system-row"><span>Pin Node 3</span><strong data-value="battery">${hasData(3) && Number.isFinite(S.bed.battery) ? S.bed.battery + "%" : "—"}</strong></div>
          <a href="#architecture" class="text-button">Xem tổng quan kết nối ↗</a>
        </section>
        ${S.mode === "demo" ? bedDemoPanel() : `<div class="notice green">Đang theo dõi thiết bị thực. Dữ liệu chưa được gửi sẽ hiển thị chờ kết nối.</div>`}
      </div>
    </div>`
  );
}

function turnProgress(view) {
  if (!view.scheduleKnown || view.remainingMs === null) return 0;
  return Math.max(
    0,
    Math.min(100, (1 - view.remainingMs / (config.turnMinutes * 60000)) * 100),
  );
}

function bedDemoPanel() {
  return `<section class="card padded"><span class="pill amber">Dữ liệu mô phỏng</span><h3 style="margin-top:14px">Thử tình huống Node 3</h3><p class="help">Tạo tình huống mẫu để kiểm tra giao diện và luồng xử lý cảnh báo.</p>
    <div class="field"><label for="demo-bed-angle">Góc đầu giường</label><div class="bed-slider-line"><input id="demo-bed-angle" type="range" min="0" max="80" step="1" value="${S.bed.headAngle ?? 35}"><output id="demo-bed-angle-output">${S.bed.headAngle ?? 35}°</output></div></div>
    <div class="demo-buttons"><button class="button" data-action="bed-demo-agitation">Thử kích động</button><button class="button danger" data-action="bed-demo-seizure">Thử nghi co giật</button><button class="button" data-action="bed-demo-due">Thử đến giờ xoay trở</button><button class="button" data-action="bed-demo-turn">Đã xoay trở (mô phỏng)</button><button class="button" data-action="bed-demo-normal">Trở về ổn định</button></div>
  </section>`;
}

function architectureContent() {
  return `<section class="card padded architecture-card">
    <div class="section-heading" style="margin-top:0"><h2>Luồng kết nối toàn hệ thống</h2><span class="pill gray">Theo sơ đồ mới</span></div>
    <div class="architecture-nodes">
      <div><span class="node-icon">${icon("heart")}</span><h3>Node 1 · Sinh hiệu</h3><p>MAX30102 · AD8232</p><strong>Wi-Fi / MQTT ↕</strong><small>Gửi ECG, nhịp tim, SpO₂<br>Nhận lệnh lấy mẫu và đo</small></div>
      <div><span class="node-icon blue">${icon("leaf")}</span><h3>Node 2 · Môi trường</h3><p>DHT22 · Relay quạt</p><strong>LoRa 433 MHz ↕</strong><small>Gửi nhiệt độ, độ ẩm<br>Nhận lệnh relay quạt</small></div>
      <div><span class="node-icon purple">${icon("bed")}</span><h3>Node 3 · Giường bệnh</h3><p>MPU6050 · Buzzer</p><strong>BLE GATT ↕</strong><small>Gửi góc giường và cảnh báo<br>Nhận lệnh bật/tắt còi</small></div>
    </div>
    <div class="architecture-connector" aria-hidden="true">↓ ↑</div>
    <div class="architecture-gateway"><span>${icon("signal")}</span><div><h3>Gateway trung tâm · ESP32-S3</h3><p>Thu thập đa giao thức · Phân tích tại chỗ · Định tuyến lệnh và phản hồi</p></div></div>
    <div class="architecture-connector" aria-hidden="true">↓ ↑</div>
    <div class="architecture-web"><div><h3>CareLink · Phần web của nhóm</h3><p>Biểu đồ, cảnh báo, nhắc xoay trở, nhật ký và điều khiển còi</p></div><span class="pill">WebSocket /ws</span></div>
    <p class="help">Khi chạy trên máy tính, cầu nối Python nhận các bản tin MQTT đã chuẩn hóa từ ESP32-S3 và chuyển sang WebSocket cho web. Blynk có thể tiếp tục chạy song song theo phần Gateway của nhóm.</p>
  </section>`;
}

function architecture() {
  return (
    header(
      "Tổng quan kết nối",
      "Ba node đo lường · Gateway ESP32-S3 · Dashboard CareLink",
    ) +
    architectureContent() +
    `<div class="detail-grid" style="margin-top:20px"><section class="card padded"><h3>Tín hiệu giường bệnh gửi lên</h3><p class="help">Node 3 đo góc và rung bằng MPU6050. Gateway chuẩn hóa góc, trạng thái vận động và lịch xoay trở trước khi đẩy lên web.</p><div class="protocol"><code>head_angle · motion_status · last_reposition_at</code><p>Mỗi chỉ số gắn với thời điểm nhận dữ liệu. Khi mất kết nối, web hiển thị trạng thái chờ và ghi cảnh báo mất liên lạc.</p></div></section><section class="card padded"><h3>Lệnh còi gửi xuống</h3><p class="help">Nhân viên bấm bật/tắt còi → web gửi mã lệnh → Gateway điều khiển Node 3 qua BLE → thiết bị gửi ACK.</p><div class="protocol"><code>node: 3 · action: set_buzzer · value: true/false</code><p>Chỉ báo thành công sau ACK của Node 3. Hết thời gian chờ hoặc bị từ chối được ghi vào nhật ký.</p></div></section></div>`
  );
}

function checkBedAlerts() {
  const view = bedView();
  if (view.angleKnown) {
    if (view.angleOutside)
      alertEvent("bed-angle", "Góc đầu giường ngoài khoảng cài đặt", 3);
    else resolveType("bed-angle");
  }
  if (view.motionKnown) {
    for (const [status, title] of [
      ["agitation", "Giường có dấu hiệu kích động / vận động mạnh"],
      ["suspected_seizure", "Giường có dấu hiệu nghi ngờ co giật"],
    ]) {
      const type = "bed-" + status;
      if (S.bed.motionStatus === status) alertEvent(type, title, 3);
      else resolveType(type);
    }
  }
  if (view.scheduleKnown) {
    if (view.due)
      alertEvent("bed-turn", "Đến giờ hỗ trợ xoay trở chống loét tỳ đè", 3);
    else resolveType("bed-turn");
  }
}

function updateBedReadings() {
  const view = bedView();
  const banner = $("#bed-alert-banner");
  if (banner) {
    const content = bedAlertContent();
    if (banner.innerHTML !== content) banner.innerHTML = content;
  }
  const values = {
    "bed-angle": view.angleKnown ? S.bed.headAngle.toFixed(1) + "°" : "—",
    "bed-angle-figure": view.angleKnown
      ? S.bed.headAngle.toFixed(1) + "°"
      : "—",
    "bed-angle-status": view.angleKnown
      ? view.angleOutside
        ? "Ngoài khoảng cài đặt"
        : "Trong khoảng cài đặt"
      : "Chờ Node 3",
    "bed-motion": view.motionLabel,
    "bed-timer": bedTimer(view),
    "bed-buzzer": bedBuzzerLabel(view),
    "bed-motion-hz":
      view.motionKnown && Number.isFinite(S.bed.motionHz)
        ? S.bed.motionHz.toFixed(1) + " Hz"
        : "—",
    "bed-rms":
      view.motionKnown && Number.isFinite(S.bed.vibrationRms)
        ? S.bed.vibrationRms.toFixed(3) + " g"
        : "—",
    "bed-last-turn":
      view.scheduleKnown && S.bed.lastRepositionAt
        ? clock(S.bed.lastRepositionAt)
        : "Chưa có thông tin",
    "bed-reason":
      view.motionKnown && S.bed.reason
        ? S.bed.reason
        : "Chờ kết quả phân tích vận động từ Gateway.",
    battery:
      hasData(3) && Number.isFinite(S.bed.battery) ? S.bed.battery + "%" : "—",
  };
  for (const [key, value] of Object.entries(values)) {
    document.querySelectorAll(`[data-value="${key}"]`).forEach((element) => {
      element.textContent = value;
    });
  }
  const head = document.querySelector("[data-bed-head]");
  if (head)
    head.setAttribute(
      "transform",
      `rotate(${view.angleKnown ? -S.bed.headAngle : 0} 226 150)`,
    );
  const marker = document.querySelector("[data-angle-marker]");
  if (marker)
    marker.style.left =
      (view.angleKnown
        ? Math.max(0, Math.min(100, (S.bed.headAngle / 90) * 100))
        : 0) + "%";
  const progress = document.querySelector("[data-turn-progress]");
  if (progress) progress.style.width = turnProgress(view) + "%";
  const motion = $("#bed-motion-badge");
  if (motion) motion.innerHTML = bedMotionBadge(view);
  const angle = $("#bed-angle-badge");
  if (angle) {
    angle.className =
      "pill " + (view.angleOutside ? "amber" : view.angleKnown ? "" : "gray");
    angle.textContent = view.angleKnown
      ? view.angleOutside
        ? "Cần kiểm tra"
        : "Trong khoảng"
      : "Chờ dữ liệu";
  }
  const turn = $("#bed-turn-badge");
  if (turn) {
    turn.className = "pill " + (view.due ? "amber" : "gray");
    turn.textContent = view.due ? "Đến giờ" : "Lịch chăm sóc";
  }
  const pending = [...S.pending.values()].some((item) => item.node === 3);
  document
    .querySelectorAll(
      '[data-action="bed-buzzer-on"], [data-action="bed-buzzer-off"]',
    )
    .forEach((button) => {
      button.disabled = pending;
    });
  const commandStatus = $("#bed-command-status");
  if (commandStatus)
    commandStatus.textContent = pending
      ? "Đang chờ Node 3 xác nhận lệnh…"
      : S.mode === "demo"
        ? "Lệnh đang chạy trong mô phỏng."
        : "Trạng thái đổi sau khi nhận ACK từ thiết bị.";
}

function seedBedDemo() {
  S.bed = BedModel.create();
  BedModel.applyTelemetry(S.bed, {
    head_angle: 35,
    motion_status: "normal",
    motion_hz: 0.2,
    vibration_rms: 0.012,
    last_reposition_at: Date.now() - 90 * 60000,
    reposition_due: false,
    buzzer: false,
    battery: 86,
    reason: "Tình huống minh họa · Giường ổn định.",
  });
}

function bindBedControls() {
  const slider = $("#demo-bed-angle");
  if (!slider) return;
  slider.oninput = (event) => {
    BedModel.applyTelemetry(S.bed, { head_angle: Number(event.target.value) });
    $("#demo-bed-angle-output").textContent = event.target.value + "°";
    updateBedReadings();
  };
  slider.onchange = () => {
    checkBedAlerts();
    render();
  };
}

function handleBedAction(action) {
  if (action === "bed-buzzer-on") {
    command(3, "set_buzzer", true);
    return;
  }
  if (action === "bed-buzzer-off") {
    command(3, "set_buzzer", false);
    return;
  }
  if (S.mode !== "demo" || !action.startsWith("bed-demo-")) return;
  const now = Date.now();
  const samples = {
    "bed-demo-agitation": {
      motion_status: "agitation",
      motion_hz: 2.5,
      vibration_rms: 0.18,
      reason: "Mô phỏng · Gateway phát hiện vận động mạnh.",
    },
    "bed-demo-seizure": {
      motion_status: "suspected_seizure",
      motion_hz: 5.2,
      vibration_rms: 0.35,
      reason:
        "Mô phỏng · Gateway gửi cờ nghi ngờ co giật để kiểm tra tại giường.",
    },
    "bed-demo-due": {
      last_reposition_at: now - (config.turnMinutes + 1) * 60000,
      reposition_due: true,
    },
    "bed-demo-turn": { last_reposition_at: now, reposition_due: false },
    "bed-demo-normal": {
      head_angle: 35,
      motion_status: "normal",
      motion_hz: 0.2,
      vibration_rms: 0.012,
      reason: "Tình huống minh họa · Giường ổn định.",
    },
  };
  if (!Object.hasOwn(samples, action)) return;
  BedModel.applyTelemetry(S.bed, samples[action], now);
  addEvent(
    "Thử tình huống giường bệnh",
    action === "bed-demo-turn"
      ? "Đã hỗ trợ xoay trở · Mô phỏng"
      : "Dữ liệu mẫu của Node 3",
    3,
  );
  checkBedAlerts();
  render();
  toast("Đã cập nhật tình huống mô phỏng");
}
