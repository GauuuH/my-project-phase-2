/* DECIDER - Shared Main Screen logic
 *
 * Listens for messages from the phones in the room:
 *  - player-join / player-leave / player-heartbeat: role card state
 *  - player-result: stores the submitted result PER ROLE (secret -
 *    never shown) and marks that role READY. No environment /
 *    character / item feedback is triggered before 4/4.
 * The main status shows how many roles are READY, e.g. "2 / 4 READY".
 * At 4/4 the four results are combined, the command is revealed AND
 * executed once: weather changes, the character plays the Action
 * animation, physically moves in the Direction and the Item follows
 * the character. The NEXT ROUND button then resets the round and
 * re-arms every phone.
 * Works with any number of players (1-2 phones are enough to test).
 */

var OFFLINE_AFTER_MS = 4000;

var state = {
  players: new Map(),   /* id -> { id, name, roleId, lastSeen } */
  results: new Map(),   /* roleId -> result (stored secretly until 4/4) */
  events: [],           /* recent log lines, newest first */
  combined: false,      /* true once the 4/4 command was revealed */
};

var nextRoundBtn = document.getElementById("nextRoundBtn");
var itemTimer = null;   /* pending Eat + Pizza hide (this round) */

var world = document.getElementById("world");
var resultText = document.getElementById("resultText");
var resultSub = document.getElementById("resultSub");
var eventLogText = document.getElementById("eventLogText");
var playersEl = document.getElementById("players");
var roomCodeEl = document.getElementById("roomCode");
var connDot = document.getElementById("connDot");
var connText = document.getElementById("connText");

/* Room code: the laptop keeps the same code every visit, so phones can
 * join again without typing a new one. */
var room = getRoomCode(true);
roomCodeEl.textContent = room;

var channel = createChannel(handleMessage, room, updateConnStatus);

function updateConnStatus(status) {
  if (status === "connected") {
    connDot.classList.remove("off");
    connText.textContent = "Connected";
    /* tell phones that are already open that the screen is here */
    channel.send({ type: "screen-ready" });
  } else if (status === "failed") {
    connDot.classList.add("off");
    connText.textContent = "No connection";
  } else {
    connDot.classList.add("off");
    connText.textContent = "Connecting…";
  }
}

/* Re-announced regularly so a refreshed screen re-syncs quickly. */
channel.send({ type: "screen-ready" });
setInterval(function () {
  channel.send({ type: "screen-ready" });
}, 5000);

function handleMessage(msg) {
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case "player-join":
      var existed = state.players.has(msg.player.id);
      state.players.set(msg.player.id, {
        id: msg.player.id,
        name: msg.player.name,
        roleId: msg.player.roleId,
        lastSeen: Date.now(),
      });
      if (!existed) {
        var role = roleById(msg.player.roleId);
        pushEvent((role ? role.icon + " " : "") + esc(msg.player.name) + " joined as " +
          (role ? role.name : "?"));
      }
      break;

    /* a phone finished its interaction and submitted its result.
     * Store it per role (secret), mark the role READY. Do NOT show
     * the result itself and do NOT trigger any game feedback yet. */
    case "player-result": {
      var rp = state.players.get(msg.playerId);
      if (!rp) break;
      if (rp.roleId !== msg.roleId || !msg.result) break; /* sanity */
      rp.lastSeen = Date.now();
      state.results.set(msg.roleId, msg.result);
      var rrole = roleById(msg.roleId);
      pushEvent((rrole ? rrole.icon + " " : "") + esc(rp.name) + " is ready");
      break;
    }

    case "player-heartbeat": {
      var hp = state.players.get(msg.playerId);
      if (hp) hp.lastSeen = Date.now();
      break;
    }

    case "player-leave": {
      var lp = state.players.get(msg.playerId);
      if (lp) {
        state.players.delete(msg.playerId);
        pushEvent(esc(lp.name) + " left");
      }
      break;
    }
  }

  render();
}

/* ---------- log ---------- */

function pushEvent(text) {
  state.events.unshift(text);
  state.events = state.events.slice(0, 3);
  eventLogText.textContent = state.events.join("   ·   ");
}

