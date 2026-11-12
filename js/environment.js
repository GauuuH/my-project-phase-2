/* DECIDER - Environment system (Sunny / Rain / Snow) + test panel
 *
 * Sunny: the map's own state + a soft warm light overlay.
 * Rain:  code-generated raindrops, only inside the big window box,
 *        plus a darker tint on the outside view.
 * Snow:  code-generated snowflakes of different sizes and speeds,
 *        only inside the window box.
 * Only one environment is active at a time.
 */

var ENV_CONFIG = {
  rain: {
    drops: 60,          /* how many raindrops in the window */
    minDuration: 0.50,  /* fastest fall (seconds) */
    maxDuration: 0.95,  /* slowest fall (seconds) */
  },
  snow: {
    flakes: 45,         /* how many snowflakes in the window */
    minDuration: 3.2,   /* slowest drift (seconds) */
    maxDuration: 8.0,   /* fastest drift (seconds) */
    minSize: 2,         /* px */
    maxSize: 6,         /* px */
  },
};

var envWorld = document.getElementById("world");
var envWindowFx = document.getElementById("windowFx");
var currentEnv = "sunny";

function setEnvironment(env) {
  if (env !== "sunny" && env !== "rain" && env !== "snow") return;
  currentEnv = env;

  envWorld.classList.remove("env-sunny", "env-rain", "env-snow");
  envWorld.classList.add("env-" + env);

  clearWeather();
  if (env === "rain") buildRain();
  else if (env === "snow") buildSnow();

  highlightButton(env);
  console.log("[Env] " + env);
}

/* remove generated particles, keep the .window-dim overlay element */
function clearWeather() {
  var parts = envWindowFx.querySelectorAll(".fx-drop, .fx-flake");
  for (var i = 0; i < parts.length; i++) parts[i].remove();
}

function envRand(min, max) {
  return min + Math.random() * (max - min);
}

function buildRain() {
  var cfg = ENV_CONFIG.rain;
  for (var i = 0; i < cfg.drops; i++) {
    var d = document.createElement("div");
    d.className = "fx-drop";
    d.style.left = envRand(0, 100) + "%";
    d.style.height = envRand(10, 26) + "px";
    d.style.animationDuration = envRand(cfg.minDuration, cfg.maxDuration) + "s";
    /* negative delay staggers the drops from the first frame */
    d.style.animationDelay = (-envRand(0, cfg.maxDuration)) + "s";
    d.style.opacity = envRand(0.35, 0.8);
    envWindowFx.appendChild(d);
  }
}

function buildSnow() {
  var cfg = ENV_CONFIG.snow;
  for (var i = 0; i < cfg.flakes; i++) {
    var f = document.createElement("div");
    f.className = "fx-flake";
    var size = envRand(cfg.minSize, cfg.maxSize);
    f.style.width = size + "px";
    f.style.height = size + "px";
    f.style.left = envRand(0, 100) + "%";
    f.style.animationDuration = envRand(cfg.minDuration, cfg.maxDuration) + "s";
    f.style.animationDelay = (-envRand(0, cfg.maxDuration)) + "s";
    f.style.opacity = envRand(0.55, 0.95);
    envWindowFx.appendChild(f);
  }
}

function highlightButton(env) {
  var btns = document.querySelectorAll(".env-btn");
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle("active", btns[i].getAttribute("data-env") === env);
  }
}

/* wire up the Environment Test Panel */
var envBtns = document.querySelectorAll(".env-btn");
for (var i = 0; i < envBtns.length; i++) {
  envBtns[i].onclick = function () {
    setEnvironment(this.getAttribute("data-env"));
  };
}

/* start on Sunny (the map's own state) */
setEnvironment("sunny");
