/* Slabwise — поиск маркера ArUco, выпрямление перспективы, автоконтур куска (OpenCV.js 4.10).
   В браузере: window.SlabCV (loadCV + функции); в node: module.exports = function (cv) -> api. */
(function (root) {
  "use strict";

  function pts32(cv, arr) { return cv.matFromArray(arr.length, 1, cv.CV_32FC2, [].concat.apply([], arr)); }

  function toGray(cv, mat) {
    var g = new cv.Mat();
    if (mat.channels() === 4) cv.cvtColor(mat, g, cv.COLOR_RGBA2GRAY);
    else if (mat.channels() === 3) cv.cvtColor(mat, g, cv.COLOR_RGB2GRAY);
    else mat.copyTo(g);
    return g;
  }

  // Маркер DICT_4X4_50 id 0. Углы: верх-лево, верх-право, низ-право, низ-лево маркера.
  function detectMarker(cv, mat) {
    var gray = toGray(cv, mat), dict = null, params = null, ref = null, det = null;
    var corners = new cv.MatVector(), ids = new cv.Mat(), rej = new cv.MatVector();
    try {
      dict = cv.getPredefinedDictionary(cv.DICT_4X4_50);
      params = new cv.aruco_DetectorParameters();
      // Субпиксельные углы: маркер маленький, ошибка в 1 пиксель даёт проценты на всём куске
      params.cornerRefinementMethod = 1; // CORNER_REFINE_SUBPIX
      params.cornerRefinementWinSize = 5;
      params.cornerRefinementMaxIterations = 50;
      params.cornerRefinementMinAccuracy = 0.01;
      ref = new cv.aruco_RefineParameters(10, 3, true);
      det = new cv.aruco_ArucoDetector(dict, params, ref);
      det.detectMarkers(gray, corners, ids, rej);
      for (var i = 0; i < ids.rows; i++) {
        if (ids.data32S[i] !== 0) continue;
        var c = corners.get(i), d = c.data32F, out = [[d[0], d[1]], [d[2], d[3]], [d[4], d[5]], [d[6], d[7]]];
        c.delete();
        return { corners: out };
      }
      return null;
    } finally {
      [gray, corners, ids, rej, det, ref, params, dict].forEach(function (m) { if (m && m.delete) try { m.delete(); } catch (e) {} });
    }
  }

  function applyH(h, p) {
    var w = h[6] * p[0] + h[7] * p[1] + h[8];
    return [(h[0] * p[0] + h[1] * p[1] + h[2]) / w, (h[3] * p[0] + h[4] * p[1] + h[5]) / w];
  }

  // Выпрямление: плоскость камня в мм -> пиксели, длинная сторона <= maxSide.
  function rectify(cv, mat, corners, markerMm, maxSide) {
    maxSide = maxSide || 1600;
    var S = markerMm, src = pts32(cv, corners), dst = pts32(cv, [[0, 0], [S, 0], [S, S], [0, S]]);
    var H0 = cv.getPerspectiveTransform(src, dst), h = Array.from(H0.data64F);
    src.delete(); dst.delete(); H0.delete();
    var W = mat.cols, Ht = mat.rows;
    var fr = [[0, 0], [W, 0], [W, Ht], [0, Ht]].map(function (p) { return applyH(h, p); });
    // Углы кадра могут уйти очень далеко при сильном наклоне: ограничиваем рамку 30 сторонами маркера
    var lim = S * 30, mx = (corners[0][0]), minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    fr.forEach(function (p) {
      var x = Math.max(-lim, Math.min(lim, p[0])), y = Math.max(-lim, Math.min(lim, p[1]));
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    });
    void mx;
    var spanX = maxX - minX, spanY = maxY - minY;
    var scale = maxSide / Math.max(spanX, spanY); // пикселей на мм
    var T = [scale, 0, -minX * scale, 0, scale, -minY * scale, 0, 0, 1];
    var M = mul3(T, h);
    var Mm = cv.matFromArray(3, 3, cv.CV_64F, M), out = new cv.Mat(), rgba = new cv.Mat();
    var outW = Math.max(1, Math.round(spanX * scale)), outH = Math.max(1, Math.round(spanY * scale));
    // Всегда RGBA с непрозрачным снимком: поле за краем кадра получается прозрачным (alpha 0)
    if (mat.channels() === 4) { mat.copyTo(rgba); var ad = rgba.data; for (var ai = 3; ai < ad.length; ai += 4) ad[ai] = 255; }
    else if (mat.channels() === 3) cv.cvtColor(mat, rgba, cv.COLOR_RGB2RGBA);
    else cv.cvtColor(mat, rgba, cv.COLOR_GRAY2RGBA);
    cv.warpPerspective(rgba, out, Mm, new cv.Size(outW, outH), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 0));
    Mm.delete(); rgba.delete();
    var q = corners.map(function (p) { return applyH(M, p); });
    return { mat: out, mmPerPx: 1 / scale, markerQuad: q, H: M };
  }

  function mul3(a, b) {
    var r = new Array(9);
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
    return r;
  }

  function fallbackRect(markerQuad, W, H) {
    var xs = markerQuad.map(function (p) { return p[0]; }), ys = markerQuad.map(function (p) { return p[1]; });
    var cx = (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2, cy = (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2;
    var hw = (Math.max.apply(null, xs) - Math.min.apply(null, xs)) * 2, hh = (Math.max.apply(null, ys) - Math.min.apply(null, ys)) * 2;
    var x0 = Math.max(0, cx - hw), x1 = Math.min(W - 1, cx + hw), y0 = Math.max(0, cy - hh), y1 = Math.min(H - 1, cy + hh);
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  }

  // Автоконтур: GrabCut, маркер — точно кусок, полоса по краю кадра — фон.
  function autoContour(cv, rectMat, markerQuad, workSide) {
    var W = rectMat.cols, H = rectMat.rows;
    var k = Math.min(1, (workSide || 640) / Math.max(W, H));
    var small = new cv.Mat(), rgb = new cv.Mat(), mask = null, bgd = new cv.Mat(), fgd = new cv.Mat();
    var fg = new cv.Mat(), labels = new cv.Mat(), stats = new cv.Mat(), cents = new cv.Mat(), comp = new cv.Mat();
    var contours = new cv.MatVector(), hier = new cv.Mat();
    try {
      cv.resize(rectMat, small, new cv.Size(Math.max(2, Math.round(W * k)), Math.max(2, Math.round(H * k))), 0, 0, cv.INTER_AREA);
      if (small.channels() === 4) cv.cvtColor(small, rgb, cv.COLOR_RGBA2RGB); else if (small.channels() === 1) cv.cvtColor(small, rgb, cv.COLOR_GRAY2RGB); else small.copyTo(rgb);
      var w = rgb.cols, h = rgb.rows;
      mask = new cv.Mat(h, w, cv.CV_8UC1, new cv.Scalar(cv.GC_PR_FGD));
      // Фон: полоса вдоль настоящего края снимка (после выпрямления края косые) и чёрные поля за кадром
      var band = Math.max(2, Math.round(Math.min(w, h) * 0.03));
      var valid = new cv.Mat(h, w, cv.CV_8UC1), inner = new cv.Mat();
      if (small.channels() === 4) { var sd = small.data; for (var vi = 0; vi < w * h; vi++) valid.data[vi] = sd[vi * 4 + 3] > 200 ? 255 : 0; }
      else valid.setTo(new cv.Scalar(255));
      var ek = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(band * 2 + 1, band * 2 + 1));
      cv.erode(valid, inner, ek, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, new cv.Scalar(0));
      ek.delete();
      for (var i = 0; i < inner.data.length; i++) if (!inner.data[i]) mask.data[i] = cv.GC_BGD;
      valid.delete(); inner.delete();
      var q = markerQuad.map(function (p) { return [p[0] * k, p[1] * k]; });
      var mcx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, mcy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
      var qq = q.map(function (p) { return [Math.round(mcx + (p[0] - mcx) * 1.2), Math.round(mcy + (p[1] - mcy) * 1.2)]; });
      var qm = cv.matFromArray(4, 1, cv.CV_32SC2, [].concat.apply([], qq)), qv = new cv.MatVector();
      qv.push_back(qm); cv.fillPoly(mask, qv, new cv.Scalar(cv.GC_FGD)); qm.delete(); qv.delete();
      seedByColor(cv, rgb, mask, q, mcx, mcy);
      if (cv.setRNGSeed) cv.setRNGSeed(12345);
      cv.grabCut(rgb, mask, new cv.Rect(0, 0, 1, 1), bgd, fgd, 5, cv.GC_INIT_WITH_MASK);
      fg = new cv.Mat(h, w, cv.CV_8UC1);
      for (var j = 0; j < mask.data.length; j++) fg.data[j] = (mask.data[j] === cv.GC_FGD || mask.data[j] === cv.GC_PR_FGD) ? 255 : 0;
      var kern = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
      cv.morphologyEx(fg, fg, cv.MORPH_OPEN, kern); kern.delete();
      // Маркер с белой рамкой лежит на камне: рамка не должна отрезать его от куска
      var qq2 = q.map(function (p) { return [Math.round(mcx + (p[0] - mcx) * 1.5), Math.round(mcy + (p[1] - mcy) * 1.5)]; });
      var qm2 = cv.matFromArray(4, 1, cv.CV_32SC2, [].concat.apply([], qq2)), qv2 = new cv.MatVector();
      qv2.push_back(qm2); cv.fillPoly(fg, qv2, new cv.Scalar(255)); qm2.delete(); qv2.delete();
      cv.connectedComponentsWithStats(fg, labels, stats, cents, 8, cv.CV_32S);
      var lab = labels.data32S[Math.min(h - 1, Math.max(0, Math.round(mcy))) * w + Math.min(w - 1, Math.max(0, Math.round(mcx)))];
      var markerArea = Math.abs((q[1][0] - q[0][0]) * (q[3][1] - q[0][1]));
      if (lab <= 0 || stats.intAt(lab, cv.CC_STAT_AREA) < markerArea * 2 || stats.intAt(lab, cv.CC_STAT_AREA) > w * h * 0.9) return fallbackRect(markerQuad, W, H);
      comp = new cv.Mat(h, w, cv.CV_8UC1);
      for (var t = 0; t < labels.data32S.length; t++) comp.data[t] = labels.data32S[t] === lab ? 255 : 0;
      cv.findContours(comp, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      if (!contours.size()) return fallbackRect(markerQuad, W, H);
      var big = contours.get(0), bestA = cv.contourArea(big);
      for (var c = 1; c < contours.size(); c++) { var cc = contours.get(c), a = cv.contourArea(cc); if (a > bestA) { big.delete(); big = cc; bestA = a; } else cc.delete(); }
      var per = cv.arcLength(big, true), eps = per * 0.01, approx = new cv.Mat(), pts = [];
      for (var tries = 0; tries < 12; tries++) {
        cv.approxPolyDP(big, approx, eps, true);
        if (approx.rows <= 12) break;
        eps *= 1.4;
      }
      for (var r = 0; r < approx.rows; r++) pts.push([approx.data32S[r * 2] / k, approx.data32S[r * 2 + 1] / k]);
      approx.delete(); big.delete();
      return pts.length >= 3 ? pts : fallbackRect(markerQuad, W, H);
    } catch (e) {
      api.lastError = String(e && e.message || e);
      return fallbackRect(markerQuad, W, H);
    } finally {
      [small, rgb, mask, bgd, fgd, fg, labels, stats, cents, comp, contours, hier].forEach(function (m) { if (m && m.delete) try { m.delete(); } catch (e) {} });
    }
  }


  // Начальная разметка: цвет камня — медиана кольца вокруг маркера, цвет фона — медиана полосы у края.
  // Пиксели кольца, похожие на камень, — точно кусок; остальные — «вероятно кусок/фон» по близости цвета.
  function seedByColor(cv, rgb, mask, q, mcx, mcy) {
    var w = rgb.cols, h = rgb.rows, d = rgb.data;
    var side = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]);
    var r0 = side * 0.85, r1 = side * 1.6, ring = [], bg = [];
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var i = y * w + x, m = mask.data[i];
      if (m === cv.GC_BGD) { if (d[i * 3] + d[i * 3 + 1] + d[i * 3 + 2] > 6 && (x + y) % 3 === 0) bg.push(i); continue; }
      var dx = Math.abs(x - mcx), dy = Math.abs(y - mcy), cheb = Math.max(dx, dy);
      if (m !== cv.GC_FGD && cheb > r0 && cheb < r1) ring.push(i);
    }
    function med(list) {
      var out = [0, 0, 0];
      for (var c = 0; c < 3; c++) {
        var v = list.map(function (i) { return d[i * 3 + c]; }).sort(function (a, b) { return a - b; });
        out[c] = v.length ? v[v.length >> 1] : 0;
      }
      return out;
    }
    if (ring.length < 10) return;
    var fgC = med(ring), bgC = bg.length >= 10 ? med(bg) : null;
    function dist(i, c) { var a = d[i * 3] - c[0], b = d[i * 3 + 1] - c[1], e = d[i * 3 + 2] - c[2]; return a * a + b * b + e * e; }
    var ringSet = {};
    ring.forEach(function (i) { ringSet[i] = 1; if (!bgC || dist(i, fgC) * 2 < dist(i, bgC)) mask.data[i] = cv.GC_FGD; });
    if (!bgC) return;
    for (var j = 0; j < mask.data.length; j++) {
      var mm = mask.data[j];
      if (mm === cv.GC_PR_FGD && !ringSet[j]) mask.data[j] = dist(j, fgC) <= dist(j, bgC) ? cv.GC_PR_FGD : cv.GC_PR_BGD;
    }
  }

  var cvPromise = null;
  // Браузер: грузим vendor/opencv.js один раз, только когда он нужен
  function loadCV(src) {
    if (cvPromise) return cvPromise;
    cvPromise = new Promise(function (resolve, reject) {
      var done = function (cv) { resolve({ cv: cv }); };
      var s = document.createElement("script");
      s.src = src || "vendor/opencv.js";
      s.async = true;
      s.onload = function () {
        var m = root.cv;
        if (!m) { reject(new Error("opencv missing")); return; }
        if (m.Mat) done(m);
        else if (typeof m.then === "function") m.then(function (cv) { root.cv = cv; done(cv); });
        else m.onRuntimeInitialized = function () { done(m); };
      };
      s.onerror = function () { cvPromise = null; reject(new Error("opencv load failed")); };
      document.head.appendChild(s);
    });
    return cvPromise;
  }

  var api = { detectMarker: detectMarker, rectify: rectify, autoContour: autoContour, applyH: applyH };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = function () { return api; };
  } else {
    api.loadCV = loadCV;
    root.SlabCV = api;
  }
})(typeof window !== "undefined" ? window : this);
