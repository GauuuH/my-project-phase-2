/* DECIDER - Shared Main Screen logic
 *
 * Listens for messages from the phones in the room:
 *  - player-join / player-leave / player-heartbeat: role card state
 *  - player-result: stores the submitted result PER ROLE (secret -
 *    never shown) and marks that role READY. No environment /
 *    character / item feedback is triggered yet.
 * The main status shows how many roles are READY, e.g. "2 / 5 READY".
 * Works with any number of players (1-2 phones are enough to test).
 */

var OFFLINE_AFTER_MS = 4000;

var state = {
  players: new Map(),   /* id -> { id, name, roleId, lastSeen } */
  results: new Map(),   /* roleId -> result (stored secretly until 5/5) */
  events: [],           /* recent log lines, newest first */
  combined: false,      /* true once the 5/5 command was revealed */
};

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

/* main status: READY count, and the revealed command at 5/5 */
function renderStatus() {
  var now = Date.now();
  var online = 0;
  state.players.forEach(function (p) {
    if (now - p.lastSeen < OFFLINE_AFTER_MS) online++;
  });

  if (state.results.size === DECIDER.ROLES.length) {
    /* 5/5: read the five results once and reveal the command */
    if (!state.combined) {
      state.combined = true;
      pushEvent("⭐ All roles ready — command revealed");
    }
    var cmd = buildCommand();
    resultText.textContent = cmd.line;
    resultText.classList.add("revealed");
    resultSub.textContent = cmd.sentence;
  } else {
    /* before 5/5: only the READY count, results stay hidden */
    resultText.textContent = state.results.size + " / " + DECIDER.ROLES.length + " READY";
    resultText.classList.remove("revealed");
    resultSub.textContent = "Players online: " + online + " · Submitted results are hidden";
  }
}

/* ---------- combine & command reveal (5/5 only) ---------- */

var ACTION_GERUND = { Eat: "eating", Hit: "hitting", Use: "using" };
var ENV_WORD = { Sunny: "sun", Rain: "rain", Snow: "snow" };

/* Read the five results (fixed role order) and build:
 *   line:     "Rain · Run · Eat · Pizza · Umbrella"
 *   sentence: "Run in the rain while eating pizza with an umbrella." */
function buildCommand() {
  var env = state.results.get("environment");
  var move = state.results.get("movement");
  var act = state.results.get("action");
  var obj = state.results.get("object");
  var tool = state.results.get("tool");

  var line = [env, move, act, obj, tool].join(" · ");

  var envWord = ENV_WORD[env] || String(env).toLowerCase();
  var actWord = ACTION_GERUND[act] || String(act).toLowerCase() + "ing";
  var objWord = String(obj).toLowerCase();
  var objPhrase = act === "Eat" ? objWord : "the " + objWord;
  var sentence = move + " in the " + envWord + " while " + actWord + " " +
    objPhrase + " with " + article(String(tool).toLowerCase()) + ".";

  return { line: line, sentence: sentence };
}

function article(word) {
  return (/^[aeiou]/i.test(word) ? "an " : "a ") + word;
}

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
