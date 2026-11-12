/* DECIDER - phone player page logic
 *
 * Join flow (role / name / room) stays the same. The round is
 * SEQUENTIAL (Environment -> Direction -> Action -> Item): the laptop
 * broadcasts "stage-state" and this page only arms a player's
 * interaction when their role is the current stage. Before that it
 * shows "WAITING FOR ...", after submitting it shows READY. Results
 * are sent to the laptop once per round; a new round arrives as
 * "round-reset" and everything re-syncs automatically.
 */

var roleGrid = document.getElementById("roleGrid");
var nameInput = document.getElementById("nameInput");
var roomInput = document.getElementById("roomInput");
var joinBtn = document.getElementById("joinBtn");
var joinSection = document.getElementById("joinSection");
var actionSection = document.getElementById("actionSection");
var youIcon = document.getElementById("youIcon");
var youName = document.getElementById("youName");
var youRole = document.getElementById("youRole");
var youRoom = document.getElementById("youRoom");
var youStatus = document.getElementById("youStatus");
var leaveBtn = document.getElementById("leaveBtn");
var interBinding = document.getElementById("interBinding");
var stageBanner = document.getElementById("stageBanner");

var selectedRoleId = null;
var joined = false;
var heartbeat = null;
var playerId = getPlayerId();
var channel = null;
var connState = null; /* "connected" | "disconnected" | "failed" */
var currentStage = null; /* role allowed to act now (from the laptop) */
var lastStageSignature = null; /* guards against re-arming on repeat broadcasts */

/* Prefill the room code: ?room=XXXX in the URL first, then the last used code. */
(function () {
  var fromUrl = null;
  try { fromUrl = new URLSearchParams(location.search).get("room"); } catch (e) { /* ignore */ }
  if (fromUrl && normalizeRoomCode(fromUrl)) {
    roomInput.value = normalizeRoomCode(fromUrl);
  } else {
    var stored = getRoomCode(false);
    if (stored) roomInput.value = stored;
  }
  /* start listening for the room status right away (if a code exists) */
  scheduleRoomListener();
})();

/* ---------- build UI: role picker ---------- */

DECIDER.ROLES.forEach(function (role) {
  var btn = document.createElement("button");
  btn.className = "role-btn";
  btn.setAttribute("data-role", role.id);
  btn.style.setProperty("--role-color", role.color);
  btn.innerHTML =
    '<span class="icon">' + role.icon + '</span>' +
    '<span>' + role.name + '</span>' +
    '<span class="ctrl">' + role.controller + '</span>' +
    '<span class="role-count" hidden>1/1</span>';
  btn.onclick = function () {
    var all = roleGrid.querySelectorAll(".role-btn");
    for (var i = 0; i < all.length; i++) all[i].classList.remove("selected");
    btn.classList.add("selected");
    selectedRoleId = role.id;
    updateJoinBtn();
  };
  roleGrid.appendChild(btn);
});

/* Mark roles that already have a player in the room (laptop keeps the
 * truth - one player per role). Occupied buttons get the 1/1 badge
 * and a dimmed look so new joiners can pick a free role. */
function updateRoleOccupancy(occupied) {
  var list = occupied || [];
  var btns = roleGrid.querySelectorAll(".role-btn");
  for (var i = 0; i < btns.length; i++) {
    var occ = list.indexOf(btns[i].getAttribute("data-role")) >= 0;
    btns[i].classList.toggle("occupied", occ);
    var badge = btns[i].querySelector(".role-count");
    if (badge) badge.hidden = !occ;
  }
}

/* ---------- room status listener (before joining) ---------- */

/* A lightweight listen-only channel on the entered room code, so the
 * role picker shows which roles are occupied before the player joins.
 * Closed when the player joins (the main channel takes over) and
 * restarted when they leave. */
var roomListenChannel = null;
var roomListenDebounce = null;

