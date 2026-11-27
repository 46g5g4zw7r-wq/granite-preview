/* Slabwise — геометрия измерения остатка (без OpenCV).
   Все расчёты в миллиметрах; summarize() переводит в дюймы и кв. футы. */
(function (root) {
  "use strict";
  var MM_PER_IN = 25.4, MM2_PER_FT2 = 92903.04;

  function polygonArea(pts) {
    var s = 0, n = pts.length;
    for (var i = 0; i < n; i++) {
      var a = pts[i], b = pts[(i + 1) % n];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(s) / 2;
  }

  function convexHull(pts) {
    var p = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    if (p.length < 3) return p;
    function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], hi = [], i;
    for (i = 0; i < p.length; i++) {
      while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p[i]) <= 0) lo.pop();
      lo.push(p[i]);
    }
    for (i = p.length - 1; i >= 0; i--) {
      while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p[i]) <= 0) hi.pop();
      hi.push(p[i]);
    }
    lo.pop(); hi.pop();
    return lo.concat(hi);
  }

  function rotate(pts, a) {
    var c = Math.cos(a), s = Math.sin(a);
    return pts.map(function (p) { return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]; });
  }

  // Прямоугольник минимальной площади: одна из сторон лежит на ребре выпуклой оболочки
  function minAreaRect(pts) {
    var h = convexHull(pts);
    if (h.length < 2) return { w: 0, h: 0, angle: 0 };
    var best = null;
    for (var i = 0; i < h.length; i++) {
      var a = h[i], b = h[(i + 1) % h.length];
      var ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      var r = rotate(h, -ang);
      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      r.forEach(function (p) {
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
      });
      var w = maxX - minX, hh = maxY - minY;
      if (!best || w * hh < best.w * best.h - 1e-9) best = { w: w, h: hh, angle: ang };
    }
    if (best.h > best.w) best = { w: best.h, h: best.w, angle: best.angle + Math.PI / 2 };
    return best;
  }

  function inside(x, y, pts) {
    var c = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var a = pts[i], b = pts[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }

  // Самый большой прямоугольник внутри многоугольника со сторонами вдоль angle
  function largestInscribedRect(pts, angle, cell) {
    var none = { w: 0, h: 0, corners: [[0, 0], [0, 0], [0, 0], [0, 0]] };
    if (pts.length < 3 || !(cell > 0)) return none;
    var r = rotate(pts, -angle);
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    r.forEach(function (p) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    });
    var cols = Math.ceil((maxX - minX) / cell), rows = Math.ceil((maxY - minY) / cell);
    if (!(cols > 0 && rows > 0) || cols * rows > 4e6) return none;
    var heights = new Int32Array(cols), best = { area: 0 };
    for (var y = 0; y < rows; y++) {
      var cy = minY + (y + 0.5) * cell;
      for (var x = 0; x < cols; x++) heights[x] = inside(minX + (x + 0.5) * cell, cy, r) ? heights[x] + 1 : 0;
      var stack = [];
      for (var i = 0; i <= cols; i++) {
        var hcur = i < cols ? heights[i] : 0;
        while (stack.length && heights[stack[stack.length - 1]] >= hcur) {
          var top = stack.pop(), ht = heights[top];
          var left = stack.length ? stack[stack.length - 1] + 1 : 0, wdt = i - left;
          if (ht * wdt > best.area) best = { area: ht * wdt, x0: left, x1: i, y0: y - ht + 1, y1: y + 1 };
        }
        stack.push(i);
      }
    }
    if (!best.area) return none;
    var x0 = minX + best.x0 * cell, x1 = minX + best.x1 * cell, y0 = minY + best.y0 * cell, y1 = minY + best.y1 * cell;
    var w = x1 - x0, h = y1 - y0;
    return { w: w, h: h, corners: rotate([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], angle) };
  }

  function r1(v) { return isFinite(v) ? Math.round(v * 10) / 10 : 0; }

  function summarize(ptsMm) {
    var pts = (ptsMm || []).filter(function (p) { return p && isFinite(p[0]) && isFinite(p[1]); });
    var box = minAreaRect(pts);
    var inner = largestInscribedRect(pts, box.angle, 2.5);
    var iw = Math.max(inner.w, inner.h), ih = Math.min(inner.w, inner.h);
    return {
      wIn: r1(box.w / MM_PER_IN), hIn: r1(box.h / MM_PER_IN),
      areaFt2: r1(pts.length >= 3 ? polygonArea(pts) / MM2_PER_FT2 : 0),
      innerWIn: r1(iw / MM_PER_IN), innerHIn: r1(ih / MM_PER_IN),
      inner: inner.corners
    };
  }

  var api = { polygonArea: polygonArea, convexHull: convexHull, minAreaRect: minAreaRect,
              largestInscribedRect: largestInscribedRect, summarize: summarize };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SlabCore = api;
})(typeof window !== "undefined" ? window : this);
