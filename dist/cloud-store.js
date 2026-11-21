"use strict";

class CloudIndexedQueue {
  async database() {
    if (!this.opening)
      this.opening = new Promise((resolve, reject) => {
        if (!globalThis.indexedDB)
          return reject(
            new Error(
              "Trình duyệt không hỗ trợ hàng chờ bền vững. Hãy dùng Chrome/Edge thông thường.",
            ),
          );
        const request = indexedDB.open("carelink-server-outbox", 1);
        request.onupgradeneeded = () => {
          request.result
            .createObjectStore("rows", { keyPath: "key" })
            .createIndex("scope", "scope");
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(
            new Error(
              "Không mở được hàng chờ trên máy. Kiểm tra dung lượng trình duyệt.",
            ),
          );
      });
    return this.opening;
  }
  async list(scope) {
    const db = await this.database();
    return new Promise((resolve, reject) => {
      const r = db
        .transaction("rows")
        .objectStore("rows")
        .index("scope")
        .getAll(scope);
      r.onsuccess = () =>
        resolve(
          r.result
            .map((v) => v.row)
            .sort((a, b) => a.observed_at.localeCompare(b.observed_at)),
        );
      r.onerror = () => reject(new Error("Không đọc được hàng chờ."));
    });
  }
  async count(scope) {
    return (await this.list(scope)).length;
  }
  async mutate(scope, rows, remove = false) {
    const db = await this.database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("rows", "readwrite");
      const store = tx.objectStore("rows");
      for (const row of rows) {
        const id = remove ? row : row.id;
        if (remove) store.delete(`${scope}/${id}`);
        else store.put({ key: `${scope}/${id}`, scope, row });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(
          new Error(
            "Không lưu được hàng chờ. Có thể trình duyệt hết dung lượng.",
          ),
        );
      tx.onabort = () =>
        reject(new Error("Chưa lưu được bản ghi vào hàng chờ."));
    });
  }
  async add(scope, rows) {
    return this.mutate(scope, rows);
  }
  async remove(scope, ids) {
    return this.mutate(scope, ids, true);
  }
}

