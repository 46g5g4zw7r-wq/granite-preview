/* Slabwise — экран измерения остатка по фото.
   window.SlabMeasure.open(file, lang) -> Promise<null | {wIn, hIn, areaFt2, innerWIn, innerHIn, polyIn, markerMm, photo}>
   Зависит от SlabCore (measure-core.js) и SlabCV (measure-cv.js); OpenCV грузится при первом открытии. */
(function () {
  "use strict";
  var MM_KEY = "granite.markerMm", MM_OK = "granite.markerMmOk";
  var MAX_INPUT = 3000, SMALL_PX = 150, HANDLE = 14;

  var T = {
    ru: { title: "Измерение по фото", loading: "Загружаю распознавание… (первый раз дольше)", finding: "Ищу маркер и край куска…",
      noMarker: "Маркер не найден. Проверь: маркер целиком в кадре, без бликов, плотно прилегает к камню.",
      small: "Маркер на фото маленький — подойди ближе, иначе размеры будут менее точными.",
      hint: "Проверь контур. Тяни точки пальцем; нажми на линию — добавится точка; выбери точку и нажми «− точка», чтобы убрать.",
      mmAsk: "Один раз: приложи линейку к чёрному квадрату маркера и введи его сторону в миллиметрах.",
      mmLabel: "Сторона чёрного квадрата по линейке, мм", mmBad: "Введи число от 20 до 400.", ok: "OK", mmNow: "Маркер: {mm} мм",
      retake: "Переснять", reset: "Сбросить точки", cancel: "Отмена", del: "− точка", done: "Готово",
      dim: "Габарит", area: "Площадь", inner: "Самый большой прямоугольник внутри", ft2: "кв. фт", crossing: "Линии контура перекрещиваются — площадь будет неверной. Передвинь точки, чтобы контур шёл по краю куска.", fail: "Не получилось обработать фото. Попробуй ещё раз." },
    fr: { title: "Mesure par photo", loading: "Chargement de la reconnaissance… (plus long la première fois)", finding: "Recherche du marqueur et du bord…",
      noMarker: "Marqueur introuvable. Vérifiez : marqueur entier dans l’image, sans reflet, bien plaqué contre la pierre.",
      small: "Le marqueur est petit sur la photo — rapprochez-vous, sinon les dimensions seront moins précises.",
      hint: "Vérifiez le contour. Glissez les points ; touchez une ligne pour ajouter un point ; choisissez un point puis « − point » pour l’enlever.",
      mmAsk: "Une seule fois : mesurez à la règle le côté du carré noir du marqueur, en millimètres.",
      mmLabel: "Côté du carré noir à la règle, mm", mmBad: "Entrez un nombre entre 20 et 400.", ok: "OK", mmNow: "Marqueur : {mm} mm",
      retake: "Reprendre", reset: "Réinitialiser les points", cancel: "Annuler", del: "− point", done: "Terminé",
      dim: "Encombrement", area: "Surface", inner: "Plus grand rectangle à l’intérieur", ft2: "pi²", crossing: "Les lignes du contour se croisent — la surface serait fausse. Déplacez les points le long du bord de la pièce.", fail: "Impossible de traiter la photo. Réessayez." },
    en: { title: "Measure from photo", loading: "Loading recognition… (slower the first time)", finding: "Looking for the marker and the edge…",
      noMarker: "Marker not found. Check: the whole marker is in the frame, no glare, flat against the stone.",
      small: "The marker is small in the photo — move closer, or the sizes will be less accurate.",
      hint: "Check the outline. Drag the points; tap a line to add a point; pick a point and tap “− point” to remove it.",
      mmAsk: "Once: measure the side of the marker’s black square with a ruler, in millimetres.",
      mmLabel: "Black square side by ruler, mm", mmBad: "Enter a number from 20 to 400.", ok: "OK", mmNow: "Marker: {mm} mm",
      retake: "Retake", reset: "Reset points", cancel: "Cancel", del: "− point", done: "Done",
      dim: "Overall size", area: "Area", inner: "Largest rectangle inside", ft2: "ft²", crossing: "The outline crosses itself — the area would be wrong. Move the points so the outline follows the edge of the piece.", fail: "Could not process the photo. Try again." },
    es: { title: "Medir por foto", loading: "Cargando el reconocimiento… (la primera vez tarda más)", finding: "Buscando el marcador y el borde…",
      noMarker: "No se encontró el marcador. Compruebe: el marcador entero en la foto, sin reflejos, pegado a la piedra.",
      small: "El marcador sale pequeño en la foto: acérquese, o las medidas serán menos precisas.",
      hint: "Revise el contorno. Arrastre los puntos; toque una línea para añadir un punto; elija un punto y pulse «− punto» para quitarlo.",
      mmAsk: "Una vez: mida con una regla el lado del cuadrado negro del marcador, en milímetros.",
      mmLabel: "Lado del cuadrado negro con regla, mm", mmBad: "Introduzca un número de 20 a 400.", ok: "OK", mmNow: "Marcador: {mm} mm",
      retake: "Repetir foto", reset: "Restablecer puntos", cancel: "Cancelar", del: "− punto", done: "Listo",
      dim: "Medida total", area: "Superficie", inner: "Rectángulo más grande dentro", ft2: "pie²", crossing: "Las líneas del contorno se cruzan — la superficie saldría mal. Mueva los puntos para que sigan el borde de la pieza.", fail: "No se pudo procesar la foto. Inténtelo de nuevo." }
  };

  var lang = "ru", ui = null, st = null, resolveFn = null;

  function L() { return T[lang] || T.ru; }
  function storeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function storeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function markerMm() { var v = parseFloat(storeGet(MM_KEY)); return v >= 20 && v <= 400 ? v : 100; }

  function el(tag, attrs, parent) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === "text") e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  }

  function build() {
    if (ui) return ui;
    var css = el("style", {}, document.head);
    css.textContent =
      "#msr{position:fixed;inset:0;z-index:200;background:#111317;color:#f1ece2;display:flex;flex-direction:column;font:15px/1.4 Inter,system-ui,sans-serif}" +
      "#msr[hidden]{display:none}#msr header{display:flex;align-items:center;gap:12px;padding:10px 14px;background:#1b1d22;flex-wrap:wrap}" +
      "#msr h2{margin:0;font-size:1.05rem;flex:1;color:#f1ece2}#msr .stage{flex:1;position:relative;overflow:hidden;touch-action:none}" +
      "#msrCanvas{position:absolute;inset:0;width:100%;height:100%;display:block}" +
      "#msr .bar{display:flex;flex-wrap:wrap;gap:8px;padding:10px 14px;background:#1b1d22;align-items:center}" +
      "#msr .nums{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:8px 14px;background:#16181c}" +
      "#msr .nums div{background:#22252b;border-radius:10px;padding:8px 10px}#msr .nums small{display:block;color:#b9b2a5;font-size:.75rem}" +
      "#msr .nums b{font-size:1.05rem}#msr button{font:inherit;border-radius:10px;border:1px solid #4a4d55;background:#2a2d33;color:#f1ece2;padding:9px 14px;cursor:pointer}" +
      "#msr button.gold{background:linear-gradient(180deg,#d9b276,#a87f3a);border-color:#8a6a2e;color:#fff;font-weight:700}#msr button:disabled{opacity:.45;cursor:not-allowed}" +
      "#msr .grow{flex:1}#msrMsg{padding:8px 14px;color:#f3dca8;min-height:1.2em}#msrMsg.err{color:#ff9d8f}#msrWarn{padding:0 14px 8px;color:#ff9d8f}#msrWarn[hidden]{display:none}" +
      "#msrMmAsk{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:#22252b;border:1px solid #e2b866;border-radius:14px;padding:16px;max-width:340px;width:90%;display:grid;gap:10px;z-index:2}" +
      "#msrMmAsk[hidden]{display:none}#msrMmAsk input{font:inherit;padding:10px;border-radius:10px;border:1px solid #4a4d55;background:#111317;color:#fff}" +
      "#msr .mlang{display:flex;gap:4px}#msr .mlang button{padding:5px 9px;font-size:.78rem;font-weight:700}#msr .mlang button.on{background:#a87f3a;border-color:#8a6a2e}" +
      "#msrMmEdit{background:none!important;border:0!important;color:#e2b866!important;text-decoration:underline;padding:4px!important}" +
      "@media (max-width:640px){#msr .nums{gap:6px;padding:6px 10px}#msr .nums div{padding:6px 8px}#msr .nums small{font-size:.68rem}#msr .nums b{font-size:.92rem}#msr .bar{gap:6px;padding:8px 10px}#msr .bar button{padding:8px 10px}}";
    var root = el("section", { id: "msr", hidden: "", role: "dialog", "aria-modal": "true", translate: "no", "class": "notranslate" }, document.body);
    var head = el("header", {}, root);
    el("h2", { id: "msrTitle" }, head);
    var ml = el("span", { "class": "mlang" }, head);
    ["ru", "fr", "en", "es"].forEach(function (code) {
      var b = el("button", { type: "button", "data-lang": code, text: code.toUpperCase() }, ml);
      b.addEventListener("click", function () {
        // Язык всего приложения: нажимаем его же кнопку, чтобы форма под экраном тоже переключилась
        var appBtn = document.querySelector('.lang button[data-lang="' + code + '"]');
        if (appBtn) appBtn.click(); else window.SlabMeasure.setLang(code);
        if (lang !== code) window.SlabMeasure.setLang(code);
      });
    });
    el("button", { id: "msrMmEdit", type: "button" }, head);
    el("button", { id: "msrCancel", type: "button" }, head);
    el("div", { id: "msrMsg", "aria-live": "polite" }, root);
    el("div", { id: "msrWarn", "aria-live": "polite", hidden: "" }, root);
    var stage = el("div", { "class": "stage" }, root);
    var canvas = el("canvas", { id: "msrCanvas" }, stage);
    var ask = el("div", { id: "msrMmAsk", hidden: "" }, stage);
    el("p", { id: "msrMmText", style: "margin:0" }, ask);
    var lab = el("label", { style: "display:grid;gap:6px" }, ask);
    el("span", { id: "msrMmLabel" }, lab);
    el("input", { id: "msrMm", type: "text", inputmode: "decimal", autocomplete: "off" }, lab);
    el("p", { id: "msrMmErr", style: "margin:0;color:#ff9d8f;min-height:1em" }, ask);
    el("button", { id: "msrMmOk", type: "button", "class": "gold" }, ask);
    var nums = el("div", { "class": "nums" }, root);
    [["msrDimL", "msrDim"], ["msrAreaL", "msrArea"], ["msrInnerL", "msrInner"]].forEach(function (p) {
      var d = el("div", {}, nums); el("small", { id: p[0] }, d); el("b", { id: p[1], text: "—" }, d);
    });
    var bar = el("div", { "class": "bar" }, root);
    el("button", { id: "msrRetake", type: "button" }, bar);
    el("button", { id: "msrRetakeSame", type: "button" }, bar);
    el("button", { id: "msrDel", type: "button" }, bar);
    el("span", { "class": "grow" }, bar);
    el("button", { id: "msrDone", type: "button", "class": "gold" }, bar);
    var file = el("input", { id: "msrFile", type: "file", accept: "image/*", capture: "environment", hidden: "" }, root);

    ui = { root: root, canvas: canvas, ask: ask, file: file, $: function (id) { return document.getElementById(id); } };
    ui.$("msrCancel").addEventListener("click", function () { finish(null); });
    ui.$("msrDone").addEventListener("click", function () { finish(result()); });
    ui.$("msrRetake").addEventListener("click", function () { file.value = ""; file.click(); });
    file.addEventListener("change", function () { if (file.files && file.files[0]) run(file.files[0]); });
    ui.$("msrRetakeSame").addEventListener("click", function () {
      if (!st || !st.rect) return;
      var token = st.token;
      msg("finding");
      setTimeout(function () { // поиск контура тяжёлый: сначала показываем «Ищу…»
        if (!st || st.token !== token || !st.rect) return;
        st.points = autoPoints(); st.sel = -1; msg("hint"); refresh();
      }, 30);
    });
    ui.$("msrDel").addEventListener("click", function () {
      if (!st || !st.points.length) return;
      var i = st.sel >= 0 && st.sel < st.points.length ? st.sel : st.points.length - 1;
      st.points.splice(i, 1); st.sel = -1; refresh();
    });
    ui.$("msrMmEdit").addEventListener("click", function () {
      askMm().then(function (v) {
        if (!st || !v) return;
        if (st.rect) { st.rect.mmPerPx *= v / st.mm; st.mm = v; refresh(); } // точки те же, меняется только масштаб
        else if (st.img && !st.processing) process();
      });
    });
    bindPointer(canvas);
    window.addEventListener("resize", function () { if (!ui.root.hidden) draw(); });
    return ui;
  }

  function texts() {
    if (!ui) return;
    var t = L();
    ui.$("msrTitle").textContent = t.title;
    Array.prototype.forEach.call(ui.root.querySelectorAll(".mlang button"), function (b) { b.classList.toggle("on", b.getAttribute("data-lang") === lang); });
    ui.$("msrCancel").textContent = t.cancel;
    ui.$("msrRetake").textContent = t.retake;
    ui.$("msrRetakeSame").textContent = t.reset;
    ui.$("msrDel").textContent = t.del;
    ui.$("msrDone").textContent = t.done;
    ui.$("msrDimL").textContent = t.dim;
    ui.$("msrAreaL").textContent = t.area;
    ui.$("msrInnerL").textContent = t.inner;
    ui.$("msrMmText").textContent = t.mmAsk;
    ui.$("msrMmLabel").textContent = t.mmLabel;
    ui.$("msrMmOk").textContent = t.ok;
    ui.$("msrMmEdit").textContent = t.mmNow.replace("{mm}", String(markerMm()));
    if (st && st.msgKey) msg(st.msgKey, st.msgErr);
    if (st) warn(st.warnKey);
    if (st && st.points) refresh();
  }

  function msg(key, isErr) {
    if (st) { st.msgKey = key; st.msgErr = !!isErr; }
    var m = ui.$("msrMsg");
    m.textContent = key ? (L()[key] || key) : "";
    m.className = isErr ? "err" : "";
  }

  // Отдельная строка предупреждения, чтобы не прятать подсказку по правке точек
  function warn(key) {
    if (st) st.warnKey = key || null;
    var w = ui.$("msrWarn");
    w.textContent = key ? (L()[key] || key) : "";
    w.hidden = !key;
  }

  var askState = null;
  function askMm() {
    if (askState) return askState.promise; // уже открыт — не открываем второй раз
    askState = {};
    askState.promise = new Promise(function (resolve) {
      var inp = ui.$("msrMm"), err = ui.$("msrMmErr");
      inp.value = storeGet(MM_OK) === "1" ? String(markerMm()) : "";
      err.textContent = "";
      ui.ask.hidden = false;
      setTimeout(function () { inp.focus(); }, 30);
      var okBtn = ui.$("msrMmOk");
      function accept() {
        var v = parseFloat(String(inp.value).replace(",", "."));
        if (!(v >= 20 && v <= 400)) { err.textContent = L().mmBad; return; }
        storeSet(MM_KEY, String(v)); storeSet(MM_OK, "1");
        ui.ask.hidden = true;
        cleanup();
        texts();
        resolve(v);
      }
      function onKey(e) { if (e.key === "Enter") accept(); }
      function cleanup() { okBtn.removeEventListener("click", accept); inp.removeEventListener("keydown", onKey); askState = null; }
      askState.cancel = function () { ui.ask.hidden = true; cleanup(); resolve(null); };
      okBtn.addEventListener("click", accept); inp.addEventListener("keydown", onKey);
    });
    return askState.promise;
  }

  function freeState() {
    if (!st) return;
    try { if (st.rect && st.rect.mat) st.rect.mat.delete(); } catch (e) {}
    try { if (st.img) st.img.delete(); } catch (e) {}
    st.rect = null; st.img = null;
  }

  function loadBitmap(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: "from-image" }).catch(function () { return createImageBitmap(file); });
    }
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () { URL.revokeObjectURL(url); res(im); };
      im.onerror = function (e) { URL.revokeObjectURL(url); rej(e); };
      im.src = url;
    });
  }

  function run(file) {
    var token = {};
    freeState();
    st = { token: token, points: [], sel: -1, rect: null, img: null, photo: "", srcCanvas: null };
    warn(null);
    ui.$("msrDone").disabled = true;
    msg("loading");
    draw();
    Promise.all([window.SlabCV.loadCV(), loadBitmap(file)]).then(function (r) {
      if (!st || st.token !== token) { if (r[1] && r[1].close) r[1].close(); return; }
      var cv = r[0].cv, bmp = r[1];
      st.cv = cv;
      var k = Math.min(1, MAX_INPUT / Math.max(bmp.width, bmp.height));
      var c = document.createElement("canvas");
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      if (bmp.close) bmp.close();
      st.srcCanvas = c;
      var p = document.createElement("canvas"), pk = Math.min(1, 480 / Math.max(c.width, c.height));
      p.width = Math.round(c.width * pk); p.height = Math.round(c.height * pk);
      p.getContext("2d").drawImage(c, 0, 0, p.width, p.height);
      st.photo = p.toDataURL("image/jpeg", 0.8);
      st.img = cv.imread(c);
      return (storeGet(MM_OK) === "1" ? Promise.resolve() : askMm()).then(function () {
        if (!st || st.token !== token) return;
        process();
      });
    }).catch(function () { if (st && st.token === token) msg("fail", true); });
  }

  function process() {
    var cv = st.cv, token = st.token;
    st.processing = true;
    msg("finding");
    setTimeout(function () {
      if (!st || st.token !== token) return;
      try {
        if (st.rect && st.rect.mat) { st.rect.mat.delete(); st.rect = null; }
        st.points = []; refresh();
        var det = window.SlabCV.detectMarker(cv, st.img);
        if (!det) { msg("noMarker", true); draw(); return; }
        var c = det.corners, side = Math.min(Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]), Math.hypot(c[3][0] - c[0][0], c[3][1] - c[0][1]));
        st.mm = markerMm();
        st.rect = window.SlabCV.rectify(cv, st.img, c, st.mm, 1600);
        var rc = document.createElement("canvas");
        cv.imshow(rc, st.rect.mat);
        st.rectCanvas = rc;
        st.points = autoPoints();
        st.sel = -1;
        msg("hint");
        st.baseWarn = side < SMALL_PX ? "small" : null;
        warn(st.baseWarn);
        refresh();
      } catch (e) { msg("fail", true); }
      if (st) st.processing = false;
    }, 30);
  }

  function autoPoints() { return window.SlabCV.autoContour(st.cv, st.rect.mat, st.rect.markerQuad); }

  function summary() {
    var k = st.rect ? st.rect.mmPerPx : 1;
    return window.SlabCore.summarize(st.points.map(function (p) { return [p[0] * k, p[1] * k]; }));
  }

  function refresh() {
    var ok = st && st.rect && st.points.length >= 3;
    var crossing = ok && window.SlabCore.selfIntersects(st.points);
    if (st && st.rect) warn(crossing ? "crossing" : st.baseWarn);
    ui.$("msrDone").disabled = !ok || crossing;
    ui.$("msrDel").disabled = !(st && st.points.length);
    ui.$("msrRetakeSame").disabled = !(st && st.rect);
    if (ok) {
      var s = summary(), t = L();
      st.sum = s;
      ui.$("msrDim").textContent = s.wIn + " × " + s.hIn + "″";
      ui.$("msrArea").textContent = s.areaFt2 + " " + t.ft2;
      ui.$("msrInner").textContent = s.innerWIn + " × " + s.innerHIn + "″";
    } else {
      ["msrDim", "msrArea", "msrInner"].forEach(function (id) { ui.$(id).textContent = "—"; });
    }
    draw();
  }

  // Вид: выпрямленное фото, вписанное в холст
  function view() {
    var cw = ui.canvas.clientWidth, ch = ui.canvas.clientHeight, src = st && st.rectCanvas && st.rect ? st.rectCanvas : (st && st.srcCanvas);
    if (!src) return null;
    var s = Math.min(cw / src.width, ch / src.height), ox = (cw - src.width * s) / 2, oy = (ch - src.height * s) / 2;
    return { s: s, ox: ox, oy: oy, src: src };
  }

  function draw() {
    var c = ui.canvas, dpr = window.devicePixelRatio || 1;
    c.width = Math.round(c.clientWidth * dpr); c.height = Math.round(c.clientHeight * dpr);
    var g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, c.clientWidth, c.clientHeight);
    var v = view();
    if (!v) return;
    g.drawImage(v.src, v.ox, v.oy, v.src.width * v.s, v.src.height * v.s);
    if (!st.rect || !st.points.length) return;
    var P = function (p) { return [v.ox + p[0] * v.s, v.oy + p[1] * v.s]; };
    if (st.sum && st.points.length >= 3) {
      var k = st.rect.mmPerPx;
      g.setLineDash([8, 6]); g.strokeStyle = "rgba(120,220,255,.9)"; g.lineWidth = 2; g.beginPath();
      st.sum.inner.forEach(function (q, i) { var pp = P([q[0] / k, q[1] / k]); if (i) g.lineTo(pp[0], pp[1]); else g.moveTo(pp[0], pp[1]); });
      g.closePath(); g.stroke(); g.setLineDash([]);
    }
    g.strokeStyle = "#e2b866"; g.lineWidth = 3; g.fillStyle = "rgba(226,184,102,.14)"; g.beginPath();
    st.points.forEach(function (p, i) { var pp = P(p); if (i) g.lineTo(pp[0], pp[1]); else g.moveTo(pp[0], pp[1]); });
    g.closePath(); g.fill(); g.stroke();
    st.points.forEach(function (p, i) {
      var pp = P(p);
      g.beginPath(); g.arc(pp[0], pp[1], HANDLE, 0, Math.PI * 2);
      g.fillStyle = i === st.sel ? "#ffffff" : "rgba(17,19,23,.75)"; g.fill();
      g.lineWidth = 3; g.strokeStyle = "#e2b866"; g.stroke();
    });
    if (st.drag != null && st.loupe) {
      var R = 60, lx = R + 10, ly = R + 10, z = 2.5, cp = st.points[st.drag];
      g.save(); g.beginPath(); g.arc(lx, ly, R, 0, Math.PI * 2); g.clip();
      var sz = (2 * R) / (z * v.s);
      g.drawImage(v.src, cp[0] - sz / 2, cp[1] - sz / 2, sz, sz, lx - R, ly - R, 2 * R, 2 * R);
      g.restore();
      g.beginPath(); g.arc(lx, ly, R, 0, Math.PI * 2); g.strokeStyle = "#fff"; g.lineWidth = 2; g.stroke();
      g.beginPath(); g.moveTo(lx - 10, ly); g.lineTo(lx + 10, ly); g.moveTo(lx, ly - 10); g.lineTo(lx, ly + 10); g.strokeStyle = "#e2b866"; g.stroke();
    }
  }

  function toImg(e) {
    var r = ui.canvas.getBoundingClientRect(), v = view();
    return v ? [(e.clientX - r.left - v.ox) / v.s, (e.clientY - r.top - v.oy) / v.s, v] : null;
  }

  function bindPointer(c) {
    c.addEventListener("pointerdown", function (e) {
      if (!st || !st.rect) return;
      var q = toImg(e); if (!q) return;
      var v = q[2], best = -1, bd = Infinity;
      st.points.forEach(function (p, i) { var d = Math.hypot((p[0] - q[0]) * v.s, (p[1] - q[1]) * v.s); if (d < bd) { bd = d; best = i; } });
      if (best >= 0 && bd <= HANDLE + 8) {
        st.sel = best; st.drag = best; st.loupe = true; c.setPointerCapture(e.pointerId); draw(); return;
      }
      // Нажатие на ребро — новая точка
      var n = st.points.length;
      for (var i = 0; i < n; i++) {
        var a = st.points[i], b = st.points[(i + 1) % n];
        if (segDist(q, a, b) * v.s <= 10) { st.points.splice(i + 1, 0, [q[0], q[1]]); st.sel = i + 1; st.drag = i + 1; st.loupe = true; c.setPointerCapture(e.pointerId); refresh(); return; }
      }
      st.sel = -1; draw();
    });
    c.addEventListener("pointermove", function (e) {
      if (!st || st.drag == null) return;
      var q = toImg(e); if (!q) return;
      var w = st.rect.mat.cols, h = st.rect.mat.rows;
      st.points[st.drag] = [Math.max(0, Math.min(w, q[0])), Math.max(0, Math.min(h, q[1]))];
      refresh();
    });
    function end() { if (st) { st.drag = null; st.loupe = false; draw(); } }
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
  }

  function segDist(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    var t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  }

  function result() {
    if (!st || !st.rect || st.points.length < 3) return null;
    var s = summary(), k = st.rect.mmPerPx;
    return { wIn: s.wIn, hIn: s.hIn, areaFt2: s.areaFt2, innerWIn: s.innerWIn, innerHIn: s.innerHIn,
      polyIn: st.points.map(function (p) { return [Math.round(p[0] * k / 25.4 * 10) / 10, Math.round(p[1] * k / 25.4 * 10) / 10]; }),
      markerMm: st.mm, photo: st.photo };
  }

  function finish(res) {
    if (askState && askState.cancel) askState.cancel();
    freeState();
    st = null;
    ui.root.hidden = true;
    ui.ask.hidden = true;
    document.documentElement.style.overflow = "";
    var r = resolveFn; resolveFn = null;
    if (r) r(res);
  }

  function open(file, lg) {
    if (lg) lang = lg;
    build();
    if (resolveFn) finish(null);
    ui.root.hidden = false;
    document.documentElement.style.overflow = "hidden";
    texts();
    return new Promise(function (resolve) { resolveFn = resolve; run(file); });
  }

  window.SlabMeasure = {
    open: open,
    setLang: function (lg) { lang = lg; texts(); },
    _T: T,
    // Для тестов и отладки: текущие точки и экранные координаты ручек
    _state: function () {
      return {
        points: st ? st.points.slice() : [],
        select: function (i) { if (st) { st.sel = i; draw(); } },
        setPoints: function (pts) { if (st) { st.points = pts.map(function (p) { return [p[0], p[1]]; }); st.sel = -1; refresh(); } },
        handleScreen: function (i) {
          var v = view(), r = ui.canvas.getBoundingClientRect(), p = st.points[i];
          return [r.left + v.ox + p[0] * v.s, r.top + v.oy + p[1] * v.s];
        }
      };
    }
  };
})();
