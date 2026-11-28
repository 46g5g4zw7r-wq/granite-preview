/* Slabwise — вход по разделам через Supabase (настоящие аккаунты).
   Разделы: office (Офис), shop (Цех), admin (Админ). Админ может войти в любой раздел.
   Сессия раздела дублируется в sessionStorage, чтобы проверка в начале страницы была мгновенной;
   cloud.js на странице раздела ещё раз сверяет её с сервером. */
(function (root) {
  "use strict";
  var STAFF_KEY = "granite.staff", SES_KEY = "granite.session";
  var SECTIONS = ["office", "shop", "admin"], MIN_PW = 8;

  function B() { return root.SlabCloud && root.SlabCloud.backend(); }
  function read(store, k, d) { try { var v = store.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function write(store, k, v) { try { store.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function ls() { return root.localStorage; }
  function ss() { return root.sessionStorage; }
  function normEmail(e) { return String(e || "").trim().toLowerCase(); }

  // Строки сотрудников из локальной копии: [имя, должность, e-mail, смена, раздел]
  function staff() {
    var r = read(ls(), STAFF_KEY, []);
    return (Array.isArray(r) ? r : []).map(function (x) {
      return { name: x[0] || "", position: x[1] || "", email: normEmail(x[2]), shift: x[3] || "", section: x[4] === "office" ? "office" : "shop" };
    });
  }
  function refreshStaff() {
    var b = B();
    return b.profiles().then(function (list) {
      var rows = root.SlabCloud.pure.staffRows(list || []);
      write(ls(), STAFF_KEY, rows);
      return rows;
    });
  }
  function staffCall(body) {
    var b = B();
    if (!b) return Promise.reject(new Error("net"));
    return b.staff(body).then(function (r) {
      if (r && r.ok) return refreshStaff().catch(function () {}).then(function () { return true; });
      throw new Error((r && r.error) || "net");
    });
  }
  function addStaff(p) {
    var email = normEmail(p.email);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Promise.reject(new Error("email"));
    if (staff().some(function (s) { return s.email === email; })) return Promise.reject(new Error("exists"));
    if (String(p.tempPw || "").length < MIN_PW) return Promise.reject(new Error("short"));
    return staffCall({ action: "add", email: email, tempPw: p.tempPw, name: String(p.name || "").trim(),
      position: String(p.position || "").trim(), shift: String(p.shift || "").trim(), section: p.section === "office" ? "office" : "shop" });
  }
  function removeStaff(email) { return staffCall({ action: "remove", email: normEmail(email) }); }
  function resetTempPw(email, pw) {
    if (String(pw || "").length < MIN_PW) return Promise.reject(new Error("short"));
    return staffCall({ action: "reset", email: normEmail(email), pw: pw });
  }

  function adminExists() {
    var b = B(); if (!b) return Promise.resolve(true);
    return b.rpc("admin_exists").then(function (v) { return !!v; }, function () { return true; });
  }
  // Первый вход владельца: создаётся аккаунт администратора (только для e-mail владельца)
  function setAdminPw(email, pw) {
    if (String(pw || "").length < MIN_PW) return Promise.resolve({ ok: false, reason: "short" });
    var b = B();
    if (!b) return Promise.resolve({ ok: false, reason: "net" });
    return b.staff({ action: "bootstrap", email: normEmail(email), password: pw }).then(function (r) {
      if (!r || !r.ok) return { ok: false, reason: (r && r.error) || "net" };
      return login("admin", email, pw);
    });
  }

  function remember(p) {
    write(ss(), SES_KEY, { section: p.section, admin: p.section === "admin", email: p.email, name: p.name || "", position: p.position || "" });
  }
  function login(section, email, pw) {
    if (SECTIONS.indexOf(section) < 0) return Promise.resolve({ ok: false, reason: "section" });
    var b = B();
    if (!b) return Promise.resolve({ ok: false, reason: "net" });
    return b.signIn(normEmail(email), pw).then(function (u) {
      if (!u) return { ok: false, reason: "wrong" };
      return b.myProfile(u.id).then(function (p) {
        if (!p) { b.signOut(); return { ok: false, reason: "nouser" }; }
        if (p.section !== "admin" && p.section !== section) { b.signOut(); return { ok: false, reason: "section", section: p.section }; }
        if (p.section === "admin") { remember(p); return { ok: true, section: section }; }
        if (p.must_change) return { ok: false, mustChange: true, section: p.section };
        remember(p);
        return { ok: true, section: p.section };
      });
    }, function () { return { ok: false, reason: "net" }; });
  }
  function changePw(email, oldPw, newPw) {
    if (String(newPw || "").length < MIN_PW) return Promise.resolve({ ok: false, reason: "short" });
    if (newPw === oldPw) return Promise.resolve({ ok: false, reason: "same" }); // временный пароль знает админ
    var b = B();
    if (!b) return Promise.resolve({ ok: false, reason: "net" });
    return b.user().then(function (u) {
      var signed = u && normEmail(u.email) === normEmail(email) ? Promise.resolve(u) : b.signIn(normEmail(email), oldPw);
      return signed.then(function (u2) {
        if (!u2) return { ok: false, reason: "wrong" };
        return b.updatePassword(newPw).then(function (ok) {
          if (!ok) return { ok: false, reason: "wrong" };
          return b.rpc("password_changed").then(function () { return b.myProfile(u2.id); }).then(function (p) {
            remember(p); return { ok: true, section: p.section };
          });
        });
      });
    }, function () { return { ok: false, reason: "net" }; });
  }

  function session() { var s = read(ss(), SES_KEY, null); return s && SECTIONS.indexOf(s.section) >= 0 ? s : null; }
  function logout() {
    try { ss().removeItem(SES_KEY); } catch (e) {}
    var b = B(); return b ? b.signOut() : Promise.resolve();
  }
  function can(section) {
    var s = session(); if (!s) return false;
    return s.admin || s.section === section;
  }

  var api = { SECTIONS: SECTIONS, MIN_PW: MIN_PW, staff: staff, refreshStaff: refreshStaff, addStaff: addStaff, removeStaff: removeStaff,
    resetTempPw: resetTempPw, login: login, adminExists: adminExists, setAdminPw: setAdminPw, changePw: changePw,
    session: session, logout: logout, can: can };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.SlabAuth = api;
})(typeof window !== "undefined" ? window : globalThis);
