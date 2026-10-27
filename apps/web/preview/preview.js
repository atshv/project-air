// P0-20 live connection demo for the static design preview: two cards, a curved
// edge snapped to invisible side-midpoint anchors (P0-23/P0-25) and preview-only
// zoom controls (P0-24). P0-26 adds the preview-only toolbar selection state and
// P0-27 the DE/EN locale controller (locale JSON over HTTP, no build step) and
// P0-28/P0-29 the zone detach, collapse and re-grouping interaction.
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
  // Zone detach (P0-28): distances are screen pixels, so the behaviour is the
  // same at every zoom level. Detach needs 28 px of pointer travel outside the
  // zone edge (progress 0 -> 1); it docks again below 8 px (hysteresis, so a
  // wobble at the edge cannot flicker). A release halfway uses the nearest
  // state: farther than 18 px outside means detached.
  var ZONE_DETACH_DISTANCE = 28;
  var ZONE_DOCK_DISTANCE = 8;
  var ZONE_RELEASE_DISTANCE = 18;
  // Zone collapse and re-grouping (P0-29): both items out -> the empty zone fades
  // and shrinks out (opacity/scale via CSS classes). Free items that overlap by at
  // least 25 % of the smaller area, or whose centres are within 48 screen px, form
  // a new zone around their union + 16 px padding; the slots keep the original
  // 12 px gap, are clamped to the demo surface and become functional again.
  var ZONE_GROUP_OVERLAP = 0.25;
  var ZONE_GROUP_CENTRE_DISTANCE = 48;
  var ZONE_MOTION_TIMEOUT = 260;

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
    "demo.status.grouped": "Items grouped into a new zone.",
  };
  var localeMessages = null;
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
      }
      clampCard(cards[0]);
      clampCard(cards[1]);
      place(cards[0]);
      place(cards[1]);
      applyZoom();
      drawEdge();
      syncZoneGeometry();
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

    zoomIn.addEventListener("click", function () {
      zoomBy(1);
    });
    zoomOut.addEventListener("click", function () {
      zoomBy(-1);
    });
    zoomFit.addEventListener("click", function () {
      fitView();
    });

    // ---------- zone detach (P0-28) ----------

    var zone = surface.querySelector("[data-demo-zone]");
    var zoneCard = zone === null ? null : zone.querySelector("[data-demo-zone-card]");
    var zoneItems = [];
    var zonePointer = null;
    var zoneGeometryReady = false;
    var zoneObserver = null;
    var zoneCollapseTimer = null;
    var zoneHidden = false;
    var zoneLeaving = false;
    var zoneGrouping = false;
    var zoneLayout = { x: 0, y: 0 };

    if (zone !== null && zoneCard !== null) {
      var zoneElements = zone.querySelectorAll("[data-zone-item]");
      for (var zoneIndex = 0; zoneIndex < zoneElements.length; zoneIndex += 1) {
        var zoneElement = zoneElements[zoneIndex];
        if (!(zoneElement instanceof HTMLElement)) continue;
        zoneItems.push({
          element: zoneElement,
          key: zoneElement.getAttribute("data-zone-item") || "item",
          slot: null,
          dockX: 0,
          dockY: 0,
          width: 0,
          height: 0,
          x: 0,
          y: 0,
          progress: 0,
          settling: false,
          settleTimer: null,
        });
      }
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

    function worldRectOf(element) {
      var worldRect = world.getBoundingClientRect();
      var rect = element.getBoundingClientRect();
      return {
        x: (rect.left - worldRect.left) / scale,
        y: (rect.top - worldRect.top) / scale,
        w: rect.width / scale,
        h: rect.height / scale,
      };
    }

    function setZoneItemState(item, state) {
      item.element.classList.toggle("is-docked", state === "docked");
      item.element.classList.toggle("is-detached", state === "detached");
      item.element.setAttribute("data-zone-state", state);
    }

    function placeZoneItem(item) {
      item.element.style.setProperty("--zone-item-x", item.x.toFixed(1) + "px");
      item.element.style.setProperty("--zone-item-y", item.y.toFixed(1) + "px");
      item.element.style.setProperty("--detach-progress", item.progress.toFixed(3));
      item.element.setAttribute("data-detach-progress", item.progress.toFixed(2));
    }

    function clampToBounds(item, x, y, bounds) {
      var maxX = Math.max(bounds.x, bounds.x + bounds.w - item.width);
      var maxY = Math.max(bounds.y, bounds.y + bounds.h - item.height);
      return { x: clamp(x, bounds.x, maxX), y: clamp(y, bounds.y, maxY) };
    }

    function worldBounds() {
      return { x: 0, y: 0, w: world.clientWidth, h: world.clientHeight };
    }

    function zoneDockedCount() {
      var count = 0;
      for (var index = 0; index < zoneItems.length; index += 1) {
        if (zoneItems[index].element.classList.contains("is-docked")) count += 1;
      }
      return count;
    }

    function prefersReducedMotion() {
      return typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    function announceZoneStatus(key) {
      if (status === null) return;
      status.textContent = translate(key);
    }

    function startSettling(item) {
      item.settling = true;
      item.element.classList.add("is-settling");
      window.clearTimeout(item.settleTimer);
      item.settleTimer = window.setTimeout(function () {
        item.settling = false;
        item.element.classList.remove("is-settling");
      }, ZONE_MOTION_TIMEOUT);
    }

    function stopSettling(item) {
      window.clearTimeout(item.settleTimer);
      item.settling = false;
      item.element.classList.remove("is-settling");
    }

    // Empty zone: fade/scale out, then hide it from pointer and tab flow. An item
    // that docks during the exit cancels it (revealZone) and the zone fades back
    // in; nothing else in the demo is touched.
    function hideZone() {
      if (zoneHidden || zoneLeaving || zoneGrouping) return;
      zoneLeaving = true;
      zoneCard.classList.remove("is-collapsed");
      zoneCard.classList.add("is-leaving");
      zoneCard.setAttribute("data-zone-visible", "false");
      window.clearTimeout(zoneCollapseTimer);
      if (prefersReducedMotion()) {
        zoneCard.classList.remove("is-leaving");
        zoneCard.classList.add("is-collapsed");
        zoneLeaving = false;
        zoneHidden = true;
        announceZoneStatus("demo.status.zoneHidden");
        return;
      }
      zoneCollapseTimer = window.setTimeout(function () {
        zoneCard.classList.remove("is-leaving");
        zoneCard.classList.add("is-collapsed");
        zoneLeaving = false;
        zoneHidden = true;
        announceZoneStatus("demo.status.zoneHidden");
      }, ZONE_MOTION_TIMEOUT);
    }

    function revealZone() {
      if (!zoneHidden && !zoneLeaving) return;
      window.clearTimeout(zoneCollapseTimer);
      zoneHidden = false;
      zoneLeaving = false;
      zoneCard.classList.remove("is-collapsed");
      zoneCard.classList.remove("is-leaving");
      zoneCard.setAttribute("data-zone-visible", "true");
      announceZoneStatus("demo.status.zoneShown");
    }

    function updateZoneCollapse() {
      if (zoneItems.length === 0 || !zoneGeometryReady || zoneGrouping) return;
      if (zoneDockedCount() > 0) revealZone();
      else hideZone();
    }

    function screenRectOf(element) {
      var rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        w: rect.width,
        h: rect.height,
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2,
      };
    }

    function overlapFraction(a, b) {
      var width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      var height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (width <= 0 || height <= 0) return 0;
      var smaller = Math.min(a.w * a.h, b.w * b.h);
      return smaller === 0 ? 0 : (width * height) / smaller;
    }

    function maybeGroupZone() {
      if (zoneGrouping || zoneItems.length < 2 || zoneDockedCount() !== 0) return false;
      for (var index = 0; index < zoneItems.length; index += 1) {
        var entry = zoneItems[index];
        if (!entry.element.classList.contains("is-detached")) return false;
        if (entry.settling) return false;
      }
      var first = screenRectOf(zoneItems[0].element);
      var second = screenRectOf(zoneItems[1].element);
      var overlap = overlapFraction(first, second);
      var centres = Math.hypot(first.cx - second.cx, first.cy - second.cy);
      if (overlap < ZONE_GROUP_OVERLAP && centres > ZONE_GROUP_CENTRE_DISTANCE) return false;
      return groupZone();
    }

    // The floating toolbar is canvas chrome above the world on desktop; a grouped
    // zone is kept below it so the two never overlap. In the compact layout the
    // toolbar sits in its own row above the world, so the clearance is zero.
    function zoneTopLimit() {
      var toolbar = surface.querySelector(".demo-toolbar");
      if (toolbar === null) return 0;
      var worldBox = world.getBoundingClientRect();
      var toolbarBox = toolbar.getBoundingClientRect();
      if (toolbarBox.bottom <= worldBox.top + 1) return 0;
      var scale = worldBox.width / Math.max(1, world.clientWidth);
      var toolbarBottom = (toolbarBox.bottom - worldBox.top) / scale;
      return Math.max(0, toolbarBottom + readPixelToken("--space-8", 8));
    }

    function groupedOrientation() {
      var padding = readPixelToken("--space-16", 16);
      var gap = readPixelToken("--space-12", 12);
      var bounds = worldBounds();
      var first = zoneItems[0];
      var second = zoneItems[1];
      var horizontalWidth = first.width + gap + second.width + 2 * padding + 2 * zoneBorderWidth;
      var horizontalHeight = Math.max(first.height, second.height) + 2 * padding + 2 * zoneBorderWidth;
      var verticalWidth = Math.max(first.width, second.width) + 2 * padding + 2 * zoneBorderWidth;
      var verticalHeight = first.height + gap + second.height + 2 * padding + 2 * zoneBorderWidth;
      var horizontal = horizontalWidth <= bounds.w && horizontalHeight <= bounds.h;
      return {
        horizontal: horizontal,
        width: horizontal ? horizontalWidth : verticalWidth,
        height: horizontal ? horizontalHeight : verticalHeight,
      };
    }

    function placeGroupedZone(x, y) {
      var bounds = worldBounds();
      var width = zoneCard.offsetWidth;
      var height = zoneCard.offsetHeight;
      var top = Math.max(bounds.y, zoneTopLimit());
      var nextX = clamp(x, bounds.x, Math.max(bounds.x, bounds.x + bounds.w - width));
      var nextY = clamp(y, top, Math.max(top, bounds.y + bounds.h - height));
      zoneLayout = { x: nextX, y: nextY };
      zoneCard.style.setProperty("--zone-x", nextX.toFixed(1) + "px");
      zoneCard.style.setProperty("--zone-y", nextY.toFixed(1) + "px");
      return zoneLayout;
    }

    // Both items are free and overlap: animate a new zone in around their union
    // and ease both items into slots inside it (side by side when the surface is
    // wide enough, stacked otherwise). No edge is created or moved.
    function groupZone() {
      if (zoneGrouping || zoneItems.length < 2) return false;
      zoneGrouping = true;
      window.clearTimeout(zoneCollapseTimer);
      zoneHidden = false;
      zoneLeaving = false;
      if (zonePointer !== null) {
        var drag = zonePointer;
        zonePointer = null;
        drag.item.element.classList.remove("is-dragging");
        stopSettling(drag.item);
      }
      var index;
      for (index = 0; index < zoneItems.length; index += 1) {
        zoneItems[index].width = zoneItems[index].element.offsetWidth;
        zoneItems[index].height = zoneItems[index].element.offsetHeight;
        if (zoneItems[index].slot !== null) {
          zoneItems[index].slot.style.inlineSize = zoneItems[index].width + "px";
          zoneItems[index].slot.style.blockSize = zoneItems[index].height + "px";
        }
      }
      var bounds = worldBounds();
      var orientation = groupedOrientation();
      var horizontal = orientation.horizontal;
      var cardWidth = orientation.width;
      var cardHeight = orientation.height;
      var rects = [];
      for (index = 0; index < zoneItems.length; index += 1) {
        rects.push(worldRectOf(zoneItems[index].element));
      }
      var unionX = Math.min(rects[0].x, rects[1].x);
      var unionY = Math.min(rects[0].y, rects[1].y);
      // is-entering disables the card transition first, so pinning the card and
      // measuring the new slots happens at the final geometry (no mid-transition
      // measurements); removing it afterwards plays the opacity/scale entrance.
      zoneCard.classList.add("is-entering");
      zoneCard.classList.remove("is-leaving", "is-collapsed");
      zoneCard.classList.add("is-positioned");
      zoneCard.classList.toggle("is-horizontal", horizontal);
      zoneCard.setAttribute("data-zone-layout", "grouped");
      zoneCard.setAttribute("data-zone-orientation", horizontal ? "horizontal" : "vertical");
      zoneCard.setAttribute("data-zone-visible", "true");
      var padding = readPixelToken("--space-16", 16);
      zoneLayout = {
        x: clamp(unionX - padding, bounds.x, Math.max(bounds.x, bounds.x + bounds.w - cardWidth)),
        y: clamp(unionY - padding, bounds.y, Math.max(bounds.y, bounds.y + bounds.h - cardHeight)),
      };
      placeGroupedZone(zoneLayout.x, zoneLayout.y);
      void zoneCard.offsetWidth;
      syncZoneGeometry();
      for (index = 0; index < zoneItems.length; index += 1) {
        var entry = zoneItems[index];
        setZoneItemState(entry, "docked");
        entry.element.classList.remove("is-dragging");
        entry.progress = 0;
        startSettling(entry);
      }
      syncZoneGeometry();
      void zoneCard.offsetWidth;
      zoneCard.classList.remove("is-entering");
      announceZoneStatus("demo.status.grouped");
      zoneGrouping = false;
      return true;
    }

    function syncZoneGeometry() {
      if (!zoneGeometryReady) return;
      if (zoneCard.classList.contains("is-positioned")) {
        placeGroupedZone(zoneLayout.x, zoneLayout.y);
      }
      var index;
      for (index = 0; index < zoneItems.length; index += 1) {
        var measured = zoneItems[index];
        measured.width = measured.element.offsetWidth;
        measured.height = measured.element.offsetHeight;
        if (measured.slot !== null) {
          measured.slot.style.inlineSize = measured.width + "px";
          measured.slot.style.blockSize = measured.height + "px";
        }
      }
      // An existing grouped zone is re-fitted on every resize (and locale/height
      // change): the orientation is recomputed from the current item sizes and the
      // world, so 1440 -> 390 switches from side by side to stacked, then the zone
      // is clamped fully into the surface below the toolbar and the docked items
      // follow their new slots (both items stay visible).
      if (zoneCard.classList.contains("is-positioned")) {
        var refit = groupedOrientation();
        zoneCard.classList.toggle("is-horizontal", refit.horizontal);
        zoneCard.setAttribute("data-zone-orientation", refit.horizontal ? "horizontal" : "vertical");
        placeGroupedZone(zoneLayout.x, zoneLayout.y);
      }
      // Dock positions come from the slot's layout offset inside the card plus the
      // card's border-box origin, so an in-flight card scale (entrance) cannot
      // distort the measurement.
      var cardOrigin;
      if (zoneCard.classList.contains("is-positioned")) {
        cardOrigin = { x: zoneLayout.x, y: zoneLayout.y };
      } else {
        var cardRect = worldRectOf(zoneCard);
        cardOrigin = { x: cardRect.x, y: cardRect.y };
      }
      for (index = 0; index < zoneItems.length; index += 1) {
        var entry = zoneItems[index];
        if (entry.slot === null) continue;
        entry.dockX = cardOrigin.x + zoneBorderWidth + entry.slot.offsetLeft;
        entry.dockY = cardOrigin.y + zoneBorderWidth + entry.slot.offsetTop;
        var dragging = zonePointer !== null && zonePointer.item === entry;
        if (entry.element.classList.contains("is-detached")) {
          var clampedFree = clampToBounds(entry, entry.x, entry.y, worldBounds());
          entry.x = clampedFree.x;
          entry.y = clampedFree.y;
          placeZoneItem(entry);
        } else if (!dragging) {
          entry.x = entry.dockX;
          entry.y = entry.dockY;
          placeZoneItem(entry);
        }
      }
    }

    // The items start in the zone card grid. On the first drag they are replaced
    // by equally sized dock slots and moved into the zone container, so they can
    // leave the zone; their world coordinates are measured from those slots (the
    // dock position is never hard-coded).
    function ensureZoneGeometry() {
      if (zoneGeometryReady || zoneItems.length === 0) return;
      var index;
      for (index = 0; index < zoneItems.length; index += 1) {
        var item = zoneItems[index];
        item.width = item.element.offsetWidth;
        item.height = item.element.offsetHeight;
      }
      for (index = 0; index < zoneItems.length; index += 1) {
        var entry = zoneItems[index];
        var slot = document.createElement("span");
        slot.className = "demo-zone__slot";
        slot.setAttribute("data-zone-slot", entry.key);
        slot.setAttribute("aria-hidden", "true");
        slot.style.inlineSize = entry.width + "px";
        slot.style.blockSize = entry.height + "px";
        entry.element.parentNode.insertBefore(slot, entry.element);
        entry.slot = slot;
        zone.appendChild(entry.element);
        entry.element.classList.add("is-floating", "is-docked");
        entry.element.style.setProperty("--detach-progress", "0");
        setZoneItemState(entry, "docked");
      }
      zoneGeometryReady = true;
      zoneCard.setAttribute("data-zone-layout", "docked");
      zoneCard.setAttribute("data-zone-visible", "true");
      syncZoneGeometry();
      if (zoneObserver === null && typeof window.ResizeObserver === "function") {
        zoneObserver = new window.ResizeObserver(function () {
          if (zonePointer === null) syncZoneGeometry();
        });
        for (var observed = 0; observed < zoneItems.length; observed += 1) {
          zoneObserver.observe(zoneItems[observed].element);
        }
      }
    }

    function pointerOutsideZone(clientX, clientY) {
      var rect = zoneCard.getBoundingClientRect();
      var dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
      var dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
      return Math.hypot(dx, dy);
    }

    function zoneWorldPoint(event) {
      var worldRect = world.getBoundingClientRect();
      return {
        x: (event.clientX - worldRect.left) / scale,
        y: (event.clientY - worldRect.top) / scale,
      };
    }

    function detachProgress(distance) {
      var value = clamp(distance / ZONE_DETACH_DISTANCE, 0, 1);
      return value * value * (3 - 2 * value);
    }

    function onZoneItemPointerDown(item, event) {
      if (zonePointer !== null) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      var target = event.target;
      if (target instanceof Element && target.closest("button, a, input, textarea, select")) {
        return;
      }
      event.preventDefault();
      ensureZoneGeometry();
      var point = zoneWorldPoint(event);
      zonePointer = {
        pointerId: event.pointerId,
        item: item,
        grabX: point.x - item.x,
        grabY: point.y - item.y,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startedDetached: item.element.classList.contains("is-detached"),
        active: false,
      };
      stopSettling(item);
      item.element.classList.add("is-dragging");
      try {
        item.element.setPointerCapture(event.pointerId);
      } catch (error) {
        // Pointer capture is best effort; the drag keeps working without it.
      }
    }

    function onZoneItemPointerMove(item, event) {
      var drag = zonePointer;
      if (drag === null || drag.item !== item || drag.pointerId !== event.pointerId) return;
      if (!drag.active) {
        if (Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY) < threshold) {
          return;
        }
        drag.active = true;
      }
      stopSettling(item);
      var point = zoneWorldPoint(event);
      var distance = pointerOutsideZone(event.clientX, event.clientY);
      var progress = detachProgress(distance);
      var detached = item.element.classList.contains("is-detached");
      var stateChanged = false;
      if (!detached && distance >= ZONE_DETACH_DISTANCE) {
        detached = true;
        setZoneItemState(item, "detached");
        stateChanged = true;
      } else if (detached && distance <= ZONE_DOCK_DISTANCE && !zoneHidden) {
        // A collapsed zone is inert: dragging over its old area does not re-dock.
        // Only a zone that is still visible (or mid-exit) can take an item back.
        detached = false;
        setZoneItemState(item, "docked");
        stateChanged = true;
        item.x = item.dockX;
        item.y = item.dockY;
        drag.grabX = point.x - item.x;
        drag.grabY = point.y - item.y;
        item.element.classList.add("is-settling");
      }
      var targetX = point.x - drag.grabX;
      var targetY = point.y - drag.grabY;
      var position;
      if (detached) {
        item.progress = 1;
        position = clampToBounds(item, targetX, targetY, worldBounds());
      } else {
        item.progress = progress;
        var inside = clampToBounds(item, targetX, targetY, worldRectOf(zoneCard));
        var free = clampToBounds(item, targetX, targetY, worldBounds());
        position = {
          x: inside.x + (free.x - inside.x) * progress,
          y: inside.y + (free.y - inside.y) * progress,
        };
      }
      item.x = position.x;
      item.y = position.y;
      placeZoneItem(item);
      if (stateChanged) updateZoneCollapse();
      if (drag.active && detached) maybeGroupZone();
    }

    function settleZoneItem(item, detached) {
      item.element.classList.remove("is-dragging");
      if (detached) {
        var snapped = clampToBounds(item, snap(item.x), snap(item.y), worldBounds());
        item.x = snapped.x;
        item.y = snapped.y;
        item.progress = 1;
        setZoneItemState(item, "detached");
      } else {
        item.x = item.dockX;
        item.y = item.dockY;
        item.progress = 0;
        setZoneItemState(item, "docked");
      }
      startSettling(item);
      placeZoneItem(item);
      updateZoneCollapse();
    }

    function onZoneItemPointerEnd(item, event, cancelled) {
      var drag = zonePointer;
      if (drag === null || drag.item !== item || drag.pointerId !== event.pointerId) return;
      zonePointer = null;
      item.element.classList.remove("is-dragging");
      if (!drag.active) {
        item.element.classList.remove("is-settling");
        placeZoneItem(item);
        return;
      }
      // A collapsed zone is inert on release as well: dropping a free item over
      // its old rectangle keeps the item detached and the zone hidden. Only the
      // pointermove dock branch and this release decision can re-dock; both check
      // zoneHidden, and the zone comes back through re-grouping (or by docking
      // during the exit, before it is hidden).
      var detached;
      if (cancelled) {
        detached = item.element.classList.contains("is-detached");
      } else if (zoneHidden) {
        detached = true;
      } else {
        detached = pointerOutsideZone(event.clientX, event.clientY) > ZONE_RELEASE_DISTANCE;
      }
      if (!cancelled && detached && maybeGroupZone()) return;
      settleZoneItem(item, detached);
      if (detached !== drag.startedDetached) announceZoneItem(item, detached);
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
    });

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
