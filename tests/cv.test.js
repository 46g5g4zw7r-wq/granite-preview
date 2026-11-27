// Run: NODE_PATH=/tmp/cvprobe/node_modules node tests/cv.test.js
var assert = require("assert");
var scene = require("./scene.js");
var Core = require("../measure-core.js");
var makeApi = require("../measure-cv.js");

var L = [[0, 0], [1500, 0], [1500, 400], [600, 400], [600, 900], [0, 900]];
function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, (msg || "") + " expected " + b + " ±" + tol + ", got " + a); }

// Точки истины (мм в плоскости камня) -> мм через выпрямленное изображение: проверяем масштаб и выпрямление,
// перенося истину сквозь ту же цепочку, что и изображение.
function _unusedMeasureTruth(cv, api, sc, markerMm) {
  var det = api.detectMarker(cv, sc.mat);
  assert.ok(det, "marker not found");
  var rec = api.rectify(cv, sc.mat, det.corners, markerMm);
  // В выпрямленном изображении маркер — квадрат со стороной markerMm/mmPerPx
  var q = rec.markerQuad, side = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]);
  near(side * rec.mmPerPx, markerMm, markerMm * 0.01, "marker side");
  var s = Core.summarize(L); // габарит истины не зависит от позы
  rec.mat.delete();
  return { rec: rec, s: s };
}

function polyIoU(cv, a, b, W, H) {
  function mask(p) {
    var m = cv.Mat.zeros(H, W, cv.CV_8UC1), mv = new cv.MatVector();
    var pts = cv.matFromArray(p.length, 1, cv.CV_32SC2, [].concat.apply([], p.map(function (x) { return [Math.round(x[0]), Math.round(x[1])]; })));
    mv.push_back(pts); cv.fillPoly(m, mv, new cv.Scalar(255)); pts.delete(); mv.delete(); return m;
  }
  var ma = mask(a), mb = mask(b), i = new cv.Mat(), u = new cv.Mat();
  cv.bitwise_and(ma, mb, i); cv.bitwise_or(ma, mb, u);
  var r = cv.countNonZero(i) / Math.max(1, cv.countNonZero(u));
  [ma, mb, i, u].forEach(function (m) { m.delete(); });
  return r;
}

var tests = [];
function test(n, f) { tests.push([n, f]); }

