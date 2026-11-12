/* DECIDER - five real phone interactions (dev test mode)
 *
 *   blow  : microphone (Web Audio) detects blowing into the phone
 *   shake : DeviceMotion detects a real shake
 *   press : touch & hold for ~1.5 s
 *   tilt  : DeviceOrientation detects tilting the phone
 *   swipe : fast finger swipe in any direction
 *
 * Role -> Interaction -> Result flow:
 *   - The interaction is only the input method.
 *   - A successful interaction randomly generates one game result
 *     from the bound role's pool (see DECIDER.ROLE_RESULTS):
 *       Environment/Blow -> Sunny | Rain | Snow
 *       Movement/Shake   -> Walk | Run | Jump | Fall
 *       Action/Press     -> Eat | Hit | Use
 *       Object/Tilt      -> Pizza | Football
 *       Tool/Swipe       -> Umbrella | Hammer | Flashlight | Phone
 *   - The result stays on screen and the interaction locks until the
 *     player presses "Try again" (so one action can't spam results).
 *   - Nothing is sent to the laptop yet.
 *
 * All thresholds are in INTER_CONFIG below - easy to tune.
 */

var INTER_CONFIG = {
  blow: {
    calibrateMs: 700,   /* sample the environment noise this long at start */
    noiseFactor: 2.5,   /* trigger = backgroundNoise * factor (must be clearly louder) */
    minThreshold: 0.02, /* floor so quiet rooms are not too sensitive */
    holdMs: 150,        /* blow must stay above the threshold ~150 ms */
    releaseMs: 400,     /* quiet time before a new blow can re-trigger */
  },
  shake: { threshold: 22, cooldownMs: 1200, calmMs: 8 },
  press: { holdMs: 1500 },
  tilt:  { triggerDeg: 32, resetDeg: 15, cooldownMs: 1000 },
  swipe: { minDistance: 60, maxDuration: 600 },
};

var interSelect = document.getElementById("interSelect");
var interStage = document.getElementById("interStage");
var interStatusText = document.getElementById("interStatusText");
var interDot = document.getElementById("interDot");
var interResult = document.getElementById("interResult");
var interResetBtn = document.getElementById("interResetBtn");

var interCurrent = null;
var interLocked = false;
var interSubmitted = false; /* own-role result was sent to the room */
var lastResult = null;      /* { roleId, result } of the latest completion */

/* per-detector state */
var blowState = { stream: null, ctx: null, raf: null, detector: null, sample: null };
var shakeState = { handler: null, last: null, lastShake: 0, armed: true };
var tiltState = { handler: null, lastTrigger: 0, armed: true };
var pressState = { raf: null, done: false };
var swipeState = { tracking: false, sx: 0, sy: 0, st: 0 };

/* ---------- status helpers ---------- */

function interSetStatus(kind, text) {
  interDot.className = "inter-dot" + (kind ? " " + kind : "");
  interStatusText.textContent = text;
}

function interSetResult(html) {
  interResult.innerHTML = html;
}

function interStageClear() {
  interStage.innerHTML = "";
  interSetResult("");
  interSetStatus(null, "Select an interaction");
}

/* ---------- role -> result ---------- */

function roleForInteraction(interactionId) {
  for (var roleId in DECIDER.ROLE_INTERACTION) {
    if (DECIDER.ROLE_INTERACTION[roleId] === interactionId) return roleId;
  }
  return null;
}

