const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
let db, team;
const owner = "11111111-1111-4111-8111-111111111111";
const writer = "22222222-2222-4222-8222-222222222222";
const viewer = "33333333-3333-4333-8333-333333333333";
const stranger = "44444444-4444-4444-8444-444444444444";
async function asUser(id, sql, args = []) {
  await db.exec(`reset role; set role authenticated;`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  return db.query(sql, args);
}
function row(extra = {}) {
  return {
    id: crypto.randomUUID(),
    node_id: 3,
    device_id: "bed-03",
    source: "device",
    event_key: crypto.randomUUID(),
    observed_at: new Date().toISOString(),
    payload: { head_angle: 35, motion_status: "normal", buzzer: false },
    ...extra,
  };
}
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
  for (const [id, email] of [
    [owner, "owner@example.test"],
    [writer, "writer@example.test"],
    [viewer, "viewer@example.test"],
    [stranger, "stranger@example.test"],
  ])
    await db.query("insert into auth.users values($1,$2,now())", [id, email]);
  const sql = fs.readFileSync(
    path.join(__dirname, "../supabase/schema.sql"),
    "utf8",
  );
  await db.exec(sql);
  await db.exec(sql); // migration is safe to rerun, preserving existing records
  team = (
    await asUser(owner, "select public.carelink_create_team($1) as id", [
      "Nhóm kiểm tra",
    ])
  ).rows[0].id;
  await asUser(owner, "select public.carelink_add_member($1,$2,$3)", [
    team,
    "writer@example.test",
    "writer",
  ]);
  await asUser(owner, "select public.carelink_add_member($1,$2,$3)", [
    team,
    "viewer@example.test",
    "viewer",
  ]);
});
after(async () => {
  if (db) await db.close();
});
test("anonymous users cannot read or ingest measurements", async () => {
  await db.exec("reset role; set role anon;");
  await assert.rejects(
    db.query("select * from public.carelink_measurements"),
    /permission denied/,
  );
  await assert.rejects(
    db.query("select public.carelink_ingest($1,$2::jsonb)", [
      team,
      JSON.stringify([row()]),
    ]),
    /permission denied/,
  );
});
test("writer can persist all three nodes, server stamps identity", async () => {
  const rows = [
    row(),
    row({ node_id: 1, payload: { hr: 76, spo2: 98, rate: 200 } }),
    row({ node_id: 2, payload: { temp: 25, humidity: 60, fan: false } }),
  ];
  const result = await asUser(
    writer,
    "select public.carelink_ingest($1,$2::jsonb) as result",
    [team, JSON.stringify(rows)],
  );
  assert.equal(result.rows[0].result.inserted, 3);
  const found = await asUser(
    viewer,
    "select * from public.carelink_measurements where id=$1",
    [rows[0].id],
  );
  assert.equal(found.rows[0].created_by, writer);
});
test("retry is idempotent and does not overwrite a previous measurement", async () => {
  const item = row();
  await asUser(writer, "select public.carelink_ingest($1,$2::jsonb)", [
    team,
    JSON.stringify([item]),
  ]);
  const retry = await asUser(
    writer,
    "select public.carelink_ingest($1,$2::jsonb) as result",
    [team, JSON.stringify([{ ...item, payload: { head_angle: 60 } }])],
  );
  assert.equal(retry.rows[0].result.duplicates, 1);
  const saved = await asUser(
    viewer,
    "select payload from public.carelink_measurements where id=$1",
    [item.id],
  );
  assert.equal(saved.rows[0].payload.head_angle, 35);
});
test("viewer and unrelated account cannot write; unrelated account sees no team rows", async () => {
  for (const user of [viewer, stranger])
    await assert.rejects(
      asUser(user, "select public.carelink_ingest($1,$2::jsonb)", [
        team,
        JSON.stringify([row()]),
      ]),
      /Không có quyền/,
    );
  const result = await asUser(
    stranger,
    "select * from public.carelink_measurements",
  );
  assert.equal(result.rows.length, 0);
  assert.equal(
    (await asUser(stranger, "select * from public.carelink_teams")).rows.length,
    0,
  );
});
test("only owner can add members or change permissions", async () => {
  await assert.rejects(
    asUser(writer, "select public.carelink_add_member($1,$2,$3)", [
      team,
      "stranger@example.test",
      "writer",
    ]),
    /trưởng nhóm/,
  );
  await assert.rejects(
    asUser(owner, "select public.carelink_add_member($1,$2,$3)", [
      team,
      "owner@example.test",
      "writer",
    ]),
    /trưởng nhóm/,
  );
  await assert.rejects(
    asUser(
      writer,
      "insert into public.carelink_members values($1,$2,$3,now())",
      [team, stranger, "owner"],
    ),
    /permission denied/,
  );
});
test("forged created_by and modifying/deleting stored results are rejected", async () => {
  const item = row();
  await assert.rejects(
    asUser(
      writer,
      `insert into public.carelink_measurements(id,team_id,node_id,device_id,source,event_key,observed_at,payload,created_by) values($1,$2,3,'bed-03','device','forged',now(),'{"head_angle":35}',$3)`,
      [item.id, team, owner],
    ),
    /row-level security/,
  );
  await assert.rejects(
    asUser(writer, "update public.carelink_measurements set source=$1", [
      "demo",
    ]),
    /permission denied/,
  );
  await assert.rejects(
    asUser(owner, "delete from public.carelink_measurements"),
    /permission denied/,
  );
});
test("invalid samples roll back the entire upload transaction", async () => {
  const valid = row();
  await assert.rejects(
    asUser(writer, "select public.carelink_ingest($1,$2::jsonb)", [
      team,
      JSON.stringify([valid, row({ payload: { head_angle: "35" } })]),
    ]),
    /check constraint/,
  );
  assert.equal(
    (
      await asUser(
        writer,
        "select id from public.carelink_measurements where id=$1",
        [valid.id],
      )
    ).rows.length,
    0,
  );
});
test("raw ECG is a separate checked batch and restricted to its team", async () => {
  const item = row({
    node_id: 1,
    payload: { rate: 200, hr: 76 },
    ecg_frames: [
      {
        rate: 200,
        received_at: new Date().toISOString(),
        samples: [0, 0.1, -0.2],
      },
    ],
  });
  const result = await asUser(
    writer,
    "select public.carelink_ingest($1,$2::jsonb) as result",
    [team, JSON.stringify([item])],
  );
  assert.equal(result.rows[0].result.ecg_batches, 1);
  assert.equal(
    (
      await asUser(
        viewer,
        "select frames from public.carelink_ecg_batches where measurement_id=$1",
        [item.id],
      )
    ).rows[0].frames[0].rate,
    200,
  );
  assert.equal(
    (await asUser(stranger, "select * from public.carelink_ecg_batches")).rows
      .length,
    0,
  );
  await assert.rejects(
    asUser(writer, "select public.carelink_ingest($1,$2::jsonb)", [
      team,
      JSON.stringify([row({ ecg_frames: item.ecg_frames })]),
    ]),
    /ECG/,
  );
});

