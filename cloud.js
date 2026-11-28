/* Slabwise — общая база в Supabase.
   Страницы по-прежнему читают и пишут localStorage (это локальная копия). Этот файл:
   • при записи общих ключей отправляет изменения на сервер;
   • при открытии и при чужих изменениях скачивает свежие данные и шлёт событие "slab:data".
   Ключи: куски (granite.items) — строка на кусок; журналы — только добавление; настройки — целиком. */
(function (root) {
  "use strict";
  var CONFIG = {
    url: "https://diydirqvwvpmwatemgoe.supabase.co",
    key: "sb_publishable_KhL0Pkf42yfbmcts8YX42w_abMr47xF"
  };
  var ITEM_KEY = "granite.items";
  var LOG_KEYS = ["granite.pieceLog", "granite.log"];
  var DOC_KEYS = ["granite.edits", "granite.company", "granite.trialStart", "granite.trialExt"];
  var STAFF_KEY = "granite.staff", SNAP_KEY = "granite.syncSnap", BLOCK_KEY = "granite.seqBlock", SES_KEY = "granite.session";
  var LOG_LIMIT = 300;

  /* ---------- Чистые функции (проверяются тестами в node) ---------- */
  function stable(v) {
    if (v === undefined) return undefined;
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(function (x) { var s = stable(x); return s === undefined ? "null" : s; }).join(",") + "]";
    return "{" + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; })
      .map(function (k) { return JSON.stringify(k) + ":" + stable(v[k]); }).join(",") + "}";
  }
  function hash(v) { // FNV-1a 32 bit ×2 — отличать записи журнала, не для защиты
    var s = stable(v), h1 = 0x811c9dc5, h2 = 0x01000193 ^ s.length;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
      h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
    }
    return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
  }
  function byCode(arr) { var m = {}; (arr || []).forEach(function (x) { if (x && x.code) m[x.code] = x; }); return m; }
  // Что изменилось в списке кусков: новые/изменённые — upserts, пропавшие — deletes
  function diffItems(prev, next) {
    var a = byCode(prev), b = byCode(next), ups = [], dels = [];
    Object.keys(b).forEach(function (c) { if (!a[c] || stable(a[c]) !== stable(b[c])) ups.push(b[c]); });
    Object.keys(a).forEach(function (c) { if (!b[c]) dels.push(c); });
    return { upserts: ups, deletes: dels };
  }
  // Новые записи журнала (по отпечатку), порядок сохраняется
  function newLogEntries(prev, next) {
    var seen = {}; (prev || []).forEach(function (e) { seen[hash(e)] = 1; });
    return (next || []).filter(function (e) { return e && !seen[hash(e)]; });
  }
  function logTime(e) { var t = Date.parse(e && e.time); return isNaN(t) ? 0 : t; }
  // Журнал с сервера в том порядке, в каком его держит страница
  function orderLog(key, entries) {
    var list = entries.slice().sort(function (x, y) { return logTime(y) - logTime(x); }).slice(0, LOG_LIMIT);
    return key === "granite.log" ? list.reverse() : list; // работники дописывают в конец, куски — в начало
  }
  function staffRows(profiles) {
    return (profiles || []).filter(function (p) { return p.section !== "admin"; })
      .sort(function (x, y) { return String(x.created_at || "").localeCompare(String(y.created_at || "")); })
      .map(function (p) { return [p.name || "", p.position || "", p.email || "", p.shift || "", p.section]; });
  }
  // Кусок для сервера: фото в виде ссылки на файл хранилища, а не временного адреса
  function photoPath(url) {
    var m = /\/storage\/v1\/object\/sign\/photos\/([^?#]+)/.exec(String(url || ""));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function toServerItem(item, urlToPath) {
    var x = Object.assign({}, item);
    if (typeof x.img === "string") {
      var p = (urlToPath && urlToPath[x.img]) || photoPath(x.img);
      if (p) x.img = "photo:" + p;
    }
    return x;
  }
  function parse(s, d) { try { var v = JSON.parse(s); return v == null ? d : v; } catch (e) { return d; } }

  var pure = { stable: stable, hash: hash, diffItems: diffItems, newLogEntries: newLogEntries, orderLog: orderLog,
    staffRows: staffRows, toServerItem: toServerItem, photoPath: photoPath };
  pure.migrateLocal = function (l, sr) { return migrateLocal(l, sr); };

  /* ---------- Подключение к Supabase ---------- */
  function supabaseBackend() {
    var sb = root.supabase.createClient(CONFIG.url, CONFIG.key, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "slabwise-auth" }
    });
    function ok(r) { if (r.error) throw r.error; return r.data; }
    return {
      signIn: function (email, pw) { return sb.auth.signInWithPassword({ email: email, password: pw }).then(function (r) { return r.error ? null : r.data.user; }); },
      signOut: function () { return sb.auth.signOut({ scope: "local" }).catch(function () {}); },
      user: function () { return sb.auth.getSession().then(function (r) { return r.data && r.data.session ? r.data.session.user : null; }); },
      updatePassword: function (pw) { return sb.auth.updateUser({ password: pw }).then(function (r) { return !r.error; }); },
      rpc: function (name, args) { return sb.rpc(name, args || {}).then(ok); },
      myProfile: function (id) { return sb.from("profiles").select("*").eq("id", id).maybeSingle().then(ok); },
      profiles: function () { return sb.from("profiles").select("*").then(ok); },
      pullItems: function () { return sb.from("items").select("code,data,deleted").then(ok); },
      pullLogs: function (key) { return sb.from("logs").select("entry,time").eq("key", key).order("time", { ascending: false }).limit(LOG_LIMIT).then(ok); },
      pullKv: function () { return sb.from("kv").select("key,value").then(ok); },
      upsertItems: function (rows) { return sb.from("items").upsert(rows, { onConflict: "code" }).then(ok); },
      insertLogs: function (rows) { return sb.from("logs").upsert(rows, { onConflict: "key,hash", ignoreDuplicates: true }).then(ok); },
      upsertKv: function (key, value) { return sb.from("kv").upsert({ key: key, value: value, updated_at: new Date().toISOString() }, { onConflict: "key" }).then(ok); },
      uploadPhoto: function (path, blob) { return sb.storage.from("photos").upload(path, blob, { contentType: blob.type || "image/jpeg", upsert: false }).then(ok); },
      signUrls: function (paths) {
        if (!paths.length) return Promise.resolve({});
        return sb.storage.from("photos").createSignedUrls(paths, 86400).then(ok).then(function (list) {
          var m = {}; (list || []).forEach(function (x) { if (x.signedUrl) m[x.path] = x.signedUrl; }); return m;
        });
      },
      staff: function (body) {
        return sb.functions.invoke("staff", { body: body }).then(function (r) {
          if (!r.error) return r.data || { ok: true };
          var ctx = r.error.context;
          if (ctx && typeof ctx.json === "function") return ctx.json().catch(function () { return { error: "net" }; });
          return { error: "net" };
        });
      },
      subscribe: function (onChange) {
        var ch = sb.channel("slabwise");
        ["items", "logs", "kv"].forEach(function (t) { ch.on("postgres_changes", { event: "*", schema: "public", table: t }, onChange); });
        ch.subscribe();
        return function () { sb.removeChannel(ch); };
      }
    };
  }

  /* ---------- Синхронизация ---------- */
  var LS = root.localStorage;
  var rawSet = root.Storage ? root.Storage.prototype.setItem : null;
  var rawRemove = root.Storage ? root.Storage.prototype.removeItem : null;
  var backend = null, me = null, profile = null, ready = false, chain = Promise.resolve();
  var dirty = {}, timer = null, urlToPath = {}, pullTimer = null, listeners = [];

  function getB() {
    if (!backend) backend = root.SLAB_BACKEND || (root.supabase ? supabaseBackend() : null);
    return backend;
  }
  function lsGet(k) { try { return LS.getItem(k); } catch (e) { return null; } }
  function lsPut(k, v) { try { if (v == null) rawRemove.call(LS, k); else rawSet.call(LS, k, v); } catch (e) {} }
  function snap() { return parse(lsGet(SNAP_KEY), {}); }
  function saveSnap(s) { lsPut(SNAP_KEY, JSON.stringify(s)); }
  function shared(k) { return k === ITEM_KEY || LOG_KEYS.indexOf(k) >= 0 || DOC_KEYS.indexOf(k) >= 0; }
  function emit(info) {
    try { root.dispatchEvent(new CustomEvent("slab:data", { detail: info || {} })); } catch (e) {}
    listeners.forEach(function (f) { try { f(info || {}); } catch (e) {} });
  }
  function queue(fn) { chain = chain.then(fn, fn).catch(function (e) { if (root.console) console.warn("slabwise sync:", e && e.message || e); }); return chain; }

  function markDirty(k) {
    if (!ready || !shared(k)) return;
    dirty[k] = 1;
    var p = parse(lsGet("granite.syncDirty"), {}); p[k] = 1; lsPut("granite.syncDirty", JSON.stringify(p));
    clearTimeout(timer);
    timer = setTimeout(function () { queue(pushDirty); }, 300);
  }
  function install() {
    if (!rawSet || root.Storage.prototype.__slab) return;
    root.Storage.prototype.setItem = function (k, v) { rawSet.call(this, k, v); if (this === LS) markDirty(String(k)); };
    root.Storage.prototype.removeItem = function (k) { rawRemove.call(this, k); if (this === LS) markDirty(String(k)); };
    root.Storage.prototype.__slab = true;
  }

  function dataUrlToBlob(u) {
    var m = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(u); if (!m) return null;
    var bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: m[1] || "image/jpeg" });
  }
  function uploadPhotos(items) {
    var b = getB();
    return items.reduce(function (p, x) {
      return p.then(function () {
        if (typeof x.img !== "string" || x.img.indexOf("data:") !== 0) return;
        var blob = dataUrlToBlob(x.img); if (!blob) return;
        var path = "items/" + String(x.code).replace(/[^A-Za-z0-9_-]/g, "_") + "-" + Date.now() + ".jpg";
        var local = x.img;
        return b.uploadPhoto(path, blob).then(function () { urlToPath[local] = path; });
      });
    }, Promise.resolve());
  }

  function pushKey(k, s) {
    var b = getB(), cur = lsGet(k);
    if (k === ITEM_KEY) {
      var next = parse(cur, []), prev = s[k] || [];
      var nextS = next.map(function (x) { return toServerItem(x, urlToPath); });
      var d = diffItems(prev, nextS);
      if (!d.upserts.length && !d.deletes.length) return Promise.resolve();
      return uploadPhotos(d.upserts).then(function () {
        var rows = d.upserts.map(function (x) { return { code: x.code, data: toServerItem(x, urlToPath), deleted: false }; });
        var prevBy = byCode(prev);
        d.deletes.forEach(function (c) { rows.push({ code: c, data: prevBy[c], deleted: true }); });
        rows.forEach(function (r) { r.updated_at = new Date().toISOString(); });
        return b.upsertItems(rows).then(function () { s[k] = next.map(function (x) { return toServerItem(x, urlToPath); }); });
      });
    }
    if (LOG_KEYS.indexOf(k) >= 0) {
      var nl = parse(cur, []), add = newLogEntries(s[k] || [], nl);
      if (!add.length) return Promise.resolve();
      var rows2 = add.map(function (e) { return { key: k, hash: hash(e), entry: e, time: e.time || new Date().toISOString() }; });
      return b.insertLogs(rows2).then(function () { s[k] = nl; });
    }
    if (DOC_KEYS.indexOf(k) >= 0) {
      if (cur === (s[k] === undefined ? null : s[k])) return Promise.resolve();
      return b.upsertKv(k, cur).then(function () { s[k] = cur; }, function () { /* нет прав — ключ останется локальным */ s[k] = cur; });
    }
    return Promise.resolve();
  }
  function pushDirty() {
    var keys = Object.keys(parse(lsGet("granite.syncDirty"), {})).concat(Object.keys(dirty))
      .filter(function (k, i, a) { return a.indexOf(k) === i; });
    if (!keys.length || !me) return Promise.resolve();
    dirty = {};
    var s = snap();
    return keys.reduce(function (p, k) { return p.then(function () { return pushKey(k, s); }); }, Promise.resolve())
      .then(function () { saveSnap(s); lsPut("granite.syncDirty", null); }, function (e) {
        keys.forEach(function (k) { dirty[k] = 1; }); throw e;
      });
  }

  // Скачать всё; first — первый запуск на этом устройстве: свои локальные записи дописываются на сервер
  function pull(first) {
    var b = getB(), s = snap();
    return Promise.all([b.pullItems(), b.pullLogs(LOG_KEYS[0]), b.pullLogs(LOG_KEYS[1]), b.pullKv(),
      profile && profile.section === "admin" ? b.profiles() : Promise.resolve(null)])
    .then(function (r) {
      var items = r[0].filter(function (x) { return !x.deleted; }).map(function (x) { return Object.assign({}, x.data, { code: x.code }); });
      var serverCodes = {}; r[0].forEach(function (x) { serverCodes[x.code] = 1; });
      var extraLocal = [];
      if (first) extraLocal = migrateLocal(parse(lsGet(ITEM_KEY), []), r[0]);
      var paths = items.map(function (x) { return typeof x.img === "string" && x.img.indexOf("photo:") === 0 ? x.img.slice(6) : null; }).filter(Boolean);
      return b.signUrls(paths).then(function (urls) {
        s[ITEM_KEY] = items.map(function (x) { return Object.assign({}, x); });
        var shown = items.map(function (x) {
          if (typeof x.img === "string" && x.img.indexOf("photo:") === 0) {
            var p = x.img.slice(6), u = urls[p];
            if (u) { urlToPath[u] = p; return Object.assign({}, x, { img: u }); }
            return Object.assign({}, x, { img: "" });
          }
          return x;
        });
        lsPut(ITEM_KEY, JSON.stringify(shown.concat(extraLocal)));
        [1, 2].forEach(function (i) {
          var key = LOG_KEYS[i - 1], server = orderLog(key, r[i].map(function (x) { return x.entry; }));
          s[key] = server.slice();
          var merged = server;
          if (first) {
            var add = newLogEntries(server, parse(lsGet(key), []));
            merged = orderLog(key, server.concat(add));
          }
          lsPut(key, JSON.stringify(merged));
        });
        var kv = {}; r[3].forEach(function (x) { kv[x.key] = x.value; });
        DOC_KEYS.forEach(function (k) {
          if (kv[k] !== undefined) { s[k] = kv[k]; lsPut(k, kv[k]); }
          else if (first && lsGet(k) != null) { s[k] = null; } // локальное значение уйдёт на сервер
          else { s[k] = null; if (!first) lsPut(k, null); }
        });
        if (r[4]) lsPut(STAFF_KEY, JSON.stringify(staffRows(r[4])));
        saveSnap(s);
        if (first) {
          var p = {}; if (extraLocal.length) p[ITEM_KEY] = 1;
          LOG_KEYS.forEach(function (k) { if (newLogEntries(s[k], parse(lsGet(k), [])).length) p[k] = 1; });
          DOC_KEYS.forEach(function (k) { if (s[k] == null && lsGet(k) != null) p[k] = 1; });
          lsPut("granite.syncDirty", JSON.stringify(p));
        }
      });
    });
  }
  // Первый запуск на устройстве: куски из старого прототипа дописываются на сервер.
  // Тот же номер на сервере у другого куска (у каждого телефона был свой счётчик) — номер получает суффикс.
  function migrateLocal(local, serverRows) {
    var server = {}; serverRows.forEach(function (x) { server[x.code] = x; });
    var taken = {}; Object.keys(server).forEach(function (c) { taken[c] = 1; });
    var out = [];
    local.forEach(function (x) {
      if (!x || !x.code) return;
      var sv = server[x.code];
      if (sv) {
        var a = Object.assign({}, sv.data, { img: "" }), b2 = Object.assign({}, x, { img: "" });
        if (stable(a) === stable(b2)) return; // тот же кусок уже на сервере
        var n = 2; while (taken[x.code + "-" + n]) n++;
        x = Object.assign({}, x, { code: x.code + "-" + n });
      }
      taken[x.code] = 1; out.push(x);
    });
    return out;
  }
  function maxLocalCode() {
    var m = parseInt(lsGet("granite.seq") || "0", 10) || 0;
    parse(lsGet(ITEM_KEY), []).forEach(function (x) { var k = /^S-(\d+)$/.exec(x && x.code || ""); if (k) m = Math.max(m, parseInt(k[1], 10)); });
    return m;
  }
  function schedulePull() {
    clearTimeout(pullTimer);
    pullTimer = setTimeout(function () { queue(function () { return pushDirty().then(function () { return pull(false); }).then(function () { emit({ remote: true }); }); }); }, 800);
  }

  // Номера кусков: блок с сервера, чтобы два телефона не выдали один номер
  function refillCodes() {
    var blk = parse(lsGet(BLOCK_KEY), []);
    if (blk.length >= 5 || !me) return Promise.resolve();
    return getB().rpc("reserve_codes", { n: 20 }).then(function (nums) {
      var cur = parse(lsGet(BLOCK_KEY), []); lsPut(BLOCK_KEY, JSON.stringify(cur.concat(nums || [])));
    }).catch(function () {});
  }
  function takeCode() {
    var blk = parse(lsGet(BLOCK_KEY), []);
    if (!blk.length) return null;
    var n = blk.shift(); lsPut(BLOCK_KEY, JSON.stringify(blk));
    if (blk.length < 5) queue(refillCodes);
    return "S-" + String(n).padStart(3, "0");
  }
  function reserveCodes(n) {
    return getB().rpc("reserve_codes", { n: n }).then(function (nums) {
      return (nums || []).map(function (x) { return "S-" + String(x).padStart(3, "0"); });
    });
  }

  // Запуск на странице раздела: нет входа — на главную
  function start(opts) {
    opts = opts || {};
    var b = getB();
    if (!b) return Promise.reject(new Error("no backend"));
    return b.user().then(function (u) {
      if (!u) throw new Error("signed out");
      me = u;
      return b.myProfile(u.id);
    }).then(function (p) {
      if (!p) throw new Error("no profile");
      profile = p;
      var first = !lsGet(SNAP_KEY);
      install();
      ready = true;
      var bump = first && maxLocalCode() > 0 ? b.rpc("bump_codes", { n: maxLocalCode() }).catch(function () {}) : Promise.resolve();
      return bump.then(function () { return first ? null : pushDirty(); }).then(function () { return pull(first); })
        .then(function () { return first ? pushDirty() : null; })
        .then(function () { emit({ initial: true }); b.subscribe(schedulePull); queue(refillCodes); return p; });
    }).catch(function (e) {
      if (opts.redirect !== false && /signed out|no profile/.test(e.message)) {
        try { root.sessionStorage.removeItem(SES_KEY); } catch (x) {}
        root.location.replace("index.html");
      }
      throw e;
    });
  }

  var api = { CONFIG: CONFIG, pure: pure, backend: getB, start: start, takeCode: takeCode, reserveCodes: reserveCodes,
    profile: function () { return profile; }, flush: function () { return queue(pushDirty); },
    onData: function (f) { listeners.push(f); }, _pull: pull };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.SlabCloud = api;
})(typeof window !== "undefined" ? window : globalThis);
