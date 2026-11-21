"use strict";

const CloudModel = (() => {
  const limits = {
    1: { hr: [0, 300], spo2: [0, 100] },
    2: { temp: [-40, 100], humidity: [0, 100] },
    3: {
      head_angle: [-20, 90],
      motion_hz: [0, 100],
      vibration_rms: [0, 32],
      last_reposition_at: [1, 8000000000000],
      battery: [0, 100],
      rssi: [-200, 0],
    },
  };
  const booleans = {
    1: ["measuring"],
    2: ["fan"],
    3: ["reposition_due", "buzzer"],
  };
  const rates = [125, 200, 250, 500];
  const validNumber = (n, low, high) =>
    typeof n === "number" && Number.isFinite(n) && n >= low && n <= high;
  const uuid = () => globalThis.crypto.randomUUID();

  function projectConfig(url, key) {
    let parsed;
    try {
      parsed = new URL(url.trim());
    } catch {
      throw new Error("Địa chỉ Supabase không hợp lệ.");
    }
    const local = ["localhost", "127.0.0.1"].includes(parsed.hostname);
    if (
      (!local && parsed.protocol !== "https:") ||
      !["https:", "http:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== "/"
    ) {
      throw new Error(
        "Dùng Project URL HTTPS, ví dụ https://ten-du-an.supabase.co, không thêm đường dẫn.",
      );
    }
    key = key.trim();
    if (key.startsWith("sb_secret_"))
      throw new Error(
        "Không dùng secret/service_role key trên web. Hãy dùng publishable key.",
      );
    if (!key.startsWith("sb_publishable_")) {
      try {
        const segment = key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        const claims = JSON.parse(atob(segment));
        if (claims.role !== "anon") throw new Error();
      } catch {
        throw new Error(
          "Khóa cần là sb_publishable_… hoặc anon key. Không dùng service_role.",
        );
      }
    }
    if (key.length < 20) throw new Error("Khóa Supabase chưa đầy đủ.");
    return { url: parsed.origin, key };
  }

  function normalize(node, data) {
    if (
      !limits[node] ||
      !data ||
      typeof data !== "object" ||
      Array.isArray(data)
    )
      return null;
    const out = {};
    for (const [key, [low, high]] of Object.entries(limits[node])) {
      if (validNumber(data[key], low, high)) out[key] = data[key];
    }
    for (const key of booleans[node])
      if (typeof data[key] === "boolean") out[key] = data[key];
    if (node === 1 && rates.includes(data.rate)) out.rate = data.rate;
    if (
      node === 3 &&
      ["normal", "agitation", "suspected_seizure"].includes(data.motion_status)
    ) {
      out.motion_status = data.motion_status;
      if (typeof data.reason === "string")
        out.reason = data.reason.slice(0, 180);
    }
    return Object.keys(out).length ? out : null;
  }

  class Collector {
    constructor({ interval = 5, saveEcg = false, makeId = uuid } = {}) {
      this.interval = interval * 1000;
      this.saveEcg = saveEcg;
      this.makeId = makeId;
      this.buckets = new Map();
      this.seen = new Set();
      this.invalidEcg = 0;
    }
    push(message, source = "device", now = Date.now()) {
      if (
        message?.type !== "telemetry" ||
        ![1, 2, 3].includes(message.node) ||
        !["device", "demo"].includes(source)
      )
        return [];
      const node = message.node;
      const payload = normalize(node, message.data);
      if (!payload) {
        if (
          this.saveEcg &&
          node === 1 &&
          Array.isArray(message.data?.ecg) &&
          message.data.ecg.length
        )
          this.invalidEcg++;
        return [];
      }
      const device =
        typeof message.device_id === "string" && message.device_id.trim()
          ? message.device_id.slice(0, 100)
          : `node-${node}`;
      const bucketKey = `${source}/${node}/${device}`;
      const numbered =
        typeof message.boot_id === "string" &&
        Number.isSafeInteger(message.seq) &&
        message.seq >= 0;
      const packet = numbered
        ? `${message.boot_id.slice(0, 60)}:${message.seq}`
        : this.makeId();
      const seenKey = `${bucketKey}/${packet}`;
      if (this.seen.has(seenKey)) return [];
      this.seen.add(seenKey);
      if (this.seen.size > 2048)
        this.seen.delete(this.seen.values().next().value);
      let frame;
      if (
        this.saveEcg &&
        node === 1 &&
        Array.isArray(message.data.ecg) &&
        message.data.ecg.length
      ) {
        if (
          rates.includes(message.data.rate) &&
          message.data.ecg.length <= 2000 &&
          message.data.ecg.every((v) => validNumber(v, -100000, 100000))
        ) {
          frame = {
            received_at: new Date(now).toISOString(),
            rate: message.data.rate,
            samples: [...message.data.ecg],
          };
        } else this.invalidEcg++;
      }
      const ready = [];
      let previous = this.buckets.get(bucketKey);
      const stateKeys = [
        "motion_status",
        "reposition_due",
        "last_reposition_at",
        "buzzer",
        "fan",
        "measuring",
      ];
      const transition =
        previous &&
        stateKeys.some(
          (key) =>
            key in payload &&
            key in previous.payload &&
            payload[key] !== previous.payload[key],
        );
      if (
        previous &&
        (now - previous.started >= this.interval ||
          transition ||
          previous.samples + (frame?.samples.length || 0) > 6000 ||
          previous.frames.length >= 400)
      ) {
        ready.push(this.finish(bucketKey));
        previous = null;
      }
      const bucket = previous || {
        id: this.makeId(),
        node_id: node,
        device_id: device,
        source,
        started: now,
        ended: now,
        first: packet,
        last: packet,
        payload: {},
        frames: [],
        samples: 0,
      };
      Object.assign(bucket.payload, payload);
      bucket.ended = now;
      bucket.last = packet;
      if (frame) {
        bucket.frames.push(frame);
        bucket.samples += frame.samples.length;
      }
      this.buckets.set(bucketKey, bucket);
      return ready;
    }
    finish(key) {
      const b = this.buckets.get(key);
      this.buckets.delete(key);
      const row = {
        id: b.id,
        node_id: b.node_id,
        device_id: b.device_id,
        source: b.source,
        event_key: `${b.first}..${b.last}`.slice(0, 200),
        observed_at: new Date(b.ended).toISOString(),
        payload: b.payload,
      };
      if (b.frames.length) row.ecg_frames = b.frames;
      return row;
    }
    drain(now = Date.now(), force = false) {
      const rows = [];
      for (const [key, b] of this.buckets)
        if (force || now - b.started >= this.interval)
          rows.push(this.finish(key));
      return rows;
    }
  }

  class MemoryQueue {
    constructor() {
      this.rows = new Map();
    }
    async count(scope) {
      return (await this.list(scope)).length;
    }
    async add(scope, rows) {
      for (const row of rows)
        this.rows.set(`${scope}/${row.id}`, { scope, row });
    }
    async list(scope) {
      return [...this.rows.values()]
        .filter((v) => v.scope === scope)
        .map((v) => v.row)
        .sort((a, b) => a.observed_at.localeCompare(b.observed_at));
    }
    async remove(scope, ids) {
      for (const id of ids) this.rows.delete(`${scope}/${id}`);
    }
  }

  class UploadQueue {
    constructor({ storage, send, limit = 5000 }) {
      this.storage = storage;
      this.send = send;
      this.limit = limit;
      this.busy = false;
    }
    async add(scope, rows) {
      if (!rows.length) return;
      if ((await this.storage.count(scope)) + rows.length > this.limit)
        throw new Error(
          "Hàng chờ đã đầy. Dừng ghi, khôi phục mạng và gửi hết dữ liệu chờ trước.",
        );
      await this.storage.add(scope, rows);
    }
    async flush(scope) {
      if (this.busy) return null;
      this.busy = true;
      try {
        const batch = (await this.storage.list(scope)).slice(0, 50);
        if (!batch.length) return null;
        const result = await this.send(batch);
        if (
          !result ||
          !Number.isInteger(result.inserted) ||
          !Number.isInteger(result.duplicates) ||
          result.inserted + result.duplicates !== batch.length
        )
          throw new Error(
            "Máy chủ chưa xác nhận đủ bản ghi; giữ dữ liệu trong hàng chờ.",
          );
        await this.storage.remove(
          scope,
          batch.map((r) => r.id),
        );
        return result;
      } finally {
        this.busy = false;
      }
    }
  }
  return {
    projectConfig,
    normalize,
    Collector,
    UploadQueue,
    MemoryQueue,
    validNumber,
  };
})();
if (typeof module !== "undefined") module.exports = CloudModel;
