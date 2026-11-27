/* Slabwise — вход по разделам (прототип: всё хранится в этом браузере).
   Разделы: office (Офис), shop (Цех), admin (Админ). Админ может войти в любой раздел.
   Пароли: PBKDF2-SHA-256, 310000 раундов, формат {v:2, salt, hash} — как раньше в app.html/worker.html. */
(function (root) {
  "use strict";
  var STAFF_KEY = "granite.staff", PW_KEY = "granite.workerpw", ADMIN_KEY = "granite.adminpw", SES_KEY = "granite.session";
  var SECTIONS = ["office", "shop", "admin"], MIN_PW = 8;

  function ls() { return root.localStorage || (typeof localStorage !== "undefined" ? localStorage : null); }
  function ss() { return root.sessionStorage || (typeof sessionStorage !== "undefined" ? sessionStorage : null); }
  function read(store, k, d) { try { var v = store().getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function write(store, k, v) { try { store().setItem(k, JSON.stringify(v)); } catch (e) {} }
  function subtle() { return (root.crypto || globalThis.crypto).subtle; }
  function cryptoObj() { return root.crypto || globalThis.crypto; }

  function normEmail(e) { return String(e || "").trim().toLowerCase(); }
  function hexOf(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, "0"); }).join(""); }
  function randomSalt() { var a = new Uint8Array(16); cryptoObj().getRandomValues(a); return hexOf(a.buffer); }
  function hashPw(salt, pw) {
    var enc = new TextEncoder();
    return subtle().importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]).then(function (key) {
      return subtle().deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: 310000 }, key, 256);
    }).then(hexOf);
  }
  function hashLegacy(salt, pw) { return subtle().digest("SHA-256", new TextEncoder().encode(salt + ":" + pw)).then(hexOf); }
  function check(rec, pw) {
    if (!rec) return Promise.resolve(false);
    return (rec.v === 2 ? hashPw(rec.salt, pw) : hashLegacy(rec.salt, pw)).then(function (h) { return h === rec.hash; });
  }
  function record(pw, temp) {
    var salt = randomSalt();
    return hashPw(salt, pw).then(function (h) { var r = { v: 2, salt: salt, hash: h }; if (temp) r.temp = true; return r; });
  }

  // Строки сотрудников: [имя, должность, e-mail, смена, раздел]; без раздела — цех (старые записи)
  function rows() { var r = read(ls, STAFF_KEY, []); return Array.isArray(r) ? r : []; }
  function staff() {
    return rows().map(function (r) {
      return { name: r[0] || "", position: r[1] || "", email: normEmail(r[2]), shift: r[3] || "", section: r[4] === "office" ? "office" : "shop" };
    });
  }
  function find(email) { var e = normEmail(email); return staff().filter(function (s) { return s.email && s.email === e; })[0] || null; }

  function addStaff(p) {
    var email = normEmail(p.email);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Promise.reject(new Error("email"));
    if (find(email)) return Promise.reject(new Error("exists"));
    if (String(p.tempPw || "").length < MIN_PW) return Promise.reject(new Error("short"));
    var section = p.section === "office" ? "office" : "shop";
    return record(p.tempPw, true).then(function (rec) {
      var list = rows(); list.push([String(p.name || "").trim(), String(p.position || "").trim(), email, String(p.shift || "").trim(), section]);
      write(ls, STAFF_KEY, list);
      var pws = read(ls, PW_KEY, {}); pws[email] = rec; write(ls, PW_KEY, pws);
    });
  }
  function removeStaff(email) {
    var e = normEmail(email);
    write(ls, STAFF_KEY, rows().filter(function (r) { return normEmail(r[2]) !== e; }));
    var pws = read(ls, PW_KEY, {}); delete pws[e]; write(ls, PW_KEY, pws);
    var s = session(); if (s && s.email === e) logout();
  }

  // Админ выдаёт новый временный пароль (сотрудник забыл свой или не успел войти)
  function resetTempPw(email, pw) {
    var person = find(email);
    if (!person) return Promise.reject(new Error("nouser"));
    if (String(pw || "").length < MIN_PW) return Promise.reject(new Error("short"));
    return record(pw, true).then(function (rec) { var pws = read(ls, PW_KEY, {}); pws[person.email] = rec; write(ls, PW_KEY, pws); });
  }
  function adminSet() { return !!read(ls, ADMIN_KEY, null); }
  function setAdminPw(pw) {
    if (String(pw || "").length < MIN_PW) return Promise.reject(new Error("short"));
    return record(pw, false).then(function (rec) {
      write(ls, ADMIN_KEY, rec); write(ss, SES_KEY, { section: "admin", admin: true, email: "", name: "" });
      // Пробный период компании начинается с первого входа администратора
      try { if (!ls().getItem("granite.trialStart")) ls().setItem("granite.trialStart", String(Date.now())); } catch (e) {}
    });
  }

  function login(section, email, pw) {
    if (SECTIONS.indexOf(section) < 0) return Promise.resolve({ ok: false, reason: "section" });
    if (section === "admin") {
      var a = read(ls, ADMIN_KEY, null);
      if (!a) return Promise.resolve({ ok: false, reason: "admin_unset" });
      return check(a, pw).then(function (ok) {
        if (!ok) return { ok: false, reason: "wrong" };
        write(ss, SES_KEY, { section: "admin", admin: true, email: "", name: "" });
        return { ok: true, section: "admin" };
      });
    }
    var person = find(email);
    if (!person) return Promise.resolve({ ok: false, reason: "nouser" });
    var rec = read(ls, PW_KEY, {})[person.email];
    return check(rec, pw).then(function (ok) {
      if (!ok) return { ok: false, reason: "wrong" };
      if (person.section !== section) return { ok: false, reason: "section", section: person.section };
      if (rec.temp) return { ok: false, mustChange: true, section: person.section };
      write(ss, SES_KEY, { section: person.section, admin: false, email: person.email, name: person.name });
      return { ok: true, section: person.section };
    });
  }

  function changePw(email, oldPw, newPw) {
    var person = find(email);
    if (!person) return Promise.resolve({ ok: false, reason: "nouser" });
    if (String(newPw || "").length < MIN_PW) return Promise.resolve({ ok: false, reason: "short" });
    if (newPw === oldPw) return Promise.resolve({ ok: false, reason: "same" }); // временный пароль знает админ
    var pws = read(ls, PW_KEY, {});
    return check(pws[person.email], oldPw).then(function (ok) {
      if (!ok) return { ok: false, reason: "wrong" };
      return record(newPw, false).then(function (rec) {
        pws = read(ls, PW_KEY, {}); pws[person.email] = rec; write(ls, PW_KEY, pws);
        write(ss, SES_KEY, { section: person.section, admin: false, email: person.email, name: person.name });
        return { ok: true, section: person.section };
      });
    });
  }

  function session() { var s = read(ss, SES_KEY, null); return s && SECTIONS.indexOf(s.section) >= 0 ? s : null; }
  function logout() { try { ss().removeItem(SES_KEY); } catch (e) {} }
  function can(section) {
    var s = session(); if (!s) return false;
    if (s.admin) return true;
    if (s.section !== section) return false;
    return !!find(s.email); // удалённый сотрудник теряет доступ сразу
  }

  var api = { SECTIONS: SECTIONS, MIN_PW: MIN_PW, hashPw: hashPw, randomSalt: randomSalt, staff: staff, addStaff: addStaff,
    removeStaff: removeStaff, resetTempPw: resetTempPw, login: login, setAdminPw: setAdminPw, adminSet: adminSet, changePw: changePw,
    session: session, logout: logout, can: can };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.SlabAuth = api;
})(typeof window !== "undefined" ? window : globalThis);
