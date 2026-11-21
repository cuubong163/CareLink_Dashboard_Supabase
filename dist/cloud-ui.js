"use strict";
function cloudPage() {
  const c = Cloud.state,
    team = c.teams.find((t) => t.id === c.teamId);
  return `<div class="page-heading"><div><div class="eyebrow">LƯU TRỮ CỦA NHÓM</div><h1>Kết quả trên máy chủ</h1><p>Lưu số đo vào Supabase và đọc lại lịch sử trên nhiều máy.</p></div><span class="pill gray" data-cloud="connection">Chưa cấu hình</span></div>
  <div class="cloud-steps"><span class="${c.config ? "done" : ""}">1. Cấu hình dự án</span><span class="${c.user ? "done" : ""}">2. Đăng nhập</span><span class="${c.teamId ? "done" : ""}">3. Chọn nhóm & lưu</span></div>
  <div class="cloud-feedback" role="status" id="cloud-feedback" hidden></div>
  <div class="cloud-stats"><div class="card cloud-stat"><small>Nhóm đang xem</small><strong data-cloud="team">${esc(team?.name || "Chưa chọn nhóm")}</strong><span data-cloud="account">${esc(c.user?.email || "Chưa đăng nhập")}</span></div><div class="card cloud-stat"><small>Máy chủ đã xác nhận trong phiên</small><strong data-cloud="saved">${c.saved}</strong><span data-cloud="last-saved">Chưa gửi bản ghi nào</span></div><div class="card cloud-stat"><small>Đang chờ gửi trên máy này</small><strong data-cloud="pending">${c.pending}</strong><span>Giữ bản ghi khi gửi lỗi</span></div></div>
  <div class="cloud-grid"><div class="cloud-stack">
    <section class="card padded"><h3>1. Kết nối dự án Supabase</h3><p class="help">Dùng dự án của nhóm. Cấu hình được lưu riêng trong trình duyệt.</p><form id="cloud-config-form"><div class="field"><label for="supabase-url">Project URL</label><input id="supabase-url" name="url" type="url" placeholder="https://ten-du-an.supabase.co" value="${esc(c.config?.url || "")}" required></div><div class="field"><label for="supabase-key">Publishable key hoặc anon key</label><input id="supabase-key" name="key" autocomplete="off" spellcheck="false" placeholder="sb_publishable_…" value="${esc(c.config?.key || "")}" required><small>Không nhập secret key, service_role hay mật khẩu cơ sở dữ liệu.</small></div><button class="button primary" type="submit">Lưu cấu hình Supabase</button></form><div class="cloud-setup-note"><strong>Thiết lập lần đầu</strong><p>Mở SQL Editor trong dự án Supabase, chạy toàn bộ file tạo bảng, sau đó đăng nhập bên dưới.</p><a class="button" href="supabase-setup.sql" download>Tải SQL tạo bảng & phân quyền</a></div></section>
    <section class="card padded"><h3>2. Tài khoản thành viên</h3>${c.user ? `<p class="help">Đang đăng nhập: <strong>${esc(c.user.email)}</strong></p><div class="cloud-actions"><button class="button" data-cloud-action="check">Kiểm tra bảng & nhóm</button><button class="button" data-cloud-action="sign-out">Đăng xuất</button></div>` : `<p class="help">Thành viên dùng chung Project URL và publishable key, mỗi người một tài khoản.</p><form id="cloud-auth-form"><div class="field"><label for="cloud-email">Email</label><input id="cloud-email" type="email" name="email" autocomplete="username" required></div><div class="field"><label for="cloud-password">Mật khẩu tài khoản</label><input id="cloud-password" type="password" name="password" autocomplete="current-password" minlength="6" required></div><div class="cloud-actions"><button class="button primary" type="submit" name="intent" value="sign-in">Đăng nhập</button><button class="button" type="submit" name="intent" value="sign-up">Đăng ký tài khoản</button></div></form>`}</section>
  </div><div class="cloud-stack">
    <section class="card padded"><h3>3. Không gian của nhóm</h3>${c.user && c.schemaReady ? `<div class="field"><label for="cloud-team">Chọn nhóm</label><select id="cloud-team"><option value="">Chọn nhóm…</option>${c.teams.map((t) => `<option value="${esc(t.id)}" ${t.id === c.teamId ? "selected" : ""}>${esc(t.name)} · ${t.role === "owner" ? "Trưởng nhóm" : t.role === "writer" ? "Được ghi" : "Chỉ xem"}</option>`).join("")}</select></div>${c.teamId ? `<div class="field"><label for="cloud-team-id">Mã nhóm dùng cho Gateway</label><input id="cloud-team-id" readonly value="${esc(c.teamId)}"></div>` : ""}<form id="cloud-create-team"><div class="field"><label for="cloud-team-name">Tạo nhóm mới</label><input id="cloud-team-name" name="name" placeholder="Nhóm IoT y tế" maxlength="80" required></div><button class="button" type="submit">Tạo nhóm</button></form>${c.role === "owner" ? `<div class="separator"></div><h4>Thêm thành viên đã đăng ký</h4><p class="help">Bạn ấy cần đăng ký và xác nhận email trong cùng dự án trước. Thao tác này cấp quyền, không gửi thư mời.</p><form id="cloud-add-member"><div class="field"><label for="member-email">Email thành viên</label><input id="member-email" type="email" name="email" required></div><div class="field"><label for="member-role">Quyền trong nhóm</label><select id="member-role" name="role"><option value="viewer">Chỉ xem lịch sử</option><option value="writer">Xem và ghi kết quả</option></select></div><button class="button" type="submit">Thêm / cập nhật thành viên</button></form>` : ""}` : '<div class="empty cloud-empty">Đăng nhập và chạy file SQL để tạo hoặc xem nhóm của bạn.</div>'}</section>
    <section class="card padded"><div class="bed-card-heading"><h3>Ghi kết quả từ dashboard</h3><span class="pill gray" data-cloud="recording">Đang dừng ghi</span></div><p class="help">Nhận số đo thật qua WebSocket rồi lưu lên máy chủ. Khi Gateway đã tự lưu, giữ web ở trạng thái dừng ghi để tránh hai nơi cùng ghi.</p><form id="cloud-capture-form"><div class="field"><label for="cloud-interval">Chu kỳ gom kết quả</label><select id="cloud-interval">${[1, 5, 10, 30].map((n) => `<option value="${n}" ${n === c.interval ? "selected" : ""}>${n} giây</option>`).join("")}</select><small>Giữ số đo mới nhất trong mỗi khoảng; thay đổi trạng thái còi/vận động được tách thành bản ghi riêng.</small></div><label class="cloud-check"><input id="cloud-ecg" type="checkbox" ${c.saveEcg ? "checked" : ""}> Lưu cả các khối ECG thô</label><p class="help">ECG thô tốn dung lượng hơn. Gateway cần gửi tần số lấy mẫu trong từng gói.</p><div class="cloud-actions"><button class="button primary" type="submit" data-cloud-requires="write">Bắt đầu lưu đo thật</button><button class="button" type="button" data-cloud-action="stop">Dừng lưu</button></div></form><div class="cloud-actions" style="margin-top:14px"><button class="button" data-cloud-action="flush" data-cloud-requires="write">Gửi dữ liệu đang chờ</button><button class="button" data-cloud-action="demo" data-cloud-requires="demo">Lưu 1 bộ mẫu mô phỏng</button></div><p class="help" data-cloud="write-help">Mô phỏng không tự được ghi vào kết quả thật.</p><p class="help">Muốn lưu cả khi đóng web: chạy bộ gửi Supabase trong chương trình Gateway theo HUONG_DAN_SUPABASE.md.</p></section>
  </div></div>
  <section class="card cloud-history"><div class="card-head"><div><h3>Lịch sử đọc từ Supabase</h3><p class="help">Số đo có thời gian nhận và người ghi. Mặc định chỉ xem thiết bị thật.</p></div><button class="button" data-cloud-action="export">${icon("down")}Xuất CSV trang này</button></div><form id="cloud-history-filter" class="cloud-filter"><div class="field"><label for="server-node">Node</label><select id="server-node"><option value="0">Tất cả node</option>${[1, 2, 3].map((n) => `<option value="${n}" ${Number(c.filters.node) === n ? "selected" : ""}>Node ${n}</option>`).join("")}</select></div><div class="field"><label for="server-source">Nguồn dữ liệu</label><select id="server-source">${[
    ["device", "Thiết bị thật"],
    ["demo", "Mô phỏng"],
    ["all", "Tất cả"],
  ]
    .map(
      ([v, l]) =>
        `<option value="${v}" ${v === c.filters.source ? "selected" : ""}>${l}</option>`,
    )
    .join(
      "",
    )}</select></div><div class="field"><label for="server-from">Từ thời điểm</label><input id="server-from" type="datetime-local" value="${esc(c.filters.from)}"></div><div class="field"><label for="server-to">Đến thời điểm</label><input id="server-to" type="datetime-local" value="${esc(c.filters.to)}"></div><button class="button primary" type="submit" data-cloud-requires="team">Lọc kết quả</button><button class="button" type="button" data-cloud-action="refresh" data-cloud-requires="team">Làm mới</button></form><div class="table-wrap"><table><thead><tr><th>Thời gian đo</th><th>Node</th><th>Kết quả</th><th>Nguồn</th><th>Chi tiết</th></tr></thead><tbody id="cloud-history-rows">${cloudHistoryRows()}</tbody></table></div><div class="cloud-pagination"><button class="button" data-cloud-action="previous">← Mới hơn</button><span data-cloud="page">Trang ${c.page + 1} · ${c.rows.length} bản ghi</span><button class="button" data-cloud-action="next">Cũ hơn →</button></div></section><p class="help" style="margin-top:16px">Trang chính vẫn dùng nguồn đo Gateway đã chọn. Supabase lưu và chia sẻ lịch sử; lệnh còi tiếp tục qua kết nối Gateway và chờ xác nhận thiết bị.</p>`;
}
function cloudSummary(row) {
  const p = row.payload || {},
    parts = [];
  const fields =
    row.node_id === 1
      ? [
          ["hr", "Nhịp tim", "bpm"],
          ["spo2", "SpO₂", "%"],
          ["rate", "Lấy mẫu", "Hz"],
        ]
      : row.node_id === 2
        ? [
            ["temp", "Nhiệt độ", "°C"],
            ["humidity", "Độ ẩm", "%"],
          ]
        : [
            ["head_angle", "Góc giường", "°"],
            ["motion_hz", "Rung", "Hz"],
          ];
  for (const [k, label, unit] of fields)
    if (typeof p[k] === "number") parts.push(`${label}: ${p[k]} ${unit}`);
  if (p.motion_status)
    parts.push(BedModel.motionLabels[p.motion_status] || p.motion_status);
  for (const [k, label] of [
    ["buzzer", "Còi"],
    ["fan", "Quạt"],
  ])
    if (typeof p[k] === "boolean")
      parts.push(`${label}: ${p[k] ? "bật" : "tắt"}`);
  if (p.reposition_due === true) parts.push("Đến giờ xoay trở");
  return parts.join(" · ") || "Bản tin trạng thái";
}
function cloudHistoryRows() {
  return (
    Cloud.state.rows
      .map(
        (r) =>
          `<tr><td>${esc(new Date(r.observed_at).toLocaleString("vi-VN"))}</td><td>Node ${esc(r.node_id)}<small class="cloud-device">${esc(r.device_id)}</small></td><td class="cloud-result">${esc(cloudSummary(r))}</td><td><span class="pill ${r.source === "demo" ? "amber" : "gray"}">${r.source === "demo" ? "Mô phỏng" : "Thiết bị"}</span></td><td><button class="text-button" data-cloud-action="detail" data-id="${esc(r.id)}">Xem</button>${r.node_id === 1 ? `<button class="text-button" data-cloud-action="ecg" data-id="${esc(r.id)}">ECG</button>` : ""}</td></tr>`,
      )
      .join("") ||
    `<tr><td colspan="5" class="empty">${Cloud.state.user && Cloud.state.teamId ? "Chưa có kết quả phù hợp trên máy chủ." : "Chọn nhóm sau khi đăng nhập để đọc lịch sử."}</td></tr>`
  );
}
function refreshCloudUI(kind = "status") {
  if (typeof S === "undefined" || S.route !== "cloud") return;
  if (kind === "identity") {
    render();
    return;
  }
  const c = Cloud.state,
    selected = c.teams.find((t) => t.id === c.teamId);
  const values = {
    connection: c.schemaReady
      ? "Đã kết nối"
      : c.user
        ? "Chờ kiểm tra bảng"
        : c.config
          ? "Chờ đăng nhập"
          : "Chưa cấu hình",
    team: selected?.name || "Chưa chọn nhóm",
    account: c.user?.email || "Chưa đăng nhập",
    saved: c.saved,
    pending: c.pending,
    "last-saved": c.lastSaved
      ? `Lần lưu gần nhất ${clock(c.lastSaved)}`
      : "Chưa gửi bản ghi nào",
    recording: c.autoSave ? "Đang thu đo thật" : "Đang dừng ghi",
    page: `Trang ${c.page + 1} · ${c.rows.length} bản ghi`,
    "write-help": c.invalidEcg
      ? `${c.invalidEcg} gói ECG thiếu/sai mẫu hoặc tần số nên không lưu phần thô.`
      : c.autoSave && S.mode === "demo"
        ? "Đã bật lưu, nhưng trang đang mô phỏng. Chuyển sang Thiết bị thực và kết nối Gateway để thu số đo thật."
        : "Mô phỏng không tự được ghi vào kết quả thật.",
  };
  for (const [k, v] of Object.entries(values))
    document
      .querySelectorAll(`[data-cloud="${k}"]`)
      .forEach((el) => (el.textContent = v));
  const feedback = $("#cloud-feedback");
  if (feedback) {
    feedback.hidden = !(c.error || c.notice);
    feedback.textContent = c.error || c.notice;
    feedback.className = "cloud-feedback " + (c.error ? "error" : "");
  }
  document.querySelectorAll("#main button").forEach((b) => {
    const required = b.dataset.cloudRequires,
      a = b.dataset.cloudAction;
    b.disabled =
      c.busy ||
      (required === "write" && !Cloud.canWrite()) ||
      (required === "team" && !c.teamId) ||
      (required === "demo" && (!Cloud.canWrite() || S.mode !== "demo")) ||
      (a === "previous" && (c.page === 0 || c.queryBusy)) ||
      (a === "next" && (!c.hasMore || c.queryBusy)) ||
      (a === "export" && !c.rows.length);
  });
  if (kind === "history" && $("#cloud-history-rows"))
    $("#cloud-history-rows").innerHTML = cloudHistoryRows();
}
async function cloudPerform(task) {
  if (Cloud.state.busy) return;
  Cloud.state.busy = true;
  Cloud.state.error = "";
  refreshCloudUI();
  try {
    await task();
  } catch (e) {
    Cloud.fail(e);
  } finally {
    Cloud.state.busy = false;
    refreshCloudUI();
  }
}
function bindCloudControls() {
  if (S.route !== "cloud") return;
  const bind = (id, task) => {
    const form = $(id);
    if (form)
      form.onsubmit = (e) => {
        e.preventDefault();
        cloudPerform(() => task(form, e));
      };
  };
  bind("#cloud-config-form", (form) =>
    Cloud.configure(form.elements.url.value, form.elements.key.value),
  );
  bind("#cloud-auth-form", async (form, e) => {
    const email = form.elements.email.value,
      password = form.elements.password.value;
    form.elements.password.value = "";
    await (e.submitter?.value === "sign-up"
      ? Cloud.signUp(email, password)
      : Cloud.signIn(email, password));
  });
  bind("#cloud-create-team", (form) =>
    Cloud.createTeam(form.elements.name.value),
  );
  bind("#cloud-add-member", (form) =>
    Cloud.addMember(form.elements.email.value, form.elements.role.value),
  );
  bind("#cloud-capture-form", () =>
    Cloud.setAutoSave(true, {
      interval: Number($("#cloud-interval").value),
      saveEcg: $("#cloud-ecg").checked,
    }),
  );
  bind("#cloud-history-filter", async () => {
    const from = $("#server-from").value,
      to = $("#server-to").value;
    if (from && to && new Date(from) > new Date(to))
      throw new Error("Thời điểm bắt đầu phải trước thời điểm kết thúc.");
    Object.assign(Cloud.state.filters, {
      node: Number($("#server-node").value),
      source: $("#server-source").value,
      from,
      to,
    });
    await Cloud.queryHistory(true);
  });
  if ($("#cloud-team"))
    $("#cloud-team").onchange = (e) =>
      cloudPerform(async () => {
        await Cloud.chooseTeam(e.target.value);
        render();
      });
  refreshCloudUI();
}
function cloudDownload(name, body, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function cloudExport() {
  const cell = (v) =>
    `"${String(v ?? "")
      .replace(/^[=+@\-]/, "'$&")
      .replace(/"/g, '""')}"`;
  const rows = Cloud.state.rows.map((r) => [
    r.observed_at,
    r.received_at,
    r.node_id,
    r.device_id,
    r.source,
    r.payload.hr,
    r.payload.spo2,
    r.payload.temp,
    r.payload.humidity,
    r.payload.head_angle,
    r.payload.motion_status,
    r.payload.last_reposition_at,
    r.payload.reposition_due,
    r.payload.buzzer,
    r.payload.fan,
    r.payload.rate,
    r.created_by,
    r.id,
  ]);
  const heads = [
    "Thời gian đo",
    "Thời gian máy chủ nhận",
    "Node",
    "Thiết bị",
    "Nguồn",
    "Nhịp tim bpm",
    "SpO2 %",
    "Nhiệt độ C",
    "Độ ẩm %",
    "Góc giường độ",
    "Vận động",
    "Lần xoay trở UNIX ms",
    "Đến giờ xoay trở",
    "Còi",
    "Quạt",
    "Tần số lấy mẫu Hz",
    "Người ghi",
    "Mã bản ghi",
  ];
  cloudDownload(
    `CareLink_Supabase_trang_${Cloud.state.page + 1}.csv`,
    "\ufeff" + [heads, ...rows].map((r) => r.map(cell).join(",")).join("\r\n"),
    "text/csv;charset=utf-8",
  );
}
function handleCloudAction(button) {
  const action = button.dataset.cloudAction;
  if (!action) return;
  const tasks = {
    check: () => Cloud.loadTeams(),
    "sign-out": () => Cloud.signOut(),
    stop: () => Cloud.stop(),
    flush: () => Cloud.flush(true),
    refresh: () => Cloud.queryHistory(true),
    next: () => Cloud.nextPage(),
    previous: () => Cloud.previousPage(),
    export: () => cloudExport(),
    demo: () => {
      if (S.mode !== "demo")
        throw new Error("Chuyển sang mô phỏng để lưu bộ mẫu có nhãn mô phỏng.");
      return Cloud.saveDemo([
        {
          type: "telemetry",
          node: 1,
          data: {
            hr: S.hr,
            spo2: S.spo2,
            rate: S.rate,
            measuring: S.measuring,
          },
        },
        {
          type: "telemetry",
          node: 2,
          data: { temp: S.temp, humidity: S.humidity, fan: S.fan },
        },
        {
          type: "telemetry",
          node: 3,
          data: {
            head_angle: S.bed.headAngle,
            motion_status: S.bed.motionStatus,
            last_reposition_at: S.bed.lastRepositionAt,
            reposition_due: S.bed.repositionDue,
            buzzer: S.bed.buzzer,
          },
        },
      ]);
    },
    detail: () => {
      const row = Cloud.state.rows.find((r) => r.id === button.dataset.id);
      if (row) {
        $("#modal-body").innerHTML =
          `<h3>Bản ghi trên máy chủ</h3><pre class="cloud-json">${esc(JSON.stringify(row, null, 2))}</pre>`;
        $("#modal").showModal();
      }
    },
    ecg: async () => {
      const frames = await Cloud.readEcg(button.dataset.id);
      if (!frames)
        throw new Error(
          "Bản ghi này không kèm ECG thô. Bật lưu ECG cho các phép đo tiếp theo nếu cần.",
        );
      cloudDownload(
        `ECG_${button.dataset.id}.json`,
        JSON.stringify(frames, null, 2),
        "application/json",
      );
    },
  };
  if (tasks[action]) cloudPerform(tasks[action]);
}
