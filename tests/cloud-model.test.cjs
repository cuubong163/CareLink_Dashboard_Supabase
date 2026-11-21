const { test } = require("node:test");
const assert = require("node:assert/strict");
const Model = require("../dist/cloud-model.js");
const now = 1794913200000;
const packet = (node, data, seq = 1) => ({
  type: "telemetry",
  node,
  boot_id: "boot-one",
  seq,
  data,
});

test("public configuration rejects secret keys, non-anon JWTs and unsafe URLs", () => {
  const key = "sb_publishable_qa_only_test_key";
  assert.equal(
    Model.projectConfig("https://example.supabase.co/", key).url,
    "https://example.supabase.co",
  );
  for (const url of [
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com/path",
    "javascript:alert(1)",
  ])
    assert.throws(() => Model.projectConfig(url, key));
  assert.throws(() =>
    Model.projectConfig(
      "https://example.supabase.co",
      "sb_secret_not_for_frontend",
    ),
  );
  const jwt = (role) =>
    "e30." + Buffer.from(JSON.stringify({ role })).toString("base64url") + ".x";
  assert.throws(() =>
    Model.projectConfig("https://example.supabase.co", jwt("service_role")),
  );
  assert.equal(
    Model.projectConfig("https://example.supabase.co", jwt("anon")).key,
    jwt("anon"),
  );
});
test("measurements preserve legitimate zero/false values and omit invalid or absent data", () => {
  assert.deepEqual(
    Model.normalize(3, {
      head_angle: 0,
      buzzer: false,
      battery: 0,
      unknown: "secret",
      motion_status: "fall",
    }),
    { head_angle: 0, battery: 0, buzzer: false },
  );
  assert.equal(Model.normalize(3, { fall: true, accel: [0, 0, 1] }), null);
  assert.deepEqual(
    Model.normalize(1, { hr: "76", spo2: NaN, rate: 200, measuring: false }),
    { measuring: false, rate: 200 },
  );
});
test("collector saves latest measured values once per window without carrying old fields", () => {
  const c = new Model.Collector({ interval: 5 });
  c.push(packet(1, { hr: 76, spo2: 98 }, 1), "device", now);
  c.push(packet(1, { hr: 80 }, 2), "device", now + 1000);
  const rows = c.drain(now + 5000);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload.hr, 80);
  assert.equal(rows[0].source, "device");
  assert.equal(rows[0].observed_at, new Date(now + 1000).toISOString());
  c.push(packet(1, { hr: 70 }, 3), "device", now + 6000);
  assert.equal(c.drain(now + 11000)[0].payload.spo2, undefined);
});
test("device/gateway sequence duplicates and old fall packets are ignored", () => {
  const c = new Model.Collector();
  c.push(packet(3, { head_angle: 35 }), "device", now);
  c.push(packet(3, { head_angle: 60 }), "device", now + 1);
  assert.equal(c.drain(now + 6000)[0].payload.head_angle, 35);
  assert.deepEqual(c.push(packet(3, { fall: true }, 2), "device", now), []);
  assert.equal(c.drain(now + 6000).length, 0);
});
test("state transitions preserve short seizure and buzzer events within an aggregation window", () => {
  const c = new Model.Collector();
  c.push(
    packet(3, { motion_status: "normal", buzzer: false }, 1),
    "device",
    now,
  );
  const first = c.push(
    packet(3, { motion_status: "suspected_seizure", buzzer: true }, 2),
    "device",
    now + 200,
  );
  const second = c.push(
    packet(3, { motion_status: "normal", buzzer: false }, 3),
    "device",
    now + 400,
  );
  assert.equal(first[0].payload.motion_status, "normal");
  assert.equal(second[0].payload.motion_status, "suspected_seizure");
  assert.equal(second[0].payload.buzzer, true);
});
test("raw ECG keeps all frames/rates in a bounded batch; storage is opt-in", () => {
  const c = new Model.Collector({ interval: 5, saveEcg: true });
  for (let i = 0; i < 10; i++)
    c.push(
      packet(
        1,
        { rate: 200, ecg: Array.from({ length: 20 }, (_, n) => n / 100) },
        i,
      ),
      "device",
      now + i * 100,
    );
  const row = c.drain(now + 5000)[0];
  assert.equal(row.ecg_frames.length, 10);
  assert.equal(row.ecg_frames.flatMap((f) => f.samples).length, 200);
  assert.equal(row.ecg_frames[0].rate, 200);
  const off = new Model.Collector();
  off.push(packet(1, { rate: 200, ecg: [1, 2, 3] }), "device", now);
  assert.equal(off.drain(now + 5000)[0].ecg_frames, undefined);
});
test("invalid ECG frame never fabricates samples or a sampling frequency", () => {
  const c = new Model.Collector({ saveEcg: true });
  c.push(packet(1, { hr: 76, ecg: [1, 2, 3] }, 1), "device", now);
  c.push(packet(1, { rate: 200, ecg: [1, NaN, 3] }, 2), "device", now + 1);
  const row = c.drain(now + 5000)[0];
  assert.equal(row.ecg_frames, undefined);
  assert.equal(c.invalidEcg, 2);
});
test("ECG window splits before exceeding the server sample cap", () => {
  const c = new Model.Collector({ interval: 30, saveEcg: true });
  let rows = [];
  for (let i = 0; i < 5; i++)
    rows.push(
      ...c.push(
        packet(1, { rate: 500, ecg: Array(2000).fill(0.2) }, i),
        "device",
        now + i,
      ),
    );
  rows.push(...c.drain(now, true));
  assert.equal(rows.length, 2);
  assert.equal(
    rows.reduce((n, r) => n + r.ecg_frames.flatMap((f) => f.samples).length, 0),
    10000,
  );
  assert.ok(
    rows.every((r) => r.ecg_frames.flatMap((f) => f.samples).length <= 6000),
  );
});
test("demo and real packets stay in separate labelled buckets", () => {
  const c = new Model.Collector();
  c.push(packet(3, { head_angle: 35 }), "demo", now);
  c.push(packet(3, { head_angle: 36 }), "device", now);
  assert.deepEqual(
    c
      .drain(now, true)
      .map((r) => r.source)
      .sort(),
    ["demo", "device"],
  );
});
test("failed upload retains exact IDs; retry removes only server-confirmed records", async () => {
  const storage = new Model.MemoryQueue(),
    c = new Model.Collector();
  c.push(packet(2, { temp: 25, humidity: 60 }), "device", now);
  const rows = c.drain(now, true);
  let fail = true,
    seen = [];
  const q = new Model.UploadQueue({
    storage,
    send: async (items) => {
      seen.push(items[0].id);
      if (fail) throw Error("offline");
      return { inserted: 0, duplicates: items.length };
    },
  });
  await q.add("team-A", rows);
  await assert.rejects(q.flush("team-A"));
  assert.equal(await storage.count("team-A"), 1);
  fail = false;
  await q.flush("team-A");
  assert.equal(await storage.count("team-A"), 0);
  assert.equal(seen[0], seen[1]);
});
test("wrong server confirmation cannot silently discard pending data", async () => {
  const storage = new Model.MemoryQueue(),
    q = new Model.UploadQueue({
      storage,
      send: async () => ({ inserted: 0, duplicates: 0 }),
    });
  await q.add("A", [
    { id: crypto.randomUUID(), observed_at: new Date(now).toISOString() },
  ]);
  await assert.rejects(q.flush("A"), /xác nhận/);
  assert.equal(await storage.count("A"), 1);
});
test("outbox is isolated by project/account/team and reports full capacity", async () => {
  const storage = new Model.MemoryQueue(),
    q = new Model.UploadQueue({
      storage,
      limit: 1,
      send: async (items) => ({ inserted: items.length, duplicates: 0 }),
    });
  const row = () => ({
    id: crypto.randomUUID(),
    observed_at: new Date(now).toISOString(),
  });
  await q.add("project-A/user/team", [row()]);
  await q.add("project-B/user/team", [row()]);
  await assert.rejects(q.add("project-A/user/team", [row()]), /đầy/);
  await q.flush("project-A/user/team");
  assert.equal(await storage.count("project-B/user/team"), 1);
});
