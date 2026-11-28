// Run: NODE_PATH=$(npm root -g) node tests/security.spec.js
var { chromium } = require("playwright");
var { spawn, execSync } = require("child_process");
var assert = require("assert");
var fs = require("fs");
var path = require("path");
var ROOT = path.resolve(__dirname, "..");
var PAGES = ["index.html", "app.html", "worker.html", "labels.html", "links.html", "print.html"];
execSync("rm -rf /tmp/sw-sec && cp -r " + ROOT + " /tmp/sw-sec && rm -rf /tmp/sw-sec/.git /tmp/sw-sec/.superpowers");
var srv = spawn("python3", ["-m", "http.server", "8768"], { cwd: "/tmp/sw-sec", stdio: "ignore" });
var srv2 = spawn("python3", ["-m", "http.server", "8769"], { cwd: "/tmp/sw-sec", stdio: "ignore" });
var results = [];
async function step(n, f) { try { await f(); results.push("PASS " + n); } catch (e) { results.push("FAIL " + n + " - " + String(e && e.message || e).split("\n")[0]); } }

(async function () {
  await new Promise(function (r) { setTimeout(r, 700); });

  await step("no third-party <script src> on any page", async function () {
    PAGES.forEach(function (p) {
      var s = fs.readFileSync(path.join(ROOT, p), "utf8");
      var m = s.match(/<script[^>]+src=["']https?:\/\/[^"']+/g);
      assert.ok(!m, p + ": " + (m && m[0]));
    });
  });

  await step("every page has a Content-Security-Policy meta with object-src 'none' and base-uri", async function () {
    PAGES.forEach(function (p) {
      var s = fs.readFileSync(path.join(ROOT, p), "utf8");
      var m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(s);
      assert.ok(m, p + ": no CSP");
      assert.ok(/object-src 'none'/.test(m[1]) && /base-uri 'self'/.test(m[1]), p + ": weak CSP " + m[1]);
    });
  });

  var b = await chromium.launch();

  await step("QR libraries load locally (no network) and every page loads without CSP violations", async function () {
    var ctx = await b.newContext();
    await ctx.addInitScript({ content: require("./fake-init.js")({ as: "admin" }) });
    await ctx.route(/^https?:\/\/(?!localhost)/, function (r) { r.abort(); });
    var p = await ctx.newPage(), bad = [];
    p.on("console", function (m) { if (/Content Security Policy|Refused to/.test(m.text())) bad.push(m.text().slice(0, 160)); });
    p.on("pageerror", function (e) { bad.push("pageerror: " + e.message); });
    await p.goto("http://localhost:8768/print.html");
    await p.evaluate(function () { sessionStorage.setItem("granite.session", JSON.stringify({ section: "admin", admin: true, email: "", name: "" })); });
    for (var pg of PAGES.filter(function (x) { return x !== "index.html"; })) { await p.goto("http://localhost:8768/" + pg + (pg === "app.html" ? "?s=office" : "")); await p.waitForTimeout(400); }
    await p.goto("http://localhost:8768/index.html"); await p.waitForTimeout(400);
    await p.goto("http://localhost:8768/print.html");
    await p.evaluate(function () {
      sessionStorage.setItem("granite.session", JSON.stringify({ section: "admin", admin: true, email: "", name: "" }));
      localStorage.setItem("__fakeUser", JSON.stringify({ id: "u-admin", email: "andrey_sazonov@icloud.com" })); // главная выходит из аккаунта
    });
    await p.goto("http://localhost:8768/app.html?s=office"); await p.waitForTimeout(500);
    var libs = await p.evaluate(function () {
      return [typeof window.jsQR, !!(window.ZXing && window.ZXing.BrowserMultiFormatReader), !!(window.QRCode && window.QRCode.CorrectLevel)];
    });
    assert.deepStrictEqual(libs, ["function", true, true], "libs " + JSON.stringify(libs));
    assert.deepStrictEqual(bad, []);
    await ctx.close();
  });

  await step("app and worker pages refuse to run inside a frame on another site", async function () {
    var p = await b.newPage();
    for (var pg of ["app.html", "worker.html", "index.html"]) {
      await p.setContent('<iframe id="f" src="http://127.0.0.1:8769/' + pg + '" width="800" height="600"></iframe>');
      await p.waitForTimeout(1200);
      var framed = await p.evaluate(function () {
        try { var d = document.getElementById("f").contentDocument; return d ? "same" : "blocked"; } catch (e) { return "blocked"; }
      });
      var shown = await p.frames()[1] ? await p.frames()[1].evaluate(function () { return document.documentElement.style.display; }).catch(function () { return "gone"; }) : "gone";
      assert.ok(shown === "none" || shown === "gone", pg + " rendered inside a foreign frame (" + framed + "/" + shown + ")");
    }
    await p.close();
  });

  await b.close(); srv.kill(); srv2.kill();
  results.forEach(function (r) { console.log(r); });
  var f = results.filter(function (r) { return r.indexOf("FAIL") === 0; }).length;
  console.log(f ? f + " failed" : "all " + results.length + " passed");
  process.exit(f ? 1 : 0);
})().catch(function (e) { srv.kill(); srv2.kill(); console.log("FAIL setup -", e.message); process.exit(1); });
