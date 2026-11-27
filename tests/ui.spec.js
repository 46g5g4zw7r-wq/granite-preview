// Run: python3 tests/make_photo.py /tmp/scene.jpg plain; ... exif6; ... nomarker
//      NODE_PATH=$(npm root -g) node tests/ui.spec.js   (serves a copy of the site on :8766)
var { chromium } = require("playwright");
var { spawn, execSync } = require("child_process");
var assert = require("assert");
var path = require("path");

var ROOT = path.resolve(__dirname, "..");
execSync("rm -rf /tmp/sw-ui && cp -r " + ROOT + " /tmp/sw-ui && rm -rf /tmp/sw-ui/.git /tmp/sw-ui/.superpowers");
var srv = spawn("python3", ["-m", "http.server", "8766"], { cwd: "/tmp/sw-ui", stdio: "ignore" });

var results = [];
async function step(name, fn) {
  try { await fn(); results.push("PASS " + name); } catch (e) { results.push("FAIL " + name + " - " + String(e && e.message || e).split("\n")[0]); }
}
function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, (msg || "") + " expected " + b + "±" + tol + " got " + a); }
function dims(text) { var m = /([\d.]+)\s*×\s*([\d.]+)/.exec(text || ""); return m ? [parseFloat(m[1]), parseFloat(m[2])] : null; }