test("history filters separate demo and real results and keyset pages have no duplicates", async () => {
  const time = new Date(Date.now() - 10000).toISOString();
  const items = Array.from({ length: 4 }, (_, i) =>
    row({ observed_at: time, source: i === 0 ? "demo" : "device" }),
  );
  await asUser(writer, "select public.carelink_ingest($1,$2::jsonb)", [
    team,
    JSON.stringify(items),
  ]);
  const demo = await asUser(
    viewer,
    "select * from public.carelink_history($1,p_source=>'demo',p_from=>$2,p_to=>$2)",
    [team, time],
  );
  assert.equal(demo.rows.length, 1);
  assert.equal(demo.rows[0].source, "demo");
  const first = await asUser(
    viewer,
    "select * from public.carelink_history($1,p_source=>'device',p_from=>$2,p_to=>$2,p_limit=>2)",
    [team, time],
  );
  assert.equal(first.rows.length, 2);
  const last = first.rows.at(-1);
  const next = await asUser(
    viewer,
    "select * from public.carelink_history($1,p_source=>'device',p_from=>$2,p_to=>$2,p_after_time=>$3,p_after_id=>$4,p_limit=>2)",
    [team, time, last.observed_at, last.id],
  );
  assert.equal(next.rows.length, 1);
  assert.equal(new Set([...first.rows, ...next.rows].map((r) => r.id)).size, 3);
});

test("incomplete raw frames and SQL-null uploads are rejected atomically", async () => {
  for (const frame of [
    { rate: 200, samples: [1, 2] },
    { rate: 200, received_at: new Date().toISOString() },
  ]) {
    await assert.rejects(
      asUser(writer, "select public.carelink_ingest($1,$2::jsonb)", [
        team,
        JSON.stringify([
          row({ node_id: 1, payload: { rate: 200 }, ecg_frames: [frame] }),
        ]),
      ]),
      /ECG/,
    );
  }
  await assert.rejects(
    asUser(writer, "select public.carelink_ingest($1,null)", [team]),
    /bản ghi/,
  );
});