/* ---------- rendering ---------- */

function render() {
  renderPlayers();
  renderStatus();
}

function renderPlayers() {
  playersEl.innerHTML = "";
  var now = Date.now();

  DECIDER.ROLES.forEach(function (role) {
    /* one player per role: the last player who joined this role wins */
    var player = null;
    state.players.forEach(function (p) {
      if (p.roleId === role.id) player = p;
    });

    var online = player && (now - player.lastSeen < OFFLINE_AFTER_MS);
    var ready = state.results.has(role.id);

    var card = document.createElement("div");
    card.className = "player-card";
    card.style.setProperty("--role-color", role.color);
    if (ready) card.classList.add("ready");
    else if (player && online) card.classList.add("joined");
    else if (player && !online) card.classList.add("offline");

    var status;
    if (ready) status = '<span class="player-status status-ready">● READY</span>';
    else if (player && online) status = '<span class="player-status status-joined">● online</span>';
    else if (player && !online) status = '<span class="player-status status-offline">● offline</span>';
    else status = '<span class="player-status status-empty">WAITING</span>';

    card.innerHTML =
      '<div class="player-icon">' + role.icon + '</div>' +
      '<div class="player-info">' +
      '<div class="player-role">' + role.name + ' · ' + role.controller + '</div>' +
      '<div class="player-name">' + (player ? esc(player.name) : "Waiting…") + '</div>' +
      '</div>' +
      status;

    playersEl.appendChild(card);
  });
}

/* main status: READY count, and the revealed command at 4/4 */
function renderStatus() {
  var now = Date.now();
  var online = 0;
  state.players.forEach(function (p) {
    if (now - p.lastSeen < OFFLINE_AFTER_MS) online++;
  });

  if (state.results.size === DECIDER.ROLES.length) {
    /* 4/4: read the four results once, reveal the command and run it
     * exactly once (the per-second render() never restarts it) */
    if (!state.combined) {
      state.combined = true;
      pushEvent("⭐ All roles ready — command revealed");
      executeCommand();
    }
    var cmd = buildCommand();
    resultText.textContent = cmd.line;
    resultText.classList.add("revealed");
    resultSub.textContent = cmd.sentence;
    if (nextRoundBtn) nextRoundBtn.hidden = false;
  } else {
    /* before 4/4: only the READY count, results stay hidden */
    resultText.textContent = state.results.size + " / " + DECIDER.ROLES.length + " READY";
    resultText.classList.remove("revealed");
    resultSub.textContent = "Players online: " + online + " · Submitted results are hidden";
    if (nextRoundBtn) nextRoundBtn.hidden = true;
  }
}

/* ---------- combine & command reveal (4/4 only) ---------- */

var ENV_WORD = { Sunny: "sun", Rain: "rain", Snow: "snow" };

/* Read the four results (fixed role order) and build:
 *   line:     "Rain · Run · Pizza · Right"
 *   sentence: "Run right in the rain with a pizza." */
function buildCommand() {
  var env = state.results.get("environment");
  var act = state.results.get("action");
  var item = state.results.get("item");
  var dir = state.results.get("direction");

  var line = [env, act, item, dir].join(" · ");

  var envWord = ENV_WORD[env] || String(env).toLowerCase();
  var actWord = String(act);
  var sentence = actWord.charAt(0) + actWord.slice(1).toLowerCase() +
    " " + String(dir).toLowerCase() +
    " in the " + envWord + " with " +
    article(String(item).toLowerCase()) + ".";

  return { line: line, sentence: sentence };
}

function article(word) {
  return (/^[aeiou]/i.test(word) ? "an " : "a ") + word;
}

/* ---------- execute the revealed command (once per round) ---------- */

/* result -> existing system call (see js/environment.js, js/animations.js,
 * js/items.js - nothing new is built here) */
var RESULT_ENV = { Sunny: "sunny", Rain: "rain", Snow: "snow" };
var RESULT_CHAR = { Jump: "jump", Fall: "fall", Eat: "eat" };
var RESULT_ITEM = {
  Pizza: "pizza", Football: "football",
  Umbrella: "umbrella", Hammer: "hammer", Flashlight: "flashlight", Phone: "phone",
};

