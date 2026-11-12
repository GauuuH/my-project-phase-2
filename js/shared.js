/* DECIDER - shared game data + realtime messaging (Phase 2)
 *
 * Transport: MQTT over WebSockets through a public broker. The laptop
 * (Shared Main Screen) and every phone join the same "room" topic, so
 * they can talk to each other across devices — no own server needed.
 *
 * The message protocol between pages stays the same:
 *   { type: "player-join",      player: { id, name, roleId } }
 *   { type: "player-action",    playerId, actionId }
 *   { type: "player-heartbeat", playerId }
 *   { type: "player-leave",     playerId }
 *   { type: "screen-ready" }
 *   { type: "round-reset" }  (laptop -> phones: re-arm for a new round)
 *
 * NOTE: the broker is public, so anyone who knows the room code can read
 * or send game messages. Fine for a prototype. Later (own server) this
 * file is the only place that needs to change.
 */

var DECIDER = {
  /* Public MQTT brokers (WebSocket). Tried in order if one fails. */
  BROKERS: [
    "wss://broker.emqx.io:8084/mqtt",
    "wss://broker.hivemq.com:8884/mqtt",
  ],
  TOPIC_PREFIX: "decider/phase2/",
  ROOM_KEY: "decider-room",      /* localStorage key for the room code */
  PLAYER_ID_KEY: "decider-player-id",

  /* Four player roles. Each role controls one part of the world:
   * Environment, Action, Object, Tool.
   * (The old Movement role was merged into Action: Action now also
   * covers Walk / Run / Jump / Fall next to Eat.) */
  ROLES: [
    { id: "environment", name: "Environment", controller: "The Architect", icon: "🌍", color: "#2dd4bf" },
    { id: "action",      name: "Action",      controller: "The Operator",  icon: "⚡", color: "#fbbf24" },
    { id: "object",      name: "Object",      controller: "The Collector", icon: "📦", color: "#60a5fa" },
    { id: "tool",        name: "Tool",        controller: "The Engineer",  icon: "🔧", color: "#a78bfa" },
  ],

  /* Physical interactions. Press & Hold is kept as a dev/test
   * interaction only - it is NOT bound to any role here and does not
   * participate in a round. */
  ACTIONS: [
    { id: "blow",  name: "Blow",  icon: "💨" },
    { id: "shake", name: "Shake", icon: "📳" },
    { id: "press", name: "Press", icon: "👆" },
    { id: "tilt",  name: "Tilt",  icon: "📐" },
    { id: "swipe", name: "Swipe", icon: "👋" },
  ],

  /* Role -> real phone interaction binding:
   * Environment = Blow, Action = Shake, Object = Tilt, Tool = Swipe. */
  ROLE_INTERACTION: {
    environment: "blow",
    action: "shake",
    object: "tilt",
    tool: "swipe",
  },

  /* Random game result pool for each role. The interaction is
   * only the input: e.g. a successful Blow randomly gives Sunny,
   * Rain or Snow. */
  ROLE_RESULTS: {
    environment: ["Sunny", "Rain", "Snow"],
    action: ["Walk", "Run", "Jump", "Fall", "Eat"],
    object: ["Pizza", "Football"],
    tool: ["Umbrella", "Hammer", "Flashlight", "Phone"],
  },
};

function roleById(id) {
  return DECIDER.ROLES.find(function (r) { return r.id === id; });
}

function actionById(id) {
  return DECIDER.ACTIONS.find(function (a) { return a.id === id; });
}

/* pick a random item from an array */
function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/* ---------- room code ---------- */

var ROOM_CHARSET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; /* no I, L, O, 0, 1 */

function generateRoomCode() {
  var code = "";
  for (var i = 0; i < 4; i++) {
    code += ROOM_CHARSET[Math.floor(Math.random() * ROOM_CHARSET.length)];
  }
  return code;
}

