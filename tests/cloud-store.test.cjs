const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  vm = require("node:vm"),
  path = require("node:path");
function fixture({ session = true } = {}) {
  const saved = [],
    preferences = new Map(),
    team = "11111111-1111-4111-8111-111111111111";
  const user = {
    id: "22222222-2222-4222-8222-222222222222",
    email: "fake@example.test",
  };
  let failed = false;
  const sdk = {
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } },
      }),
      getSession: async () => ({
        data: { session: session ? { user } : null },
      }),
      signInWithPassword: async () => ({ data: { session: { user } } }),
      signOut: async () => ({}),
    },
    removeAllChannels: async () => {},
    rpc: async (name, args) => {
      if (name === "carelink_schema_version") return { data: 1 };
      if (name === "carelink_history")
        return {
          data: saved.filter(
            (r) => args.p_source === "all" || r.source === args.p_source,
          ),
        };
      if (name === "carelink_ingest") {
        if (failed) return { error: { message: "offline" } };
        let inserted = 0;
        for (const row of args.p_rows)
          if (!saved.some((r) => r.id === row.id)) {
            saved.push(row);
            inserted++;
          }
        return {
          data: { inserted, duplicates: args.p_rows.length - inserted },
        };
      }
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({
            data: [
              {
                team_id: team,
                role: "writer",
                team: { id: team, name: "Nhóm kiểm tra" },
              },
            ],
          }),
        }),
      }),
    }),
  };
  const context = vm.createContext({
    crypto,
    URL,
    atob,
    Date,
    console,
    Map,
    Set,
    JSON,
    Number,
    Math,
    Object,
    Promise,
    supabase: { createClient: () => sdk },
    localStorage: {
      getItem: (k) => preferences.get(k) || null,
      setItem: (k, v) => preferences.set(k, v),
    },
    setTimeout: () => 1,
    refreshCloudUI: () => {},
    S: { route: "overview" },
  });
  for (const file of ["cloud-model.js", "cloud-store.js"])
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, "../dist", file), "utf8"),
      context,
    );
  vm.runInContext(
    `const memory=new CloudModel.MemoryQueue();CloudIndexedQueue.prototype.database=async()=>({});for(const name of ['count','add','list','remove'])CloudIndexedQueue.prototype[name]=(...args)=>memory[name](...args);`,
    context,
  );
  return {
    run: (code) => vm.runInContext(code, context),
    saved,
    preferences,
    fail: (value) => {
      failed = value;
    },
  };
}
async function configured(f) {
  await f.run(
    `Cloud.configure('https://example.supabase.co','sb_publishable_fake_key_for_tests')`,
  );
}
test("configuration without user session does not pretend that the server is connected", async () => {
  const f = fixture({ session: false });
  await configured(f);
  assert.equal(f.run("Cloud.state.schemaReady"), false);
  assert.equal(f.run("Cloud.state.user"), null);
  assert.equal(f.run("Cloud.state.saved"), 0);
  await assert.rejects(f.run("Cloud.setAutoSave(true)"), /quyền ghi/);
});
test("live telemetry reaches persistent queue, then successful server acknowledgement", async () => {
  const f = fixture();
  await configured(f);
  await f.run("Cloud.setAutoSave(true)");
  f.run(
    `Cloud.ingest({type:'telemetry',node:3,data:{head_angle:35,buzzer:false}})`,
  );
  await f.run("Cloud.stop()");
  assert.equal(f.run("Cloud.state.pending"), 1);
  assert.equal(f.run("Cloud.state.saved"), 0);
  await f.run("Cloud.flush(true)");
  assert.equal(f.run("Cloud.state.pending"), 0);
  assert.equal(f.run("Cloud.state.saved"), 1);
  assert.equal(f.saved[0].source, "device");
  assert.equal(f.saved[0].payload.buzzer, false);
});
test("failed server upload remains pending and retries exact record", async () => {
  const f = fixture();
  await configured(f);
  await f.run("Cloud.setAutoSave(true)");
  f.run(`Cloud.ingest({type:'telemetry',node:2,data:{temp:26,humidity:60}})`);
  await f.run("Cloud.stop()");
  f.fail(true);
  await f.run("Cloud.flush(true)");
  assert.equal(f.run("Cloud.state.pending"), 1);
  assert.equal(f.run("Cloud.state.saved"), 0);
  f.fail(false);
  await f.run("Cloud.flush(true)");
  assert.equal(f.run("Cloud.state.pending"), 0);
  assert.equal(f.saved.length, 1);
});
test("explicit demo upload stays labelled and history is read back from server", async () => {
  const f = fixture();
  await configured(f);
  await f.run(
    `Cloud.saveDemo([{type:'telemetry',node:3,data:{head_angle:35,motion_status:'normal'}}])`,
  );
  assert.equal(f.saved[0].source, "demo");
  assert.equal(f.run("Cloud.state.rows.length"), 1);
  assert.equal(f.run("Cloud.state.filters.source"), "demo");
});
test("secret key rejected before replacing an existing working project", async () => {
  const f = fixture();
  await configured(f);
  await assert.rejects(
    f.run(
      `Cloud.configure('https://another.supabase.co','sb_secret_example_not_real')`,
    ),
    /secret/,
  );
  assert.equal(f.run("Cloud.state.config.url"), "https://example.supabase.co");
});