const Cloud = (() => {
  const state = {
    config: null,
    user: null,
    teams: [],
    teamId: "",
    role: "",
    schemaReady: false,
    busy: false,
    queryBusy: false,
    error: "",
    notice: "",
    autoSave: false,
    saveEcg: false,
    interval: 5,
    pending: 0,
    saved: 0,
    duplicates: 0,
    lastSaved: null,
    rows: [],
    hasMore: false,
    cursors: [null],
    page: 0,
    filters: { node: 0, source: "device", from: "", to: "" },
    lastHistory: 0,
    invalidEcg: 0,
  };
  let client = null,
    subscription = null,
    collector = null,
    queue = null,
    generation = 0,
    adding = Promise.resolve(),
    retryAt = 0,
    failures = 0,
    refreshing = false,
    loadingIdentity = "";
  const storage = new CloudIndexedQueue();
  const notify = (kind = "status") => {
    if (typeof refreshCloudUI === "function") refreshCloudUI(kind);
  };
  const scope = () => `${state.config?.url}/${state.user?.id}/${state.teamId}`;
  const canWrite = () =>
    state.schemaReady &&
    !!state.teamId &&
    ["owner", "writer"].includes(state.role);
  const fail = (error) => {
    const code = error?.code || "";
    state.error =
      code === "PGRST202" || code === "42P01"
        ? "Chưa có bảng/hàm CareLink. Chạy supabase/schema.sql trong SQL Editor rồi kết nối lại."
        : String(
            error?.message || error || "Không thực hiện được yêu cầu.",
          ).slice(0, 300);
    notify();
  };
  function ensure() {
    if (!client || !state.user)
      throw new Error("Hãy cấu hình Supabase và đăng nhập trước.");
  }
  async function stop() {
    state.autoSave = false;
    if (collector) await enqueue(collector.drain(Date.now(), true));
    collector = null;
    notify();
  }
  async function enqueue(rows) {
    if (!rows.length || !state.user || !state.teamId || !queue) return;
    const current = scope(),
      targetQueue = queue;
    adding = adding
      .catch(() => {})
      .then(async () => {
        await targetQueue.add(current, rows);
        if (current === scope()) state.pending = await storage.count(current);
        notify();
      })
      .catch((error) => {
        state.autoSave = false;
        collector = null;
        fail(error);
      });
    return adding;
  }
  async function loadTeams() {
    ensure();
    const currentGeneration = generation;
    const user = state.user.id;
    const version = await client.rpc("carelink_schema_version");
    if (version.error) throw version.error;
    if (version.data !== 1)
      throw new Error(
        "Phiên bản bảng Supabase chưa tương thích với bộ code này.",
      );
    const { data, error } = await client
      .from("carelink_members")
      .select("team_id,role,team:carelink_teams(id,name)")
      .eq("user_id", user)
      .order("joined_at");
    if (error) throw error;
    if (currentGeneration !== generation || state.user?.id !== user) return;
    state.schemaReady = true;
    state.teams = (data || []).map((m) => ({
      id: m.team_id,
      role: m.role,
      name:
        (Array.isArray(m.team) ? m.team[0] : m.team)?.name || "Nhóm CareLink",
    }));
    const preferred = localStorage.getItem(
      `carelink.team.${state.config.url}.${user}`,
    );
    await chooseTeam(
      state.teams.some((t) => t.id === state.teamId)
        ? state.teamId
        : state.teams.some((t) => t.id === preferred)
          ? preferred
          : state.teams[0]?.id || "",
    );
    notify("identity");
  }
  async function activate(session, which) {
    if (which !== generation) return;
    if (!session?.user) {
      await stop();
      state.user = null;
      state.teams = [];
      state.teamId = "";
      state.role = "";
      state.schemaReady = false;
      state.rows = [];
      state.pending = 0;
      notify("identity");
      return;
    }
    const identity = which + "/" + session.user.id;
    if (
      state.user?.id === session.user.id &&
      (state.schemaReady || loadingIdentity === identity)
    )
      return;
    loadingIdentity = identity;
    state.user = session.user;
    state.error = "";
    state.notice = "Đã đăng nhập. Đang kiểm tra bảng và quyền của nhóm…";
    notify("identity");
    try {
      await loadTeams();
      if (which === generation && state.user?.id === session.user.id) {
        state.notice = "Đã kết nối và xác nhận quyền truy cập Supabase.";
        notify();
      }
    } catch (error) {
      fail(error);
    } finally {
      if (loadingIdentity === identity) loadingIdentity = "";
    }
  }
  async function configure(url, key) {
    const checked = CloudModel.projectConfig(url, key);
    await stop();
    generation++;
    subscription?.unsubscribe();
    if (client) {
      await client.auth.stopAutoRefresh?.();
      await client.removeAllChannels();
    }
    if (!globalThis.supabase?.createClient)
      throw new Error(
        "Thiếu thư viện Supabase. Hãy dùng đủ thư mục dist/vendor đi kèm.",
      );
    state.config = checked;
    state.user = null;
    state.teams = [];
    state.teamId = "";
    state.schemaReady = false;
    state.error = "";
    state.rows = [];
    localStorage.setItem("carelink.supabase", JSON.stringify(checked));
    const which = generation;
    client = supabase.createClient(checked.url, checked.key, {
      auth: {
        storageKey: `carelink.auth.${new URL(checked.url).host}`,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
    subscription = client.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => activate(session, which), 0);
    }).data.subscription;
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (which === generation) await activate(data.session, which);
    state.notice = state.user
      ? state.notice
      : "Đã lưu cấu hình. Đăng nhập để kiểm tra kết nối đến máy chủ.";
    notify("identity");
  }
  async function signIn(email, password) {
    if (!client)
      throw new Error("Hãy lưu Project URL và publishable key trước.");
    const { data, error } = await client.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw error;
    await activate(data.session, generation);
  }
  async function signUp(email, password) {
    if (!client) throw new Error("Hãy lưu cấu hình Supabase trước.");
    const { data, error } = await client.auth.signUp({
      email: email.trim(),
      password,
    });
    if (error) throw error;
    state.notice = data.session
      ? "Đã tạo tài khoản."
      : "Đã gửi yêu cầu đăng ký. Mở email xác nhận, sau đó quay lại đăng nhập.";
    if (data.session) await activate(data.session, generation);
    notify();
  }
  async function signOut() {
    await stop();
    const { error } = await client.auth.signOut();
    if (error) throw error;
    await activate(null, generation);
  }
  async function chooseTeam(id) {
    await stop();
    const team = state.teams.find((t) => t.id === id);
    state.teamId = team?.id || "";
    state.role = team?.role || "";
    state.rows = [];
    state.page = 0;
    state.cursors = [null];
    state.hasMore = false;
    state.saved = 0;
    state.duplicates = 0;
    state.lastSaved = null;
    state.pending = 0;
    if (!team) {
      notify("identity");
      return;
    }
    localStorage.setItem(
      `carelink.team.${state.config.url}.${state.user.id}`,
      id,
    );
    const current = scope(),
      which = generation,
      teamId = id,
      targetClient = client;
    queue = new CloudModel.UploadQueue({
      storage,
      send: async (rows) => {
        const { data, error } = await targetClient.rpc("carelink_ingest", {
          p_team_id: teamId,
          p_rows: rows,
        });
        if (error) throw error;
        return data;
      },
    });
    try {
      state.pending = await storage.count(current);
    } catch (error) {
      fail(error);
    }
    if (which === generation && state.teamId === id) await queryHistory(true);
  }
  async function createTeam(name) {
    ensure();
    const { data, error } = await client.rpc("carelink_create_team", {
      p_name: name.trim(),
    });
    if (error) throw error;
    await loadTeams();
    await chooseTeam(data);
    notify("identity");
  }
  async function addMember(email, role) {
    ensure();
    const { error } = await client.rpc("carelink_add_member", {
      p_team_id: state.teamId,
      p_email: email.trim(),
      p_role: role,
    });
    if (error) throw error;
    state.notice =
      "Đã cập nhật quyền thành viên. Bạn ấy đăng nhập cùng dự án để xem nhóm.";
    notify();
  }
  async function setAutoSave(enabled, { interval = 5, saveEcg = false } = {}) {
    await stop();
    if (!enabled) return;
    if (!canWrite())
      throw new Error("Tài khoản cần quyền ghi trong một nhóm đã chọn.");
    if (![1, 5, 10, 30].includes(interval))
      throw new Error("Chu kỳ lưu không hợp lệ.");
    await storage.database();
    state.interval = interval;
    state.saveEcg = !!saveEcg;
    state.autoSave = true;
    state.error = "";
    state.invalidEcg = 0;
    collector = new CloudModel.Collector({ interval, saveEcg: state.saveEcg });
    state.notice =
      "Đang thu bản tin thiết bị thật để lưu. Mô phỏng không tự ghi lên máy chủ.";
    notify();
  }
  function ingest(msg) {
    if (!state.autoSave || !collector) return;
    const rows = collector.push(msg, "device");
    enqueue(rows);
    state.invalidEcg = collector.invalidEcg || 0;
  }
  async function saveDemo(packets) {
    ensure();
    if (!canWrite()) throw new Error("Tài khoản chưa có quyền ghi.");
    const demo = new CloudModel.Collector({ interval: 5, saveEcg: false });
    for (const packet of packets) await enqueue(demo.push(packet, "demo"));
    await enqueue(demo.drain(Date.now(), true));
    await flush(true);
    state.filters.source = "demo";
    await queryHistory(true);
    notify("identity");
  }
  async function flush(manual = false) {
    if (
      !queue ||
      !state.user ||
      !state.teamId ||
      refreshing ||
      (!manual && Date.now() < retryAt)
    )
      return;
    refreshing = true;
    const current = scope(),
      selectedQueue = queue;
    try {
      await adding;
      const result = await selectedQueue.flush(current);
      if (current !== scope()) return;
      state.pending = await storage.count(current);
      if (result) {
        state.saved += result.inserted + result.duplicates;
        state.duplicates += result.duplicates;
        state.lastSaved = Date.now();
        state.error = "";
        state.notice = "Máy chủ đã xác nhận lưu bản ghi.";
      }
      failures = 0;
      retryAt = 0;
      notify();
    } catch (error) {
      if (current !== scope()) return;
      failures++;
      retryAt = Date.now() + Math.min(60000, 2000 * 2 ** Math.min(failures, 5));
      if (
        ["42501", "PGRST202", "42P01", "23514", "23503", "22P02"].includes(
          error?.code,
        )
      )
        await stop();
      fail(error);
    } finally {
      refreshing = false;
    }
  }
  async function queryHistory(reset = false) {
    if (!client || !state.user || !state.teamId || state.queryBusy) return;
    if (reset) {
      state.page = 0;
      state.cursors = [null];
    }
    state.queryBusy = true;
    notify();
    const current = scope(),
      after = state.cursors[state.page];
    try {
      const f = state.filters;
      const { data, error } = await client.rpc("carelink_history", {
        p_team_id: state.teamId,
        p_node: Number(f.node),
        p_source: f.source,
        p_from: f.from ? new Date(f.from).toISOString() : null,
        p_to: f.to ? new Date(f.to).toISOString() : null,
        p_after_time: after?.observed_at || null,
        p_after_id: after?.id || null,
        p_limit: 101,
      });
      if (error) throw error;
      if (current !== scope()) return;
      state.rows = (data || []).slice(0, 100);
      state.hasMore = (data || []).length > 100;
      state.lastHistory = Date.now();
    } catch (error) {
      if (current === scope()) fail(error);
    } finally {
      state.queryBusy = false;
      notify("history");
    }
  }
  async function nextPage() {
    if (!state.hasMore || state.queryBusy) return;
    state.cursors[state.page + 1] = state.rows.at(-1);
    state.page++;
    await queryHistory();
  }
  async function previousPage() {
    if (state.page < 1 || state.queryBusy) return;
    state.page--;
    await queryHistory();
  }
  async function readEcg(id) {
    ensure();
    const { data, error } = await client
      .from("carelink_ecg_batches")
      .select("frames")
      .eq("team_id", state.teamId)
      .eq("measurement_id", id)
      .maybeSingle();
    if (error) throw error;
    return data?.frames || null;
  }
  async function tick() {
    if (collector) await enqueue(collector.drain());
    await flush();
    if (
      state.user &&
      state.teamId &&
      state.schemaReady &&
      state.page === 0 &&
      Date.now() - state.lastHistory > 10000 &&
      typeof S !== "undefined" &&
      S.route === "cloud"
    )
      await queryHistory();
  }
  async function init() {
    try {
      const saved = JSON.parse(
        localStorage.getItem("carelink.supabase") || "null",
      );
      const preset = globalThis.CARELINK_SUPABASE_CONFIG;
      if (saved) await configure(saved.url, saved.key);
      else if (preset?.url && preset?.key) await configure(preset.url, preset.key);
    } catch (error) {
      fail(error);
    }
  }
  return {
    state,
    init,
    configure,
    signIn,
    signUp,
    signOut,
    createTeam,
    addMember,
    chooseTeam,
    setAutoSave,
    ingest,
    saveDemo,
    flush,
    queryHistory,
    nextPage,
    previousPage,
    readEcg,
    tick,
    loadTeams,
    stop,
    fail,
    canWrite,
  };
})();