function startRoomListener() {
  stopRoomListener();
  var code = normalizeRoomCode(roomInput.value);
  if (joined || code.length < 4) return;

  roomListenChannel = createChannel(function (msg) {
    if (msg && msg.type === "stage-state") {
      updateRoleOccupancy(msg.occupied || []);
    }
  }, code, function (status) {
    /* ask the laptop for the room status as soon as we are connected */
    if (status === "connected" && roomListenChannel && roomListenChannel.send) {
      roomListenChannel.send({ type: "screen-ping" });
    }
  });
}

function stopRoomListener() {
  clearTimeout(roomListenDebounce);
  if (roomListenChannel) {
    roomListenChannel.close();
    roomListenChannel = null;
  }
}

/* re-connect the listener shortly after the room code stops changing */
function scheduleRoomListener() {
  clearTimeout(roomListenDebounce);
  roomListenDebounce = setTimeout(startRoomListener, 500);
}

/* ---------- join / leave ---------- */

function updateJoinBtn() {
  joinBtn.disabled = !(
    selectedRoleId &&
    nameInput.value.trim() &&
    normalizeRoomCode(roomInput.value)
  );
}

nameInput.oninput = updateJoinBtn;
roomInput.oninput = function () {
  updateJoinBtn();
  scheduleRoomListener();
};

joinBtn.onclick = function () {
  var name = nameInput.value.trim();
  var room = normalizeRoomCode(roomInput.value);
  if (!selectedRoleId || !name || !room) return;

  saveRoomCode(room);
  joined = true;
  lastStageSignature = null;

  /* the main channel replaces the listen-only room listener */
  stopRoomListener();

  /* connect to the room the laptop is showing */
  setYouStatus("warn", "● Connecting to room " + room + "…");
  channel = createChannel(handleMessage, room, updateConnStatus);

  announceJoin();
  heartbeat = setInterval(function () {
    channel.send({ type: "player-heartbeat", playerId: playerId });
  }, 1500);

  var role = roleById(selectedRoleId);
  youIcon.textContent = role.icon;
  youName.textContent = name;
  youRole.textContent = role.name + " · " + role.controller;
  youRoom.textContent = "Room: " + room;

  joinSection.hidden = true;
  actionSection.hidden = false;

  /* The laptop is the source of truth for the stage: wait for its
   * stage-state message before arming anything. */
  interBinding.textContent = "";
  showBanner("JOINING…", "Waiting for the screen…");
};

leaveBtn.onclick = function () {
  if (!joined) return;
  clearInterval(heartbeat);
  channel.send({ type: "player-leave", playerId: playerId });
  channel.close();
  channel = null;
  joined = false;
  currentStage = null;
  lastStageSignature = null;
  if (typeof stopAllInteractions === "function") stopAllInteractions();
  if (typeof setRolePool === "function") {
    setRolePool("action", null);
    setRolePool("item", null);
  }
  interBinding.textContent = "";
  hideBanner();
  actionSection.hidden = true;
  joinSection.hidden = false;

  /* show fresh occupancy on the join screen again */
  updateRoleOccupancy([]);
  scheduleRoomListener();
};

function announceJoin() {
  channel.send({
    type: "player-join",
    player: {
      id: playerId,
      name: nameInput.value.trim(),
      roleId: selectedRoleId,
    },
  });
  channel.send({ type: "player-heartbeat", playerId: playerId });
}

function setYouStatus(cls, text) {
  youStatus.className = "you-status" + (cls ? " " + cls : "");
  youStatus.textContent = text;
}

function updateConnStatus(status) {
  connState = status;
  if (status === "connected") {
    setYouStatus("ok", "● Connected to room " + normalizeRoomCode(roomInput.value));
    /* make sure the screen knows we are here as soon as we connect */
    if (joined) announceJoin();
  } else if (status === "failed") {
    setYouStatus("err", "● Could not connect — check your internet");
  } else {
    setYouStatus("warn", "● Reconnecting…");
  }
}

/* ---------- result submission (hook used by interactions.js) ---------- */

function getJoinedRoleId() {
  return joined ? selectedRoleId : null;
}

/* Send this role's result to the room once.
 * Returns true when the room connection is up. */
