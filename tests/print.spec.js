// Run: NODE_PATH=$(npm root -g) node tests/print.spec.js
var { chromium } = require("playwright");
var { spawn, execSync } = require("child_process");
var assert = require("assert");
var path = require("path");
execSync("rm -rf /tmp/sw-pr && cp -r " + path.resolve(__dirname, "..") + " /tmp/sw-pr && rm -rf /tmp/sw-pr/.git /tmp/sw-pr/.superpowers");
var srv = spawn("python3", ["-m", "http.server", "8767"], { cwd: "/tmp/sw-pr", stdio: "ignore" });
var results = [];
async function step(n, f) { try { await f(); results.push("PASS " + n); } catch (e) { results.push("FAIL " + n + " - " + String(e && e.message || e).split("\n")[0]); } }

(async function () {
  await new Promise(function (r) { setTimeout(r, 700); });
  var b = await chromium.launch(), p = await b.newPage();
  await p.goto("http://localhost:8767/print.html"); await p.waitForTimeout(300);
  var HOOK = { ru: "крючок", fr: "crochet", en: "hook", es: "gancho" };
  var OLD = { ru: "сверху", fr: "d’en haut", en: "from above", es: "desde arriba" };
  for (var l of ["ru", "fr", "en", "es"]) {
    await step("steps in " + l + ": hook, 100% scale, no shooting from above", async function () {
      await p.click('#langs button[data-lang="' + l + '"]');
      var t = await p.textContent("#steps");
      assert.ok(t.toLowerCase().indexOf(HOOK[l]) >= 0, "no hook: " + t.slice(0, 80));
      assert.ok(/100\s?%/.test(t), "no 100%");
      assert.ok(t.toLowerCase().indexOf(OLD[l]) < 0, "still says " + OLD[l]);
    });
  }
  await step("measured size field saves 127 and rejects 0", async function () {
    await p.fill("#mm", "0"); await p.click("#mmSave");
    assert.strictEqual(await p.evaluate(function () { return localStorage.getItem("granite.markerMm"); }), null);
    await p.fill("#mm", "127"); await p.click("#mmSave");
    assert.strictEqual(await p.evaluate(function () { return localStorage.getItem("granite.markerMm"); }), "127");
    assert.strictEqual(await p.evaluate(function () { return localStorage.getItem("granite.markerMmOk"); }), "1");
  });
  await step("size field is not printed", async function () {
    await p.emulateMedia({ media: "print" });
    assert.ok(!(await p.isVisible("#mmBox")), "visible in print");
    await p.emulateMedia({ media: "screen" });
  });
  await b.close(); srv.kill();
  results.forEach(function (r) { console.log(r); });
  var f = results.filter(function (r) { return r.indexOf("FAIL") === 0; }).length;
  console.log(f ? f + " failed" : "all " + results.length + " passed");
  process.exit(f ? 1 : 0);
})().catch(function (e) { srv.kill(); console.log("FAIL setup -", e.message); process.exit(1); });
