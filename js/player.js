/* DECIDER - phone player page logic */

var roleGrid = document.getElementById("roleGrid");
var nameInput = document.getElementById("nameInput");
var roomInput = document.getElementById("roomInput");
var joinBtn = document.getElementById("joinBtn");
var joinSection = document.getElementById("joinSection");
var actionSection = document.getElementById("actionSection");
var actionGrid = document.getElementById("actionGrid");
var youIcon = document.getElementById("youIcon");
var youName = document.getElementById("youName");
var youRole = document.getElementById("youRole");
var youRoom = document.getElementById("youRoom");
var youStatus = document.getElementById("youStatus");
var lastAction = document.getElementById("lastAction");
var leaveBtn = document.getElementById("leaveBtn");

var selectedRoleId = null;
var joined = false;
var heartbeat = null;
var playerId = getPlayerId();
var channel = null;

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

/* ---------- build UI ---------- */

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

DECIDER.ACTIONS.forEach(function (action) {
  var btn = document.createElement("button");
  btn.className = "action-btn";
  btn.innerHTML =
    '<span class="icon">' + action.icon + '</span>' +
    '<span>' + action.name + '</span>';
  btn.onclick = function () {
    channel.send({ type: "player-action", playerId: playerId, actionId: action.id });
    lastAction.textContent = "You used " + action.name + "!";
  };
  actionGrid.appendChild(btn);
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
  lastAction.textContent = "";
};

leaveBtn.onclick = function () {
  if (!joined) return;
  clearInterval(heartbeat);
  channel.send({ type: "player-leave", playerId: playerId });
  channel.close();
  channel = null;
  joined = false;
  actionSection.hidden = true;
  joinSection.hidden = false;
  lastAction.textContent = "";
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
  if (status === "connected") {
    setYouStatus("ok", "● Connected to room " + normalizeRoomCode(roomInput.value));
  } else if (status === "failed") {
    setYouStatus("err", "● Could not connect — check your internet");
  } else {
    setYouStatus("warn", "● Reconnecting…");
  }
}

/* ---------- messages from the screen ---------- */

function handleMessage(msg) {
  if (!msg) return;
  if (msg.type === "screen-ready" && joined) {
    announceJoin();
  }
}