function sendPlayerResult(roleId, result) {
  if (!joined || !channel || connState !== "connected") return false;
  /* re-announce the join first so the screen knows this player before
   * the result arrives (MQTT keeps per-client message order) */
  announceJoin();
  channel.send({
    type: "player-result",
    playerId: playerId,
    roleId: roleId,
    result: result,
  });
  return true;
}

/* ---------- messages from the screen ---------- */

function handleMessage(msg) {
  if (!msg) return;
  if (msg.type === "screen-ready" && joined) {
    announceJoin();
  }
  if (msg.type === "stage-state" && joined) {
    applyStageState(msg);
  }
  if (msg.type === "round-reset" && joined) {
    /* new round: the laptop sends the new stage (Environment starts).
     * Force a full re-apply even if the signature looks the same. */
    lastStageSignature = null;
    applyStageState({ currentStage: msg.currentStage || "environment", done: [] });
  }
}

/* ---------- sequential stage flow (laptop is the source of truth) ---------- */

/* Only true when this player's role is the current stage. Used by
 * interactions.js to block out-of-turn submissions on the phone side
 * (the laptop re-validates every message anyway). */
function stageAllowsSubmission(roleId) {
  return roleId === currentStage;
}

function showBanner(title, sub) {
  if (!stageBanner) return;
  stageBanner.innerHTML =
    '<div class="stage-banner-title">' + esc(title) + '</div>' +
    (sub ? '<div class="stage-banner-sub">' + esc(sub) + '</div>' : '');
  stageBanner.hidden = false;
}

function hideBanner() {
  if (stageBanner) stageBanner.hidden = true;
}

/* Sync this phone with the laptop's stage state:
 *   - role already done this round  -> READY, locked
 *   - current stage is my role      -> YOUR TURN: arm my interaction
 *   - otherwise                     -> WAITING FOR the current role
 * The laptop re-broadcasts the same state every few seconds; a
 * signature guard makes sure we only re-arm / re-clear when the
 * state actually changed (or when the player manually switched to a
 * different interaction, in which case we re-arm their own one). */
function applyStageState(msg) {
  var myRole = selectedRoleId;
  var stage = msg.currentStage || null;
  var done = msg.done || [];
  currentStage = stage;

  /* pools that depend on earlier results (Action / Item turn) */
  if (typeof setRolePool === "function") {
    setRolePool("action", msg.actionPool || null);
    setRolePool("item", msg.itemPool || null);
  }

  var sig = String(stage) + "|" + done.join(",");
  var changed = sig !== lastStageSignature;
  lastStageSignature = sig;

  if (done.indexOf(myRole) >= 0) {
    /* my role already acted this round: keep the submitted result on
     * screen (locked) and just show the waiting banner */
    showBanner("READY", "Waiting for the other players…");
    if (typeof interSetStatus === "function") {
      interSetStatus("ready", "READY — waiting for other players");
    }
    return;
  }

  if (stage === myRole) {
    /* YOUR TURN: arm this role's interaction (once) */
    hideBanner();
    var interId = DECIDER.ROLE_INTERACTION[myRole];
    var role = roleById(myRole);
    if (interId) {
      var interLabel = typeof getInteractionLabel === "function"
        ? getInteractionLabel(interId)
        : interId;
      interBinding.textContent = role.icon + " " + role.name + " · YOUR TURN — " + interLabel;

      var currentInter = typeof getCurrentInteraction === "function"
        ? getCurrentInteraction()
        : null;
      if ((changed || currentInter !== interId) &&
          typeof selectInteraction === "function") {
        selectInteraction(interId);
      }
    }
    return;
  }

  /* not my turn yet: disarm everything and wait. Only touch the stage
   * when the state actually changed, so a manual test in progress is
   * not killed by every repeated broadcast. */
  if (changed) {
    if (typeof stopAllInteractions === "function") stopAllInteractions();
    interBinding.textContent = "";
    var curRole = roleById(stage);
    var name = curRole ? curRole.name : "others";
    showBanner("WAITING FOR " + name.toUpperCase(), "Please wait for the " + name + " player.");
    if (typeof interSetStatus === "function") {
      interSetStatus("waiting", "Waiting for " + name + "…");
    }
  }
}
