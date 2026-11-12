/* DECIDER - Items (character-relative layer)
 *
 * Pizza, Football, Umbrella, Hammer, Flashlight, Phone (or None).
 * Only one item is shown at a time. The item is its own <img> layer
 * above the character animation, keeping its original aspect ratio
 * and transparency.
 *
 * Items are NOT fixed to world coordinates: their position is derived
 * from the character's current world position (characterWorldX/Y in
 * js/animations.js) plus a per-anchor offset. updateItemFollow() is
 * called on every frame of the character movement, so the item always
 * moves together with the character.
 */

var ITEM_CONFIG = {
  none: { height: 0 },
  pizza:      { file: "../assets/items/pizza.png",      height: 10, anchor: "mouth" },
  football:   { file: "../assets/items/football.png",   height: 10, anchor: "feet" },
  umbrella:   { file: "../assets/items/umbrella.png",   height: 14, anchor: "hand" },
  hammer:     { file: "../assets/items/hammer.png",     height: 10, anchor: "hand" },
  flashlight: { file: "../assets/items/flashlight.png", height: 10, anchor: "hand" },
  phone:      { file: "../assets/items/phone.png",      height: 10, anchor: "hand" },
};

/* Anchor offsets vs the character position (characterWorldX = body
 * center, characterWorldY = feet), in % of the game area. Easy to
 * tune - the item layer is centered on that point. */
var ITEM_ANCHORS = {
  hand:  { dx: 6.5, dy: -12 },  /* right side of the body, near the hand */
  mouth: { dx: 3,   dy: -19 },  /* in front of the face */
  feet:  { dx: 5,   dy: -3 },   /* on the ground next to the feet */
};

var itemImg = document.getElementById("item");
var currentItem = "none";
var itemFollows = false;

function showItem(id) {
  if (!ITEM_CONFIG[id]) return;
  currentItem = id;
  var cfg = ITEM_CONFIG[id];

  if (id === "none" || cfg.height === 0) {
    itemImg.style.display = "none";
    itemImg.removeAttribute("src");
    itemFollows = false;
  } else {
    itemImg.src = cfg.file;
    itemImg.style.height = cfg.height + "%";
    itemImg.style.display = "block";
    itemFollows = !!cfg.anchor;
    updateItemFollow();
  }

  highlightItemButton(id);
  console.log("[Item] " + id);
}

function getCurrentItem() { return currentItem; }

/* Position the item relative to the character's current world
 * position. Called by js/animations.js on every frame of the
 * character movement, and whenever the item changes. */
function updateItemFollow() {
  if (!itemFollows || currentItem === "none") return;
  var anchor = ITEM_ANCHORS[ITEM_CONFIG[currentItem].anchor];
  if (!anchor) return;
  itemImg.style.left = (characterWorldX + anchor.dx) + "%";
  itemImg.style.top = (characterWorldY + anchor.dy) + "%";
}

function highlightItemButton(id) {
  var btns = document.querySelectorAll(".item-btn");
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle("active", btns[i].getAttribute("data-item") === id);
  }
}

/* wire up the Item Test Panel */
var itemBtns = document.querySelectorAll(".item-btn");
for (var i = 0; i < itemBtns.length; i++) {
  itemBtns[i].onclick = function () {
    showItem(this.getAttribute("data-item"));
  };
}

/* start with nothing */
showItem("none");