function randomResult(roleId) {
  var pool = DECIDER.ROLE_RESULTS[roleId];
  if (!pool || !pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

/* Called by every detector when its interaction is detected.
 * Generates a random game result for the bound role and shows it.
 * If the interaction belongs to the player's own joined role, the
 * result is sent to the room once (player-result message) and the
 * phone goes READY - no resubmission this round. Manual tests of
 * other roles' interactions only show the result on the phone. */
function interComplete() {
  if (interLocked || !interCurrent) return;

  var roleId = roleForInteraction(interCurrent);
  var role = roleById(roleId);
  var result = randomResult(roleId);
  lastResult = { roleId: roleId, result: result };

  interSetResult(
    '<span class="result-big">' + esc(result) + '</span>' +
    '<span class="result-context">' + role.icon + " " + role.name + " · " +
    esc(getInteractionLabel(interCurrent)) + '</span>'
  );
  interSetStatus("completed", "Completed");
  interLocked = true;
  interResetBtn.hidden = false;
  interSubmitted = false;

  if (getJoinedRoleId() === roleId) {
    submitResult();
  } else {
    interSetStatus("completed", "Completed · manual test");
  }

  console.log("[Result] " + role.name + " -> " + result);
}

/* send the current result to the room (once) */
function submitResult() {
  if (!lastResult) return;
  var ok = typeof sendPlayerResult === "function"
    ? sendPlayerResult(lastResult.roleId, lastResult.result)
    : false;
  if (ok) {
    interSubmitted = true;
    interSetStatus("ready", "READY — result sent");
    interResetBtn.hidden = true; /* no resubmission this round */
  } else {
    interSetStatus("error", "Not sent — check connection");
    interResetBtn.hidden = false; /* can retry the same result */
  }
}

/* "Try again":
 * - own-role result that failed to send -> retry the SAME result
 * - manual test -> clear and re-arm for a new random result */
function resetInteraction() {
  if (interSubmitted) return;

  var currentRole = interCurrent ? roleForInteraction(interCurrent) : null;
  if (lastResult && currentRole === getJoinedRoleId()) {
    submitResult();
    return;
  }

  interLocked = false;
  interSetResult("");
  interSetStatus("ready", "Ready");
  interResetBtn.hidden = true;
  lastResult = null;
  if (blowState.detector) blowState.detector.reset();
  shakeState.armed = true;
  tiltState.armed = true;
  pressState.done = false;
}

interResetBtn.onclick = resetInteraction;

/* ---------- switching ---------- */

function selectInteraction(id) {
  stopAllInteractions();
  interCurrent = id;
  highlightInterButton(id);

  if (id === "blow") armBlow();
  else if (id === "shake") armShake();
  else if (id === "press") armPress();
  else if (id === "tilt") armTilt();
  else if (id === "swipe") armSwipe();
}

function stopAllInteractions() {
  interCurrent = null;
  interLocked = false;
  interSubmitted = false;
  lastResult = null;
  interResetBtn.hidden = true;

  /* blow: release the microphone */
  if (blowState.raf) cancelAnimationFrame(blowState.raf);
  blowState.raf = null;
  if (blowState.stream) {
    var tracks = blowState.stream.getTracks();
    for (var i = 0; i < tracks.length; i++) tracks[i].stop();
  }
  blowState.stream = null;
  if (blowState.ctx) { try { blowState.ctx.close(); } catch (e) { /* ignore */ } }
  blowState.ctx = null;
  blowState.detector = null;
  blowState.sample = null;

  if (shakeState.handler) {
    window.removeEventListener("devicemotion", shakeState.handler);
    shakeState.handler = null;
    shakeState.last = null; shakeState.armed = true;
  }

  if (tiltState.handler) {
    window.removeEventListener("deviceorientation", tiltState.handler);
    tiltState.handler = null;
    tiltState.armed = true;
  }

  if (pressState.raf) cancelAnimationFrame(pressState.raf);
  pressState.raf = null;
  pressState.done = false;

  swipeState.tracking = false;

  interStageClear();
  highlightInterButton(null);
}

function highlightInterButton(id) {
  var btns = interSelect.querySelectorAll(".inter-btn");
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle("active", btns[i].getAttribute("data-inter") === id);
  }
}

/* iOS asks for permission inside a user gesture; the select button
 * click is that gesture. Android needs nothing. */
function ensureMotionPermission(kind) {
  var ctor = kind === "devicemotion" ? DeviceMotionEvent : DeviceOrientationEvent;
  if (typeof ctor !== "undefined" && typeof ctor.requestPermission === "function") {
    return ctor.requestPermission().then(function (state) {
      return state === "granted";
    }).catch(function () { return false; });
  }
  return Promise.resolve(true);
}

/* ---------- blow (microphone, adaptive noise threshold) ---------- */

/* The adaptive detector is independent of the microphone so it can be
 * driven by tests too. It first samples the environment for
 * calibrateMs, computes backgroundNoise, and then the trigger is
 * max(backgroundNoise * noiseFactor, minThreshold). A blow must stay
 * clearly above that threshold for ~holdMs to complete. */
function createBlowDetector(cfg, rmsEl, noiseEl, thrEl) {
  var noiseSum = 0, noiseCount = 0;
  var calibrateSamples = Math.max(5, Math.round(cfg.calibrateMs / 16));
  var holdSamples = Math.max(2, Math.round(cfg.holdMs / 16));
  var releaseSamples = Math.max(4, Math.round(cfg.releaseMs / 16));
  var backgroundNoise = 0;
  var dynamicThreshold = cfg.minThreshold;
  var calibrated = false;
  var aboveSince = 0, belowSince = 0, done = false;

  function sample(rms) {
    rmsEl.textContent = rms.toFixed(3);

    if (!calibrated) {
      noiseSum += rms;
      noiseCount++;
      noiseEl.textContent = "…";
      thrEl.textContent = "…";
      if (noiseCount >= calibrateSamples) {
        backgroundNoise = noiseSum / Math.max(noiseCount, 1);
        dynamicThreshold = Math.max(backgroundNoise * cfg.noiseFactor, cfg.minThreshold);
        calibrated = true;
        noiseEl.textContent = backgroundNoise.toFixed(3);
        thrEl.textContent = dynamicThreshold.toFixed(3);
        if (interCurrent === "blow" && !interLocked) {
          interSetStatus("ready", "Ready — blow into the microphone");
        }
      }
      return;
    }

    if (rms > dynamicThreshold && !interLocked) {
      aboveSince++;
      belowSince = 0;
      if (aboveSince >= holdSamples && !done) {
        done = true;
        interComplete();
      }
    } else {
      belowSince++;
      aboveSince = 0;
      if (belowSince > releaseSamples) done = false;
    }
  }

  return {
    sample: sample,
    isCalibrated: function () { return calibrated; },
    getNoise: function () { return backgroundNoise; },
    getThreshold: function () { return dynamicThreshold; },
    reset: function () { aboveSince = 0; belowSince = 0; done = false; },
  };
}

function armBlow() {
  var AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) { interSetStatus("error", "Microphone not supported"); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    interSetStatus("error", "Microphone needs HTTPS");
    return;
  }

  interStage.innerHTML =
    '<p class="inter-hint">Blow into the microphone</p>' +
    '<div class="blow-meter"><div class="blow-fill" id="blowFill"></div></div>' +
    '<div class="blow-stats">' +
    '<span>RMS <b id="blowRms">0.000</b></span>' +
    '<span>noise <b id="blowNoise">—</b></span>' +
    '<span>threshold <b id="blowThreshold">—</b></span>' +
    '</div>';
  var fill = document.getElementById("blowFill");
  var rmsEl = document.getElementById("blowRms");
  var noiseEl = document.getElementById("blowNoise");
  var thrEl = document.getElementById("blowThreshold");

  interSetStatus("active", "Requesting microphone…");

  /* the adaptive detector runs independently of the microphone */
  var cfg = INTER_CONFIG.blow;
  blowState.detector = createBlowDetector(cfg, rmsEl, noiseEl, thrEl);
  blowState.sample = function (rms) { blowState.detector.sample(rms); };

  navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
    blowState.stream = stream;
    blowState.ctx = new AC();
    var src = blowState.ctx.createMediaStreamSource(stream);
    var analyser = blowState.ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    var buf = new Float32Array(analyser.fftSize);

    interSetStatus("active", "Calibrating noise…");

    function loop() {
      if (interCurrent !== "blow") return;
      analyser.getFloatTimeDomainData(buf);
      var rms = 0;
      for (var i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
      rms = Math.sqrt(rms / buf.length);

      fill.style.height = Math.min(100, rms * 400) + "%";
      if (blowState.sample) blowState.sample(rms);
      blowState.raf = requestAnimationFrame(loop);
    }
    blowState.raf = requestAnimationFrame(loop);
  }).catch(function () {
    if (!interLocked && blowState.detector && !blowState.detector.isCalibrated()) {
      interSetStatus("error", "Microphone permission denied");
    }
  });
}

