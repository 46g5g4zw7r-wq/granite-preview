// Синтетические снимки для тестов измерения: кусок камня, маркер ArUco DICT_4X4_50 id 0, перспектива.
var MARKER = [[0,0,0,0,0,0],[0,1,0,1,1,0],[0,0,1,0,1,0],[0,0,0,1,1,0],[0,0,0,1,0,0],[0,0,0,0,0,0]];

function rng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// opts: polyMm, markerMm (100), markerAtMm [x,y] (центр), markerRotDeg, tilt (0..0.15), pxPerMm (0.9),
//       sameColor (кусок как фон), seed
function makeScene(cv, opts) {
  var k = opts.pxPerMm || 0.9, pad = 250; // мм поля вокруг куска
  var poly = opts.polyMm, maxX = 0, maxY = 0;
  poly.forEach(function (p) { maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); });
  var W = Math.round((maxX + 2 * pad) * k), H = Math.round((maxY + 2 * pad) * k);
  var R = rng(opts.seed || 7);
  var img = new cv.Mat(H, W, cv.CV_8UC3);
  var d = img.data;
  var bg = opts.bg || [70, 75, 80], fg = opts.sameColor ? bg : (opts.fg || [205, 200, 190]);
  var toPx = function (p) { return [(p[0] + pad) * k, (p[1] + pad) * k]; };
  var pp = poly.map(toPx);
  function inside(x, y, pts) {
    var c = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var a = pts[i], b = pts[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
    var c = inside(x + 0.5, y + 0.5, pp) ? fg : bg, n = (R() - 0.5) * 30, o = (y * W + x) * 3;
    d[o] = Math.max(0, Math.min(255, c[0] + n)); d[o + 1] = Math.max(0, Math.min(255, c[1] + n)); d[o + 2] = Math.max(0, Math.min(255, c[2] + n));
  }
  // Маркер: белое поле 10% + 6x6 клеток, сторона чёрного квадрата = markerMm
  if (opts.markerMm) {
    var S = opts.markerMm, rot = (opts.markerRotDeg || 0) * Math.PI / 180, cx = opts.markerAtMm[0], cy = opts.markerAtMm[1];
    var ca = Math.cos(rot), sa = Math.sin(rot), half = S * 0.6;
    for (var yy = -half; yy <= half; yy += 0.5 / k) for (var xx = -half; xx <= half; xx += 0.5 / k) {
      var u = xx / S + 0.5, v = yy / S + 0.5, white = 1;
      if (u >= 0 && u < 1 && v >= 0 && v < 1) white = MARKER[Math.floor(v * 6)][Math.floor(u * 6)];
      var px = Math.round((cx + xx * ca - yy * sa + pad) * k), py = Math.round((cy + xx * sa + yy * ca + pad) * k);
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      var oo = (py * W + px) * 3, val = white ? 245 : 15;
      d[oo] = d[oo + 1] = d[oo + 2] = val;
    }
  }
  var out = img;
  if (opts.tilt) {
    var t = opts.tilt;
    var src = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, W, 0, W, H, 0, H]);
    var dst = cv.matFromArray(4, 1, cv.CV_32FC2, [W * t, H * t * 0.5, W * (1 - t * 0.3), 0, W, H, W * t * 0.6, H * (1 - t * 0.4)]);
    var M = cv.getPerspectiveTransform(src, dst);
    out = new cv.Mat();
    cv.warpPerspective(img, out, M, new cv.Size(W, H), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(bg[0], bg[1], bg[2], 255));
    img.delete(); src.delete(); dst.delete(); M.delete();
  }
  return { mat: out, truthPolyMm: poly };
}

function loadCVNode() {
  var m = require("@techstark/opencv-js");
  // Модуль OpenCV сам «thenable»: отдаём его в обёртке, иначе Promise зациклится
  return new Promise(function (resolve) {
    var done = function (cv) { resolve({ cv: cv }); };
    if (m.Mat) done(m); else if (typeof m.then === "function") m.then(done); else m.onRuntimeInitialized = function () { done(m); };
  });
}

module.exports = { makeScene: makeScene, loadCVNode: loadCVNode, MARKER: MARKER };
