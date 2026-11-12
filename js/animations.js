/* DECIDER - Character Animation System (7 states)
 *
 * Every animation is a folder of single-frame PNGs. Frames are
 * preloaded and checked (the console logs how many were found).
 *
 * The frames in assets/char have already been chroma-keyed (the
 * opaque background of the source PNGs was made transparent with a
 * border flood fill - see tools/key_frames.cs). The original PNGs
 * on the artist's drive are never modified.
 *
 * Each state has its own fps below, plus a "calib" block measured
 * from the real character pixels, which keeps the character's visual
 * size, feet position and center position consistent when switching
 * between states (the canvases are 816px vs 512px).
 */

/* ================================================================
 * CHARACTER ANIMATION SETTINGS — change fps per state here.
 *   higher fps = faster, lower fps = slower.
 * ================================================================ */

var CHAR_PLACEMENT = {
  floorY: 68,      /* % of map height where the feet stand */
  centerX: 50,     /* % of map width for the body center */
  bodyHeight: 24.1 /* % of map height of the standing body (idle = reference) */
};

var ANIM_CONFIG = {
  idle: {
    folder: "../assets/char/idle/frames/", frames: ["008", "009"],
    fps: 6,   /* ~167 ms per frame */
    loop: true,
    calib: { bodyFrac: 0.8603, feetFrac: 0.8971, centerFrac: 0.5037, canvasW: 816, canvasH: 816 }
  },
  walk: {
    folder: "../assets/char/walk/frames/", frames: seq(1, 48),
    fps: 12,  /* ~83 ms per frame */
    loop: true,
    calib: { bodyFrac: 0.6895, feetFrac: 0.8184, centerFrac: 0.5049, canvasW: 512, canvasH: 512 }
  },
  run: {
    folder: "../assets/char/run/frames/", frames: seq(1, 48),
    fps: 12,
    loop: true,
    calib: { bodyFrac: 0.6973, feetFrac: 0.8184, centerFrac: 0.5322, canvasW: 512, canvasH: 512 }
  },
  jump: {
    folder: "../assets/char/jump/frames/", frames: seq(1, 48),
    fps: 12,
    loop: false, /* plays once, then back to idle */
    calib: { bodyFrac: 0.6914, feetFrac: 0.8184, centerFrac: 0.5156, canvasW: 512, canvasH: 512 }
  },
  fall: {
    folder: "../assets/char/fall/frames/", frames: seq(1, 48),
    fps: 12,
    loop: false,
    calib: { bodyFrac: 0.6895, feetFrac: 0.8164, centerFrac: 0.5059, canvasW: 512, canvasH: 512 }
  },
  wind: {
    folder: "../assets/char/wind/frames/", frames: seq(1, 48),
    fps: 12,
    loop: false,
    calib: { bodyFrac: 0.7012, feetFrac: 0.8184, centerFrac: 0.5049, canvasW: 512, canvasH: 512 }
  },
  eat: {
    folder: "../assets/char/eat/frames/", frames: seq(1, 48),
    fps: 12,
    loop: false,
    calib: { bodyFrac: 0.6895, feetFrac: 0.8164, centerFrac: 0.5117, canvasW: 512, canvasH: 512 }
  },
};

/* "001" ... "048" */
function seq(from, to) {
  var r = [];
  for (var i = from; i <= to; i++) r.push(("00" + i).slice(-3));
  return r;
}

/* ================================================================
 * Engine (no need to change anything below).
 * ================================================================ */

var charDisplay = document.getElementById("character");
var charCtx = charDisplay.getContext("2d");
var charStateCache = {};   /* state -> [{ name, img }] */
var charCurrent = null;    /* active state name */
var charFrames = null;
var charFrameIndex = 0;
var charLastTime = 0;
var charAccumulator = 0;
var charPending = null;    /* state requested while loading */

function getCharacterState() { return charCurrent; }

/* ---------- loading (auto-check) ---------- */

