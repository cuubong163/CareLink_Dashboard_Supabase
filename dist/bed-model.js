"use strict";

// Node 3 reports measurements and decisions made by the device/Gateway.
// Clinical classification is not performed in the browser.
const BedModel = (() => {
  const motionLabels = {
    normal: "Ổn định",
    agitation: "Kích động / vận động mạnh",
    suspected_seizure: "Nghi ngờ cơn co giật",
  };

  function create() {
    return {
      headAngle: null,
      angleAt: 0,
      motionStatus: null,
      motionAt: 0,
      motionHz: null,
      vibrationRms: null,
      lastRepositionAt: null,
      repositionDue: null,
      repositionAt: 0,
      buzzer: null,
      buzzerAt: 0,
      battery: null,
      rssi: null,
      reason: "",
    };
  }

  function numberInRange(value, minimum, maximum) {
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= minimum &&
      value <= maximum
    );
  }

  function applyTelemetry(state, data, now = Date.now()) {
    let accepted = false;
    if (numberInRange(data.head_angle, -20, 90)) {
      state.headAngle = data.head_angle;
      state.angleAt = now;
      accepted = true;
    }
    if (Object.hasOwn(motionLabels, data.motion_status)) {
      state.motionStatus = data.motion_status;
      state.motionAt = now;
      // Optional details belong to this assessment; never reuse an older RMS/Hz.
      state.motionHz = numberInRange(data.motion_hz, 0, 100)
        ? data.motion_hz
        : null;
      state.vibrationRms = numberInRange(data.vibration_rms, 0, 32)
        ? data.vibration_rms
        : null;
      state.reason =
        typeof data.reason === "string" ? data.reason.slice(0, 180) : "";
      accepted = true;
    }
    if (numberInRange(data.motion_hz, 0, 100)) state.motionHz = data.motion_hz;
    if (numberInRange(data.vibration_rms, 0, 32))
      state.vibrationRms = data.vibration_rms;
    if (numberInRange(data.last_reposition_at, 1, now)) {
      state.lastRepositionAt = data.last_reposition_at;
      state.repositionAt = now;
      accepted = true;
    }
    if (typeof data.reposition_due === "boolean") {
      state.repositionDue = data.reposition_due;
      state.repositionAt = now;
      accepted = true;
    }
    if (typeof data.buzzer === "boolean") {
      state.buzzer = data.buzzer;
      state.buzzerAt = now;
      accepted = true;
    }
    if (numberInRange(data.battery, 0, 100)) state.battery = data.battery;
    if (numberInRange(data.rssi, -200, 0)) state.rssi = data.rssi;
    return accepted;
  }

  function fresh(timestamp, now, staleSeconds) {
    return timestamp > 0 && now - timestamp <= staleSeconds * 1000;
  }

  function view(state, options) {
    const { now, staleSeconds, connected, angleLow, angleHigh, turnMinutes } =
      options;
    const angleKnown = connected && fresh(state.angleAt, now, staleSeconds);
    const motionKnown = connected && fresh(state.motionAt, now, staleSeconds);
    const scheduleKnown =
      connected && fresh(state.repositionAt, now, staleSeconds);
    const buzzerKnown = connected && fresh(state.buzzerAt, now, staleSeconds);
    const dueTime =
      state.lastRepositionAt === null
        ? null
        : state.lastRepositionAt + turnMinutes * 60000;
    const remainingMs =
      scheduleKnown && dueTime !== null ? dueTime - now : null;
    const due =
      scheduleKnown &&
      (state.repositionDue === true ||
        (remainingMs !== null && remainingMs <= 0));
    return {
      angleKnown,
      motionKnown,
      scheduleKnown,
      buzzerKnown,
      angleOutside:
        angleKnown &&
        (state.headAngle < angleLow || state.headAngle > angleHigh),
      motionLabel: motionKnown
        ? motionLabels[state.motionStatus]
        : "Chờ dữ liệu",
      motionAlarm: motionKnown && state.motionStatus !== "normal",
      motionSeverity:
        state.motionStatus === "suspected_seizure" ? "red" : "amber",
      remainingMs,
      due,
    };
  }

  function duration(milliseconds) {
    const seconds = Math.max(0, Math.ceil(Math.abs(milliseconds) / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds / 60) % 60;
    return [hours, minutes, seconds % 60]
      .map((value) => String(value).padStart(2, "0"))
      .join(":");
  }

  return { create, applyTelemetry, view, duration, motionLabels };
})();

if (typeof module !== "undefined" && module.exports) module.exports = BedModel;