function normalizeRoomCode(raw) {
  return String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function saveRoomCode(code) {
  try { localStorage.setItem(DECIDER.ROOM_KEY, code); } catch (e) { /* ignore */ }
}

/* Room code priority: ?room= in the URL → last used code → new code.
 * The screen passes createIfMissing=true so it always has a room.
 * Players only read the last used code (to prefill the input). */
function getRoomCode(createIfMissing) {
  var fromUrl = null;
  try { fromUrl = new URLSearchParams(location.search).get("room"); } catch (e) { /* ignore */ }
  if (fromUrl && normalizeRoomCode(fromUrl)) {
    var urlCode = normalizeRoomCode(fromUrl);
    saveRoomCode(urlCode);
    return urlCode;
  }

  var stored = null;
  try { stored = localStorage.getItem(DECIDER.ROOM_KEY); } catch (e) { /* ignore */ }
  if (stored && normalizeRoomCode(stored)) return normalizeRoomCode(stored);

  if (createIfMissing) {
    var fresh = generateRoomCode();
    saveRoomCode(fresh);
    return fresh;
  }
  return "";
}

function topicForRoom(room) {
  return DECIDER.TOPIC_PREFIX + room;
}

/* ---------- messaging channel ----------
 *
 * createChannel(onMessage, room, onStatus) returns { send, close }.
 * onMessage(msg): called for every message that arrives in the room.
 * onStatus(status): "connected" | "disconnected" | "failed".
 */

function createChannel(onMessage, room, onStatus) {
  function status(s) { if (onStatus) onStatus(s); }

  if (typeof mqtt === "undefined") {
    console.error("[DECIDER] mqtt library not loaded (js/vendor/mqtt.min.js)");
    status("failed");
    return { send: function () {}, close: function () {} };
  }

  var topic = topicForRoom(room);
  var brokerIndex = 0;
  var client = null;
  var closed = false;
  var switchTimer = null;

  function connect() {
    if (closed) return;
    if (brokerIndex >= DECIDER.BROKERS.length) {
      status("failed");
      console.error("[DECIDER] all brokers failed");
      return;
    }

    var url = DECIDER.BROKERS[brokerIndex];
    console.log("[DECIDER] connecting to broker " + (brokerIndex + 1) + ": " + url);

    client = mqtt.connect(url, {
      clean: true,
      reconnectPeriod: 3000,   /* retry every 3 s on the same broker */
      connectTimeout: 8000,
      clientId: "decider-" + Math.random().toString(36).slice(2, 10),
    });

    /* if this broker doesn't answer quickly, switch to the next one */
    switchTimer = setTimeout(function () {
      if (!closed && client && !client.connected) {
        console.warn("[DECIDER] broker timed out, trying the next one");
        try { client.end(true); } catch (e) { /* ignore */ }
        brokerIndex++;
        connect();
      }
    }, 9000);

    client.on("connect", function () {
      clearTimeout(switchTimer);
      status("connected");
      client.subscribe(topic, { qos: 0 });
      console.log("[DECIDER] connected · room " + room + " · topic " + topic);
    });

    client.on("message", function (t, payload) {
      if (t !== topic) return;
      var msg;
      try { msg = JSON.parse(payload.toString()); } catch (e) { return; }
      onMessage(msg);
    });

    client.on("close", function () {
      status("disconnected");
      console.log("[DECIDER] connection closed");
    });

    client.on("error", function (err) {
      console.warn("[DECIDER] mqtt error: " + (err && err.message ? err.message : err));
    });
  }

  connect();

  return {
    send: function (msg) {
      if (client && client.connected) {
        client.publish(topic, JSON.stringify(msg), { qos: 0 });
      } else {
        console.warn("[DECIDER] not connected, message dropped: " + (msg && msg.type));
      }
    },
    isConnected: function () {
      return !!(client && client.connected);
    },
    close: function () {
      closed = true;
      clearTimeout(switchTimer);
      try { client.end(true); } catch (e) { /* ignore */ }
    },
  };
}

/* Stable id for this tab/browser (sessionStorage = per tab). */
function getPlayerId() {
  var id = null;
  try { id = sessionStorage.getItem(DECIDER.PLAYER_ID_KEY); } catch (e) { /* ignore */ }
  if (!id) {
    id = "p-" + Math.random().toString(36).slice(2, 9);
    try { sessionStorage.setItem(DECIDER.PLAYER_ID_KEY, id); } catch (e) { /* ignore */ }
  }
  return id;
}

/* Escape text before putting it into HTML. */
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
