/* DECIDER - shared game data + cross-tab messaging (Phase 2 basic prototype)
 *
 * BroadcastChannel lets the Shared Main Screen and the Player pages talk to
 * each other inside the same browser. A real server (Day 4 of PLAN.md) will
 * replace this layer so real phones can join the same room.
 */

const DECIDER = {
  CHANNEL: "decider-shared-world",
  STORAGE_FALLBACK_KEY: "decider-channel-msg",
  PLAYER_ID_KEY: "decider-player-id",

  /* Five player roles (placeholders - Day 1 will finalize the real rules).
   * Each role controls one part of the world:
   * Environment, Movement, Action, Object, Tool.
   */
  ROLES: [
    { id: "environment", name: "Environment", controller: "The Architect", icon: "🌍", color: "#2dd4bf" },
    { id: "movement",    name: "Movement",    controller: "The Navigator", icon: "🧭", color: "#f472b6" },
    { id: "action",      name: "Action",      controller: "The Operator",  icon: "⚡", color: "#fbbf24" },
    { id: "object",      name: "Object",      controller: "The Collector", icon: "📦", color: "#60a5fa" },
    { id: "tool",        name: "Tool",        controller: "The Engineer",  icon: "🔧", color: "#a78bfa" },
  ],

  /* Simple physical interactions (Blow and Shake are the Day 2-3 test ones). */
  ACTIONS: [
    { id: "blow",  name: "Blow",  icon: "💨" },
    { id: "shake", name: "Shake", icon: "📳" },
    { id: "press", name: "Press", icon: "👆" },
    { id: "tilt",  name: "Tilt",  icon: "📐" },
  ],
};

function roleById(id) {
  return DECIDER.ROLES.find(function (r) { return r.id === id; });
}

function actionById(id) {
  return DECIDER.ACTIONS.find(function (a) { return a.id === id; });
}

/* Create a message channel between the screen tab and the player tabs. */
function createChannel(onMessage) {
  if (typeof BroadcastChannel !== "undefined") {
    var ch = new BroadcastChannel(DECIDER.CHANNEL);
    ch.onmessage = function (e) { onMessage(e.data); };
    return {
      send: function (msg) { ch.postMessage(msg); },
      close: function () { ch.close(); },
    };
  }

  /* Fallback for very old browsers: localStorage + storage events
   * (still works across tabs of the same browser). */
  window.addEventListener("storage", function (e) {
    if (e.key === DECIDER.STORAGE_FALLBACK_KEY && e.newValue) {
      try {
        onMessage(JSON.parse(e.newValue).d);
      } catch (err) { /* ignore broken messages */ }
    }
  });
  return {
    send: function (msg) {
      localStorage.setItem(
        DECIDER.STORAGE_FALLBACK_KEY,
        JSON.stringify({ t: Date.now(), d: msg })
      );
      localStorage.removeItem(DECIDER.STORAGE_FALLBACK_KEY);
    },
    close: function () {},
  };
}

/* Stable id for this tab (sessionStorage = per tab). */
function getPlayerId() {
  var id = sessionStorage.getItem(DECIDER.PLAYER_ID_KEY);
  if (!id) {
    id = "p-" + Math.random().toString(36).slice(2, 9);
    sessionStorage.setItem(DECIDER.PLAYER_ID_KEY, id);
  }
  return id;
}

/* Escape text before putting it into HTML. */
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
