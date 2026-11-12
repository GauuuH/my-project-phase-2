/* DECIDER - Objects & Tools (independent layer next to the character)
 *
 * Pizza, Football, Umbrella, Hammer, Flashlight, Phone (or None).
 * Only one item is shown at a time. The item is its own <img> layer
 * above the character animation, keeping its original aspect ratio
 * and transparency.
 *
 * left / top = item CENTER in % of the game area (the image is
 * centered on that point). height = item height in % of the game
 * area height; width follows the image's own aspect ratio.
 */

var ITEM_CONFIG = {
  none: { height: 0 },
  pizza:      { file: "../assets/items/pizza.png",      height: 10, left: 56.5, top: 50 },
  football:   { file: "../assets/items/football.png",   height: 10, left: 56.5, top: 50 },
  umbrella:   { file: "../assets/items/umbrella.png",   height: 14, left: 56.5, top: 50 },
  hammer:     { file: "../assets/items/hammer.png",     height: 10, left: 56.5, top: 50 },
  flashlight: { file: "../assets/items/flashlight.png", height: 10, left: 56.5, top: 50 },
  phone:      { file: "../assets/items/phone.png",      height: 10, left: 56.5, top: 50 },
};

var itemImg = document.getElementById("item");
var currentItem = "none";

function showItem(id) {
  if (!ITEM_CONFIG[id]) return;
  currentItem = id;
  var cfg = ITEM_CONFIG[id];

  if (id === "none" || cfg.height === 0) {
    itemImg.style.display = "none";
    itemImg.removeAttribute("src");
  } else {
    itemImg.src = cfg.file;
    itemImg.style.height = cfg.height + "%";
    itemImg.style.left = cfg.left + "%";
    itemImg.style.top = cfg.top + "%";
    itemImg.style.display = "block";
  }

  highlightItemButton(id);
  console.log("[Item] " + id);
}

function getCurrentItem() { return currentItem; }

function highlightItemButton(id) {
  var btns = document.querySelectorAll(".item-btn");
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle("active", btns[i].getAttribute("data-item") === id);
  }
}

/* wire up the Object/Tool Test Panel */
var itemBtns = document.querySelectorAll(".item-btn");
for (var i = 0; i < itemBtns.length; i++) {
  itemBtns[i].onclick = function () {
    showItem(this.getAttribute("data-item"));
  };
}

/* start with nothing */
showItem("none");
