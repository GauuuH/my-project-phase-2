/* DECIDER - five real phone interactions (dev test mode)
 *
 *   blow  : microphone (Web Audio) detects blowing into the phone
 *   shake : DeviceMotion detects a real shake
 *   press : touch & hold for ~1.5 s
 *   tilt  : DeviceOrientation detects tilting the phone
 *   swipe : fast finger swipe in any direction
 *
 * Each interaction is selected with the Interaction Test buttons and
 * can be tested alone on one phone. After a detection the phone only
 * shows the result + "Completed", then returns to "Ready". Nothing is
 * sent to the laptop yet.
 *
 * All thresholds are in INTER_CONFIG below - easy to tune.
 */

var INTER_CONFIG = {
  blow:  { threshold: 0.06, holdMs: 260, releaseMs: 400 },
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

var interCurrent = null;
var interCompleteTimer = null;

/* per-detector state */
var blowState = { stream: null, ctx: null, raf: null, aboveSince: 0, belowSince: 0, done: false };
var shakeState = { handler: null, last: null, lastShake: 0, armed: true };
var tiltState = { handler: null, lastTrigger: 0, armed: true };
var pressState = { raf: null, done: false };
var swipeState = { tracking: false, sx: 0, sy: 0, st: 0 };

/* ---------- status helpers ---------- */

function interSetStatus(kind, text) {
  interDot.className = "inter-dot" + (kind ? " " + kind : "");
  interStatusText.textContent = text;
}

function interSetResult(text) {
  interResult.textContent = text;
}

/* called by every detector when it detects its interaction */
function interComplete(resultText) {
  interSetResult(resultText);
  interSetStatus("completed", "Completed");
  clearTimeout(interCompleteTimer);
  interCompleteTimer = setTimeout(function () {
    interSetResult("");
    interSetStatus("ready", "Ready");
  }, 1500);
}

function interStageClear() {
  interStage.innerHTML = "";
  interSetResult("");
  interSetStatus(null, "Select an interaction");
}

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
  clearTimeout(interCompleteTimer);

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
  blowState.aboveSince = 0; blowState.belowSince = 0; blowState.done = false;

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

/* ---------- blow (microphone) ---------- */

function armBlow() {
  var AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) { interSetStatus("error", "Microphone not supported"); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    interSetStatus("error", "Microphone needs HTTPS");
    return;
  }

  interStage.innerHTML =
    '<p class="inter-hint">Blow into the microphone</p>' +
    '<div class="blow-meter"><div class="blow-fill" id="blowFill"></div></div>';
  var fill = document.getElementById("blowFill");

  interSetStatus("active", "Requesting microphone…");

  navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
    blowState.stream = stream;
    blowState.ctx = new AC();
    var src = blowState.ctx.createMediaStreamSource(stream);
    var analyser = blowState.ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    var buf = new Float32Array(analyser.fftSize);
    blowState.aboveSince = 0;
    blowState.belowSince = 0;
    blowState.done = false;
    interSetStatus("ready", "Ready — blow into the microphone");

    function loop() {
      if (interCurrent !== "blow") return;
      analyser.getFloatTimeDomainData(buf);
      var rms = 0;
      for (var i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
      rms = Math.sqrt(rms / buf.length);

      fill.style.height = Math.min(100, rms * 400) + "%";

      var cfg = INTER_CONFIG.blow;
      if (rms > cfg.threshold) {
        blowState.aboveSince += 16;
        blowState.belowSince = 0;
        if (blowState.aboveSince >= cfg.holdMs && !blowState.done) {
          blowState.done = true;
          interComplete("💨 Blow detected");
        }
      } else {
        blowState.belowSince += 16;
        blowState.aboveSince = 0;
        if (blowState.belowSince > cfg.releaseMs) blowState.done = false;
      }
      blowState.raf = requestAnimationFrame(loop);
    }
    blowState.raf = requestAnimationFrame(loop);
  }).catch(function () {
    interSetStatus("error", "Microphone permission denied");
  });
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
        if (shakeState.armed && mag > cfg.threshold && now - shakeState.lastShake > cfg.cooldownMs) {
          shakeState.lastShake = now;
          shakeState.armed = false;
          interComplete("📳 Shake detected");
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
    fill.style.width = (p * 100) + "%";
    if (p >= 1) {
      pressState.done = true;
      interComplete("👆 Press &amp; Hold (1.5 s)");
    } else {
      pressState.raf = requestAnimationFrame(step);
    }
  }

  function start(e) {
    e.preventDefault();
    if (interCurrent !== "press") return;
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
    if (interCurrent === "press" && !pressState.done) {
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

      if (tiltState.armed && (absB > cfg.triggerDeg || absG > cfg.triggerDeg) &&
          now - tiltState.lastTrigger > cfg.cooldownMs) {
        tiltState.lastTrigger = now;
        tiltState.armed = false;
        var dir;
        if (absB > absG) dir = beta > 0 ? "forward" : "backward";
        else dir = gamma > 0 ? "right" : "left";
        interComplete("📐 Tilt detected (" + dir + ")");
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
    if (interCurrent !== "swipe") return;
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

    if (Math.max(Math.abs(dx), Math.abs(dy)) >= cfg.minDistance && dt <= cfg.maxDuration) {
      var dir = Math.abs(dx) > Math.abs(dy)
        ? (dx > 0 ? "right" : "left")
        : (dy > 0 ? "down" : "up");
      interComplete("👋 Swipe " + dir);
    } else {
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
