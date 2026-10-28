// P0-20 live connection demo for the static design preview: two cards, a curved
// edge snapped to invisible side-midpoint anchors (P0-23/P0-25) and preview-only
// zoom controls (P0-24). P0-26 adds the preview-only toolbar selection state and
// P0-27 the DE/EN locale controller (locale JSON over HTTP, no build step) and
// P0-28/P0-29 the zone detach, collapse and re-grouping interaction, P0-30 the
// placement-driven orientation, reorder/swap and release-commit drag model and
// P0-31 the live release preview (landing slot, room-making, shrinking and ghost
// frames) with one calm settle curve.
// Plain DOM, pointer events and one SVG path: no dependencies, no engine, no data.
// Card positions, edge anchors and zoom maths use the world layer, which equals
// the demo surface on desktop and is the grid row below the toolbar strip in the
// compact layout.

(function () {
  "use strict";

  var DRAG_THRESHOLD_FALLBACK = 4;
  var CANVAS_GRID_FALLBACK = 16;
  // Invisible anchor geometry: the anchor points sit 4 px inside the card edge
  // (they are not rendered as elements).
  var ANCHOR_HALF = 4;
  var MIN_EDGE_LENGTH = 1;
  var CURVE_OFFSET_FALLBACK = 48;
  var ZOOM_MIN = 0.5;
  var ZOOM_MAX = 1.5;
  var ZOOM_STEP = 0.1;
  var SCALE_PRECISION = 10;
  // Zone interaction (P0-28 … P0-31). Distances are screen pixels, so the
  // behaviour is the same at every zoom level. A drag enters the zone when the
  // pointer is over the frame that is shown or the item covers 25 % of it, and
  // leaves once the pointer is more than the catch margin outside the previewed
  // frame; that band is both the hysteresis and the ramp of the lift look. Two
  // free items group on release when they overlap by at least 20 % of the
  // smaller area or the pointer is within 16 px of the other item. The
  // orientation dominance ratio, the overlap rule (offsets under half an item
  // keep the orientation) and the order band keep diagonal, stacked-on-top or
  // midpoint drops from flapping.
  var ZONE_CATCH_MARGIN = 24;
  var ZONE_ENTER_OVERLAP = 0.25;
  var ZONE_GROUP_OVERLAP = 0.2;
  var ZONE_GROUP_MARGIN = 16;
  var ZONE_ORIENTATION_DOMINANCE = 1.25;
  var ZONE_ORIENTATION_OVERLAP = 0.5;
  var ZONE_ORDER_HYSTERESIS = 12;
  // A zone name is one line of at most 40 characters (P0-32).
  var ZONE_TITLE_MAX = 40;

  var LOCALE_STORAGE_KEY = "preview-locale";
  var LOCALE_DEFAULT = "en";
  var LOCALE_LANGUAGES = ["en", "de"];
  var LOCALE_ASSET_QUERY = "v";
  // English fallbacks for the status strings when the locale file cannot be loaded.
  var STATUS_FALLBACK = {
    "demo.status.card": "Card {label} at column {column}, row {row}.",
    "demo.status.zoom": "Zoom {percent} percent.",
    "demo.status.reset": "Both cards returned to their start positions.",
    "demo.status.tool": "Tool {label} selected. Preview only: no canvas action.",
    "demo.status.detached": "{item} detached — free on the canvas.",
    "demo.status.docked": "{item} docked back in the zone.",
    "demo.item.notepad": "Notepad",
    "demo.item.window": "Image window",
    "demo.status.zoneHidden": "Zone hidden — drag the two items together to form a new zone.",
    "demo.status.zoneShown": "Zone back — an item is docked in it again.",
    "demo.status.groupedHorizontal": "Items grouped side by side into a new zone.",
    "demo.status.groupedVertical": "Items grouped stacked into a new zone.",
    "demo.status.reordered": "Order changed inside the zone.",
    "demo.status.orientationChanged": "Orientation changed inside the zone.",
    "demo.status.zoneRenamed": "Zone renamed to “{name}”.",
    "demo.status.zoneNameReset": "Zone name reset to “{name}”.",
    "demo.zone.nameInitial": "Lake trip",
    "demo.zone.nameNew": "New zone",
    "demo.zone.nameLabel": "Zone name, click to rename",
    "demo.sheet.sumFunction": "SUM",
    "demo.status.zoneMoved": "Zone moved.",
    "demo.status.resized": "Size changed.",
    "demo.status.checklistCount": "{done} of {total} done",
    "demo.status.checklistDone": "\u201c{item}\u201d done \u2014 {done} of {total}.",
    "demo.status.checklistOpen": "\u201c{item}\u201d open again \u2014 {done} of {total}.",
  };
  var localeMessages = null;
  // Called after a locale was applied, for text the script owns (zone names).
  var localeListeners = [];
  // Language whose messages are currently applied; null means the page shows the
  // English markup fallback only. Never change the switch without changing this.
  var appliedLocale = null;

  // The bundled script URL carries the cache-busting version (?v=P0-27); the
  // locale files use the same query so a bump never serves stale translations.
  function readAssetVersion() {
    var script = document.currentScript;
    if (!(script instanceof HTMLScriptElement) || script.src === "") return "";
    try {
      return new URL(script.src).searchParams.get(LOCALE_ASSET_QUERY) || "";
    } catch (error) {
      return "";
    }
  }

  var assetVersion = readAssetVersion();

  function interpolate(text, params) {
    return text.replace(/\{(\w+)\}/g, function (match, name) {
      return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match;
    });
  }

  // Translated status text for the demo; falls back to English when no locale
  // file is available (the static text then keeps its English fallback markup).
  function translate(key, params) {
    var text = null;
    if (localeMessages !== null && typeof localeMessages[key] === "string") {
      text = localeMessages[key];
    } else if (typeof STATUS_FALLBACK[key] === "string") {
      text = STATUS_FALLBACK[key];
    }
    if (text === null) return "";
    return interpolate(text, params || {});
  }

  function applyLocale(messages, lang) {
    document.documentElement.lang = lang;
    var texts = document.querySelectorAll("[data-i18n]");
    for (var t = 0; t < texts.length; t += 1) {
      var textKey = texts[t].getAttribute("data-i18n");
      if (typeof messages[textKey] === "string") texts[t].textContent = messages[textKey];
    }
    var htmlNodes = document.querySelectorAll("[data-i18n-html]");
    for (var h = 0; h < htmlNodes.length; h += 1) {
      var htmlKey = htmlNodes[h].getAttribute("data-i18n-html");
      if (typeof messages[htmlKey] === "string") htmlNodes[h].innerHTML = messages[htmlKey];
    }
    var attributeNodes = document.querySelectorAll("[data-i18n-attr]");
    for (var a = 0; a < attributeNodes.length; a += 1) {
      var spec = attributeNodes[a].getAttribute("data-i18n-attr") || "";
      var entries = spec.split(/\s+/);
      for (var e = 0; e < entries.length; e += 1) {
        var parts = entries[e].split(":");
        var attribute = parts[0];
        var attributeKey = parts[1] || attributeNodes[a].getAttribute("data-i18n");
        if (attribute !== "" && attributeKey && typeof messages[attributeKey] === "string") {
          attributeNodes[a].setAttribute(attribute, messages[attributeKey]);
        }
      }
    }
    for (var l = 0; l < localeListeners.length; l += 1) localeListeners[l]();
  }

  function updateLocaleSwitch(lang) {
    var options = document.querySelectorAll("[data-preview-locale]");
    for (var o = 0; o < options.length; o += 1) {
      var active = options[o].getAttribute("data-preview-locale") === lang;
      options[o].setAttribute("aria-pressed", active ? "true" : "false");
    }
  }

  function readStoredLocale() {
    try {
      var value = window.localStorage.getItem(LOCALE_STORAGE_KEY);
      return typeof value === "string" ? value : null;
    } catch (error) {
      return null;
    }
  }

  function storeLocale(lang) {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, lang);
    } catch (error) {
      // Storage can be unavailable (private mode, file://); the switch still works.
    }
  }

  function localeUrl(lang) {
    var query = assetVersion === "" ? "" : "?" + LOCALE_ASSET_QUERY + "=" + encodeURIComponent(assetVersion);
    return "locales/" + lang + ".json" + query;
  }

  function fetchLocale(lang) {
    return window.fetch(localeUrl(lang)).then(function (response) {
      if (!response.ok) throw new Error("locale " + lang + ": HTTP " + response.status);
      return response.json();
    });
  }

  function clearStatus() {
    var status = document.querySelector("[data-demo-status]");
    if (status !== null) status.textContent = "";
  }

  function markEnglishFallback() {
    localeMessages = null;
    appliedLocale = null;
    document.documentElement.lang = LOCALE_DEFAULT;
    updateLocaleSwitch(LOCALE_DEFAULT);
  }

  function activateLocale(lang, persist) {
    if (LOCALE_LANGUAGES.indexOf(lang) === -1) lang = LOCALE_DEFAULT;
    if (appliedLocale === lang) {
      if (persist) storeLocale(lang);
      return Promise.resolve(lang);
    }
    return fetchLocale(lang)
      .then(function (messages) {
        localeMessages = messages;
        appliedLocale = lang;
        applyLocale(messages, lang);
        updateLocaleSwitch(lang);
        if (persist) storeLocale(lang);
        clearStatus();
        return lang;
      })
      .catch(function () {
        // A failed load keeps the language and the toggle state that are really
        // applied; the switch never flips on its own.
        if (appliedLocale !== null) return appliedLocale;
        if (lang === LOCALE_DEFAULT) {
          markEnglishFallback();
          return LOCALE_DEFAULT;
        }
        // Nothing was applied yet: settle on the English markup fallback once.
        return fetchLocale(LOCALE_DEFAULT)
          .then(function (messages) {
            localeMessages = messages;
            appliedLocale = LOCALE_DEFAULT;
            applyLocale(messages, LOCALE_DEFAULT);
            updateLocaleSwitch(LOCALE_DEFAULT);
            return LOCALE_DEFAULT;
          })
          .catch(function () {
            markEnglishFallback();
            return LOCALE_DEFAULT;
          });
      });
  }

  function setupLocaleSwitcher() {
    var group = document.querySelector("[data-preview-locale-group]");
    if (group === null) return;
    var options = group.querySelectorAll("[data-preview-locale]");
    for (var o = 0; o < options.length; o += 1) {
      (function (option) {
        option.addEventListener("click", function () {
          var lang = option.getAttribute("data-preview-locale");
          if (lang !== null) activateLocale(lang, true);
        });
      })(options[o]);
    }
  }

  function readPixelToken(name, fallback) {
    var value = getComputedStyle(document.documentElement).getPropertyValue(name);
    var parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  // Visible connection anchors sit at the four side midpoints of a card; the
  // demo edge connects the nearest anchor pair, comparing all 4 x 4 pairs.
  function anchorPoints(rect) {
    return [
      { side: "top", x: rect.x + rect.w / 2, y: rect.y + ANCHOR_HALF },
      { side: "right", x: rect.x + rect.w - ANCHOR_HALF, y: rect.y + rect.h / 2 },
      { side: "bottom", x: rect.x + rect.w / 2, y: rect.y + rect.h - ANCHOR_HALF },
      { side: "left", x: rect.x + ANCHOR_HALF, y: rect.y + rect.h / 2 },
    ];
  }

  function nearestAnchorPair(a, b) {
    var pointsA = anchorPoints(a);
    var pointsB = anchorPoints(b);
    var best = null;
    for (var i = 0; i < pointsA.length; i += 1) {
      for (var j = 0; j < pointsB.length; j += 1) {
        var dx = pointsB[j].x - pointsA[i].x;
        var dy = pointsB[j].y - pointsA[i].y;
        var distance = dx * dx + dy * dy;
        if (best === null || distance < best.distance) {
          best = { distance: distance, a: pointsA[i], b: pointsB[j] };
        }
      }
    }
    return { a: best.a, b: best.b };
  }

  function normalFor(side) {
    if (side === "top") return { x: 0, y: -1 };
    if (side === "right") return { x: 1, y: 0 };
    if (side === "bottom") return { x: 0, y: 1 };
    return { x: -1, y: 0 };
  }

  function roundScale(value) {
    return Math.round(value * SCALE_PRECISION) / SCALE_PRECISION;
  }

  function format(value) {
    return value.toFixed(1);
  }

  function setupDemo(demo) {
    var surface = demo.querySelector("[data-demo-surface]");
    var world = demo.querySelector("[data-demo-world]");
    var edge = demo.querySelector("[data-demo-edge]");
    if (surface === null || world === null || edge === null) return;

    var edgePath = edge.querySelector("[data-demo-edge-path]");
    var edgeDots = edge.querySelectorAll("[data-demo-edge-dot]");
    var status = demo.querySelector("[data-demo-status]");
    var zoomIn = demo.querySelector("[data-demo-zoom-in]");
    var zoomOut = demo.querySelector("[data-demo-zoom-out]");
    var zoomFit = demo.querySelector("[data-demo-zoom-fit]");
    if (edgePath === null || edgeDots.length < 2) return;
    if (zoomIn === null || zoomOut === null || zoomFit === null) return;

    var grid = readPixelToken("--canvas-grid", CANVAS_GRID_FALLBACK);
    var zoneBorderWidth = readPixelToken("--border-width", 1);
    var threshold = readPixelToken("--drag-threshold", DRAG_THRESHOLD_FALLBACK);
    var curveOffset = readPixelToken("--space-48", CURVE_OFFSET_FALLBACK);
    var cards = [];
    var activePointer = null;
    var scale = 1;
    var resizePending = false;
    // World size of the previous layout pass; a resize moves every object by the
    // same ratio (centre-relative), so nothing keeps a stale narrow position.
    var worldSize = null;

    var cardElements = surface.querySelectorAll("[data-demo-card]");
    for (var index = 0; index < cardElements.length; index += 1) {
      var element = cardElements[index];
      if (!(element instanceof HTMLElement)) continue;
      cards.push({
        element: element,
        label: (element.getAttribute("data-demo-card") || "?").toUpperCase(),
        x: 0,
        y: 0,
        homeX: 0,
        homeY: 0,
      });
    }
    if (cards.length < 2) return;

    function snap(value) {
      return Math.round(value / grid) * grid;
    }

    function limitsFor(card) {
      return {
        x: Math.max(0, world.clientWidth - card.element.offsetWidth),
        y: Math.max(0, world.clientHeight - card.element.offsetHeight),
      };
    }

    function homeFor(card, shareX, shareY) {
      var limits = limitsFor(card);
      return {
        x: clamp(snap(limits.x * shareX), 0, limits.x),
        y: clamp(snap(limits.y * shareY), 0, limits.y),
      };
    }

    function clampCard(card) {
      var limits = limitsFor(card);
      card.x = clamp(card.x, 0, limits.x);
      card.y = clamp(card.y, 0, limits.y);
    }

    function rescaleCard(card, ratioX, ratioY) {
      var width = card.element.offsetWidth;
      var height = card.element.offsetHeight;
      card.x = (card.x + width / 2) * ratioX - width / 2;
      card.y = (card.y + height / 2) * ratioY - height / 2;
    }

    function place(card) {
      card.element.style.transform =
        "translate3d(" + card.x.toFixed(1) + "px, " + card.y.toFixed(1) + "px, 0)";
    }

    function rectOf(card) {
      return {
        x: card.x,
        y: card.y,
        w: card.element.offsetWidth,
        h: card.element.offsetHeight,
      };
    }

    function drawEdge() {
      var pair = nearestAnchorPair(rectOf(cards[0]), rectOf(cards[1]));
      var start = pair.a;
      var end = pair.b;
      var startNormal = normalFor(start.side);
      var endNormal = normalFor(end.side);
      var deltaX = end.x - start.x;
      var deltaY = end.y - start.y;
      if (Math.hypot(deltaX, deltaY) < MIN_EDGE_LENGTH) {
        end = {
          side: end.side,
          x: start.x + startNormal.x * MIN_EDGE_LENGTH,
          y: start.y + startNormal.y * MIN_EDGE_LENGTH,
        };
        endNormal = startNormal;
      }
      var controlA = {
        x: start.x + startNormal.x * curveOffset,
        y: start.y + startNormal.y * curveOffset,
      };
      var controlB = {
        x: end.x + endNormal.x * curveOffset,
        y: end.y + endNormal.y * curveOffset,
      };
      edge.setAttribute(
        "viewBox",
        "0 0 " + world.clientWidth + " " + world.clientHeight,
      );
      edgePath.setAttribute(
        "d",
        "M " + format(start.x) + " " + format(start.y) +
          " C " + format(controlA.x) + " " + format(controlA.y) +
          ", " + format(controlB.x) + " " + format(controlB.y) +
          ", " + format(end.x) + " " + format(end.y),
      );
      edgeDots[0].setAttribute("cx", format(start.x));
      edgeDots[0].setAttribute("cy", format(start.y));
      edgeDots[1].setAttribute("cx", format(end.x));
      edgeDots[1].setAttribute("cy", format(end.y));
      cards[0].element.setAttribute("data-demo-used", pair.a.side);
      cards[1].element.setAttribute("data-demo-used", pair.b.side);
    }

    function announce(card) {
      if (status === null) return;
      var column = Math.round(card.x / grid) + 1;
      var row = Math.round(card.y / grid) + 1;
      status.textContent = translate("demo.status.card", {
        label: card.label,
        column: column,
        row: row,
      });
    }

    function announceZoom() {
      if (status === null) return;
      status.textContent = translate("demo.status.zoom", {
        percent: Math.round(scale * 100),
      });
    }

    function applyZoom() {
      world.style.transform = "scale(" + scale + ")";
      surface.setAttribute("data-demo-scale", scale.toFixed(2));
      zoomIn.disabled = scale >= ZOOM_MAX - 1e-9;
      zoomOut.disabled = scale <= ZOOM_MIN + 1e-9;
    }

    function setScale(next) {
      scale = clamp(roundScale(next), ZOOM_MIN, ZOOM_MAX);
      applyZoom();
      announceZoom();
    }

    function zoomBy(direction) {
      setScale(scale + direction * ZOOM_STEP);
    }

    function fitView() {
      setScale(1);
    }

    function select(card) {
      for (var i = 0; i < cards.length; i += 1) {
        cards[i].element.classList.toggle("is-selected", cards[i] === card);
      }
    }

    function layout() {
      var width = world.clientWidth;
      var height = world.clientHeight;
      var ratioX = 1;
      var ratioY = 1;
      if (worldSize !== null && worldSize.w > 0 && worldSize.h > 0) {
        ratioX = width / worldSize.w;
        ratioY = height / worldSize.h;
      }
      worldSize = { w: width, h: height };
      var homeA = homeFor(cards[0], 0.04, 0.05);
      var homeB = homeFor(cards[1], 0.9, 0.9);
      cards[0].homeX = homeA.x;
      cards[0].homeY = homeA.y;
      cards[1].homeX = homeB.x;
      cards[1].homeY = homeB.y;
      if (!demo.classList.contains("is-ready")) {
        cards[0].x = homeA.x;
        cards[0].y = homeA.y;
        cards[1].x = homeB.x;
        cards[1].y = homeB.y;
      } else if (ratioX !== 1 || ratioY !== 1) {
        rescaleCard(cards[0], ratioX, ratioY);
        rescaleCard(cards[1], ratioX, ratioY);
      }
      clampCard(cards[0]);
      clampCard(cards[1]);
      place(cards[0]);
      place(cards[1]);
      applyZoom();
      drawEdge();
      layoutBlocks(ratioX, ratioY);
      if (zoneReady) syncZoneGeometry(ratioX, ratioY);
      else initZone();
      demo.classList.add("is-ready");
    }

    function resetAll() {
      for (var i = 0; i < cards.length; i += 1) {
        cards[i].x = cards[i].homeX;
        cards[i].y = cards[i].homeY;
        clampCard(cards[i]);
        place(cards[i]);
      }
      drawEdge();
      if (status !== null) status.textContent = translate("demo.status.reset");
    }

    function onPointerDown(card, event) {
      if (activePointer !== null) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      var target = event.target;
      if (target instanceof Element && target.closest("button, a, input, textarea, select")) {
        return;
      }
      event.preventDefault();
      select(card);
      activePointer = {
        pointerId: event.pointerId,
        card: card,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: card.x,
        startY: card.y,
        dragging: false,
      };
      try {
        card.element.setPointerCapture(event.pointerId);
      } catch (error) {
        // Pointer capture is best effort; the drag keeps working without it.
      }
    }

    function onPointerMove(card, event) {
      if (activePointer === null) return;
      if (activePointer.pointerId !== event.pointerId || activePointer.card !== card) return;
      var screenX = event.clientX - activePointer.startClientX;
      var screenY = event.clientY - activePointer.startClientY;
      if (!activePointer.dragging) {
        if (Math.hypot(screenX, screenY) < threshold) return;
        activePointer.dragging = true;
        card.element.classList.add("is-dragging");
      }
      // Pointer deltas are screen pixels; the card lives on the scaled world layer.
      card.x = activePointer.startX + screenX / scale;
      card.y = activePointer.startY + screenY / scale;
      clampCard(card);
      place(card);
      drawEdge();
    }

    function onPointerEnd(card, event) {
      if (activePointer === null) return;
      if (activePointer.pointerId !== event.pointerId || activePointer.card !== card) return;
      var moved = activePointer.dragging;
      activePointer = null;
      card.element.classList.remove("is-dragging");
      drawEdge();
      if (moved) announce(card);
    }

    function onKeyDown(card, event) {
      var handled = true;
      if (event.key === "ArrowLeft") {
        card.x -= grid;
      } else if (event.key === "ArrowRight") {
        card.x += grid;
      } else if (event.key === "ArrowUp") {
        card.y -= grid;
      } else if (event.key === "ArrowDown") {
        card.y += grid;
      } else if (event.key === "Home") {
        resetAll();
      } else {
        handled = false;
      }
      if (!handled) return;
      event.preventDefault();
      if (event.key !== "Home") {
        select(card);
        clampCard(card);
        place(card);
        drawEdge();
        announce(card);
      }
    }

    cards.forEach(function (card) {
      card.element.addEventListener("pointerdown", function (event) {
        onPointerDown(card, event);
      });
      card.element.addEventListener("pointermove", function (event) {
        onPointerMove(card, event);
      });
      card.element.addEventListener("pointerup", function (event) {
        onPointerEnd(card, event);
      });
      card.element.addEventListener("pointercancel", function (event) {
        onPointerEnd(card, event);
      });
      card.element.addEventListener("keydown", function (event) {
        onKeyDown(card, event);
      });
    });

    // ---------- checklist block and spreadsheet card (P0-33) ----------
    //
    // Both are blocks on the canvas: positioned like the note cards (home as a
    // share of the free world space, rescaled on resize), dragged 1:1 after the
    // 4 px threshold, the last touched block raised above the other blocks.
    // A drag never starts on a checkbox or its label, and a press without
    // movement is a click (toggle a checkbox, select a cell), so pointer capture
    // is only taken once a drag really starts.

    var blocks = [];
    var blockPointer = null;
    var blockElements = world.querySelectorAll("[data-demo-block]");
    for (var blockIndex = 0; blockIndex < blockElements.length; blockIndex += 1) {
      var blockElement = blockElements[blockIndex];
      if (!(blockElement instanceof HTMLElement)) continue;
      var shares = (blockElement.getAttribute("data-home") || "0,0").split(",");
      var compactShares = (blockElement.getAttribute("data-home-compact") || shares.join(",")).split(",");
      blocks.push({
        element: blockElement,
        shareX: clamp(parseFloat(shares[0]) || 0, 0, 1),
        shareY: clamp(parseFloat(shares[1]) || 0, 0, 1),
        compactShareX: clamp(parseFloat(compactShares[0]) || 0, 0, 1),
        compactShareY: clamp(parseFloat(compactShares[1]) || 0, 0, 1),
        x: 0,
        y: 0,
        placed: false,
      });
    }

    function layoutBlocks(ratioX, ratioY) {
      for (var index = 0; index < blocks.length; index += 1) {
        var block = blocks[index];
        if (!block.placed) {
          // The compact layout (toolbar row above a tall world, the same 900 px
          // breakpoint as preview.css) stacks the blocks between the notes and
          // the zone instead of beside them.
          var compact = typeof window.matchMedia === "function" &&
            window.matchMedia("(max-width: 900px)").matches;
          var home = compact
            ? homeFor(block, block.compactShareX, block.compactShareY)
            : homeFor(block, block.shareX, block.shareY);
          block.x = home.x;
          block.y = home.y;
          block.placed = true;
        } else if (ratioX !== 1 || ratioY !== 1) {
          rescaleCard(block, ratioX, ratioY);
        }
        clampCard(block);
        place(block);
      }
    }

    function raiseBlock(block) {
      for (var index = 0; index < blocks.length; index += 1) {
        blocks[index].element.classList.toggle("is-raised", blocks[index] === block);
      }
    }

    function onBlockPointerDown(block, event) {
      if (blockPointer !== null || activePointer !== null) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      var target = event.target;
      if (target instanceof Element && target.closest("input, label, button, a, textarea, select")) {
        raiseBlock(block);
        return;
      }
      raiseBlock(block);
      blockPointer = {
        pointerId: event.pointerId,
        block: block,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: block.x,
        startY: block.y,
        dragging: false,
      };
    }

    function onBlockPointerMove(block, event) {
      var drag = blockPointer;
      if (drag === null || drag.block !== block || drag.pointerId !== event.pointerId) return;
      var screenX = event.clientX - drag.startClientX;
      var screenY = event.clientY - drag.startClientY;
      if (!drag.dragging) {
        if (Math.hypot(screenX, screenY) < threshold) return;
        drag.dragging = true;
        block.element.classList.add("is-dragging");
        try {
          block.element.setPointerCapture(event.pointerId);
        } catch (error) {
          // Pointer capture is best effort; the drag keeps working without it.
        }
      }
      event.preventDefault();
      block.x = drag.startX + screenX / scale;
      block.y = drag.startY + screenY / scale;
      clampCard(block);
      place(block);
    }

    function onBlockPointerEnd(block, event) {
      var drag = blockPointer;
      if (drag === null || drag.block !== block || drag.pointerId !== event.pointerId) return;
      blockPointer = null;
      if (!drag.dragging) return;
      block.element.classList.remove("is-dragging");
      // A drag must not end in a click on whatever lies under the pointer.
      block.suppressClick = true;
      window.setTimeout(function () {
        block.suppressClick = false;
      }, 0);
    }

    blocks.forEach(function (block) {
      block.element.addEventListener("pointerdown", function (event) {
        onBlockPointerDown(block, event);
      });
      block.element.addEventListener("pointermove", function (event) {
        onBlockPointerMove(block, event);
      });
      block.element.addEventListener("pointerup", function (event) {
        onBlockPointerEnd(block, event);
      });
      block.element.addEventListener("pointercancel", function (event) {
        onBlockPointerEnd(block, event);
      });
      block.element.addEventListener(
        "click",
        function (event) {
          if (block.suppressClick) {
            event.preventDefault();
            event.stopPropagation();
          }
        },
        true,
      );
    });

    // Checklist: the counter and the status line follow every toggle.
    var checklist = world.querySelector('[data-demo-block="checklist"]');
    var checklistCount = checklist === null ? null : checklist.querySelector("[data-checklist-count]");
    var checklistItems = checklist === null ? [] : checklist.querySelectorAll("[data-checklist-item]");

    function checklistDone() {
      var done = 0;
      for (var index = 0; index < checklistItems.length; index += 1) {
        if (checklistItems[index].checked) done += 1;
      }
      return done;
    }

    function updateChecklistCount() {
      if (checklistCount === null) return;
      var done = checklistDone();
      checklistCount.textContent = done + "/" + checklistItems.length;
      checklistCount.setAttribute(
        "aria-label",
        translate("demo.status.checklistCount", { done: done, total: checklistItems.length }),
      );
    }

    for (var itemIndex = 0; itemIndex < checklistItems.length; itemIndex += 1) {
      checklistItems[itemIndex].addEventListener("change", function (event) {
        var box = event.currentTarget;
        updateChecklistCount();
        if (status === null || !(box instanceof HTMLInputElement)) return;
        var label = box.closest("label");
        status.textContent = translate(box.checked ? "demo.status.checklistDone" : "demo.status.checklistOpen", {
          item: label === null ? "" : label.textContent.trim(),
          done: checklistDone(),
          total: checklistItems.length,
        });
      });
    }
    updateChecklistCount();
    localeListeners.push(updateChecklistCount);

    // Spreadsheet: totals are computed from the rows (D = B × C, D6 = SUM),
    // a click or the arrow keys select a cell and the formula bar shows its
    // reference and its formula (localised function name) or value.
    var sheet = world.querySelector("[data-sheet]");
    var sheetRef = world.querySelector("[data-sheet-ref]");
    var sheetValue = world.querySelector("[data-sheet-value]");
    var sheetCells = sheet === null ? [] : sheet.querySelectorAll("[data-cell]");
    var activeCell = null;

    function cellAt(reference) {
      return sheet === null ? null : sheet.querySelector('[data-cell="' + reference + '"]');
    }

    function numberIn(reference) {
      var cell = cellAt(reference);
      var value = cell === null ? NaN : parseFloat(cell.textContent);
      return Number.isFinite(value) ? value : 0;
    }

    function computeSheet() {
      var sum = 0;
      for (var row = 2; row <= 5; row += 1) {
        var total = numberIn("B" + row) * numberIn("C" + row);
        var totalCell = cellAt("D" + row);
        if (totalCell !== null) totalCell.textContent = total.toFixed(2);
        sum += total;
      }
      var sumCell = cellAt("D6");
      if (sumCell !== null) sumCell.textContent = sum.toFixed(2);
    }

    function formulaText(cell) {
      var formula = cell.getAttribute("data-formula");
      if (formula === null) return cell.textContent.trim();
      return formula.replace("SUM(", translate("demo.sheet.sumFunction") + "(");
    }

    function selectCell(cell, focus) {
      if (!(cell instanceof HTMLElement)) return;
      for (var index = 0; index < sheetCells.length; index += 1) {
        var each = sheetCells[index];
        var active = each === cell;
        each.classList.toggle("is-active", active);
        each.setAttribute("aria-selected", active ? "true" : "false");
        each.setAttribute("tabindex", active ? "0" : "-1");
      }
      activeCell = cell;
      var reference = cell.getAttribute("data-cell") || "";
      if (sheetRef !== null) sheetRef.textContent = reference;
      if (sheetValue !== null) sheetValue.textContent = formulaText(cell);
      if (focus) cell.focus({ preventScroll: true });
    }

    function moveSelection(columnStep, rowStep) {
      if (activeCell === null) return;
      var reference = activeCell.getAttribute("data-cell") || "A1";
      var column = clamp(reference.charCodeAt(0) - 65 + columnStep, 0, 3);
      var row = clamp(parseInt(reference.slice(1), 10) + rowStep, 1, 6);
      selectCell(cellAt(String.fromCharCode(65 + column) + row), true);
    }

    if (sheet !== null) {
      // A grid: one cell is in the tab order, the arrow keys move the selection.
      sheet.setAttribute("role", "grid");
      computeSheet();
      sheet.addEventListener("click", function (event) {
        var target = event.target;
        if (target instanceof Element) selectCell(target.closest("[data-cell]"), true);
      });
      sheet.addEventListener("keydown", function (event) {
        var steps = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        }[event.key];
        if (steps === undefined) return;
        event.preventDefault();
        moveSelection(steps[0], steps[1]);
      });
      selectCell(cellAt("D6"), false);
      localeListeners.push(function () {
        computeSheet();
        if (activeCell !== null) selectCell(activeCell, false);
      });
    }

    zoomIn.addEventListener("click", function () {
      zoomBy(1);
    });
    zoomOut.addEventListener("click", function () {
      zoomBy(-1);
    });
    zoomFit.addEventListener("click", function () {
      fitView();
    });

    // ---------- zone interaction (P0-28 … P0-31) ----------
    //
    // The zone card is only a frame drawn around its docked items; the items live
    // on the zone layer in world coordinates. While a drag is active the dragged
    // item tracks the pointer 1:1 and the zone previews what a release would do:
    // a dashed slot where the item would land (the other docked item makes room),
    // a frame that shrinks around the remaining item when one is pulled out, a
    // dimmed dashed frame when the last item leaves and a dashed ghost frame when
    // two free items would group. Only the release commits (dock, reorder,
    // orientation, detach, group, collapse). Every settle uses one ease-out curve
    // without overshoot and the frame resizes with a FLIP scale, so only
    // transform and opacity animate. No edge is ever created or moved.

    var zone = surface.querySelector("[data-demo-zone]");
    var zoneCard = zone === null ? null : zone.querySelector("[data-demo-zone-card]");
    var zoneItems = [];
    var zoneReady = false;
    var zoneDocked = [];              // committed docked keys in flow order
    var zoneOrientation = "vertical"; // requested orientation for two docked items
    var zoneOrigin = { x: 0, y: 0 };  // committed frame origin (world px)
    var zoneFrame = null;             // frame target currently shown (world px)
    var zonePlaceholder = null;
    var zoneDrag = null;
    var zonePendingSync = false;
    var zoneObserver = null;
    var zonePadding = 16;
    var zoneGap = 12;
    // Header row of the frame (L02: 40 px header, content 40 + 16 px below the
    // top) and the 24 px title box centred in it.
    var zoneHeader = 40;
    var zoneTitleHeight = 24;
    var zoneTitleInset = 4;
    var zoneTitle = zone === null ? null : zone.querySelector("[data-zone-title]");
    // The zone name: a default from the locale files (it follows the language)
    // until someone types their own, which then stays exactly as typed.
    var zoneName = { key: "demo.zone.nameInitial", custom: null };
    var zoneTitleBefore = "";
    var zoneTitleCancelled = false;

    if (zone !== null && zoneCard !== null) {
      var zoneElements = zone.querySelectorAll("[data-zone-item]");
      for (var zoneIndex = 0; zoneIndex < zoneElements.length; zoneIndex += 1) {
        var zoneElement = zoneElements[zoneIndex];
        if (!(zoneElement instanceof HTMLElement)) continue;
        zoneItems.push({
          element: zoneElement,
          key: zoneElement.getAttribute("data-zone-item") || "item",
          width: 0,
          height: 0,
          x: 0,
          y: 0,
          docked: true,
          progress: 0,
        });
      }
    }

    function zoneItemByKey(key) {
      for (var index = 0; index < zoneItems.length; index += 1) {
        if (zoneItems[index].key === key) return zoneItems[index];
      }
      return null;
    }

    function otherZoneItem(item) {
      for (var index = 0; index < zoneItems.length; index += 1) {
        if (zoneItems[index] !== item) return zoneItems[index];
      }
      return null;
    }

    function dockedWithout(item) {
      var keys = [];
      for (var index = 0; index < zoneDocked.length; index += 1) {
        if (zoneDocked[index] !== item.key) keys.push(zoneDocked[index]);
      }
      return keys;
    }

    function zoneItemLabel(item) {
      return translate("demo.item." + item.key) || item.key;
    }

    function announceZoneItem(item, detached) {
      if (status === null) return;
      status.textContent = translate(detached ? "demo.status.detached" : "demo.status.docked", {
        item: zoneItemLabel(item),
      });
    }

    function announceZoneStatus(key) {
      if (status === null) return;
      status.textContent = translate(key);
    }

    function prefersReducedMotion() {
      return typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    // Screen pixels per world pixel, read from the rendered world box so the maths
    // stays right while a zoom transition is still running.
    function worldRatio(worldBox) {
      return worldBox.width / Math.max(1, world.clientWidth);
    }

    function zoneWorldPoint(clientX, clientY) {
      var worldBox = world.getBoundingClientRect();
      var ratio = worldRatio(worldBox);
      return {
        x: (clientX - worldBox.left) / ratio,
        y: (clientY - worldBox.top) / ratio,
      };
    }

    function worldRectOf(element) {
      var worldBox = world.getBoundingClientRect();
      var ratio = worldRatio(worldBox);
      var rect = element.getBoundingClientRect();
      return {
        x: (rect.left - worldBox.left) / ratio,
        y: (rect.top - worldBox.top) / ratio,
        w: rect.width / ratio,
        h: rect.height / ratio,
      };
    }

    function screenRectOf(rect) {
      var worldBox = world.getBoundingClientRect();
      var ratio = worldRatio(worldBox);
      var left = worldBox.left + rect.x * ratio;
      var top = worldBox.top + rect.y * ratio;
      return {
        left: left,
        top: top,
        right: left + rect.w * ratio,
        bottom: top + rect.h * ratio,
        w: rect.w * ratio,
        h: rect.h * ratio,
      };
    }

    function itemRect(item) {
      return { x: item.x, y: item.y, w: item.width, h: item.height };
    }

    // Where an item stood when the drag started. Placement is always decided
    // against this rectangle, never against a preview position, so an item that
    // makes room cannot feed back into the decision and make it flap.
    function homeRect(drag, item) {
      var home = drag.home[item.key];
      return { x: home.x, y: home.y, w: item.width, h: item.height };
    }

    // Screen distance from the pointer to a world rectangle (0 when inside).
    function distanceOutside(rect, clientX, clientY) {
      var box = screenRectOf(rect);
      var dx = Math.max(box.left - clientX, 0, clientX - box.right);
      var dy = Math.max(box.top - clientY, 0, clientY - box.bottom);
      return Math.hypot(dx, dy);
    }

    function overlapFraction(a, b) {
      var width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      var height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (width <= 0 || height <= 0) return 0;
      var smaller = Math.min(a.w * a.h, b.w * b.h);
      return smaller === 0 ? 0 : (width * height) / smaller;
    }

    function smoothstep(value) {
      var t = clamp(value, 0, 1);
      return t * t * (3 - 2 * t);
    }

    function worldBounds() {
      return { x: 0, y: 0, w: world.clientWidth, h: world.clientHeight };
    }

    function clampToBounds(item, x, y, bounds) {
      var maxX = Math.max(bounds.x, bounds.x + bounds.w - item.width);
      var maxY = Math.max(bounds.y, bounds.y + bounds.h - item.height);
      return { x: clamp(x, bounds.x, maxX), y: clamp(y, bounds.y, maxY) };
    }

    // The part of the world layer that is actually visible through the surface
    // (the world is scaled inside the surface at every zoom level). A zone must
    // stay inside this rectangle, otherwise it can sit outside the visible area
    // at high zoom.
    function visibleWorldBounds() {
      var worldBox = world.getBoundingClientRect();
      var surfaceBox = surface.getBoundingClientRect();
      var ratio = worldRatio(worldBox);
      var left = (Math.max(surfaceBox.left, worldBox.left) - worldBox.left) / ratio;
      var top = (Math.max(surfaceBox.top, worldBox.top) - worldBox.top) / ratio;
      var right = (Math.min(surfaceBox.right, worldBox.right) - worldBox.left) / ratio;
      var bottom = (Math.min(surfaceBox.bottom, worldBox.bottom) - worldBox.top) / ratio;
      return { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };
    }

    // The floating toolbar is canvas chrome above the world on desktop; a zone is
    // kept below it so the two never overlap. In the compact layout the toolbar
    // sits in its own row above the world, so the clearance is zero.
    function zoneTopLimit() {
      var toolbar = surface.querySelector(".demo-toolbar");
      if (toolbar === null) return 0;
      var worldBox = world.getBoundingClientRect();
      var toolbarBox = toolbar.getBoundingClientRect();
      if (toolbarBox.bottom <= worldBox.top + 1) return 0;
      var toolbarBottom = (toolbarBox.bottom - worldBox.top) / worldRatio(worldBox);
      return Math.max(0, toolbarBottom + readPixelToken("--space-8", 8));
    }

    function zoneBounds() {
      var visible = visibleWorldBounds();
      var top = Math.max(visible.y, zoneTopLimit());
      return { x: visible.x, y: top, w: visible.w, h: Math.max(0, visible.y + visible.h - top) };
    }

    // Frame layout for docked keys in flow order: slots are item sizes plus the
    // 16 px padding and the 12 px gap, laid out side by side or stacked, below
    // the 40 px header that carries the zone name.
    function buildLayout(keys, orientation) {
      var horizontal = keys.length > 1 && orientation === "horizontal";
      var inset = zoneBorderWidth + zonePadding;
      var top = inset + zoneHeader;
      var along = 0;
      var across = 0;
      var slots = {};
      for (var index = 0; index < keys.length; index += 1) {
        var entry = zoneItemByKey(keys[index]);
        if (entry === null) continue;
        if (index > 0) along += zoneGap;
        slots[entry.key] = horizontal ? { x: inset + along, y: top } : { x: inset, y: top + along };
        along += horizontal ? entry.width : entry.height;
        across = Math.max(across, horizontal ? entry.height : entry.width);
      }
      return {
        keys: keys.slice(),
        orientation: horizontal ? "horizontal" : "vertical",
        x: 0,
        y: 0,
        w: (horizontal ? along : across) + 2 * inset,
        h: (horizontal ? across : along) + inset + top,
        slots: slots,
      };
    }

    function layoutFits(candidate) {
      var bounds = zoneBounds();
      return candidate.w <= bounds.w + 0.5 && candidate.h <= bounds.h + 0.5;
    }

    // Requested orientation when it fits below the toolbar, otherwise the other
    // one (side by side falls back to stacked at 390 px and returns when the
    // surface gets wider again). The requested value itself is kept.
    function fittedLayout(keys, orientation) {
      var requested = buildLayout(keys, orientation);
      if (keys.length < 2 || layoutFits(requested)) return requested;
      var fallback = buildLayout(keys, orientation === "horizontal" ? "vertical" : "horizontal");
      return layoutFits(fallback) ? fallback : requested;
    }

    // Inside the visible surface first; below the toolbar when the size allows it
    // (at maximum zoom the clearance can be larger than the free height).
    function positionLayout(candidate, x, y) {
      var bounds = zoneBounds();
      var visible = visibleWorldBounds();
      var maxY = Math.max(visible.y, visible.y + visible.h - candidate.h);
      candidate.x = clamp(x, bounds.x, Math.max(bounds.x, bounds.x + bounds.w - candidate.w));
      candidate.y = clamp(y, Math.min(bounds.y, maxY), maxY);
      return candidate;
    }

    // The anchor item keeps its place: the frame grows or shrinks around it.
    function layoutAround(keys, orientation, anchorKey, anchorRect) {
      var candidate = fittedLayout(keys, orientation);
      var slot = candidate.slots[anchorKey];
      return positionLayout(candidate, anchorRect.x - slot.x, anchorRect.y - slot.y);
    }

    function committedLayout() {
      if (zoneDocked.length === 0) return null;
      return positionLayout(fittedLayout(zoneDocked, zoneOrientation), zoneOrigin.x, zoneOrigin.y);
    }

    function slotPosition(candidate, key) {
      var slot = candidate.slots[key];
      return { x: candidate.x + slot.x, y: candidate.y + slot.y };
    }

    function withoutTransitions(element, apply) {
      element.classList.add("is-instant");
      apply();
      void element.offsetWidth;
      element.classList.remove("is-instant");
    }

    function setZoneItemState(item, docked) {
      item.docked = docked;
      item.element.classList.toggle("is-docked", docked);
      item.element.classList.toggle("is-detached", !docked);
      item.element.setAttribute("data-zone-state", docked ? "docked" : "detached");
    }

    function placeZoneItem(item) {
      item.element.style.setProperty("--zone-item-x", item.x.toFixed(1) + "px");
      item.element.style.setProperty("--zone-item-y", item.y.toFixed(1) + "px");
      item.element.style.setProperty("--detach-progress", item.progress.toFixed(3));
      item.element.setAttribute("data-detach-progress", item.progress.toFixed(2));
    }

    function moveZoneItem(item, position) {
      item.x = position.x;
      item.y = position.y;
      placeZoneItem(item);
    }

    function refreshItemSizes() {
      for (var index = 0; index < zoneItems.length; index += 1) {
        zoneItems[index].width = zoneItems[index].element.offsetWidth;
        zoneItems[index].height = zoneItems[index].element.offsetHeight;
      }
    }

    function frameShown() {
      return !zoneCard.classList.contains("is-collapsed");
    }

    function setFrameTransform(x, y, scaleX, scaleY) {
      zoneCard.style.setProperty("--zone-x", x.toFixed(1) + "px");
      zoneCard.style.setProperty("--zone-y", y.toFixed(1) + "px");
      zoneCard.style.setProperty("--zone-sx", scaleX.toFixed(4));
      zoneCard.style.setProperty("--zone-sy", scaleY.toFixed(4));
    }

    // FLIP: the frame takes its new size at once, is scaled back to the
    // rectangle it shows right now and then transitions to scale 1, so the resize
    // animates through transform only. An unchanged target never restarts it.
    function renderFrame(candidate, instant) {
      var next = { x: candidate.x, y: candidate.y, w: candidate.w, h: candidate.h };
      zoneCard.setAttribute("data-zone-orientation", candidate.orientation);
      var shown = frameShown();
      if (!instant && shown && zoneFrame !== null &&
          Math.abs(zoneFrame.x - next.x) < 0.5 && Math.abs(zoneFrame.y - next.y) < 0.5 &&
          Math.abs(zoneFrame.w - next.w) < 0.5 && Math.abs(zoneFrame.h - next.h) < 0.5) {
        return;
      }
      var from = !instant && shown && zoneFrame !== null && !prefersReducedMotion()
        ? worldRectOf(zoneCard)
        : null;
      zoneFrame = next;
      placeTitle(next, from === null);
      withoutTransitions(zoneCard, function () {
        zoneCard.style.inlineSize = next.w.toFixed(1) + "px";
        zoneCard.style.blockSize = next.h.toFixed(1) + "px";
        if (from !== null) setFrameTransform(from.x, from.y, from.w / next.w, from.h / next.h);
        else setFrameTransform(next.x, next.y, 1, 1);
      });
      if (from !== null) setFrameTransform(next.x, next.y, 1, 1);
    }

    // solid = committed zone, target = the drag would dock here, ghost = the
    // release would form this zone, emptying = the release would remove it.
    function showFrame(candidate, mode) {
      if (!frameShown()) {
        // A collapsed frame is placed while invisible and then only fades in.
        renderFrame(candidate, true);
        zoneCard.classList.remove("is-collapsed");
      } else {
        renderFrame(candidate, false);
      }
      zoneCard.classList.toggle("is-target", mode === "target");
      zoneCard.classList.toggle("is-ghost", mode === "ghost" || mode === "emptying");
      zoneCard.classList.toggle("is-emptying", mode === "emptying");
      zoneCard.setAttribute("data-zone-mode", mode);
      zoneCard.setAttribute("data-zone-visible", "true");
      syncTitle(mode, false);
    }

    // Fades out and then leaves the pointer and tab flow (visibility follows the
    // fade); the frame keeps its last look while it fades.
    function collapseFrame() {
      if (!frameShown()) return;
      zoneCard.classList.add("is-collapsed");
      zoneCard.setAttribute("data-zone-visible", "false");
      syncTitle(zoneCard.getAttribute("data-zone-mode"), true);
    }

    // ---------- zone name (P0-32) ----------

    function zoneDisplayName() {
      return zoneName.custom !== null ? zoneName.custom : translate(zoneName.key);
    }

    // Shows the zone name (or a preview text); never overwrites a name that is
    // being typed.
    function renderTitle(text) {
      if (zoneTitle === null || zoneTitle.classList.contains("is-editing")) return;
      zoneTitle.textContent = typeof text === "string" ? text : zoneDisplayName();
      zoneTitle.setAttribute("aria-label", translate("demo.zone.nameLabel"));
    }

    // The title is not part of the FLIP-scaled frame (its text would stretch):
    // it sits on the zone layer at the frame's header and moves with the same
    // settle, so frame and name arrive together.
    function placeTitle(frame, instant) {
      if (zoneTitle === null || !zoneTitle.classList.contains("is-placed")) return;
      var apply = function () {
        var x = frame.x + zoneBorderWidth + zonePadding - zoneTitleInset;
        var y = frame.y + zoneBorderWidth + (zoneHeader - zoneTitleHeight) / 2;
        var width = frame.w - 2 * (zoneBorderWidth + zonePadding - zoneTitleInset);
        zoneTitle.style.setProperty("--title-x", x.toFixed(1) + "px");
        zoneTitle.style.setProperty("--title-y", y.toFixed(1) + "px");
        zoneTitle.style.maxInlineSize = Math.max(0, width).toFixed(1) + "px";
      };
      if (instant) withoutTransitions(zoneTitle, apply);
      else apply();
    }

    function syncTitle(mode, collapsed) {
      if (zoneTitle === null) return;
      zoneTitle.classList.toggle("is-ghost", !collapsed && (mode === "ghost" || mode === "emptying"));
      zoneTitle.classList.toggle("is-collapsed", collapsed);
      if (collapsed && document.activeElement === zoneTitle) zoneTitle.blur();
    }

    // Selects the whole name (rename: typing replaces it) or puts the caret at
    // its end (after the 40-character cap cut the text).
    function selectTitleText(element, caretAtEnd) {
      var selection = window.getSelection();
      if (selection === null) return;
      var range = document.createRange();
      range.selectNodeContents(element);
      if (caretAtEnd) range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    // Enter or leaving the field commits, Escape restores the previous name, an
    // empty name returns to the default (which follows the language again).
    function commitTitle() {
      zoneTitle.classList.remove("is-editing");
      zoneTitle.scrollLeft = 0;
      if (zoneTitleCancelled) {
        renderTitle();
        return;
      }
      var text = (zoneTitle.textContent || "").replace(/\s+/g, " ").trim().slice(0, ZONE_TITLE_MAX);
      if (text === zoneTitleBefore.replace(/\s+/g, " ").trim()) {
        renderTitle();
        return;
      }
      zoneName.custom = text === "" ? null : text;
      renderTitle();
      if (status !== null) {
        status.textContent = translate(text === "" ? "demo.status.zoneNameReset" : "demo.status.zoneRenamed", {
          name: zoneDisplayName(),
        });
      }
    }

    function setupZoneTitle() {
      if (zoneTitle === null) return;
      zone.insertBefore(zoneTitle, zonePlaceholder.nextSibling);
      zoneTitle.classList.add("is-placed");
      zoneTitle.setAttribute("role", "textbox");
      zoneTitle.setAttribute("spellcheck", "false");
      try {
        zoneTitle.contentEditable = "plaintext-only";
      } catch (error) {
        // Older engines only know "true"; the commit reads plain text anyway.
        zoneTitle.contentEditable = "true";
      }
      renderTitle();
      zoneTitle.addEventListener("focus", function () {
        zoneTitleBefore = zoneTitle.textContent || "";
        zoneTitleCancelled = false;
        zoneTitle.classList.add("is-editing");
        // After the click has placed its caret, select the whole name.
        window.requestAnimationFrame(function () {
          if (document.activeElement === zoneTitle) selectTitleText(zoneTitle, false);
        });
      });
      zoneTitle.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          zoneTitle.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          zoneTitleCancelled = true;
          zoneTitle.blur();
        }
      });
      zoneTitle.addEventListener("input", function () {
        var text = zoneTitle.textContent || "";
        if (text.length <= ZONE_TITLE_MAX) return;
        zoneTitle.textContent = text.slice(0, ZONE_TITLE_MAX);
        selectTitleText(zoneTitle, true);
      });
      zoneTitle.addEventListener("blur", commitTitle);
      localeListeners.push(function () {
        renderTitle();
      });
    }

    function showPlaceholder(item, position) {
      zonePlaceholder.setAttribute("data-zone-item-for", item.key);
      var apply = function () {
        zonePlaceholder.style.inlineSize = item.width.toFixed(1) + "px";
        zonePlaceholder.style.blockSize = item.height.toFixed(1) + "px";
        zonePlaceholder.style.setProperty("--placeholder-x", position.x.toFixed(1) + "px");
        zonePlaceholder.style.setProperty("--placeholder-y", position.y.toFixed(1) + "px");
      };
      if (zonePlaceholder.classList.contains("is-visible")) apply();
      else withoutTransitions(zonePlaceholder, apply);
      zonePlaceholder.classList.add("is-visible");
    }

    function hidePlaceholder() {
      zonePlaceholder.classList.remove("is-visible");
    }

    // Orientation from the placement: the centre offsets are measured in item
    // sizes (half the summed widths / heights), so a tall photo beside a short
    // notepad still reads as side by side. More vertical than horizontal ->
    // stacked, more horizontal -> side by side; a near-diagonal drop or one right
    // on top of the other item keeps the current orientation (hysteresis).
    function placementOrientation(item, second, fallback) {
      var first = itemRect(item);
      var horizontal = Math.abs(first.x + first.w / 2 - (second.x + second.w / 2)) /
        Math.max(1, (first.w + second.w) / 2);
      var vertical = Math.abs(first.y + first.h / 2 - (second.y + second.h / 2)) /
        Math.max(1, (first.h + second.h) / 2);
      if (Math.max(horizontal, vertical) < ZONE_ORIENTATION_OVERLAP) return fallback;
      if (vertical > horizontal * ZONE_ORIENTATION_DOMINANCE) return "vertical";
      if (horizontal > vertical * ZONE_ORIENTATION_DOMINANCE) return "horizontal";
      return fallback;
    }

    // Order along the flow: the dragged item comes first when its centre is
    // before the other centre. A small screen band around the midpoint keeps the
    // current order, so a drop on the midpoint (or a wobble) does not flip it.
    function placementOrder(item, other, second, orientation, current) {
      var first = itemRect(item);
      var delta = orientation === "vertical"
        ? first.y + first.h / 2 - (second.y + second.h / 2)
        : first.x + first.w / 2 - (second.x + second.w / 2);
      if (current !== null && current.length === 2 &&
          current.indexOf(item.key) !== -1 && current.indexOf(other.key) !== -1 &&
          Math.abs(delta) * scale < ZONE_ORDER_HYSTERESIS) {
        return current.slice();
      }
      return delta < 0 ? [item.key, other.key] : [other.key, item.key];
    }

    // Two free items group when they overlap enough or the pointer is on the
    // other item; once the ghost zone shows, any contact keeps it (hysteresis).
    function groupingAllowed(item, other, clientX, clientY, sticky) {
      var first = screenRectOf(itemRect(item));
      var second = screenRectOf(itemRect(other));
      var overlap = overlapFraction(first, second);
      var margin = sticky ? 2 * ZONE_GROUP_MARGIN : ZONE_GROUP_MARGIN;
      var pointerNear = clientX >= second.left - margin && clientX <= second.right + margin &&
        clientY >= second.top - margin && clientY <= second.bottom + margin;
      return pointerNear || (sticky ? overlap > 0 : overlap >= ZONE_GROUP_OVERLAP);
    }

    // What a release at this pointer position would do. Entering the zone needs
    // the pointer over the frame that is shown (or the item covering a good part
    // of it); staying in it allows the catch margin around the previewed (grown)
    // frame, so the boundary never flickers.
    function decideIntent(drag, clientX, clientY) {
      var item = drag.item;
      var others = dockedWithout(item);
      var current = drag.intent;
      if (zoneDocked.length > 0) {
        var orientation = zoneOrientation;
        var order = null;
        var candidate;
        if (others.length === 0) {
          candidate = committedLayout();
        } else {
          var anchor = zoneItemByKey(others[0]);
          var anchorHome = homeRect(drag, anchor);
          orientation = placementOrientation(item, anchorHome, drag.orientation);
          order = placementOrder(item, anchor, anchorHome, orientation, drag.order);
          // A reorder inside the full zone keeps the frame and lets the other item
          // make room; anything else re-forms the frame around the item that stays.
          candidate = drag.keepOrigin && orientation === drag.startOrientation
            ? positionLayout(fittedLayout(order, orientation), zoneOrigin.x, zoneOrigin.y)
            : layoutAround(order, orientation, anchor.key, anchorHome);
        }
        var distance = distanceOutside(candidate, clientX, clientY);
        // An item that started docked also stays inside its committed frame, so
        // a smaller previewed layout never pushes it out by itself.
        if (drag.startDocked) {
          distance = Math.min(distance, distanceOutside(committedLayout(), clientX, clientY));
        }
        var inside = current !== null && current.type === "zone"
          ? distance <= ZONE_CATCH_MARGIN
          : zoneFrame !== null && frameShown() && (
            distanceOutside(zoneFrame, clientX, clientY) <= 0 ||
            overlapFraction(screenRectOf(itemRect(item)), screenRectOf(zoneFrame)) >= ZONE_ENTER_OVERLAP
          );
        if (inside) {
          if (order !== null) {
            drag.orientation = orientation;
            drag.order = order;
          }
          return {
            type: "zone",
            layout: candidate,
            requested: order !== null ? orientation : zoneOrientation,
            progress: smoothstep(distance / ZONE_CATCH_MARGIN),
          };
        }
      }
      var other = otherZoneItem(item);
      if (other !== null && !other.docked) {
        var grouping = current !== null && current.type === "group";
        if (groupingAllowed(item, other, clientX, clientY, grouping)) {
          var otherHome = homeRect(drag, other);
          var groupOrientation = placementOrientation(item, otherHome, drag.groupOrientation);
          var groupOrder = placementOrder(
            item,
            other,
            otherHome,
            groupOrientation,
            grouping ? current.layout.keys : null,
          );
          drag.groupOrientation = groupOrientation;
          return {
            type: "group",
            layout: layoutAround(groupOrder, groupOrientation, other.key, otherHome),
            requested: groupOrientation,
            progress: 1,
          };
        }
      }
      if (others.length > 0) {
        return {
          type: "free",
          layout: layoutAround(others, zoneOrientation, others[0], homeRect(drag, zoneItemByKey(others[0]))),
          emptying: false,
          progress: 1,
        };
      }
      return { type: "free", layout: committedLayout(), emptying: zoneDocked.length > 0, progress: 1 };
    }

    // Shows the outcome of a release without committing anything.
    function previewIntent(drag) {
      var item = drag.item;
      var intent = drag.intent;
      var index;
      if (intent.type === "zone" || intent.type === "group") {
        // A ghost that would form a brand-new zone already shows the new name.
        if (intent.type === "group" && zoneDocked.length === 0) renderTitle(translate("demo.zone.nameNew"));
        showFrame(intent.layout, intent.type === "group" ? "ghost" : "target");
        for (index = 0; index < intent.layout.keys.length; index += 1) {
          var entry = zoneItemByKey(intent.layout.keys[index]);
          if (entry !== null && entry !== item && entry.docked) {
            moveZoneItem(entry, slotPosition(intent.layout, entry.key));
          }
        }
        showPlaceholder(item, slotPosition(intent.layout, item.key));
      } else {
        hidePlaceholder();
        if (intent.layout === null) {
          collapseFrame();
        } else {
          showFrame(intent.layout, intent.emptying ? "emptying" : "solid");
          for (index = 0; index < intent.layout.keys.length; index += 1) {
            var docked = zoneItemByKey(intent.layout.keys[index]);
            if (docked !== null && docked !== item) moveZoneItem(docked, slotPosition(intent.layout, docked.key));
          }
        }
      }
      item.progress = intent.progress;
    }

    // P0-36: a photo that docks into a zone with another member takes that
    // member's size along the flow — the same width when stacked, the same
    // height side by side — and keeps its own aspect ratio. The layout is then
    // rebuilt at the same origin with the new size.
    function adoptMemberSize(item, candidate) {
      if (item.key !== "window" || candidate.keys.length < 2) return candidate;
      var other = null;
      for (var index = 0; index < candidate.keys.length; index += 1) {
        if (candidate.keys[index] !== item.key) other = zoneItemByKey(candidate.keys[index]);
      }
      if (other === null || item.width <= 0 || item.height <= 0) return candidate;
      var aspect = item.width / item.height;
      var width = candidate.orientation === "horizontal" ? other.height * aspect : other.width;
      var height = candidate.orientation === "horizontal" ? other.height : other.width / aspect;
      item.element.style.inlineSize = Math.round(width) + "px";
      item.element.style.blockSize = Math.round(height) + "px";
      refreshItemSizes();
      return positionLayout(fittedLayout(candidate.keys, candidate.orientation), candidate.x, candidate.y);
    }

    function commitRelease(drag) {
      var item = drag.item;
      var intent = drag.intent;
      var index;
      hidePlaceholder();
      if (intent === null) return;
      if (intent.type === "zone" || intent.type === "group") {
        var before = zoneDocked.slice();
        var beforeLayout = committedLayout();
        var beforeOrientation = beforeLayout === null ? null : beforeLayout.orientation;
        var target = adoptMemberSize(item, intent.layout);
        if (intent.type === "group" && before.length === 0) {
          zoneName = { key: "demo.zone.nameNew", custom: null };
          renderTitle();
        }
        zoneDocked = target.keys.slice();
        if (target.keys.length > 1) zoneOrientation = intent.requested;
        zoneOrigin = { x: target.x, y: target.y };
        showFrame(target, "solid");
        for (index = 0; index < target.keys.length; index += 1) {
          var entry = zoneItemByKey(target.keys[index]);
          if (entry === null) continue;
          setZoneItemState(entry, true);
          entry.progress = 0;
          moveZoneItem(entry, slotPosition(target, entry.key));
        }
        if (intent.type === "group") {
          announceZoneStatus(target.orientation === "horizontal"
            ? "demo.status.groupedHorizontal"
            : "demo.status.groupedVertical");
        } else if (!drag.startDocked) {
          announceZoneItem(item, false);
        } else if (beforeOrientation !== null && before.length === 2 && beforeOrientation !== target.orientation) {
          announceZoneStatus("demo.status.orientationChanged");
        } else if (before.length === 2 && before.join() !== zoneDocked.join()) {
          announceZoneStatus("demo.status.reordered");
        }
        return;
      }
      var snapped = clampToBounds(item, snap(item.x), snap(item.y), worldBounds());
      setZoneItemState(item, false);
      item.progress = 1;
      moveZoneItem(item, snapped);
      zoneDocked = dockedWithout(item);
      if (zoneDocked.length > 0 && intent.layout !== null) {
        zoneOrigin = { x: intent.layout.x, y: intent.layout.y };
        showFrame(intent.layout, "solid");
      } else {
        collapseFrame();
      }
      if (!drag.startDocked) return;
      if (zoneDocked.length === 0) announceZoneStatus("demo.status.zoneHidden");
      else announceZoneItem(item, true);
    }

    // Cancel restores the committed state: the item glides back to where the
    // drag started and the zone shows its committed frame again.
    function cancelDrag(drag) {
      var item = drag.item;
      hidePlaceholder();
      item.progress = item.docked ? 0 : 1;
      moveZoneItem(item, { x: drag.startX, y: drag.startY });
      var committed = committedLayout();
      if (committed === null) {
        collapseFrame();
        return;
      }
      showFrame(committed, "solid");
      for (var index = 0; index < committed.keys.length; index += 1) {
        var entry = zoneItemByKey(committed.keys[index]);
        if (entry !== null) moveZoneItem(entry, slotPosition(committed, entry.key));
      }
    }

    // Resize, zoom-independent re-fit and content reflow land instantly: free
    // items keep their relative place, the zone keeps its centre ratio and is
    // re-fitted (and re-oriented when the requested orientation no longer fits).
    function syncZoneGeometry(ratioX, ratioY) {
      if (!zoneReady) return;
      if (zoneDrag !== null || zoneMove !== null) {
        zonePendingSync = true;
        return;
      }
      zonePendingSync = false;
      refreshItemSizes();
      withoutTransitions(zone, function () {
        for (var index = 0; index < zoneItems.length; index += 1) {
          var entry = zoneItems[index];
          if (entry.docked) continue;
          var free = clampToBounds(
            entry,
            (entry.x + entry.width / 2) * ratioX - entry.width / 2,
            (entry.y + entry.height / 2) * ratioY - entry.height / 2,
            worldBounds(),
          );
          moveZoneItem(entry, free);
        }
        if (zoneDocked.length === 0) return;
        var target = fittedLayout(zoneDocked, zoneOrientation);
        var previous = zoneFrame === null ? target : zoneFrame;
        // A window resize keeps the zone's centre ratio; a content or member
        // size change (ratio 1) keeps its top-left corner, so a member resized
        // to the right grows the zone to the right (P0-36).
        positionLayout(
          target,
          ratioX === 1 ? zoneOrigin.x : (zoneOrigin.x + previous.w / 2) * ratioX - target.w / 2,
          ratioY === 1 ? zoneOrigin.y : (zoneOrigin.y + previous.h / 2) * ratioY - target.h / 2,
        );
        zoneOrigin = { x: target.x, y: target.y };
        renderFrame(target, true);
        for (var slot = 0; slot < target.keys.length; slot += 1) {
          var docked = zoneItemByKey(target.keys[slot]);
          if (docked !== null) moveZoneItem(docked, slotPosition(target, docked.key));
        }
      });
    }

    // The items start in the static card grid (the no-script look). The first
    // layout pass measures that card, moves the items onto the zone layer and
    // from then on the frame and the items are positioned in world coordinates.
    function initZone() {
      if (zoneReady || zoneItems.length < 2) return;
      zonePadding = readPixelToken("--space-16", 16);
      zoneGap = readPixelToken("--space-12", 12);
      zoneTitleHeight = readPixelToken("--space-24", 24);
      zoneTitleInset = readPixelToken("--space-4", 4);
      zoneHeader = zoneTitleHeight + zonePadding;
      refreshItemSizes();
      var cardRect = worldRectOf(zoneCard);
      zonePlaceholder = document.createElement("span");
      zonePlaceholder.className = "demo-zone__placeholder";
      zonePlaceholder.setAttribute("aria-hidden", "true");
      zone.insertBefore(zonePlaceholder, zone.firstChild);
      setupZoneTitle();
      withoutTransitions(zone, function () {
        for (var index = 0; index < zoneItems.length; index += 1) {
          var entry = zoneItems[index];
          zone.appendChild(entry.element);
          entry.element.classList.add("is-floating");
          setZoneItemState(entry, true);
        }
        zoneCard.classList.add("is-positioned");
        zoneDocked = [zoneItems[0].key, zoneItems[1].key];
        zoneOrientation = "vertical";
        var start = positionLayout(fittedLayout(zoneDocked, zoneOrientation), cardRect.x, cardRect.y);
        zoneOrigin = { x: start.x, y: start.y };
        renderFrame(start, true);
        showFrame(start, "solid");
        for (var slot = 0; slot < zoneItems.length; slot += 1) {
          zoneItems[slot].progress = 0;
          moveZoneItem(zoneItems[slot], slotPosition(start, zoneItems[slot].key));
        }
      });
      zoneReady = true;
      if (zoneObserver === null && typeof window.ResizeObserver === "function") {
        zoneObserver = new window.ResizeObserver(function () {
          syncZoneGeometry(1, 1);
        });
        for (var observed = 0; observed < zoneItems.length; observed += 1) {
          zoneObserver.observe(zoneItems[observed].element);
        }
      }
    }

    function onZoneItemPointerDown(item, event) {
      if (zoneDrag !== null || zoneMove !== null || !zoneReady) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      var target = event.target;
      if (target instanceof Element && target.closest("button, a, input, textarea, select")) {
        return;
      }
      event.preventDefault();
      var home = {};
      for (var index = 0; index < zoneItems.length; index += 1) {
        var entry = zoneItems[index];
        entry.element.classList.toggle("is-selected", entry === item);
        home[entry.key] = { x: entry.x, y: entry.y };
      }
      var point = zoneWorldPoint(event.clientX, event.clientY);
      var committed = committedLayout();
      zoneDrag = {
        pointerId: event.pointerId,
        item: item,
        grabX: point.x - item.x,
        grabY: point.y - item.y,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: item.x,
        startY: item.y,
        startDocked: item.docked,
        // A reorder inside a full zone keeps the frame where it is and lets the
        // other item make room; once the item was out, the frame follows the
        // remaining item instead.
        keepOrigin: item.docked && zoneDocked.length === 2,
        startOrientation: committed === null ? zoneOrientation : committed.orientation,
        home: home,
        orientation: zoneOrientation,
        order: item.docked && zoneDocked.length === 2 ? zoneDocked.slice() : null,
        groupOrientation: zoneOrientation,
        intent: null,
        active: false,
      };
      try {
        item.element.setPointerCapture(event.pointerId);
      } catch (error) {
        // Pointer capture is best effort; the drag keeps working without it.
      }
    }

    function onZoneItemPointerMove(item, event) {
      var drag = zoneDrag;
      if (drag === null || drag.item !== item || drag.pointerId !== event.pointerId) return;
      if (!drag.active) {
        if (Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY) < threshold) {
          return;
        }
        drag.active = true;
        item.element.classList.add("is-dragging");
      }
      var point = zoneWorldPoint(event.clientX, event.clientY);
      var next = clampToBounds(item, point.x - drag.grabX, point.y - drag.grabY, worldBounds());
      item.x = next.x;
      item.y = next.y;
      drag.intent = decideIntent(drag, event.clientX, event.clientY);
      if (drag.intent.type === "free") drag.keepOrigin = false;
      previewIntent(drag);
      placeZoneItem(item);
    }

    function onZoneItemPointerEnd(item, event, cancelled) {
      var drag = zoneDrag;
      if (drag === null || drag.item !== item || drag.pointerId !== event.pointerId) return;
      zoneDrag = null;
      // Dropping the dragging state first re-enables the settle transition, so
      // the commit below glides from the release point instead of jumping.
      item.element.classList.remove("is-dragging");
      if (drag.active) {
        if (cancelled) cancelDrag(drag);
        else commitRelease(drag);
      }
      if (zonePendingSync) syncZoneGeometry(1, 1);
    }

    // ---------- zone move (P0-34) ----------
    //
    // The frame's padding and header are the zone's grip: after the 4 px
    // threshold the frame, its name and every docked member follow the pointer
    // 1:1 (transitions off), clamped by the same layout functions as every other
    // zone change, so the members keep their slots. Release commits the origin;
    // a cancel glides everything back. Free items, note cards and the edge never
    // move, and a member drag and a zone move never run at the same time.

    var zoneMove = null;

    function moveZoneTo(x, y) {
      var target = positionLayout(fittedLayout(zoneDocked, zoneOrientation), x, y);
      renderFrame(target, zone.classList.contains("is-moving"));
      for (var index = 0; index < target.keys.length; index += 1) {
        var member = zoneItemByKey(target.keys[index]);
        if (member !== null) moveZoneItem(member, slotPosition(target, member.key));
      }
      return target;
    }

    function onZoneMoveDown(event) {
      if (zoneMove !== null || zoneDrag !== null || !zoneReady) return;
      if (zoneDocked.length === 0 || !frameShown()) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      zoneMove = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: zoneOrigin.x,
        startY: zoneOrigin.y,
        target: null,
        active: false,
      };
    }

    function onZoneMoveMove(event) {
      var move = zoneMove;
      if (move === null || move.pointerId !== event.pointerId) return;
      var deltaX = event.clientX - move.startClientX;
      var deltaY = event.clientY - move.startClientY;
      if (!move.active) {
        if (Math.hypot(deltaX, deltaY) < threshold) return;
        move.active = true;
        zone.classList.add("is-moving");
        zoneCard.classList.add("is-moving");
        try {
          zoneCard.setPointerCapture(event.pointerId);
        } catch (error) {
          // Pointer capture is best effort; the move keeps working without it.
        }
      }
      var ratio = worldRatio(world.getBoundingClientRect());
      move.target = moveZoneTo(move.startX + deltaX / ratio, move.startY + deltaY / ratio);
    }

    function onZoneMoveEnd(event, cancelled) {
      var move = zoneMove;
      if (move === null || move.pointerId !== event.pointerId) return;
      zoneMove = null;
      if (move.active) {
        zone.classList.remove("is-moving");
        zoneCard.classList.remove("is-moving");
        if (cancelled || move.target === null) {
          moveZoneTo(move.startX, move.startY);
        } else {
          zoneOrigin = { x: move.target.x, y: move.target.y };
          announceZoneStatus("demo.status.zoneMoved");
        }
      }
      if (zonePendingSync) syncZoneGeometry(1, 1);
    }

    if (zoneCard !== null) {
      zoneCard.addEventListener("pointerdown", onZoneMoveDown);
      zoneCard.addEventListener("pointermove", onZoneMoveMove);
      zoneCard.addEventListener("pointerup", function (event) {
        onZoneMoveEnd(event, false);
      });
      zoneCard.addEventListener("pointercancel", function (event) {
        onZoneMoveEnd(event, true);
      });
      zoneCard.addEventListener("lostpointercapture", function (event) {
        onZoneMoveEnd(event, true);
      });
    }

    zoneItems.forEach(function (item) {
      item.element.addEventListener("pointerdown", function (event) {
        onZoneItemPointerDown(item, event);
      });
      item.element.addEventListener("pointermove", function (event) {
        onZoneItemPointerMove(item, event);
      });
      item.element.addEventListener("pointerup", function (event) {
        onZoneItemPointerEnd(item, event, false);
      });
      item.element.addEventListener("pointercancel", function (event) {
        onZoneItemPointerEnd(item, event, true);
      });
      // A capture lost without pointerup (window switch, element removed) ends
      // the drag like a cancel; after a normal pointerup this is a no-op.
      item.element.addEventListener("lostpointercapture", function (event) {
        onZoneItemPointerEnd(item, event, true);
      });
    });

    // ---------- selection chrome and resize (P0-36) ----------
    //
    // A click selects one object (note card, notepad, photo, checklist, table
    // card); the engine's selection chrome — a 1 px accent frame and eight 8 px
    // handles — follows its rendered box every frame while something is
    // selected, so it stays on the object through drags, settles and zoom. A
    // handle drag resizes against the opposite edge or corner, 1:1, clamped to
    // the canvas and to each object's minimum; blocks and the notepad never get
    // lower than their content. A click on the empty canvas or Esc clears it.

    var HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
    var selectionChrome = document.createElement("div");
    selectionChrome.className = "demo-selection";
    selectionChrome.setAttribute("aria-hidden", "true");
    for (var handleIndex = 0; handleIndex < HANDLES.length; handleIndex += 1) {
      var handleElement = document.createElement("span");
      handleElement.className = "demo-selection__handle";
      handleElement.setAttribute("data-handle", HANDLES[handleIndex]);
      selectionChrome.appendChild(handleElement);
    }
    world.appendChild(selectionChrome);

    var selectionTargets = [];
    var selectedTarget = null;
    var selectionFrame = 0;
    var resizeDrag = null;

    function contentHeight(element, width) {
      var previous = element.style.blockSize;
      element.style.inlineSize = width + "px";
      element.style.blockSize = "auto";
      var height = element.offsetHeight;
      element.style.blockSize = previous;
      return height;
    }

    cards.forEach(function (card) {
      selectionTargets.push({
        element: card.element,
        minWidth: 176,
        minHeight: 80,
        growsWithContent: false,
        rect: function () {
          return { x: card.x, y: card.y, w: card.element.offsetWidth, h: card.element.offsetHeight };
        },
        apply: function (next) {
          card.x = next.x;
          card.y = next.y;
          card.element.style.inlineSize = next.w + "px";
          card.element.style.blockSize = next.h + "px";
          place(card);
          drawEdge();
        },
      });
    });
    blocks.forEach(function (block) {
      var isSheet = block.element.getAttribute("data-demo-block") === "sheet";
      selectionTargets.push({
        element: block.element,
        minWidth: isSheet ? 288 : 224,
        minHeight: 0,
        growsWithContent: true,
        rect: function () {
          return { x: block.x, y: block.y, w: block.element.offsetWidth, h: block.element.offsetHeight };
        },
        apply: function (next) {
          block.x = next.x;
          block.y = next.y;
          block.element.style.inlineSize = next.w + "px";
          block.element.style.blockSize = next.h + "px";
          place(block);
        },
      });
    });
    zoneItems.forEach(function (item) {
      var isPhoto = item.key === "window";
      selectionTargets.push({
        element: item.element,
        minWidth: isPhoto ? 128 : 176,
        minHeight: isPhoto ? 96 : 0,
        growsWithContent: !isPhoto,
        rect: function () {
          return { x: item.x, y: item.y, w: item.element.offsetWidth, h: item.element.offsetHeight };
        },
        apply: function (next) {
          item.element.style.inlineSize = next.w + "px";
          item.element.style.blockSize = next.h + "px";
          item.width = item.element.offsetWidth;
          item.height = item.element.offsetHeight;
          if (item.docked) {
            // A docked member keeps its slot origin; the zone re-lays around it.
            syncZoneGeometry(1, 1);
          } else {
            item.x = next.x;
            item.y = next.y;
            placeZoneItem(item);
          }
        },
      });
    });

    function targetFor(element) {
      for (var index = 0; index < selectionTargets.length; index += 1) {
        if (selectionTargets[index].element === element) return selectionTargets[index];
      }
      return null;
    }

    function renderSelection() {
      if (selectedTarget === null) {
        selectionChrome.classList.remove("is-visible");
        return;
      }
      var box = worldRectOf(selectedTarget.element);
      selectionChrome.style.setProperty("--chrome-inverse", (1 / scale).toFixed(4));
      selectionChrome.style.transform =
        "translate3d(" + box.x.toFixed(1) + "px, " + box.y.toFixed(1) + "px, 0)";
      selectionChrome.style.inlineSize = box.w.toFixed(1) + "px";
      selectionChrome.style.blockSize = box.h.toFixed(1) + "px";
      selectionChrome.classList.add("is-visible");
    }

    function tickSelection() {
      selectionFrame = 0;
      renderSelection();
      if (selectedTarget !== null) selectionFrame = window.requestAnimationFrame(tickSelection);
    }

    function setSelectedTarget(target) {
      if (selectedTarget !== null) selectedTarget.element.classList.remove("is-chrome-selected");
      selectedTarget = target;
      if (target !== null) target.element.classList.add("is-chrome-selected");
      renderSelection();
      if (target !== null && selectionFrame === 0) {
        selectionFrame = window.requestAnimationFrame(tickSelection);
      }
    }

    // Capture phase: the selection follows every press before the object's own
    // drag handler runs; chrome, toolbar and zoom controls never change it.
    surface.addEventListener(
      "pointerdown",
      function (event) {
        var target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest(".demo-selection, .demo-toolbar, .demo-zoom")) return;
        var hit = null;
        for (var index = 0; index < selectionTargets.length && hit === null; index += 1) {
          if (selectionTargets[index].element.contains(target)) hit = selectionTargets[index];
        }
        // Only the last touched object stays on top of its layer (design law
        // §8): blocks and zone items drop their raised state when another
        // object is pressed.
        for (var blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
          if (hit === null || blocks[blockIndex].element !== hit.element) {
            blocks[blockIndex].element.classList.remove("is-raised");
          }
        }
        for (var itemIndex = 0; itemIndex < zoneItems.length; itemIndex += 1) {
          if (hit === null || zoneItems[itemIndex].element !== hit.element) {
            zoneItems[itemIndex].element.classList.remove("is-selected");
          }
        }
        setSelectedTarget(hit);
      },
      true,
    );

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" || selectedTarget === null) return;
      var focus = document.activeElement;
      if (focus instanceof HTMLElement && (focus.isContentEditable || focus.closest("input, textarea, select"))) {
        return;
      }
      setSelectedTarget(null);
    });

    function onHandleDown(event) {
      var handle = event.target;
      if (!(handle instanceof Element) || selectedTarget === null || resizeDrag !== null) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      resizeDrag = {
        pointerId: event.pointerId,
        handle: handle.getAttribute("data-handle") || "se",
        target: selectedTarget,
        start: selectedTarget.rect(),
        startClientX: event.clientX,
        startClientY: event.clientY,
      };
      selectedTarget.element.classList.add("is-resizing");
      try {
        handle.setPointerCapture(event.pointerId);
      } catch (error) {
        // Pointer capture is best effort; the resize keeps working without it.
      }
    }

    function onHandleMove(event) {
      var drag = resizeDrag;
      if (drag === null || drag.pointerId !== event.pointerId) return;
      var ratio = worldRatio(world.getBoundingClientRect());
      var dx = (event.clientX - drag.startClientX) / ratio;
      var dy = (event.clientY - drag.startClientY) / ratio;
      var start = drag.start;
      var target = drag.target;
      var bounds = worldBounds();
      var west = drag.handle.indexOf("w") !== -1;
      var east = drag.handle.indexOf("e") !== -1;
      var north = drag.handle.indexOf("n") !== -1;
      var south = drag.handle.indexOf("s") !== -1;
      var left = start.x;
      var right = start.x + start.w;
      var top = start.y;
      var bottom = start.y + start.h;
      if (west) left = clamp(start.x + dx, bounds.x, right - target.minWidth);
      if (east) right = clamp(right + dx, left + target.minWidth, bounds.x + bounds.w);
      var width = right - left;
      var minHeight = target.growsWithContent
        ? Math.max(target.minHeight, contentHeight(target.element, width))
        : target.minHeight;
      if (north) top = clamp(start.y + dy, bounds.y, bottom - minHeight);
      if (south) bottom = clamp(bottom + dy, top + minHeight, bounds.y + bounds.h);
      var height = Math.max(bottom - top, minHeight);
      if (north) top = bottom - height;
      target.apply({ x: left, y: top, w: Math.round(width), h: Math.round(height) });
    }

    function onHandleEnd(event) {
      var drag = resizeDrag;
      if (drag === null || drag.pointerId !== event.pointerId) return;
      resizeDrag = null;
      drag.target.element.classList.remove("is-resizing");
      if (status !== null) status.textContent = translate("demo.status.resized");
    }

    selectionChrome.addEventListener("pointerdown", onHandleDown);
    selectionChrome.addEventListener("pointermove", onHandleMove);
    selectionChrome.addEventListener("pointerup", onHandleEnd);
    selectionChrome.addEventListener("pointercancel", onHandleEnd);

    window.addEventListener("resize", function () {
      if (resizePending) return;
      resizePending = true;
      requestAnimationFrame(function () {
        resizePending = false;
        layout();
      });
    });

    layout();
  }

  // Preview-only toolbar: selecting a tool only flips aria-pressed; it never
  // changes the canvas. The note tool is the initial selection in the markup.
  function setupToolbar(demo) {
    var toolbar = demo.querySelector("[data-demo-toolbar]");
    if (toolbar === null) return;
    var tools = toolbar.querySelectorAll("[data-demo-tool]");
    if (tools.length === 0) return;
    var status = demo.querySelector("[data-demo-status]");

    function selectTool(tool) {
      for (var index = 0; index < tools.length; index += 1) {
        tools[index].setAttribute(
          "aria-pressed",
          tools[index] === tool ? "true" : "false",
        );
      }
      if (status !== null) {
        status.textContent = translate("demo.status.tool", {
          label: tool.getAttribute("data-label") || "",
        });
      }
    }

    for (var index = 0; index < tools.length; index += 1) {
      var tool = tools[index];
      tool.addEventListener("click", function (event) {
        var pressed = event.currentTarget;
        if (pressed instanceof Element) selectTool(pressed);
      });
    }
  }

  function init() {
    var demos = document.querySelectorAll("[data-demo]");
    for (var i = 0; i < demos.length; i += 1) {
      setupToolbar(demos[i]);
      setupDemo(demos[i]);
    }
    setupLocaleSwitcher();
    var stored = readStoredLocale();
    var initial = LOCALE_LANGUAGES.indexOf(stored) === -1 || stored === null ? LOCALE_DEFAULT : stored;
    activateLocale(initial, false);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
