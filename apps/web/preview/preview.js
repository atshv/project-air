// P0-20 live connection demo for the static design preview, extended in P0-23 with
// four visible connection anchors per card and in P0-24 with a curved edge and
// preview-only zoom controls. Plain DOM, pointer events and one SVG path: no
// dependencies, no engine, no data.

(function () {
  "use strict";

  var DRAG_THRESHOLD_FALLBACK = 4;
  var CANVAS_GRID_FALLBACK = 16;
  // Half of the 8 px anchor dot: the dot sits inside the card, so its centre is
  // 4 px away from the card edge.
  var ANCHOR_HALF = 4;
  var MIN_EDGE_LENGTH = 1;
  var CURVE_OFFSET_FALLBACK = 48;
  var ZOOM_MIN = 0.5;
  var ZOOM_MAX = 1.5;
  var ZOOM_STEP = 0.1;
  var SCALE_PRECISION = 10;

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
      var anchorElements = element.querySelectorAll(".demo-anchor");
      var anchors = [];
      for (var anchorIndex = 0; anchorIndex < anchorElements.length; anchorIndex += 1) {
        anchors.push({
          side: anchorElements[anchorIndex].getAttribute("data-anchor") || "",
          element: anchorElements[anchorIndex],
        });
      }
      cards.push({
        element: element,
        label: (element.getAttribute("data-demo-card") || "?").toUpperCase(),
        anchors: anchors,
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
        x: Math.max(0, surface.clientWidth - card.element.offsetWidth),
        y: Math.max(0, surface.clientHeight - card.element.offsetHeight),
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

    function highlightAnchors(pair) {
      for (var cardIndex = 0; cardIndex < cards.length; cardIndex += 1) {
        var usedSide = cardIndex === 0 ? pair.a.side : pair.b.side;
        var card = cards[cardIndex];
        card.element.setAttribute("data-demo-used", usedSide);
        for (var anchorIndex = 0; anchorIndex < card.anchors.length; anchorIndex += 1) {
          card.anchors[anchorIndex].element.classList.toggle(
            "is-used",
            card.anchors[anchorIndex].side === usedSide,
          );
        }
      }
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
        "0 0 " + surface.clientWidth + " " + surface.clientHeight,
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
      highlightAnchors(pair);
    }

    function announce(card) {
      if (status === null) return;
      var column = Math.round(card.x / grid) + 1;
      var row = Math.round(card.y / grid) + 1;
      status.textContent = "Card " + card.label + " at column " + column + ", row " + row + ".";
    }

    function announceZoom() {
      if (status === null) return;
      status.textContent = "Zoom " + Math.round(scale * 100) + " percent.";
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
      if (status !== null) status.textContent = "Both cards returned to their start positions.";
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

  function init() {
    var demos = document.querySelectorAll("[data-demo]");
    for (var i = 0; i < demos.length; i += 1) setupDemo(demos[i]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