scene.loadCVNode().then(function (box) {
  var cv = box.cv, api = makeApi(cv);

  // Phone-like photo: ~2 px/mm, marker ~200 px. Limit: single 100 mm marker extrapolated over 1.5 m.
  [[2.0, 0.1, 0.5, 0.05], [2.0, 0.15, 0.5, 0.05], [0.9, 0.1, 1.25, 0.08]].forEach(function (c) {
    test("marker at top edge, " + c[0] + " px/mm, tilt " + c[1] + ": sizes within " + c[2] + "in, area within " + (c[3] * 100) + "%", function () {
      var sc = scene.makeScene(cv, { polyMm: L, markerMm: 100, markerAtMm: [1100, 120], markerRotDeg: 0, tilt: c[1], pxPerMm: c[0] });
      var det = api.detectMarker(cv, sc.mat); assert.ok(det, "not found");
      var rec = api.rectify(cv, sc.mat, det.corners, 100);
      var poly = api.autoContour(cv, rec.mat, rec.markerQuad);
      var s = Core.summarize(poly.map(function (p) { return [p[0] * rec.mmPerPx, p[1] * rec.mmPerPx]; }));
      var t = Core.summarize(L);
      near(s.wIn, t.wIn, c[2], "wIn"); near(s.hIn, t.hIn, c[2], "hIn"); near(s.areaFt2, t.areaFt2, t.areaFt2 * c[3], "area");
      rec.mat.delete(); sc.mat.delete();
    });
  });

  // Any marker position/rotation: full pipeline, same tolerances; photo "up" must stay up (long side horizontal)
  [[90, [300, 600], 127, 0.1], [45, [300, 600], 127, 0.1], [180, [1200, 200], 100, 0.1], [0, [1100, 120], 100, 0.25]].forEach(function (c) {
    test("marker rot " + c[0] + "deg at " + c[1] + ", " + c[2] + " mm, tilt " + c[3] + ": sizes within " + (c[3] > 0.2 ? 1.0 : 0.6) + "in, picture upright", function () {
      var sc = scene.makeScene(cv, { polyMm: L, markerMm: c[2], markerAtMm: c[1], markerRotDeg: c[0], tilt: c[3], pxPerMm: 2, seed: c[0] + 1 });
      var det = api.detectMarker(cv, sc.mat); assert.ok(det, "not found");
      var rec = api.rectify(cv, sc.mat, det.corners, c[2]);
      var poly = api.autoContour(cv, rec.mat, rec.markerQuad);
      var mm = poly.map(function (p) { return [p[0] * rec.mmPerPx, p[1] * rec.mmPerPx]; });
      var s = Core.summarize(mm), t = Core.summarize(L);
      var tol = c[3] > 0.2 ? 1.0 : 0.6;
      near(s.wIn, t.wIn, tol, "wIn"); near(s.hIn, t.hIn, tol, "hIn");
      var a = Core.minAreaRect(mm).angle % Math.PI; if (a < 0) a += Math.PI;
      var off = Math.min(a, Math.PI - a) * 180 / Math.PI;
      assert.ok(off < 12, "long side tilted " + off.toFixed(1) + " deg from horizontal");
      rec.mat.delete(); sc.mat.delete();
    });
  });

  test("no marker -> null", function () {
    var sc = scene.makeScene(cv, { polyMm: L, markerMm: 0 });
    assert.strictEqual(api.detectMarker(cv, sc.mat), null); sc.mat.delete();
  });

  test("autoContour: plain background -> IoU >= 0.9, 3..12 points", function () {
    var sc = scene.makeScene(cv, { polyMm: L, markerMm: 100, markerAtMm: [900, 150], tilt: 0 });
    var det = api.detectMarker(cv, sc.mat), rec = api.rectify(cv, sc.mat, det.corners, 100);
    var poly = api.autoContour(cv, rec.mat, rec.markerQuad);
    assert.ok(poly.length >= 3 && poly.length <= 12, "points " + poly.length);
    // истина в выпрямленных пикселях: tilt 0 -> сдвиг + масштаб; находим через угол маркера
    var q = rec.markerQuad, cxPx = (q[0][0] + q[2][0]) / 2, cyPx = (q[0][1] + q[2][1]) / 2;
    var truth = L.map(function (p) { return [cxPx + (p[0] - 900) / rec.mmPerPx, cyPx + (p[1] - 150) / rec.mmPerPx]; });
    var iou = polyIoU(cv, poly, truth, rec.mat.cols, rec.mat.rows);
    assert.ok(iou >= 0.9, "IoU " + iou.toFixed(3));
    rec.mat.delete(); sc.mat.delete();
  });

  test("autoContour: piece same as background -> 4-point fallback, no throw", function () {
    var sc = scene.makeScene(cv, { polyMm: L, markerMm: 100, markerAtMm: [900, 150], sameColor: true });
    var det = api.detectMarker(cv, sc.mat), rec = api.rectify(cv, sc.mat, det.corners, 100);
    var poly = api.autoContour(cv, rec.mat, rec.markerQuad);
    assert.ok(poly.length >= 3 && poly.length <= 12, "points " + poly.length);
    rec.mat.delete(); sc.mat.delete();
  });

  var fails = 0;
  tests.forEach(function (t) {
    try { t[1](); console.log("PASS", t[0]); } catch (e) { fails++; console.log("FAIL", t[0], "-", e.message || e); }
  });
  console.log(fails ? fails + " failed" : "all " + tests.length + " passed");
  process.exit(fails ? 1 : 0);
}).catch(function (e) { console.log("FAIL setup -", e.message || e); process.exit(1); });