/* Action + Direction -> character animation state. Walk and Run have
 * real left/right-facing assets, so the animation always matches the
 * movement direction. Up / Down keep the right-facing asset (there are
 * no up/down assets and no mirroring) while the world movement still
 * follows the true direction. Jump / Fall / Eat have no direction
 * variants. */
function charStateFor(act, dir) {
  if (act === "Walk") return dir === "Left" ? "walkLeft" : "walkRight";
  if (act === "Run") return dir === "Left" ? "runLeft" : "runRight";
  return RESULT_CHAR[act];
}

/* How long the one-shot Eat animation plays (frames / fps). */
function eatAnimationMs() {
  var cfg = (typeof ANIM_CONFIG !== "undefined") ? ANIM_CONFIG.eat : null;
  if (!cfg) return 4000;
  return (cfg.frames.length / cfg.fps) * 1000;
}

/* Run the four combined results on the laptop:
 *   Environment changes right away, the character plays the Action
 *   animation (Walk/Run pick the real left/right-facing asset that
 *   matches the Direction) AND moves smoothly toward the Direction
 *   (speed depends on the action), and the Item attaches to the
 *   character and follows it. Eat + Pizza: the pizza sits at the
 *   mouth while the eat animation plays, then disappears.
 * Called only from the one-time 4/4 reveal in renderStatus(). */
function executeCommand() {
  var env = state.results.get("environment");
  var act = state.results.get("action");
  var item = state.results.get("item");
  var dir = state.results.get("direction");

  var envId = RESULT_ENV[env];
  if (envId) setEnvironment(envId);

  var charState = charStateFor(act, dir);
  if (charState) playCharacterState(charState);

  /* Direction: physically move the character canvas (no teleport) */
  if (dir && typeof moveCharacter === "function") {
    moveCharacter(dir, String(act).toLowerCase());
  }

  var itemId = RESULT_ITEM[item];
  if (itemId) {
    showItem(itemId); /* item follows the character from now on */
    if (act === "Eat" && item === "Pizza") {
      itemTimer = setTimeout(function () {
        itemTimer = null;
        showItem("none");
      }, eatAnimationMs());
    }
  }

  console.log("[Command] " + [env, act, item, dir].join(" · "));
}

/* ---------- next round ---------- */

/* Reset everything for a new round: results are cleared (the players
 * stay joined), the character goes back to the center in idle, the
 * weather returns to sunny, the item disappears, any pending movement
 * / item timer is cancelled, the phones are told to re-arm their
 * interaction and the status returns to 0 / 4 READY. */
function nextRound() {
  /* cancel a pending Eat + Pizza hide */
  if (itemTimer) {
    clearTimeout(itemTimer);
    itemTimer = null;
  }

  state.results.clear();
  state.combined = false;

  if (typeof resetCharacterPosition === "function") resetCharacterPosition();
  playCharacterState("idle");
  setEnvironment("sunny");
  showItem("none");

  channel.send({ type: "round-reset" });

  pushEvent("🔄 Next round — 0 / 4 READY");
  render();
}

if (nextRoundBtn) nextRoundBtn.onclick = nextRound;

/* ---------- dev helper: fill roles that are not READY yet ---------- */

/* Only fills roles without a real phone result; real results are
 * never overwritten. Triggers the same Combine -> Reveal flow. */
function devFillMissingRoles() {
  var filled = 0;
  DECIDER.ROLES.forEach(function (role) {
    if (!state.results.has(role.id)) {
      var pool = DECIDER.ROLE_RESULTS[role.id];
      if (pool && pool.length) {
        state.results.set(role.id, randomFrom(pool));
        filled++;
      }
    }
  });
  if (filled > 0) {
    pushEvent("DEV: filled " + filled + " missing role(s)");
  }
  render();
}

var devFillBtn = document.getElementById("devFillBtn");
if (devFillBtn) devFillBtn.onclick = devFillMissingRoles;

/* mark stale players offline */
setInterval(function () {
  render();
}, 1000);

render();
