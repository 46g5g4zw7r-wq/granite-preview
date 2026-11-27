// Run: NODE_PATH=$(npm root -g) node tests/sections.spec.js [home]   ("home" = only the home-page steps)
var { chromium } = require("playwright");
var { spawn, execSync } = require("child_process");
var assert = require("assert");
var path = require("path");
var ONLY_HOME = process.argv[2] === "home";
execSync("rm -rf /tmp/sw-sec2 && cp -r " + path.resolve(__dirname, "..") + " /tmp/sw-sec2 && rm -rf /tmp/sw-sec2/.git /tmp/sw-sec2/.superpowers");
var srv = spawn("python3", ["-m", "http.server", "8770"], { cwd: "/tmp/sw-sec2", stdio: "ignore" });
var B = "http://localhost:8770/";
var results = [];
async function step(n, f) { try { await f(); results.push("PASS " + n); } catch (e) { results.push("FAIL " + n + " - " + String(e && e.message || e).split("\n")[0]); } }

(async function () {
  await new Promise(function (r) { setTimeout(r, 700); });
  var b = await chromium.launch();
  var ctx = await b.newContext(); var p = await ctx.newPage();
  var errs = []; p.on("pageerror", function (e) { errs.push(e.message); });
  async function home(lang) {
    await p.goto(B + "index.html"); await p.waitForTimeout(300);
    await p.click('#langs button[data-lang="' + (lang || "ru") + '"], .lang button[data-lang="' + (lang || "ru") + '"]');
  }
  async function signIn(btn, email, pw) {
    await p.click(btn); await p.waitForSelector("#login.open");
    if (email !== null) await p.fill("#email", email);
    await p.fill("#pw", pw);
    assert.strictEqual(await p.inputValue("#pw"), pw, "password not typed");
    await p.click("#submitBtn");
    await settle();
  }
  // Ждём конца проверки пароля (PBKDF2 занимает до нескольких секунд): ушли со страницы, или кнопка снова активна
  async function settle() {
    await p.waitForFunction(function () {
      if (!/index\.html/.test(location.href)) return true;
      var b = document.getElementById("submitBtn"); return b && !b.disabled;
    }, null, { timeout: 30000 }).catch(function () {});
    await p.waitForTimeout(200);
  }

  await step("home has Office / Admin / Shop floor buttons in 4 languages, no 'view without signing in'", async function () {
    var want = { ru: ["Офис", "Админ", "Цех"], fr: ["Bureau", "Admin", "Atelier"], en: ["Office", "Admin", "Shop floor"], es: ["Oficina", "Admin", "Taller"] };
    for (var l of ["ru", "fr", "en", "es"]) {
      await home(l);
      var got = [await p.textContent("#goOffice"), await p.textContent("#goAdmin"), await p.textContent("#goShop")].map(function (s) { return s.trim(); });
      assert.deepStrictEqual(got, want[l], l);
    }
    assert.ok(!(await p.isVisible("#demoBtn")), "demo button still visible");
  });

  await step("admin first sign-in sets the password and opens the admin section", async function () {
    await home("ru");
    await p.click("#goAdmin"); await p.waitForSelector("#login.open");
    assert.ok(!(await p.isVisible("#email")), "email asked for admin");
    assert.ok(await p.isVisible("#pw2"), "no repeat field on first admin sign-in");
    await p.fill("#pw", "adminpass1"); await p.fill("#pw2", "adminpass1"); await p.click("#submitBtn");
    await p.waitForURL(/app\.html\?s=admin/, { timeout: 15000 });
  });

  if (!ONLY_HOME) {
    await step("admin adds a shop-floor worker with a temporary password", async function () {
      await p.waitForSelector("#staffForm", { timeout: 5000 });
      await p.fill("#sfName", "Иван"); await p.fill("#sfEmail", "ivan@x.ca");
      await p.selectOption("#sfSection", "shop"); await p.fill("#sfPosition", "Пильщик"); await p.fill("#sfPw", "temp12345");
      await p.click("#sfAdd"); await p.waitForFunction(function () { return /Иван/.test((document.getElementById("sfMsg") || {}).textContent || ""); }, null, { timeout: 30000 });
      assert.ok((await p.textContent("#view")).indexOf("ivan@x.ca") >= 0, "worker not listed");
      await p.fill("#sfName", "Оля"); await p.fill("#sfEmail", "olya@x.ca");
      await p.selectOption("#sfSection", "office"); await p.fill("#sfPw", "temp12345");
      await p.click("#sfAdd"); await p.waitForFunction(function () { return /Оля/.test((document.getElementById("sfMsg") || {}).textContent || ""); }, null, { timeout: 30000 });
      await p.click("#logoutBtn"); await p.waitForURL(/index\.html/);
    });
  }

  await step("worker with right password on the wrong button is refused", async function () {
    if (ONLY_HOME) {
      await home("ru");
      await p.evaluate(function () { return window.SlabAuth.addStaff({ name: "Иван", email: "ivan@x.ca", section: "shop", tempPw: "temp12345" }); });
    }
    await home("ru");
    await signIn("#goOffice", "ivan@x.ca", "temp12345");
    assert.ok(/Цех/.test(await p.textContent("#err")), "message: " + await p.textContent("#err"));
    assert.ok(/index\.html/.test(p.url()), "left the home page");
    assert.strictEqual(await p.evaluate(function () { return window.SlabAuth.session(); }), null);
  });

  await step("temporary password forces a change; then the worker lands in the shop floor", async function () {
    await home("ru");
    await signIn("#goShop", "ivan@x.ca", "temp12345");
    assert.ok(await p.isVisible("#newPw"), "no change-password step");
    await p.fill("#newPw", "mypass999"); await p.fill("#newPw2", "mypass999"); await p.click("#submitBtn");
    await p.waitForURL(/app\.html\?s=shop/, { timeout: 15000 });
  });

  await step("Spanish sign-in form is translated", async function () {
    await home("es"); await p.evaluate(function () { window.SlabAuth.logout(); });
    await p.click("#goShop"); await p.waitForSelector("#login.open");
    assert.ok(/Taller/.test(await p.textContent("#loginTitle")), await p.textContent("#loginTitle"));
    await p.click("#cancelBtn");
  });

  if (!ONLY_HOME) {
    await step("shop floor shows the 4 big actions and hides office tabs", async function () {
      await home("ru"); await signIn("#goShop", "ivan@x.ca", "mypass999");
      await p.waitForURL(/app\.html\?s=shop/, { timeout: 15000 }); await p.waitForTimeout(400);
      for (var id of ["#shopScan", "#shopAdd", "#shopMeasure", "#shopWork"]) assert.ok(await p.isVisible(id), id + " hidden");
      assert.ok(!(await p.isVisible("text=Каталог")), "catalog tab visible on shop floor");
      assert.ok(/Иван/.test(await p.textContent("#who")), "name not shown");
    });

    await step("shop-floor session cannot open the office or admin section", async function () {
      for (var s of ["office", "admin"]) {
        await p.goto(B + "app.html?s=" + s); await p.waitForURL(/index\.html/, { timeout: 5000 });
      }
    });

    await step("office sees stock and catalog, no scanner / camera / staff", async function () {
      await p.evaluate(function () { window.SlabAuth.logout(); });
      await home("ru"); await signIn("#goOffice", "olya@x.ca", "temp12345");
      await p.fill("#newPw", "olyapass1"); await p.fill("#newPw2", "olyapass1"); await p.click("#submitBtn");
      await p.waitForURL(/app\.html\?s=office/, { timeout: 15000 }); await p.waitForTimeout(400);
      for (var id of ["#scan", "#camBtn", "#galBtn", "#measureBtn"]) assert.ok(!(await p.isVisible(id)), id + " visible in office");
      assert.ok(await p.isVisible("text=Каталог"), "no catalog tab");
      assert.ok(!(await p.isVisible("text=Персонал")), "staff tab visible in office");
    });

    await step("no session -> back to home", async function () {
      await p.evaluate(function () { window.SlabAuth.logout(); });
      await p.goto(B + "app.html?s=office"); await p.waitForURL(/index\.html/, { timeout: 5000 });
    });

    await step("admin removes a worker -> that worker can no longer sign in", async function () {
      await home("ru"); await signIn("#goAdmin", null, "adminpass1");
      await p.waitForURL(/app\.html\?s=admin/, { timeout: 15000 }); await p.waitForTimeout(400);
      await p.click('#view [data-del="ivan@x.ca"]'); await p.waitForTimeout(300);
      await p.click("#logoutBtn"); await p.waitForURL(/index\.html/);
      await signIn("#goShop", "ivan@x.ca", "mypass999");
      assert.ok(/index\.html/.test(p.url()), "removed worker signed in");
    });

    await step("trial bar shows days left; 'need more time' disabled under 50 pieces", async function () {
      await home("ru"); await signIn("#goAdmin", null, "adminpass1");
      await p.waitForURL(/app\.html\?s=admin/, { timeout: 15000 }); await p.waitForTimeout(400);
      assert.ok(/30|29/.test(await p.textContent("#trialBar")), await p.textContent("#trialBar"));
      assert.ok(await p.isDisabled("#trialMore"), "extension available with < 50 pieces");
    });

    await step("language switch translates the section header", async function () {
      await p.click('.lang button[data-lang="en"]');
      assert.ok(/Sign out/i.test(await p.textContent("#logoutBtn")), await p.textContent("#logoutBtn"));
      assert.ok(/trial/i.test(await p.textContent("#trialBar")), await p.textContent("#trialBar"));
    });
  }

  if (!ONLY_HOME) {
    await step("admin can open the Office and Shop floor sections from the header", async function () {
      await home("ru"); await signIn("#goAdmin", null, "adminpass1");
      await p.waitForURL(/app\.html\?s=admin/, { timeout: 15000 }); await p.waitForTimeout(300);
      await p.click("#secOffice"); await p.waitForURL(/app\.html\?s=office/, { timeout: 5000 }); await p.waitForTimeout(300);
      assert.ok(await p.isVisible("#labelsBtn"), "QR labels not reachable for admin");
      await p.click("#secShop"); await p.waitForURL(/app\.html\?s=shop/, { timeout: 5000 }); await p.waitForTimeout(300);
      assert.ok(await p.isVisible("#shopAdd"), "shop tools not reachable for admin");
    });

    await step("office can record incoming pieces by hand (no camera buttons)", async function () {
      await p.goto(B + "app.html?s=office"); await p.waitForTimeout(300);
      assert.ok(await p.isVisible("#add"), "no + Add in office");
      await p.click("#add"); await p.waitForTimeout(200);
      assert.ok(await p.isVisible("#iName"), "form not open");
      assert.ok(!(await p.isVisible("#iMeasure")) && !(await p.isVisible("#iScan")), "camera actions shown in office");
    });

    await step("after the trial ends: pay screen opens and adding is locked everywhere", async function () {
      await p.evaluate(function () { localStorage.setItem("granite.trialStart", String(Date.now() - 31 * 86400000)); localStorage.removeItem("granite.trialExt"); });
      await p.goto(B + "app.html?s=office"); await p.waitForTimeout(400);
      assert.ok(await p.isVisible("#payScreen"), "pay screen not shown in office");
      assert.ok(!(await p.isVisible("#add")), "+ Add still available in office");
      await p.goto(B + "app.html?s=shop"); await p.waitForTimeout(400);
      assert.ok(!(await p.isVisible("#shopAdd")) && !(await p.isVisible("#shopMeasure")), "shop can still add after trial");
      await p.evaluate(function () { localStorage.setItem("granite.trialStart", String(Date.now())); });
    });
  }

  await step("no page errors", async function () { assert.deepStrictEqual(errs, []); });
  await b.close(); srv.kill();
  results.forEach(function (r) { console.log(r); });
  var f = results.filter(function (r) { return r.indexOf("FAIL") === 0; }).length;
  console.log(f ? f + " failed" : "all " + results.length + " passed");
  process.exit(f ? 1 : 0);
})().catch(function (e) { srv.kill(); console.log("FAIL setup -", e.message); process.exit(1); });