function loadCharacterState(name, done) {
  if (charStateCache[name]) { done(charStateCache[name]); return; }

  var cfg = ANIM_CONFIG[name];
  var frames = [];
  var pending = cfg.frames.length;
  if (pending === 0) { done(frames); return; }

  cfg.frames.forEach(function (fname) {
    var img = new Image();
    img.onload = function () {
      frames.push({ name: fname, img: img });
      oneDone();
    };
    img.onerror = function () {
      console.warn("[Anim] frame not found: " + cfg.folder + fname + ".png");
      oneDone();
    };
    img.src = cfg.folder + fname + ".png";
  });

  function oneDone() {
    pending--;
    if (pending > 0) return;
    frames.sort(function (a, b) { return parseInt(a.name, 10) - parseInt(b.name, 10); });
    console.log("[Anim] " + name + ": " + frames.length + "/" + cfg.frames.length +
      " frames loaded · fps " + cfg.fps + " · " + Math.round(1000 / cfg.fps) + " ms/frame · loop " + cfg.loop);
    if (frames.length) charStateCache[name] = frames;
    done(frames);
  }
}

/* ---------- playback ---------- */

function playCharacterState(name) {
  if (!ANIM_CONFIG[name]) return;
  setActiveCharButton(name);
  if (!charStateCache[name]) {
    charPending = name;
    loadCharacterState(name, function (frames) {
      if (frames.length && charPending === name) activateCharacterState(name, frames);
    });
    return;
  }
  activateCharacterState(name, charStateCache[name]);
}

function activateCharacterState(name, frames) {
  charPending = null;
  charCurrent = name;
  charFrames = frames;
  charFrameIndex = 0;
  charAccumulator = 0;

  var cfg = ANIM_CONFIG[name];
  /* display canvas resolution = frame size */
  charDisplay.width = frames[0].img.naturalWidth;
  charDisplay.height = frames[0].img.naturalHeight;
  applyCharacterPlacement(cfg);
  showCharacterFrame(0);
  setActiveCharButton(name);
}

function showCharacterFrame(i) {
  var f = charFrames[i];
  charCtx.clearRect(0, 0, charDisplay.width, charDisplay.height);
  charCtx.drawImage(f.img, 0, 0);
}

/* keep the character's visual size / feet / center consistent between
 * states, even though the canvases and sprite offsets differ */
function applyCharacterPlacement(cfg) {
  var c = cfg.calib;
  var world = document.getElementById("world");
  var whRatio = world.clientHeight / world.clientWidth;

  var dispH = CHAR_PLACEMENT.bodyHeight / c.bodyFrac;          /* % of world height */
  var dispW = dispH * whRatio * (c.canvasW / c.canvasH);       /* % of world width */
  var left = CHAR_PLACEMENT.centerX - c.centerFrac * dispW;
  var top = CHAR_PLACEMENT.floorY - c.feetFrac * dispH;

  charDisplay.style.height = dispH + "%";
  charDisplay.style.width = "auto";
  charDisplay.style.left = left + "%";
  charDisplay.style.top = top + "%";
}

/* ---------- main loop ---------- */

function characterTick(now) {
  requestAnimationFrame(characterTick);
  if (!charFrames) return;
  if (!charLastTime) charLastTime = now;

  charAccumulator += now - charLastTime;
  charLastTime = now;

  var cfg = ANIM_CONFIG[charCurrent];
  var frameDuration = 1000 / cfg.fps;

  while (charAccumulator >= frameDuration) {
    charAccumulator -= frameDuration;
    if (cfg.loop) {
      charFrameIndex = (charFrameIndex + 1) % charFrames.length;
      showCharacterFrame(charFrameIndex);
    } else if (charFrameIndex < charFrames.length - 1) {
      charFrameIndex++;
      showCharacterFrame(charFrameIndex);
    } else {
      /* one-shot finished: back to idle */
      charFrameIndex = 0;
      charAccumulator = 0;
      playCharacterState("idle");
      break;
    }
  }
}

/* ---------- Character Test Panel ---------- */

function setActiveCharButton(name) {
  var btns = document.querySelectorAll(".char-btn");
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle("active", btns[i].getAttribute("data-state") === name);
  }
}

var charBtns = document.querySelectorAll(".char-btn");
for (var i = 0; i < charBtns.length; i++) {
  charBtns[i].onclick = function () {
    playCharacterState(this.getAttribute("data-state"));
  };
}

/* ---------- init: load idle and start the loop ---------- */

loadCharacterState("idle", function (frames) {
  if (frames.length) {
    activateCharacterState("idle", frames);
    console.log("[Anim] character animation system ready");
  }
});
requestAnimationFrame(characterTick);
