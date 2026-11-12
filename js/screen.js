/* DECIDER - Shared Main Screen logic
 *
 * Listens for messages from the phones in the room:
 *  - player-join / player-leave / player-heartbeat: role card state
 *  - player-result: stores the submitted result PER ROLE (secret -
 *    never shown) and marks that role READY. No environment /
 *    character / item feedback is triggered before 4/4.
 * The main status shows how many roles are READY, e.g. "2 / 4 READY".
 * The round is SEQUENTIAL: Environment -> Direction -> Action -> Item.
 * Only the role at the current stage may act and submit; the laptop
 * enforces the order, broadcasts stage-state to the phones and only
 * at 4/4 combines, reveals AND executes the command once: weather
 * changes, the character plays the Action animation, physically moves
 * in the Direction and the Item follows the character. The NEXT ROUND
 * button then resets the round and re-arms every phone.
 * Works with any number of players (1-2 phones are enough to test).
 */

var OFFLINE_AFTER_MS = 4000;

var state = {
  players: new Map(),   /* id -> { id, name, roleId, lastSeen } */
  results: new Map(),   /* roleId -> result (stored secretly until 4/4) */
  events: [],           /* recent log lines, newest first */
  combined: false,      /* true once the 4/4 command was revealed */
  currentStage: "environment", /* role allowed to act now (null = all done) */
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

/* Re-announced regularly so a refreshed screen re-syncs quickly.
 * The stage state rides along so phones always converge on the
 * correct stage even if they missed a broadcast. */
channel.send({ type: "screen-ready" });
setInterval(function () {
  channel.send({ type: "screen-ready" });
  broadcastStageState();
}, 5000);

function handleMessage(msg) {
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case "player-join": {
      var joinNow = Date.now();

      /* Occupancy enforcement: ONE online player per role. If another
       * (different) online player already owns this role, reject the
       * newcomer - the first accepted player keeps the role, nobody
       * overwrites anybody, even with two simultaneous JOINs. */
      var owner = null;
      state.players.forEach(function (p) {
        if (p.id !== msg.player.id && p.roleId === msg.player.roleId &&
            joinNow - p.lastSeen < OFFLINE_AFTER_MS) {
          owner = p;
        }
      });

      if (owner) {
        var oRole = roleById(msg.player.roleId);
        channel.send({
          type: "join-rejected",
          playerId: msg.player.id,
          reason: "role-occupied",
          roleId: msg.player.roleId,
        });
        pushEvent("⛔ " + esc(msg.player.name) + " — " +
          (oRole ? oRole.name : "role") + " already occupied");
        broadcastStageState();
        break;
      }

      var existed = state.players.has(msg.player.id);
      state.players.set(msg.player.id, {
        id: msg.player.id,
        name: msg.player.name,
        roleId: msg.player.roleId,
        lastSeen: joinNow,
      });
      if (!existed) {
        var role = roleById(msg.player.roleId);
        pushEvent((role ? role.icon + " " : "") + esc(msg.player.name) + " joined as " +
          (role ? role.name : "?"));
      }
      /* sync the joiner (and everyone else) with the current stage */
      broadcastStageState();
      break;
    }

    /* a phone finished its interaction and submitted its result.
     * Sequential flow: only the role at the current stage may submit
     * - anything else is ignored, so nobody can skip the order.
     * Store it per role (secret), mark the role READY and advance the
     * stage. Results are never shown before 4/4. */
    case "player-result": {
      var rp = state.players.get(msg.playerId);
      if (!rp) break;
      if (rp.roleId !== msg.roleId || !msg.result) break; /* sanity */
      if (msg.roleId !== state.currentStage) {
        console.warn("[DECIDER] out-of-order result ignored: " + msg.roleId +
          " (stage is " + state.currentStage + ")");
        break;
      }
      rp.lastSeen = Date.now();
      state.results.set(msg.roleId, msg.result);
      var rrole = roleById(msg.roleId);
      pushEvent((rrole ? rrole.icon + " " : "") + esc(rp.name) + " is ready");
      advanceStage();
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
        /* the role is free again (1/1 -> 0/1): update every phone's
         * role selection immediately, no refresh needed */
        broadcastStageState();
      }
      break;
    }

    /* a phone that just opened the join screen asks for the current
     * room status (which roles are occupied) - answer immediately */
    case "screen-ping":
      broadcastStageState();
      break;
  }

  render();
}

/* ---------- sequential stage flow ---------- */

/* Move to the next role in DECIDER.STAGE_ORDER (null once all four
 * acted) and tell every phone about it. */
function advanceStage() {
  var idx = DECIDER.STAGE_ORDER.indexOf(state.currentStage);
  state.currentStage = DECIDER.STAGE_ORDER[idx + 1] || null;
  broadcastStageState();
}