/* dev/test helper: feed a synthetic RMS sample into the blow detector */
function debugBlowSample(rms) {
  if (blowState.sample) blowState.sample(rms);
}

/* ---------- shake (DeviceMotion) ---------- */

function armShake() {
  interStage.innerHTML = '<p class="inter-hint">Shake the phone</p>';
  ensureMotionPermission("devicemotion").then(function (ok) {
    if (!ok) { interSetStatus("error", "Motion permission denied"); return; }

    shakeState.last = null;
    shakeState.armed = true;
    shakeState.lastShake = 0;
    shakeState.handler = function (e) {
      if (interCurrent !== "shake") return;
      var a = e.accelerationIncludingGravity || e.acceleration;
      if (!a) return;
      var now = Date.now();
      var cfg = INTER_CONFIG.shake;
      if (shakeState.last) {
        var dx = a.x - shakeState.last.x;
        var dy = a.y - shakeState.last.y;
        var dz = a.z - shakeState.last.z;
        var mag = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (shakeState.armed && !interLocked && mag > cfg.threshold &&
            now - shakeState.lastShake > cfg.cooldownMs) {
          shakeState.lastShake = now;
          shakeState.armed = false;
          interComplete();
        }
        if (mag < cfg.calmMs) shakeState.armed = true;
      }
      shakeState.last = { x: a.x, y: a.y, z: a.z };
    };
    window.addEventListener("devicemotion", shakeState.handler, { passive: true });
    interSetStatus("ready", "Ready — shake the phone");
  });
}