(async function () {
  await new Promise(function (r) { setTimeout(r, 800); });
  var b = await chromium.launch();
  var p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  var errs = []; p.on("pageerror", function (e) { errs.push(e.message); });
  p.on("console", function (m) { if (m.type() === "error" && !/net::ERR_|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  // Вход: сессия админа (может открыть цех), затем раздел цеха — там кнопка «Сфотографировать и измерить»
  await p.goto("http://localhost:8766/print.html");
  await p.evaluate(function () { sessionStorage.setItem("granite.session", JSON.stringify({ section: "admin", admin: true, email: "", name: "" })); });
  await p.goto("http://localhost:8766/app.html?s=shop");
  await p.waitForTimeout(500);
  await p.click('.lang button[data-lang="en"]');
  await p.click("#shopAdd");

  async function measure(file) {
    await p.evaluate(function () { document.getElementById("iMeasureFile").value = ""; });
    await p.setInputFiles("#iMeasureFile", file);
    await p.waitForSelector("#msr:not([hidden])", { timeout: 5000 });
  }

  await step("button is labelled and first run asks for marker size; bad values rejected", async function () {
    assert.ok((await p.textContent("#iMeasure")).indexOf("Take photo and measure") >= 0, "label");
    await measure("/tmp/scene.jpg");
    await p.waitForSelector("#msrMmAsk:not([hidden])", { timeout: 5000 });
    for (var bad of ["abc", "0"]) {
      await p.fill("#msrMm", bad); await p.click("#msrMmOk");
      assert.ok(await p.isVisible("#msrMmAsk"), "accepted " + bad);
    }
    await p.fill("#msrMm", "100"); await p.click("#msrMmOk");
  });

  await step("auto contour: 3..12 handles and size about 59.1 x 35.4 in", async function () {
    await p.waitForFunction(function () { return window.SlabMeasure && window.SlabMeasure._state && window.SlabMeasure._state().points.length >= 3; }, null, { timeout: 60000 });
    var n = await p.evaluate(function () { return window.SlabMeasure._state().points.length; });
    assert.ok(n >= 3 && n <= 12, "points " + n);
    var d = dims(await p.textContent("#msrDim"));
    assert.ok(d, "no dims"); near(d[0], 59.1, 0.7, "W"); near(d[1], 35.4, 0.7, "H");
  });

  await step("edit hint stays visible even when the small-marker warning shows", async function () {
    var hint = await p.evaluate(function () { return window.SlabMeasure._T.en.hint; });
    var all = await p.evaluate(function () { return document.getElementById("msr").textContent; });
    assert.ok(all.indexOf(hint) >= 0, "hint not shown");
  });

  await step("dragging a point changes the numbers; fewer than 3 points disables Done", async function () {
    var before = await p.textContent("#msrArea");
    var h = await p.evaluate(function () { return window.SlabMeasure._state().handleScreen(0); });
    await p.mouse.move(h[0], h[1]); await p.mouse.down(); await p.mouse.move(h[0] + 60, h[1] + 60, { steps: 5 }); await p.mouse.up();
    assert.notStrictEqual(await p.textContent("#msrArea"), before, "area unchanged");
    var n = await p.evaluate(function () { return window.SlabMeasure._state().points.length; });
    for (var i = 0; i < n - 2; i++) { await p.evaluate(function () { window.SlabMeasure._state().select(0); }); await p.click("#msrDel"); }
    assert.ok(await p.isDisabled("#msrDone"), "Done enabled with 2 points");
    await p.click("#msrRetakeSame"); // restore auto contour on the same photo
    await p.waitForFunction(function () { return window.SlabMeasure._state().points.length >= 3; }, null, { timeout: 60000 });
  });

  await step("language switch while open translates the screen", async function () {
    await p.click('#msr .mlang button[data-lang="es"]');
    assert.ok(await p.evaluate(function () { return document.documentElement.lang === "es"; }), "app language not switched");
    assert.strictEqual((await p.textContent("#msrTitle")).trim(), await p.evaluate(function () { return window.SlabMeasure._T.es.title; }));
    await p.click('#msr .mlang button[data-lang="en"]');
  });

  await step("Done fills width/height and photo; Save stores meas", async function () {
    await p.click("#msrDone");
    await p.waitForSelector("#msr", { state: "hidden" });
    near(parseFloat(await p.inputValue("#iW")), 59.1, 0.7, "iW");
    near(parseFloat(await p.inputValue("#iH")), 35.4, 0.7, "iH");
    await p.fill("#iName", "Test remnant"); await p.fill("#iCell", "Z-09");
    assert.strictEqual(await p.inputValue("#iForm"), "rest", "type not set to remnant");
    await p.click("#iOk");
    var it = await p.evaluate(function () { var a = JSON.parse(localStorage.getItem("granite.items") || "[]"); return a[a.length - 1]; });
    assert.ok(it && it.meas && it.meas.areaFt2 > 0, "no meas"); assert.ok(it.img && it.img.indexOf("data:image") === 0, "no photo");
    assert.ok(Array.isArray(it.meas.polyIn) && it.meas.polyIn.length >= 3, "no poly");
  });

  await step("card shows area", async function () {
    var meta = await p.evaluate(function () { return Array.from(document.querySelectorAll(".meta")).map(function (x) { return x.textContent; }).join("|"); });
    assert.ok(/ft²/.test(meta), meta.slice(0, 200));
  });

  await step("no marker -> message and retake button", async function () {
    await p.click("#shopAdd");
    await measure("/tmp/scene_nomarker.jpg");
    await p.waitForFunction(function () { var e = document.getElementById("msrMsg"); return e && /marker/i.test(e.textContent); }, null, { timeout: 60000 });
    assert.ok(await p.isVisible("#msrRetake"));
    await p.click("#msrCancel");
  });

  await step("EXIF-rotated phone photo is measured upright", async function () {
    await p.click("#shopAdd");
    await measure("/tmp/scene_exif.jpg");
    await p.waitForFunction(function () { return window.SlabMeasure._state().points.length >= 3; }, null, { timeout: 60000 });
    var d = dims(await p.textContent("#msrDim")); near(d[0], 59.1, 0.7, "W"); near(d[1], 35.4, 0.7, "H");
    await p.click("#msrCancel");
  });

  await step("open three times in a row without console errors", async function () {
    for (var i = 0; i < 3; i++) {
      await p.click("#shopAdd"); await measure("/tmp/scene.jpg");
      await p.waitForFunction(function () { return window.SlabMeasure._state().points.length >= 3; }, null, { timeout: 60000 });
      await p.click("#msrCancel");
    }
    assert.deepStrictEqual(errs, [], JSON.stringify(errs).slice(0, 400));
  });

  await b.close(); srv.kill();
  results.forEach(function (r) { console.log(r); });
  var f = results.filter(function (r) { return r.indexOf("FAIL") === 0; }).length;
  console.log(f ? f + " failed" : "all " + results.length + " passed");
  process.exit(f ? 1 : 0);
})().catch(function (e) { srv.kill(); console.log("FAIL setup -", e.message); process.exit(1); });
