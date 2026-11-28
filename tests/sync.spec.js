// Run: NODE_PATH=$(npm root -g) node tests/sync.spec.js   — общая база через поддельный сервер (без сети)
var { chromium } = require("playwright");
var { spawn, execSync } = require("child_process");
var assert = require("assert");
var path = require("path");
execSync("rm -rf /tmp/sw-sync && cp -r " + path.resolve(__dirname, "..") + " /tmp/sw-sync && rm -rf /tmp/sw-sync/.git /tmp/sw-sync/.superpowers");
var srv = spawn("python3", ["-m", "http.server", "8771"], { cwd: "/tmp/sw-sync", stdio: "ignore" });
var B = "http://localhost:8771/";
var results = [];
async function step(n, f) { try { await f(); results.push("PASS " + n); } catch (e) { results.push("FAIL " + n + " - " + String(e && e.message || e).split("\n")[0]); } }
var PIX = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

(async function () {
  await new Promise(function (r) { setTimeout(r, 700); });
  var b = await chromium.launch();
  var ctx = await b.newContext(); await ctx.addInitScript({ content: require("./fake-init.js")({ as: "admin" }) });
  var p = await ctx.newPage();
  var errs = []; p.on("pageerror", function (e) { errs.push(e.message); });
  function db() { return p.evaluate(function () { return JSON.parse(Storage.prototype.getItem.call(localStorage, "__fakeDB")); }); }
  async function openApp(s) {
    await p.goto(B + "app.html?s=" + (s || "office"));
    await p.waitForFunction(function () { return !!localStorage.getItem("granite.syncSnap"); }, null, { timeout: 10000 });
    await p.waitForTimeout(300);
  }

  await step("pieces kept in this browser before Supabase are moved to the server on first start", async function () {
    await p.goto(B + "print.html");
    await p.evaluate(function (pix) {
      localStorage.setItem("granite.items", JSON.stringify([{ name: "Старый кусок", kind: "Гранит", cell: "A1", code: "S-007", st: "ok", form: "rect", img: pix, size: "1000 × 500", when: "10:00" }]));
      localStorage.setItem("granite.pieceLog", JSON.stringify([{ time: "2026-11-20T10:00:00.000Z", code: "S-007", name: "Старый кусок", action: "cut" }]));
      localStorage.setItem("granite.company", "Granite Co");
    }, PIX);
    await openApp("office");
    await p.waitForFunction(function () { var d = JSON.parse(Storage.prototype.getItem.call(localStorage, "__fakeDB")); return d.items["S-007"] && d.logs.length >= 1; }, null, { timeout: 10000 });
    var d = await db();
    assert.ok(/^photo:items\/S-007-/.test(d.items["S-007"].data.img), "photo not uploaded: " + String(d.items["S-007"].data.img).slice(0, 40));
    assert.strictEqual(d.kv["granite.company"], "Granite Co");
    assert.ok((await p.textContent("#grid")).indexOf("Старый кусок") >= 0, "piece not shown");
  });

  await step("a new piece gets a code from the shared counter and reaches the server", async function () {
    await p.waitForFunction(function () { return JSON.parse(localStorage.getItem("granite.seqBlock") || "[]").length > 0; }, null, { timeout: 5000 });
    var code = await p.evaluate(function () { return window.SlabCloud.takeCode(); });
    assert.strictEqual(code, "S-008"); // счётчик продолжает после старых номеров (S-007)
    await p.evaluate(function () {
      var a = JSON.parse(localStorage.getItem("granite.items") || "[]");
      a.push({ name: "Новый", kind: "Кварц", cell: "B2", code: "S-002", st: "ok", form: "rect", img: "", size: "900 × 400", when: "11:00" });
      localStorage.setItem("granite.items", JSON.stringify(a));
    });
    await p.waitForFunction(function () { var d = JSON.parse(Storage.prototype.getItem.call(localStorage, "__fakeDB")); return !!d.items["S-002"]; }, null, { timeout: 5000 });
  });

  await step("another device (empty browser cache) sees the same pieces", async function () {
    await p.evaluate(function () {
      ["granite.items", "granite.pieceLog", "granite.syncSnap", "granite.syncDirty", "granite.company"].forEach(function (k) { Storage.prototype.removeItem.call(localStorage, k); });
    });
    await openApp("office");
    var g = await p.textContent("#grid");
    assert.ok(g.indexOf("Старый кусок") >= 0 && g.indexOf("Новый") >= 0, g.slice(0, 120));
    var img = await p.evaluate(function () { return JSON.parse(localStorage.getItem("granite.items")).filter(function (x) { return x.code === "S-007"; })[0].img; });
    assert.ok(/\/storage\/v1\/object\/sign\/photos\//.test(img), "photo link not restored");
  });

  await step("a change made on another phone shows up without reloading", async function () {
    await p.evaluate(function () {
      var raw = Storage.prototype.getItem, set = Storage.prototype.setItem;
      var d = JSON.parse(raw.call(localStorage, "__fakeDB"));
      d.items["S-050"] = { code: "S-050", data: { name: "С другого телефона", kind: "Гранит", cell: "C3", code: "S-050", st: "ok", form: "rect", img: "", size: "700 × 300", when: "12:00" }, deleted: false };
      set.call(localStorage, "__fakeDB", JSON.stringify(d));
      window.SLAB_BACKEND.upsertItems([]); // будит подписку, как живое обновление
    });
    await p.waitForFunction(function () { return document.getElementById("grid").textContent.indexOf("С другого телефона") >= 0; }, null, { timeout: 5000 });
  });

  await step("thrown-away piece is hidden on the server (kept as deleted), not erased", async function () {
    await p.evaluate(function () {
      var a = JSON.parse(localStorage.getItem("granite.items")).filter(function (x) { return x.code !== "S-002"; });
      localStorage.setItem("granite.items", JSON.stringify(a));
    });
    await p.waitForFunction(function () { var d = JSON.parse(Storage.prototype.getItem.call(localStorage, "__fakeDB")); return d.items["S-002"] && d.items["S-002"].deleted; }, null, { timeout: 5000 });
    var d = await db();
    assert.strictEqual(d.items["S-002"].data.name, "Новый");
  });

  await step("shop worker cannot change company settings on the server", async function () {
    await p.evaluate(function () {
      var raw = Storage.prototype.getItem, set = Storage.prototype.setItem;
      var d = JSON.parse(raw.call(localStorage, "__fakeDB"));
      d.users["w@x.ca"] = { id: "u-w", email: "w@x.ca", pw: "pass12345" };
      d.profiles["u-w"] = { id: "u-w", email: "w@x.ca", name: "W", position: "", shift: "", section: "shop", must_change: false };
      set.call(localStorage, "__fakeDB", JSON.stringify(d));
      set.call(localStorage, "__fakeUser", JSON.stringify({ id: "u-w", email: "w@x.ca" }));
      sessionStorage.setItem("granite.session", JSON.stringify({ section: "shop", admin: false, email: "w@x.ca", name: "W" }));
    });
    await openApp("shop");
    await p.evaluate(function () { localStorage.setItem("granite.company", "Hacked"); });
    await p.waitForTimeout(800);
    var d = await db();
    assert.strictEqual(d.kv["granite.company"], "Granite Co");
  });

  await step("no page errors", async function () { assert.deepStrictEqual(errs, []); });
  await b.close(); srv.kill();
  results.forEach(function (r) { console.log(r); });
  var f = results.filter(function (r) { return r.indexOf("FAIL") === 0; }).length;
  console.log(f ? f + " failed" : "all " + results.length + " passed");
  process.exit(f ? 1 : 0);
})();