/* ---------- press & hold (~1.5 s) ---------- */

function armPress() {
  interStage.innerHTML =
    '<div class="press-pad" id="pressPad">' +
    '<div class="press-fill" id="pressFill"></div>' +
    '<span class="press-label">PRESS &amp; HOLD</span></div>';
  var pad = document.getElementById("pressPad");
  var fill = document.getElementById("pressFill");
  var startTime = 0;
  pressState.done = false;

  function step() {
    if (interCurrent !== "press") return;
    var p = Math.min(1, (Date.now() - startTime) / INTER_CONFIG.press.holdMs);
    if (interLocked) {
      /* locked: stop the progress animation */
      fill.style.width = "0%";
      return;
    }
    fill.style.width = (p * 100) + "%";
    if (p >= 1) {
      pressState.done = true;
      interComplete();
    } else {
      pressState.raf = requestAnimationFrame(step);
    }
  }

  function start(e) {
    e.preventDefault();
    if (interCurrent !== "press" || interLocked) return;
    startTime = Date.now();
    pressState.done = false;
    interSetStatus("active", "Holding…");
    pressState.raf = requestAnimationFrame(step);
  }

  function end(e) {
    if (e) e.preventDefault();
    if (pressState.raf) cancelAnimationFrame(pressState.raf);
    pressState.raf = null;
    fill.style.width = "0%";
    if (interCurrent === "press" && !pressState.done && !interLocked) {
      interSetStatus("ready", "Ready");
    }
  }

  pad.addEventListener("touchstart", start, { passive: false });
  pad.addEventListener("touchend", end);
  pad.addEventListener("touchcancel", end);
  pad.addEventListener("mousedown", start);
  window.addEventListener("mouseup", end);
  window.addEventListener("mouseleave", end);

  interSetStatus("ready", "Ready — press and hold");
}