/* Tell all phones which stage the round is at, which roles already
 * finished (role ids only - never the results themselves), which
 * roles are occupied (have an online player, so new joiners can see
 * 1/1 badges), and, when the next player's options depend on earlier
 * results, the pool they may draw from (Action pool, or Items
 * allowed by the chosen Action). */
function broadcastStageState() {
  var now = Date.now();
  var occupied = [];
  var owners = {}; /* roleId -> online playerId (who owns the role) */
  state.players.forEach(function (p) {
    if (now - p.lastSeen < OFFLINE_AFTER_MS) {
      owners[p.roleId] = p.id;
      if (occupied.indexOf(p.roleId) < 0) occupied.push(p.roleId);
    }
  });

  var msg = {
    type: "stage-state",
    currentStage: state.currentStage,
    done: Array.from(state.results.keys()),
    occupied: occupied,
    owners: owners,
    actionPool: null,
    itemPool: null,
  };

  if (state.currentStage === "action") {
    msg.actionPool = actionsFor(
      state.results.get("environment"),
      state.results.get("direction")
    );
  } else if (state.currentStage === "item") {
    msg.itemPool = itemsFor(state.results.get("action"));
  }

  channel.send(msg);
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
    /* one accepted online player per role: the laptop enforces this on
     * player-join (rejects anyone who tries an occupied role), so each
     * card always maps to the role's unique owner */
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
    var turnRole = roleById(state.currentStage);
    var turnText = turnRole ? " · Turn: " + turnRole.name : "";
    resultText.textContent = state.results.size + " / " + DECIDER.ROLES.length + " READY";
    resultText.classList.remove("revealed");
    resultSub.textContent = "Players online: " + online + turnText + " · Submitted results are hidden";
    if (nextRoundBtn) nextRoundBtn.hidden = true;
  }
}

/* ---------- combine & command reveal (4/4 only) ---------- */

var ENV_WORD = { Sunny: "sun", Rain: "rain", Snow: "snow" };

/* Read the four results (stage order) and build:
 *   line:     "Rain · Right · Run · Pizza"
 *   sentence: "Run right in the rain with a pizza." */
function buildCommand() {
  var env = state.results.get("environment");
  var dir = state.results.get("direction");
  var act = state.results.get("action");
  var item = state.results.get("item");

  var line = [env, dir, act, item].join(" · ");

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
 * stay joined), the stage goes back to Environment, the character
 * goes back to the center in idle, the weather returns to sunny, the
 * item disappears, any pending movement / item timer is cancelled,
 * the phones are told to re-arm and the status returns to 0 / 4
 * READY. The round-reset message carries the new stage so every
 * phone knows who starts. */
function nextRound() {
  /* cancel a pending Eat + Pizza hide */
  if (itemTimer) {
    clearTimeout(itemTimer);
    itemTimer = null;
  }

  state.results.clear();
  state.combined = false;
  state.currentStage = "environment";

  if (typeof resetCharacterPosition === "function") resetCharacterPosition();
  playCharacterState("idle");
  setEnvironment("sunny");
  showItem("none");

  channel.send({ type: "round-reset", currentStage: state.currentStage });

  pushEvent("🔄 Next round — 0 / 4 READY");
  render();
}

if (nextRoundBtn) nextRoundBtn.onclick = nextRound;

/* ---------- dev helper: fill roles that are not READY yet ---------- */

/* Only fills roles without a real phone result; real results are
 * never overwritten. Fills in STAGE_ORDER (Environment -> Direction ->
 * Action -> Item) and respects the dependencies: the Item draw obeys
 * ACTION_ITEM_MAP and the Action draw uses the Environment + Direction
 * compatibility map. Ends with a consistent state (all four done,
 * stage complete) and the same Combine -> Reveal flow. */
function devFillMissingRoles() {
  var filled = 0;
  DECIDER.STAGE_ORDER.forEach(function (roleId) {
    if (state.results.has(roleId)) return;

    var result = null;
    if (roleId === "item") {
      /* Item must respect the already-filled Action */
      var pool = itemsFor(state.results.get("action")) || DECIDER.ROLE_RESULTS.item;
      result = randomFrom(pool);
    } else if (roleId === "action") {
      /* Action respects the already-filled Environment + Direction */
      var actions = actionsFor(
        state.results.get("environment"),
        state.results.get("direction")
      );
      result = randomFrom(actions.length ? actions : DECIDER.ROLE_RESULTS.action);
    } else {
      result = randomFrom(DECIDER.ROLE_RESULTS[roleId]);
    }

    state.results.set(roleId, result);
    filled++;
  });

  /* stage follows the filled results: all done */
  state.currentStage = null;
  broadcastStageState();

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
