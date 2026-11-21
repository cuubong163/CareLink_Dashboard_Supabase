const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function fixture() {
  const timers = new Map();
  const sent = [];
  let count = 0;
  const context = vm.createContext({
    console,
    Date,
    Map,
    Object,
    Number,
    JSON,
    Math,
    localStorage: { getItem: () => null },
    document: { querySelector: () => null },
    setTimeout: (callback) => {
      timers.set(++count, callback);
      return count;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  for (const file of ["bed-model.js", "bed-ui.js", "app.js"]) {
    let code = fs.readFileSync(path.join(__dirname, "../dist", file), "utf8");
    if (file === "app.js")
      code = code.slice(0, code.indexOf('document.addEventListener("click"'));
    vm.runInContext(code, context);
  }
  context.sendFrame = (frame) => sent.push(JSON.parse(frame));
  vm.runInContext(
    `
    render = updateBadges = updateBedReadings = updateReadings = toast = () => {};
    S.mode = 'live'; S.connected = true;
    S.seen[3] = S.dataAt[3] = Date.now();
    BedModel.applyTelemetry(S.bed, {head_angle:35, buzzer:false});
    S.ws = {send: sendFrame, close: () => {}};
  `,
    context,
  );
  return {
    context,
    sent,
    timers,
    run: (code) => vm.runInContext(code, context),
  };
}

test("sending a buzzer command changes no state until matching positive ACK", () => {
  const f = fixture();
  f.run(`command(3, 'set_buzzer', true)`);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].action, "set_buzzer");
  assert.equal(f.run("S.bed.buzzer"), false);
  assert.equal(f.run("S.pending.size"), 1);
  f.context.ack = { type: "ack", id: f.sent[0].id, node: 3, ok: true };
  f.run("receive(ack)");
  assert.equal(f.run("S.bed.buzzer"), true);
  assert.equal(f.run("S.pending.size"), 0);
});

test("wrong id, wrong node and nonboolean ACK cannot confirm a buzzer command", () => {
  const f = fixture();
  f.run(`command(3, 'set_buzzer', true)`);
  for (const ack of [
    { type: "ack", id: "other", node: 3, ok: true },
    { type: "ack", id: f.sent[0].id, node: 2, ok: true },
    { type: "ack", id: f.sent[0].id, node: 3, ok: "true" },
  ]) {
    f.context.ack = ack;
    f.run("receive(ack)");
  }
  assert.equal(f.run("S.bed.buzzer"), false);
  assert.equal(f.run("S.pending.size"), 1);
});

test("negative ACK and timeout preserve the last known device state", () => {
  const f = fixture();
  f.run(`command(3, 'set_buzzer', true)`);
  f.context.ack = {
    type: "ack",
    id: f.sent[0].id,
    ok: false,
    error: "BLE disconnected",
  };
  f.run("receive(ack)");
  assert.equal(f.run("S.bed.buzzer"), false);
  f.run(`command(3, 'set_buzzer', true)`);
  for (const timer of [...f.timers.values()]) timer();
  assert.equal(f.run("S.pending.size"), 0);
  assert.equal(f.run("S.bed.buzzer"), false);
});

test("offline node and repeated pending requests do not send extra frames", () => {
  const f = fixture();
  f.run(`command(3, 'set_buzzer', true); command(3, 'set_buzzer', false)`);
  assert.equal(f.sent.length, 1);
  f.run(
    `S.connected = false; S.pending.clear(); command(3, 'set_buzzer', true)`,
  );
  assert.equal(f.sent.length, 1);
});

test("switching from demo to real device clears every bed reading and pending command", () => {
  const f = fixture();
  f.run(`S.mode='demo'; seedBedDemo(); S.mode='demo'; switchMode('live')`);
  assert.equal(f.run("S.bed.headAngle"), null);
  assert.equal(f.run("S.bed.buzzer"), null);
  assert.equal(f.run("S.dataAt[3]"), 0);
});

test("legacy fall packets do not refresh Node 3 presence", () => {
  const f = fixture();
  f.run(
    `S.seen[3] = S.dataAt[3] = 0; receive({type:'telemetry',node:3,data:{fall:true,accel:[0,0,1]}})`,
  );
  assert.equal(f.run("S.dataAt[3]"), 0);
});
