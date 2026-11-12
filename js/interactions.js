/* DECIDER - real phone interactions
 *
 *   blow  : microphone (Web Audio) detects blowing into the phone.
 *           For the Environment role it is a continuous WEATHER
 *           SELECTOR: keep blowing to cycle Sunny -> Rain -> Snow,
 *           stop blowing to choose the current weather.
 *   shake : DeviceMotion detects a real shake
 *   press : touch & hold for ~1.5 s  (dev/test only - bound to NO role)
 *   tilt  : DeviceOrientation detects tilting the phone
 *   swipe : fast finger swipe in any direction
 *
 * Role -> Interaction -> Result flow:
 *   - The interaction is only the input method.
 *   - A successful interaction produces one game result from the
 *     bound role's pool (see DECIDER.ROLE_RESULTS):
 *       Environment/Blow   -> Sunny | Rain | Snow (chosen, not random)
 *       Direction/Swipe    -> Left | Right | Up | Down (the real
 *                             swipe direction, never a random draw)
 *       Action/Shake       -> Walk | Run | Jump | Fall | Eat
 *       Item/Tilt          -> Pizza | Football | Umbrella | Hammer |
 *                             Flashlight | Phone
 *   - Sequential flow: the Action and Item pools can be narrowed by
 *     the laptop (setRolePool) from the earlier players' results, so
 *     e.g. the Item player only draws Items allowed by the chosen
 *     Action. Submissions are blocked outside the player's own stage
 *     (stageAllowsSubmission), mirrored by the laptop.
 *   - Press & Hold has no role bound to it, so it generates no game
 *     result and takes no part in the round - it only confirms the
 *     detection on the phone.
 *   - The result stays on screen and the interaction locks until the
 *     player presses "Try again" (so one action can't spam results).
 *
 * All thresholds are in INTER_CONFIG below - easy to tune.
 */

