// Run: node tests/core.test.js
var assert = require("assert");
var C = require("../measure-core.js");

function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, (msg || "") + " expected " + b + " ±" + tol + ", got " + a); }
var tests = [];
function test(name, fn) { tests.push([name, fn]); }

test("polygonArea: rectangle, both windings", function () {
  assert.strictEqual(C.polygonArea([[0, 0], [100, 0], [100, 50], [0, 50]]), 5000);
  assert.strictEqual(C.polygonArea([[0, 50], [100, 50], [100, 0], [0, 0]]), 5000);
});

test("minAreaRect: 1000x500 rotated 30deg", function () {
  var a = Math.PI / 6, pts = [[0, 0], [1000, 0], [1000, 500], [0, 500]].map(function (p) {
    return [p[0] * Math.cos(a) - p[1] * Math.sin(a) + 300, p[0] * Math.sin(a) + p[1] * Math.cos(a) + 200];
  });
  var r = C.minAreaRect(pts);
  near(r.w, 1000, 0.5, "w"); near(r.h, 500, 0.5, "h");
});

test("summarize: L-shape", function () {
  var s = C.summarize([[0, 0], [1500, 0], [1500, 400], [600, 400], [600, 900], [0, 900]]);
  assert.strictEqual(s.wIn, 59.1); assert.strictEqual(s.hIn, 35.4);
  assert.strictEqual(s.areaFt2, Math.round((1500 * 400 + 600 * 500) / 92903.04 * 10) / 10);
  near(s.innerWIn, 59.1, 0.2, "innerW"); near(s.innerHIn, 15.7, 0.2, "innerH");
});

test("largestInscribedRect: trapezoid keeps >=98% of 1000x600", function () {
  var pts = [[0, 0], [1200, 0], [1000, 600], [0, 600]];
  var r = C.minAreaRect(pts);
  var ir = C.largestInscribedRect(pts, r.angle, 2.5);
  assert.ok(ir.w * ir.h >= 0.98 * 1000 * 600, "area " + ir.w * ir.h);
  assert.strictEqual(ir.corners.length, 4);
});

test("summarize: degenerate input gives finite numbers", function () {
  [[[0, 0], [100, 100], [100, 0], [0, 100]], [[0, 0], [10, 10]], []].forEach(function (p) {
    var s = C.summarize(p);
    ["wIn", "hIn", "areaFt2", "innerWIn", "innerHIn"].forEach(function (k) { assert.ok(isFinite(s[k]), k + " not finite for " + JSON.stringify(p)); });
  });
});

var fails = 0;
tests.forEach(function (t) {
  try { t[1](); console.log("PASS", t[0]); } catch (e) { fails++; console.log("FAIL", t[0], "-", e.message); }
});
console.log(fails ? fails + " failed" : "all " + tests.length + " passed");
process.exit(fails ? 1 : 0);
