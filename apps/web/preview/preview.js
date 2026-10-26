// P0-20 live connection demo for the static design preview: two cards, a curved
// edge snapped to invisible side-midpoint anchors (P0-23/P0-25) and preview-only
// zoom controls (P0-24). P0-26 adds the preview-only toolbar selection state and
// P0-27 the DE/EN locale controller (locale JSON over HTTP, no build step).
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
