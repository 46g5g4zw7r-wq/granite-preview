/* Поддельный сервер для тестов: та же форма, что у настоящего Supabase в cloud.js.
   Данные лежат в localStorage "__fakeDB", чтобы страницы одного сайта видели одно и то же.
   Подключается в тестах до cloud.js: window.SLAB_BACKEND = FakeBackend(). */
(function (root) {
  "use strict";
  var OWNER = "andrey_sazonov@icloud.com";
  var rawGet = root.Storage.prototype.getItem, rawSet = root.Storage.prototype.setItem;
  function db() {
    var d = null; try { d = JSON.parse(rawGet.call(localStorage, "__fakeDB")); } catch (e) {}
    return d || { users: {}, profiles: {}, items: {}, logs: [], kv: {}, seq: 0, photos: {}, calls: [] };
  }
  function save(d) { rawSet.call(localStorage, "__fakeDB", JSON.stringify(d)); }
  function me() { try { return JSON.parse(rawGet.call(localStorage, "__fakeUser")); } catch (e) { return null; } }
  function section() { var u = me(); if (!u) return null; var p = db().profiles[u.id]; return p ? p.section : null; }
  function denied() { return Promise.reject(new Error("rls")); }
  var subs = [];
  function changed() { subs.forEach(function (f) { setTimeout(f, 0); }); }

  function FakeBackend() {
    return {
      signIn: function (email, pw) {
        var d = db(), u = d.users[String(email).toLowerCase()];
        if (!u || u.pw !== pw) return Promise.resolve(null);
        rawSet.call(localStorage, "__fakeUser", JSON.stringify({ id: u.id, email: u.email }));
        return Promise.resolve({ id: u.id, email: u.email });
      },
      signOut: function () { localStorage.removeItem("__fakeUser"); return Promise.resolve(); },
      user: function () { return Promise.resolve(me()); },
      updatePassword: function (pw) {
        var u = me(); if (!u) return Promise.resolve(false);
        var d = db(); d.users[u.email].pw = pw; save(d); return Promise.resolve(true);
      },
      rpc: function (name, args) {
        var d = db(), u = me();
        if (name === "admin_exists") return Promise.resolve(Object.keys(d.profiles).some(function (k) { return d.profiles[k].section === "admin"; }));
        if (!section()) return denied();
        if (name === "reserve_codes") { var r = []; for (var i = 0; i < args.n; i++) r.push(++d.seq); save(d); return Promise.resolve(r); }
        if (name === "bump_codes") { d.seq = Math.max(d.seq, args.n); save(d); return Promise.resolve(null); }
        if (name === "password_changed") { d.profiles[u.id].must_change = false; save(d); return Promise.resolve(null); }
        return denied();
      },
      myProfile: function (id) { var u = me(); if (!u || u.id !== id) return Promise.resolve(null); return Promise.resolve(db().profiles[id] || null); },
      profiles: function () {
        if (section() !== "admin") return Promise.resolve([]);
        var d = db(); return Promise.resolve(Object.keys(d.profiles).map(function (k) { return d.profiles[k]; }));
      },
      pullItems: function () {
        if (!section()) return denied();
        var d = db(); return Promise.resolve(Object.keys(d.items).map(function (k) { return d.items[k]; }));
      },
      pullLogs: function (key) {
        if (!section()) return denied();
        return Promise.resolve(db().logs.filter(function (l) { return l.key === key; })
          .sort(function (a, b) { return Date.parse(b.time) - Date.parse(a.time); }).slice(0, 300));
      },
      pullKv: function () {
        if (!section()) return denied();
        var d = db(); return Promise.resolve(Object.keys(d.kv).map(function (k) { return { key: k, value: d.kv[k] }; }));
      },
      upsertItems: function (rows) {
        if (!section()) return denied();
        var d = db(); rows.forEach(function (r) { d.items[r.code] = { code: r.code, data: r.data, deleted: !!r.deleted }; }); save(d); changed();
        return Promise.resolve(null);
      },
      insertLogs: function (rows) {
        if (!section()) return denied();
        var d = db();
        rows.forEach(function (r) { if (!d.logs.some(function (l) { return l.key === r.key && l.hash === r.hash; })) d.logs.push(r); });
        save(d); changed(); return Promise.resolve(null);
      },
      upsertKv: function (key, value) {
        var s = section();
        if (!s) return denied();
        if (s !== "admin" && ["granite.edits", "granite.trialExt"].indexOf(key) < 0) return denied();
        var d = db(); d.kv[key] = value; save(d); changed(); return Promise.resolve(null);
      },
      uploadPhoto: function (path, blob) {
        if (!section()) return denied();
        var d = db(); d.photos[path] = blob.size || 1; save(d); return Promise.resolve(null);
      },
      signUrls: function (paths) {
        var m = {}; paths.forEach(function (p) {
          m[p] = "data:image/gif;base64,R0lGODlhAQABAAAAACw=#/storage/v1/object/sign/photos/" + encodeURIComponent(p);
        });
        return Promise.resolve(m);
      },
      staff: function (body) {
        var d = db(), u = me();
        d.calls.push(body.action); save(d);
        if (body.action === "bootstrap") {
          var hasAdmin = Object.keys(d.profiles).some(function (k) { return d.profiles[k].section === "admin"; });
          if (hasAdmin) return Promise.resolve({ error: "admin_exists" });
          if (String(body.email).toLowerCase() !== OWNER) return Promise.resolve({ error: "not_owner" });
          if (String(body.password).length < 8) return Promise.resolve({ error: "short" });
          var id = "u" + Date.now();
          d.users[OWNER] = { id: id, email: OWNER, pw: body.password };
          d.profiles[id] = { id: id, email: OWNER, name: "", position: "", shift: "", section: "admin", must_change: false, created_at: new Date().toISOString() };
          if (d.kv["granite.trialStart"] === undefined) d.kv["granite.trialStart"] = String(Date.now());
          save(d); return Promise.resolve({ ok: true });
        }
        if (section() !== "admin") return Promise.resolve({ error: "not_admin" });
        var email = String(body.email || "").trim().toLowerCase();
        if (body.action === "add") {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Promise.resolve({ error: "email" });
          if (String(body.tempPw || "").length < 8) return Promise.resolve({ error: "short" });
          if (d.users[email]) return Promise.resolve({ error: "exists" });
          var nid = "u" + Date.now() + Math.random().toString(16).slice(2, 6);
          d.users[email] = { id: nid, email: email, pw: body.tempPw };
          d.profiles[nid] = { id: nid, email: email, name: body.name || "", position: body.position || "", shift: body.shift || "",
            section: body.section === "office" ? "office" : "shop", must_change: true, created_at: new Date().toISOString() };
          save(d); return Promise.resolve({ ok: true });
        }
        var target = d.users[email];
        if (!target) return Promise.resolve({ error: "nouser" });
        if (body.action === "remove") {
          if (target.id === u.id) return Promise.resolve({ error: "self" });
          delete d.users[email]; delete d.profiles[target.id]; save(d); return Promise.resolve({ ok: true });
        }
        if (body.action === "reset") {
          if (String(body.pw || "").length < 8) return Promise.resolve({ error: "short" });
          target.pw = body.pw; d.profiles[target.id].must_change = true; save(d); return Promise.resolve({ ok: true });
        }
        return Promise.resolve({ error: "action" });
      },
      subscribe: function (f) { subs.push(f); return function () {}; }
    };
  }
  FakeBackend.reset = function () { localStorage.removeItem("__fakeDB"); localStorage.removeItem("__fakeUser"); };
  root.FakeBackend = FakeBackend;
  if (!root.SLAB_BACKEND) root.SLAB_BACKEND = FakeBackend();
})(window);