var INTER_CONFIG = {
  blow: {
    threshold: 0.05, /* BLOW_THRESHOLD from the tested old sketch: getLevel() > 0.05 = blow */
    cycleMs: 700,    /* one weather step per 700 ms of continuous blowing */
    stopMs: 300,     /* level below threshold this long = stopped -> select */
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
var blowState = { sketch: null, mic: null, done: false };
var blowSelector = { index: 0, steps: 0, lastStep: 0, belowSince: 0, weather: "Sunny" };
var shakeState = { handler: null, last: null, lastShake: 0, armed: true };
var tiltState = { handler: null, lastTrigger: 0, armed: true };
var pressState = { raf: null, done: false };
var swipeState = { tracking: false, sx: 0, sy: 0, st: 0 };

/* Sequential flow: pool overrides set by player.js from the laptop's
 * stage-state message (the Action / Item pool depends on the earlier
 * players' results). */
var poolOverrides = {}; /* roleId -> [results] */

function setRolePool(roleId, pool) {
  if (roleId && pool && pool.length) poolOverrides[roleId] = pool.slice();
  else delete poolOverrides[roleId];
}

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
  var pool = poolOverrides[roleId] || DECIDER.ROLE_RESULTS[roleId];
  if (!pool || !pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

/* Called by every detector when its interaction is detected.
 * Generates a game result for the bound role and shows it - either
 * the real swipe direction (Direction role) or a random draw from the
 * role's pool. If the interaction belongs to the player's own joined
 * role, the result is sent to the room once (player-result message)
 * and the phone goes READY - no resubmission this round. Manual tests
 * of other roles' interactions only show the result on the phone.
 * Interactions without a role (Press & Hold, dev/test only) just
 * confirm the detection - no result, nothing sent. */
function interComplete(resultOverride) {
  if (interLocked || !interCurrent) return;

  var roleId = roleForInteraction(interCurrent);
  var role = roleById(roleId);

  /* dev/test-only interaction: no role bound, no game result */
  if (!role) {
    lastResult = null;
    interSetResult(
      '<span class="result-big">DETECTED</span>' +
      '<span class="result-context">' + esc(getInteractionLabel(interCurrent)) +
      ' · dev test (no role bound)</span>'
    );
    interSetStatus("completed", "Completed · dev test");
    interLocked = true;
    interResetBtn.hidden = false;
    interSubmitted = false;
    console.log("[Result] " + getInteractionLabel(interCurrent) + " detected (dev test)");
    return;
  }

  var result = (resultOverride !== undefined && resultOverride !== null)
    ? resultOverride
    : randomResult(roleId);
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

/* send the current result to the room (once).
 * The sequential flow is enforced on BOTH ends: this phone only
 * sends when its role is the current stage (stageAllowsSubmission
 * from player.js), and the laptop re-validates the message. */
function submitResult() {
  if (!lastResult) return;
  if (typeof stageAllowsSubmission === "function" &&
      !stageAllowsSubmission(lastResult.roleId)) {
    interSetStatus("warn", "Not your turn — wait for your stage");
    interResetBtn.hidden = false;
    return;
  }
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
  blowState.done = false;
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

  /* blow: stop the p5 sketch and release the microphone */
  if (blowState.sketch) { try { blowState.sketch.remove(); } catch (e) { /* ignore */ } }
  blowState.sketch = null;
  if (blowState.mic) { try { blowState.mic.stop(); } catch (e) { /* ignore */ } }
  blowState.mic = null;
  blowState.done = false;

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

/* ---------- blow (microphone via p5.AudioIn + p5.Amplitude) ---------- */

/* Same detection as the tested old sketch:
 *   mic = new p5.AudioIn(); amplitude = new p5.Amplitude();
 *   mic.disconnect(); mic.connect(amplitude);
 *   level = amplitude.getLevel();  level > threshold (0.05) = blow
 *
 * Blow is now a continuous WEATHER SELECTOR (no random result):
 * the selector starts on Sunny, and while the player keeps blowing it
 * cycles Sunny -> Rain -> Snow -> Sunny... every cycleMs. When the
 * level drops below the threshold and stays there for stopMs, the
 * current weather becomes the Environment result. At least one real
 * cycle step must happen first, so a momentary threshold touch never
 * submits anything. */
var WEATHER_ORDER = ["Sunny", "Rain", "Snow"];

function armBlow() {
  if (typeof p5 === "undefined") {
    interSetStatus("error", "p5 sound library not loaded");
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    interSetStatus("error", "Microphone needs HTTPS");
    return;
  }

  var threshold = INTER_CONFIG.blow.threshold;
  var cycleMs = INTER_CONFIG.blow.cycleMs;
  var stopMs = INTER_CONFIG.blow.stopMs;

  /* reset the selector for this turn */
  blowSelector = { index: 0, steps: 0, lastStep: 0, belowSince: 0, weather: "Sunny" };
  blowState.done = false;

  interStage.innerHTML =
    '<p class="inter-hint">BLOW TO CHANGE THE WEATHER</p>' +
    '<div class="blow-selector">' +
    '  <div class="selector-item active" data-weather="Sunny">☀️ SUNNY</div>' +
    '  <div class="selector-item" data-weather="Rain">🌧️ RAIN</div>' +
    '  <div class="selector-item" data-weather="Snow">❄️ SNOW</div>' +
    '</div>' +
    '<p class="blow-tip">Keep blowing to change weather.<br>Stop blowing to choose.</p>' +
    '<div class="blow-meter"><div class="blow-fill" id="blowFill"></div></div>' +
    '<div class="blow-stats">' +
    '<span>level <b id="blowLevel">0.000</b></span>' +
    '<span>threshold <b id="blowThreshold">' + threshold.toFixed(3) + '</b></span>' +
    '</div>';
  var fill = document.getElementById("blowFill");
  var levelEl = document.getElementById("blowLevel");

  interSetStatus("active", "Requesting microphone…");

  blowState.sketch = new p5(function (p) {
    var mic = null;
    var amp = null;

    p.setup = function () {
      p.noCanvas(); /* this page has its own UI - no p5 canvas */
      mic = new p5.AudioIn();
      amp = new p5.Amplitude();
      mic.disconnect();
      mic.connect(amp); /* old-sketch wiring: mic straight into the amplitude */
      blowState.mic = mic;

      mic.start(function () {
        if (interCurrent === "blow" && !interLocked) {
          interSetStatus("ready", "Ready — blow to cycle the weather");
        }
      }, function () {
        if (!interLocked) interSetStatus("error", "Microphone permission denied");
      });
    };

    p.draw = function () {
      if (interCurrent !== "blow" || !amp) return;
      var level = amp.getLevel();

      fill.style.height = Math.min(100, level * 300) + "%";
      levelEl.textContent = level.toFixed(3);

      if (interLocked || blowState.done) return; /* selection already made */

      var now = Date.now();
      if (level > threshold) {
        /* blowing: cycle the weather selector at a fixed pace */
        blowSelector.belowSince = 0;
        if (now - blowSelector.lastStep >= cycleMs) {
          blowSelector.lastStep = now;
          blowSelector.index = (blowSelector.index + 1) % WEATHER_ORDER.length;
          blowSelector.steps++;
          blowSelector.weather = WEATHER_ORDER[blowSelector.index];
          updateBlowSelectorUi(blowSelector.weather);
        }
      } else if (blowSelector.steps > 0) {
        /* stopped blowing: after a short pause the shown weather is
         * chosen. Needs at least one cycle step, so a momentary
         * threshold touch can never submit. */
        if (!blowSelector.belowSince) blowSelector.belowSince = now;
        if (now - blowSelector.belowSince >= stopMs) {
          blowState.done = true;
          interComplete(blowSelector.weather);
        }
      }
    };
  });
}

/* highlight the currently selected weather on the phone */
function updateBlowSelectorUi(weather) {
  var items = interStage.querySelectorAll(".selector-item");
  for (var i = 0; i < items.length; i++) {
    items[i].classList.toggle("active", items[i].getAttribute("data-weather") === weather);
  }
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
      /* the real swipe direction is the Direction result:
       * dominant axis first, then the sign of that axis */
      var dir = null;
      if (Math.abs(dx) >= Math.abs(dy)) dir = dx < 0 ? "Left" : "Right";
      else dir = dy < 0 ? "Up" : "Down";
      interComplete(dir);
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