/* ---------- tilt (DeviceOrientation) ---------- */

function armTilt() {
  interStage.innerHTML = '<p class="inter-hint">Tilt the phone</p>';
  ensureMotionPermission("deviceorientation").then(function (ok) {
    if (!ok) { interSetStatus("error", "Orientation permission denied"); return; }

    tiltState.armed = true;
    tiltState.lastTrigger = 0;
    tiltState.handler = function (e) {
      if (interCurrent !== "tilt") return;
      var beta = e.beta || 0;
      var gamma = e.gamma || 0;
      var absB = Math.abs(beta);
      var absG = Math.abs(gamma);
      var now = Date.now();
      var cfg = INTER_CONFIG.tilt;

      if (tiltState.armed && !interLocked && (absB > cfg.triggerDeg || absG > cfg.triggerDeg) &&
          now - tiltState.lastTrigger > cfg.cooldownMs) {
        tiltState.lastTrigger = now;
        tiltState.armed = false;
        interComplete();
      }
      if (absB < cfg.resetDeg && absG < cfg.resetDeg) tiltState.armed = true;
    };
    window.addEventListener("deviceorientation", tiltState.handler, true);
    interSetStatus("ready", "Ready — tilt the phone");
  });
}

/* ---------- swipe (finger) ---------- */

function armSwipe() {
  interStage.innerHTML =
    '<div class="swipe-pad" id="swipePad"><span class="swipe-label">SWIPE ANY DIRECTION</span></div>';
  var pad = document.getElementById("swipePad");
  swipeState.tracking = false;

  function getXY(e) {
    var t = e.touches && e.touches.length ? e.touches[0] : e;
    return { x: t.clientX, y: t.clientY };
  }

  function onStart(e) {
    e.preventDefault();
    if (interCurrent !== "swipe" || interLocked) return;
    var p = getXY(e);
    swipeState.sx = p.x; swipeState.sy = p.y;
    swipeState.st = Date.now();
    swipeState.tracking = true;
    interSetStatus("active", "Swiping…");
  }

  function onEnd(e) {
    if (!swipeState.tracking || interCurrent !== "swipe") return;
    swipeState.tracking = false;
    var t = e.changedTouches && e.changedTouches.length ? e.changedTouches[0] : e;
    var dx = t.clientX - swipeState.sx;
    var dy = t.clientY - swipeState.sy;
    var dt = Date.now() - swipeState.st;
    var cfg = INTER_CONFIG.swipe;

    if (!interLocked &&
        Math.max(Math.abs(dx), Math.abs(dy)) >= cfg.minDistance && dt <= cfg.maxDuration) {
      interComplete();
    } else if (!interLocked) {
      interSetStatus("ready", "Ready");
    }
  }

  pad.addEventListener("touchstart", onStart, { passive: false });
  pad.addEventListener("touchend", onEnd);
  pad.addEventListener("touchcancel", onEnd);
  pad.addEventListener("mousedown", onStart);
  window.addEventListener("mouseup", onEnd);

  interSetStatus("ready", "Ready — swipe any direction");
}

/* ---------- wire the buttons ---------- */

var interBtns = interSelect.querySelectorAll(".inter-btn");
for (var i = 0; i < interBtns.length; i++) {
  interBtns[i].onclick = function () {
    selectInteraction(this.getAttribute("data-inter"));
  };
}

/* expose for tests */
function getCurrentInteraction() { return interCurrent; }
function isInteractionLocked() { return interLocked; }

function getInteractionLabel(id) {
  var btn = interSelect.querySelector('.inter-btn[data-inter="' + id + '"]');
  return btn ? btn.textContent.replace(/\s+/g, " ").trim() : id;
}

/* dev/test helper: simulate a successful detection of the current
 * interaction (skips the real sensor, goes through the same
 * result-generation path) */
function debugInterComplete(interactionId) {
  if (interactionId && interactionId !== interCurrent) return;
  interComplete();
}
