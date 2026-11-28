// Run: node tests/cloud.test.js
var assert = require("assert");
var P = require("../cloud.js").pure;
var tests = [];
function test(name, fn) { tests.push([name, fn]); }

test("stable: key order does not matter, undefined dropped", function () {
  assert.strictEqual(P.stable({ b: 1, a: [1, { d: 2, c: undefined }] }), P.stable({ a: [1, { d: 2 }], b: 1 }));
});
test("hash: same entry same hash, different entry different hash", function () {
  var e = { time: "2026-11-27T10:00:00Z", code: "S-001", action: "job", job: "J1" };
  assert.strictEqual(P.hash(e), P.hash(Object.assign({}, e)));
  assert.notStrictEqual(P.hash(e), P.hash(Object.assign({}, e, { job: "J2" })));
  assert.strictEqual(P.hash(e).length, 16);
});
test("diffItems: new, changed, removed, unchanged", function () {
  var prev = [{ code: "S-1", name: "A" }, { code: "S-2", name: "B" }, { code: "S-3", name: "C" }];
  var next = [{ code: "S-1", name: "A" }, { code: "S-2", name: "B2" }, { code: "S-4", name: "D" }];
  var d = P.diffItems(prev, next);
  assert.deepStrictEqual(d.upserts.map(function (x) { return x.code; }).sort(), ["S-2", "S-4"]);
  assert.deepStrictEqual(d.deletes, ["S-3"]);
});
test("diffItems: nothing changed gives empty diff", function () {
  var a = [{ code: "S-1", meas: { w: 1, h: 2 } }];
  var d = P.diffItems(a, [{ code: "S-1", meas: { h: 2, w: 1 } }]);
  assert.strictEqual(d.upserts.length + d.deletes.length, 0);
});
test("newLogEntries: only entries not seen before, order kept", function () {
  var a = { time: "1" }, b = { time: "2" }, c = { time: "3" };
  assert.deepStrictEqual(P.newLogEntries([a, b], [c, a, b]), [c]);
  assert.deepStrictEqual(P.newLogEntries([], [a]), [a]);
});
test("orderLog: pieceLog newest first, work log oldest first, capped at 300", function () {
  var list = [];
  for (var i = 0; i < 320; i++) list.push({ time: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), i: i });
  var p = P.orderLog("granite.pieceLog", list);
  assert.strictEqual(p.length, 300); assert.strictEqual(p[0].i, 319); assert.strictEqual(p[299].i, 20);
  var w = P.orderLog("granite.log", list);
  assert.strictEqual(w[0].i, 20); assert.strictEqual(w[299].i, 319);
});
test("staffRows: admin hidden, creation order, row shape", function () {
  var rows = P.staffRows([
    { name: "B", position: "Резчик", email: "b@x.ca", shift: "1", section: "shop", created_at: "2026-11-27T02:00:00Z" },
    { name: "", email: "owner@x.ca", section: "admin", created_at: "2026-11-27T00:00:00Z" },
    { name: "A", position: "Менеджер", email: "a@x.ca", shift: "", section: "office", created_at: "2026-11-27T01:00:00Z" }]);
  assert.deepStrictEqual(rows, [["A", "Менеджер", "a@x.ca", "", "office"], ["B", "Резчик", "b@x.ca", "1", "shop"]]);
});
test("photoPath + toServerItem: signed URL becomes photo: path, data URL untouched", function () {
  var u = "https://diydirqvwvpmwatemgoe.supabase.co/storage/v1/object/sign/photos/items/S-001-17.jpg?token=abc";
  assert.strictEqual(P.photoPath(u), "items/S-001-17.jpg");
  assert.strictEqual(P.toServerItem({ code: "S-001", img: u }, {}).img, "photo:items/S-001-17.jpg");
  assert.strictEqual(P.toServerItem({ code: "S-002", img: "data:image/jpeg;base64,xx" }, {}).img, "data:image/jpeg;base64,xx");
  assert.strictEqual(P.toServerItem({ code: "S-003", img: "data:a" }, { "data:a": "items/p.jpg" }).img, "photo:items/p.jpg");
});

test("migrateLocal: same piece skipped, different piece with taken code gets a suffix", function () {
  var server = [{ code: "S-003", data: { code: "S-003", name: "A", img: "photo:x" } }, { code: "S-003-2", data: { code: "S-003-2", name: "Z" } }];
  var out = P.migrateLocal([{ code: "S-003", name: "A", img: "data:1" }, { code: "S-003", name: "B" }, { code: "S-009", name: "C" }], server);
  assert.deepStrictEqual(out.map(function (x) { return x.code + ":" + x.name; }), ["S-003-3:B", "S-009:C"]);
});

var failed = 0;
tests.forEach(function (t) {
  try { t[1](); console.log("ok  " + t[0]); } catch (e) { failed++; console.log("FAIL " + t[0] + "\n     " + e.message); }
});
console.log((tests.length - failed) + "/" + tests.length + " passed");
process.exit(failed ? 1 : 0);
