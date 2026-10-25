// P0-20 live connection demo for the static design preview, extended in P0-23 with
// four visible connection anchors per card. Plain DOM, pointer events and one SVG
// edge: no dependencies, no engine, no data.

(function () {
  "use strict";

  var DRAG_THRESHOLD_FALLBACK = 4;
  var CANVAS_GRID_FALLBACK = 16;
  // Half of the 6 px anchor dot: the dot sits inside the card, so its centre is
  // 3 px away from the card edge.
  var ANCHOR_HALF = 3;
  var MIN_EDGE_LENGTH = 1;

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

  function setupDemo(demo) {
    var surface = demo.querySelector("[data-demo-surface]");
    var edge = demo.querySelector("[data-demo-edge]");
    if (surface === null || edge === null) return;

    var edgeLine = edge.querySelector("[data-demo-edge-line]");
    var edgeDots = edge.querySelectorAll("[data-demo-edge-dot]");
    var status = demo.querySelector("[data-demo-status]");
    if (edgeLine === null || edgeDots.length < 2) return;

    var grid = readPixelToken("--canvas-grid", CANVAS_GRID_FALLBACK);
    var threshold = readPixelToken("--drag-threshold", DRAG_THRESHOLD_FALLBACK);
    var cards = [];
    var activePointer = null;
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
      var dx = end.x - start.x;
      var dy = end.y - start.y;
      var length = Math.hypot(dx, dy);
      if (length > 0 && length < MIN_EDGE_LENGTH) {
        end = {
          side: end.side,
          x: start.x + (dx / length) * MIN_EDGE_LENGTH,
          y: start.y + (dy / length) * MIN_EDGE_LENGTH,
        };
      }
      edge.setAttribute(
        "viewBox",
        "0 0 " + surface.clientWidth + " " + surface.clientHeight,
      );
      edgeLine.setAttribute("x1", start.x.toFixed(1));
      edgeLine.setAttribute("y1", start.y.toFixed(1));
      edgeLine.setAttribute("x2", end.x.toFixed(1));
      edgeLine.setAttribute("y2", end.y.toFixed(1));
      edgeDots[0].setAttribute("cx", start.x.toFixed(1));
      edgeDots[0].setAttribute("cy", start.y.toFixed(1));
      edgeDots[1].setAttribute("cx", end.x.toFixed(1));
      edgeDots[1].setAttribute("cy", end.y.toFixed(1));
      highlightAnchors(pair);
    }

    function announce(card) {
      if (status === null) return;
      var column = Math.round(card.x / grid) + 1;
      var row = Math.round(card.y / grid) + 1;
      status.textContent = "Card " + card.label + " at column " + column + ", row " + row + ".";
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
      var dx = event.clientX - activePointer.startClientX;
      var dy = event.clientY - activePointer.startClientY;
      if (!activePointer.dragging) {
        if (Math.hypot(dx, dy) < threshold) return;
        activePointer.dragging = true;
        card.element.classList.add("is-dragging");
      }
      card.x = activePointer.startX + dx;
      card.y = activePointer.startY + dy;
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
