/* DECIDER - phone player page logic */

var roleGrid = document.getElementById("roleGrid");
var nameInput = document.getElementById("nameInput");
var joinBtn = document.getElementById("joinBtn");
var joinSection = document.getElementById("joinSection");
var actionSection = document.getElementById("actionSection");
var actionGrid = document.getElementById("actionGrid");
var youIcon = document.getElementById("youIcon");
var youName = document.getElementById("youName");
var youRole = document.getElementById("youRole");
var lastAction = document.getElementById("lastAction");
var leaveBtn = document.getElementById("leaveBtn");

var selectedRoleId = null;
var joined = false;
var heartbeat = null;
var playerId = getPlayerId();

var channel = createChannel(handleMessage);

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
  joinBtn.disabled = !(selectedRoleId && nameInput.value.trim());
}

nameInput.oninput = updateJoinBtn;

joinBtn.onclick = function () {
  var name = nameInput.value.trim();
  if (!selectedRoleId || !name) return;

  joined = true;
  announceJoin();
  heartbeat = setInterval(function () {
    channel.send({ type: "player-heartbeat", playerId: playerId });
  }, 1500);

  var role = roleById(selectedRoleId);
  youIcon.textContent = role.icon;
  youName.textContent = name;
  youRole.textContent = role.name + " · " + role.controller;

  joinSection.hidden = true;
  actionSection.hidden = false;
  lastAction.textContent = "";
};

leaveBtn.onclick = function () {
  if (!joined) return;
  clearInterval(heartbeat);
  channel.send({ type: "player-leave", playerId: playerId });
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

/* ---------- messages from the screen ---------- */

function handleMessage(msg) {
  if (!msg) return;
  if (msg.type === "screen-ready" && joined) {
    announceJoin();
  }
}
