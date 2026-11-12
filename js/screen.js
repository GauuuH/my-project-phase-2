/* DECIDER - Shared Main Screen logic
 *
 * Listens for messages from the phone player tabs and renders:
 *  - the five role cards at the bottom
 *  - the shared world in the middle (with action effects)
 *  - the latest action / combined result text
 */

var OFFLINE_AFTER_MS = 4000;

var state = {
  players: new Map(),   /* id -> { id, name, roleId, lastSeen } */
  events: [],           /* recent log lines, newest first */
  actedRoles: new Set(),/* role ids that have used an action since screen load */
};

var world = document.getElementById("world");
var resultText = document.getElementById("resultText");
var resultSub = document.getElementById("resultSub");
var eventLogText = document.getElementById("eventLogText");
var playersEl = document.getElementById("players");

var channel = createChannel(handleMessage);

/* Let player tabs that are already open know we are here.
 * Re-announced regularly so a refreshed screen re-syncs quickly. */
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

    case "player-action": {
      var p = state.players.get(msg.playerId);
      if (!p) break;
      p.lastSeen = Date.now();

      var action = actionById(msg.actionId);
      var role = roleById(p.roleId);
      if (!action || !role) break;

      state.actedRoles.add(p.roleId);
      applyActionFx(action.id);
      setResult(esc(p.name) + " · " + role.name + " — " + action.icon + " " + action.name, role.color);
      pushEvent(role.icon + " " + esc(p.name) + " used " + action.name);
      maybeCombined();
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

/* ---------- visuals ---------- */

function applyActionFx(actionId) {
  var fxMap = { blow: "fx-blow", shake: "fx-shake", press: "fx-press", tilt: "fx-tilt" };
  var cls = fxMap[actionId] || "fx-press";
  world.classList.remove("fx-blow", "fx-shake", "fx-press", "fx-tilt");
  void world.offsetWidth; /* restart CSS animation */
  world.classList.add(cls);
}

function setResult(text, color) {
  resultText.textContent = text;
  resultText.style.color = color || "var(--text)";
}

function pushEvent(text) {
  state.events.unshift(text);
  state.events = state.events.slice(0, 3);
  eventLogText.textContent = state.events.join("   ·   ");
}

function maybeCombined() {
  if (state.actedRoles.size === DECIDER.ROLES.length) {
    setResult("✨ All five forces combined — the world moves! ✨", "#ffffff");
    pushEvent("⭐ All five roles have acted!");
  }
}

/* ---------- rendering ---------- */

function render() {
  renderPlayers();
  renderResultSub();
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

    var card = document.createElement("div");
    card.className = "player-card";
    card.style.setProperty("--role-color", role.color);
    if (player && online) card.classList.add("joined");
    if (player && !online) card.classList.add("offline");

    var status;
    if (!player) status = '<span class="player-status status-empty">empty</span>';
    else if (online) status = '<span class="player-status status-joined">● online</span>';
    else status = '<span class="player-status status-offline">● offline</span>';

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

function renderResultSub() {
  var now = Date.now();
  var online = 0;
  state.players.forEach(function (p) {
    if (now - p.lastSeen < OFFLINE_AFTER_MS) online++;
  });
  resultSub.textContent =
    "Roles active: " + state.actedRoles.size + " / " + DECIDER.ROLES.length +
    "  ·  Players online: " + online;
}

/* mark stale players offline */
setInterval(function () {
  var now = Date.now();
  var changed = false;
  state.players.forEach(function (p) {
    if (now - p.lastSeen >= OFFLINE_AFTER_MS) changed = true;
  });
  if (changed) render();
}, 1000);

render();
