// Run: node tests/auth.test.js
var assert = require("assert");
function mem() { var m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; }, _m: m }; }
global.localStorage = mem(); global.sessionStorage = mem();
var A = require("../auth.js");

var tests = [];
function test(n, f) { tests.push([n, f]); }
function reset() { global.localStorage = mem(); global.sessionStorage = mem(); }

test("own section: ok + session", async function () {
  reset();
  await A.addStaff({ name: "Иван", position: "Пильщик", email: "ivan@x.ca", shift: "день", section: "shop", tempPw: "temp12345" });
  var r = await A.login("shop", "ivan@x.ca", "temp12345");
  assert.strictEqual(r.mustChange, true); assert.strictEqual(A.session(), null, "session before change");
  var c = await A.changePw("ivan@x.ca", "temp12345", "mypass999");
  assert.strictEqual(c.ok, true); assert.strictEqual(A.session().section, "shop");
  A.logout(); assert.strictEqual(A.session(), null);
  r = await A.login("shop", "  IVAN@x.ca ", "mypass999");
  assert.strictEqual(r.ok, true); assert.strictEqual(A.session().email, "ivan@x.ca"); assert.strictEqual(A.session().name, "Иван");
});

test("right password, other section: refused, no session", async function () {
  reset();
  await A.addStaff({ name: "Иван", position: "", email: "ivan@x.ca", shift: "", section: "shop", tempPw: "temp12345" });
  await A.changePw("ivan@x.ca", "temp12345", "mypass999"); A.logout();
  var r = await A.login("office", "ivan@x.ca", "mypass999");
  assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, "section"); assert.strictEqual(r.section, "shop");
  assert.strictEqual(A.session(), null);
});

test("wrong password / unknown email", async function () {
  reset();
  await A.addStaff({ name: "Оля", position: "", email: "olya@x.ca", shift: "", section: "office", tempPw: "temp12345" });
  assert.strictEqual((await A.login("office", "olya@x.ca", "nope12345")).reason, "wrong");
  assert.strictEqual((await A.login("office", "nobody@x.ca", "temp12345")).reason, "nouser");
});

test("old temporary password stops working after change", async function () {
  reset();
  await A.addStaff({ name: "Оля", position: "", email: "olya@x.ca", shift: "", section: "office", tempPw: "temp12345" });
  await A.changePw("olya@x.ca", "temp12345", "newpass77"); A.logout();
  assert.strictEqual((await A.login("office", "olya@x.ca", "temp12345")).reason, "wrong");
  assert.strictEqual((await A.changePw("olya@x.ca", "newpass77", "short")).ok, false, "short password accepted");
});

test("removed staff cannot sign in", async function () {
  reset();
  await A.addStaff({ name: "Оля", position: "", email: "olya@x.ca", shift: "", section: "office", tempPw: "temp12345" });
  A.removeStaff("olya@x.ca");
  assert.strictEqual((await A.login("office", "olya@x.ca", "temp12345")).reason, "nouser");
  assert.strictEqual(A.staff().length, 0);
});

test("admin: unset, then set, can enter every section", async function () {
  reset();
  assert.strictEqual(A.adminSet(), false);
  assert.strictEqual((await A.login("admin", "", "whatever1")).reason, "admin_unset");
  await A.setAdminPw("adminpass1");
  assert.strictEqual((await A.login("admin", "", "wrongpass1")).reason, "wrong");
  assert.strictEqual((await A.login("admin", "", "adminpass1")).ok, true);
  assert.ok(A.can("office") && A.can("shop") && A.can("admin"));
});

test("staff session cannot enter other sections; legacy rows default to shop", async function () {
  reset();
  localStorage.setItem("granite.staff", JSON.stringify([["Старый", "Пильщик", "old@x.ca", "день"]]));
  assert.strictEqual(A.staff()[0].section, "shop");
  await A.addStaff({ name: "Оля", position: "", email: "olya@x.ca", shift: "", section: "office", tempPw: "temp12345" });
  await A.changePw("olya@x.ca", "temp12345", "newpass77");
  assert.ok(A.can("office")); assert.ok(!A.can("shop")); assert.ok(!A.can("admin"));
});

test("duplicate email is refused", async function () {
  reset();
  await A.addStaff({ name: "Оля", position: "", email: "olya@x.ca", shift: "", section: "office", tempPw: "temp12345" });
  await assert.rejects(A.addStaff({ name: "Оля2", position: "", email: "OLYA@x.ca", shift: "", section: "shop", tempPw: "temp12345" }));
});

(async function () {
  var fails = 0;
  for (var t of tests) { try { await t[1](); console.log("PASS", t[0]); } catch (e) { fails++; console.log("FAIL", t[0], "-", e.message); } }
  console.log(fails ? fails + " failed" : "all " + tests.length + " passed");
  process.exit(fails ? 1 : 0);
})();
