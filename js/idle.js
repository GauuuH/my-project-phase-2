/* DECIDER - Idle animation for the character in the Game Area
 *
 * How it works:
 *   1. Every frame file listed in IDLE_CONFIG.frames is preloaded and
 *      checked (the console reports how many frames were found).
 *   2. Frames are sorted by their number and played in that order.
 *   3. The animation loops forever until the page is closed.
 *   4. All frames are drawn into one fixed-size <img> box, so every
 *      frame has exactly the same size and position (no jumping).
 */

/* ================================================================
 * IDLE SETTINGS — change these and refresh the page.
 * ================================================================ */

var IDLE_CONFIG = {
  /* Folder that contains the single-frame PNGs. */
  folder: "assets/idle/frames/",

  /* Which frames to use (without ".png"). Played in number order.
   * To use more frames later, just add them here. */
  frames: ["008", "009"],

  /* IDLE SPEED — frames per second.
   *   higher fps  = faster animation
   *   lower fps   = slower animation
   * 6 fps = about 167 ms per frame. */
  fps: 6,
};

/* ================================================================
 * Animation code (no need to change anything below).
 * ================================================================ */

var IDLE_CHARACTER_ID = "character";
var IDLE_FRAME_DURATION = 1000 / IDLE_CONFIG.fps; /* ms per frame */

function initIdle() {
  var character = document.getElementById(IDLE_CHARACTER_ID);
  if (!character) {
    console.warn("[Idle] element #" + IDLE_CHARACTER_ID + " not found");
    return;
  }

  /* show the first frame right away while the rest are preloading */
  character.src = IDLE_CONFIG.folder + IDLE_CONFIG.frames[0] + ".png";

  var loaded = []; /* { name, img } */
  var pending = IDLE_CONFIG.frames.length;

  /* 1. auto-check how many frame images actually exist */
  IDLE_CONFIG.frames.forEach(function (name) {
    var img = new Image();
    img.onload = function () {
      loaded.push({ name: name, img: img });
      oneDone();
    };
    img.onerror = function () {
      console.warn("[Idle] frame not found: " + IDLE_CONFIG.folder + name + ".png");
      oneDone();
    };
    img.src = IDLE_CONFIG.folder + name + ".png";
  });

  function oneDone() {
    pending--;
    if (pending > 0) return;

    /* 2. play in the correct order: sort by frame number */
    loaded.sort(function (a, b) {
      return parseInt(a.name, 10) - parseInt(b.name, 10);
    });

    console.log(
      "[Idle] frames found: " + loaded.length + " / " + IDLE_CONFIG.frames.length +
      " (" + loaded.map(function (f) { return f.name; }).join(", ") + ")" +
      " · fps: " + IDLE_CONFIG.fps +
      " · " + Math.round(IDLE_FRAME_DURATION) + " ms per frame"
    );

    if (loaded.length === 0) {
      console.warn("[Idle] no frames loaded, idle animation disabled");
      return;
    }

    /* 3. infinite loop, paced by IDLE_CONFIG.fps */
    startLoop(character, loaded);
  }
}

function startLoop(character, loaded) {
  var frameIndex = 0;
  var lastTime = 0;
  var accumulator = 0;

  function showFrame(i) {
    /* all frames are preloaded, so this swap is instant (no flicker) */
    character.src = loaded[i].img.src;
  }

  function tick(now) {
    if (!lastTime) lastTime = now;
    accumulator += now - lastTime;
    lastTime = now;

    while (accumulator >= IDLE_FRAME_DURATION) {
      accumulator -= IDLE_FRAME_DURATION;
      frameIndex = (frameIndex + 1) % loaded.length; /* wrap = infinite loop */
      showFrame(frameIndex);
    }

    requestAnimationFrame(tick);
  }

  showFrame(0);
  requestAnimationFrame(tick);
}

initIdle();
