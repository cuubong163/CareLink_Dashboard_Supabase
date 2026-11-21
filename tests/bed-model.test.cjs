const { test } = require("node:test");
const assert = require("node:assert/strict");
const model = require("../dist/bed-model.js");
const now = 1794913200000;
const options = (extra = {}) => ({
  now,
  connected: true,
  staleSeconds: 15,
  angleLow: 30,
  angleHigh: 45,
  turnMinutes: 120,
  ...extra,
});

test("a new bed never invents live measurements or buzzer confirmation", () => {
  const view = model.view(model.create(), options());
  for (const field of [
    "angleKnown",
    "motionKnown",
    "scheduleKnown",
    "buzzerKnown",
    "due",
  ])
    assert.equal(view[field], false);
  assert.equal(view.motionLabel, "Chờ dữ liệu");
});

test("valid snapshot supplies angle, motion, due time and actual buzzer state", () => {
  const bed = model.create();
  assert.equal(
    model.applyTelemetry(
      bed,
      {
        head_angle: 35,
        motion_status: "suspected_seizure",
        motion_hz: 5.2,
        vibration_rms: 0.35,
        last_reposition_at: now - 90 * 60000,
        reposition_due: false,
        buzzer: false,
      },
      now,
    ),
    true,
  );
  const view = model.view(bed, options());
  assert.equal(view.angleOutside, false);
  assert.equal(view.motionSeverity, "red");
  assert.equal(view.motionAlarm, true);
  assert.equal(view.remainingMs, 30 * 60000);
  assert.equal(view.due, false);
  assert.equal(bed.buzzer, false);
});

test("invalid and legacy fall data do not make Node 3 online", () => {
  const bed = model.create();
  assert.equal(
    model.applyTelemetry(
      bed,
      {
        head_angle: "35",
        motion_status: "fall",
        last_reposition_at: now + 1,
        buzzer: "false",
        fall: true,
        accel: [0, 0, 1],
      },
      now,
    ),
    false,
  );
  assert.equal(bed.headAngle, null);
  assert.equal(bed.lastRepositionAt, null);
  assert.equal(bed.buzzer, null);
});

test("angle and motion expire independently when only buzzer telemetry continues", () => {
  const bed = model.create();
  model.applyTelemetry(
    bed,
    { head_angle: 60, motion_status: "agitation", buzzer: false },
    now - 16000,
  );
  model.applyTelemetry(bed, { buzzer: true }, now);
  const view = model.view(bed, options());
  assert.equal(view.angleKnown, false);
  assert.equal(view.motionKnown, false);
  assert.equal(view.motionAlarm, false);
  assert.equal(view.buzzerKnown, true);
});

test("angle boundaries are inclusive and reminder uses configurable duration", () => {
  const bed = model.create();
  model.applyTelemetry(
    bed,
    {
      head_angle: 30,
      last_reposition_at: now - 61 * 60000,
      reposition_due: false,
    },
    now,
  );
  assert.equal(model.view(bed, options()).angleOutside, false);
  assert.equal(model.view(bed, options()).due, false);
  assert.equal(model.view(bed, options({ turnMinutes: 60 })).due, true);
  model.applyTelemetry(bed, { head_angle: 45 }, now);
  assert.equal(model.view(bed, options()).angleOutside, false);
  model.applyTelemetry(bed, { head_angle: 45.1 }, now);
  assert.equal(model.view(bed, options()).angleOutside, true);
});

test("care confirmation resets reminder; head angle change does not", () => {
  const bed = model.create();
  model.applyTelemetry(
    bed,
    { last_reposition_at: now - 121 * 60000, reposition_due: true },
    now,
  );
  assert.equal(model.view(bed, options()).due, true);
  model.applyTelemetry(bed, { head_angle: 40 }, now);
  assert.equal(model.view(bed, options()).due, true);
  model.applyTelemetry(
    bed,
    { last_reposition_at: now, reposition_due: false },
    now,
  );
  assert.equal(model.view(bed, options()).due, false);
  assert.equal(model.view(bed, options()).remainingMs, 120 * 60000);
});

test("missing optional metrics do not retain a prior movement assessment", () => {
  const bed = model.create();
  model.applyTelemetry(
    bed,
    { motion_status: "suspected_seizure", motion_hz: 5, vibration_rms: 0.3 },
    now,
  );
  model.applyTelemetry(bed, { motion_status: "normal" }, now);
  assert.equal(bed.motionHz, null);
  assert.equal(bed.vibrationRms, null);
});

test("disconnect masks all previous readings", () => {
  const bed = model.create();
  model.applyTelemetry(
    bed,
    {
      head_angle: 35,
      motion_status: "normal",
      buzzer: true,
      last_reposition_at: now,
    },
    now,
  );
  const view = model.view(bed, options({ connected: false }));
  assert.equal(view.angleKnown, false);
  assert.equal(view.buzzerKnown, false);
  assert.equal(view.scheduleKnown, false);
});
