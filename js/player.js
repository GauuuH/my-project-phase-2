/* DECIDER - phone player page logic
 *
 * Join flow (role / name / room) stays the same. After joining, the
 * player's own role interaction (see js/interactions.js) auto-starts;
 * a detected interaction generates this role's result and sends it to
 * the laptop once. When the laptop starts a new round it broadcasts
 * "round-reset" and this page re-arms the role interaction.
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

var selectedRoleId = null;
var joined = false;
var heartbeat = null;
var playerId = getPlayerId();
var channel = null;
var connState = null; /* "connected" | "disconnected" | "failed" */

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
})();

/* ---------- build UI: role picker ---------- */

DECIDER.ROLES.forEach(function (role) {
  var btn = document.createElement("button");
  btn.className = "role-btn";
  btn.style.setProperty("--role-color", role.color);
  btn.innerHTML =
    '<span class="icon">' + role.icon + '</span>' +
    '<span>' + role.name + '</span>' +
    '<span class="ctrl">' + role.controller + '</span>';
  btn.onclick = function () {
    var all = roleGrid.querySelectorAll(".role-btn");
    for (var i = 0; i < all.length; i++) all[i].classList.remove("selected");
    btn.classList.add("selected");
    selectedRoleId = role.id;
    updateJoinBtn();
  };
  roleGrid.appendChild(btn);
});

/* ---------- join / leave ---------- */

function updateJoinBtn() {
  joinBtn.disabled = !(
    selectedRoleId &&
    nameInput.value.trim() &&
    normalizeRoomCode(roomInput.value)
  );
}

nameInput.oninput = updateJoinBtn;
roomInput.oninput = updateJoinBtn;

joinBtn.onclick = function () {
  var name = nameInput.value.trim();
  var room = normalizeRoomCode(roomInput.value);
  if (!selectedRoleId || !name || !room) return;

  saveRoomCode(room);
  joined = true;

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

  /* Role -> Interaction binding: auto-start this role's interaction.
   * The manual test buttons stay available below (dev mode). */
  var interId = DECIDER.ROLE_INTERACTION[selectedRoleId];
  if (interId) {
    var interLabel = typeof getInteractionLabel === "function"
      ? getInteractionLabel(interId)
      : interId;
    interBinding.textContent = role.icon + " " + role.name + " is bound to " + interLabel;
    if (typeof selectInteraction === "function") selectInteraction(interId);
  }
};

leaveBtn.onclick = function () {
  if (!joined) return;
  clearInterval(heartbeat);
  channel.send({ type: "player-leave", playerId: playerId });
  channel.close();
  channel = null;
  joined = false;
  if (typeof stopAllInteractions === "function") stopAllInteractions();
  interBinding.textContent = "";
  actionSection.hidden = true;
  joinSection.hidden = false;
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
  if (msg.type === "round-reset" && joined) {
    resetForNextRound();
  }
}

/* The laptop started a new round: clear the previous Result/READY
 * state (locks included) and immediately re-arm this player's own
 * role interaction, so the next round starts without leaving or
 * refreshing the page. */
function resetForNextRound() {
  if (typeof stopAllInteractions === "function") stopAllInteractions();
  var interId = DECIDER.ROLE_INTERACTION[selectedRoleId];
  if (interId && typeof selectInteraction === "function") {
    selectInteraction(interId);
  }
}
