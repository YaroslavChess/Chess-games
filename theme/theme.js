/* Теми оформлення для всіх ігор. Підключення: <script src="../theme/theme.js"></script>
   Як це працює: цей файл вибирає тему, підключає theme/base.css і theme/themes/<назва>.css.
   Тема лише міняє CSS-змінні з :root та додає декор за вмістом. Логіку ігор не чіпає.
   Якщо цей файл не завантажився — ігри працюють як раніше. Докладніше: theme/README.md */
(function () {
  'use strict';

  // Розклад тем. Рік не вказується. Формат дати: 'день.місяць'.
  // Проміжок через Новий рік (напр. 01.12 – 10.01) працює.
  // Якщо збігаються кілька рядків, виграє перший. Нічого не збіглося — тема default.
  var SCHEDULE = [
    { name: 'halloween', from: '24.10', to: '01.11' },
    { name: 'winter',    from: '01.12', to: '10.01' },
    { name: 'spring',    from: '01.03', to: '31.03' },
    { name: 'ukraine',   from: '20.08', to: '25.08' },
    { name: 'ukraine',   from: '28.09', to: '02.10' }
  ];

  var DECOR_MAX = 15;            // не більше стількох плаваючих елементів
  var DECOR_KEY = 'chess-theme-decor';   // localStorage: 'off' — декор вимкнено

  /* ---------- Вибір теми ---------- */

  // 'день.місяць' -> число місяць*100+день (10.01 -> 110). Помилка -> -1.
  function parseDay(text) {
    var m = /^\s*(\d{1,2})\.(\d{1,2})\s*$/.exec(String(text));
    if (!m) { return -1; }
    var day = parseInt(m[1], 10);
    var month = parseInt(m[2], 10);
    if (day < 1 || day > 31 || month < 1 || month > 12) { return -1; }
    return month * 100 + day;
  }

  // Чи потрапляє дата (місяць*100+день) у проміжок. Проміжок може йти через Новий рік.
  function inRange(today, from, to) {
    if (from < 0 || to < 0) { return false; }
    if (from <= to) { return today >= from && today <= to; }
    return today >= from || today <= to;
  }

  function scheduledTheme(date) {
    var today = (date.getMonth() + 1) * 100 + date.getDate();
    var i;
    for (i = 0; i < SCHEDULE.length; i = i + 1) {
      if (inRange(today, parseDay(SCHEDULE[i].from), parseDay(SCHEDULE[i].to))) {
        return SCHEDULE[i].name;
      }
    }
    return 'default';
  }

  // Порядок: ?theme=назва в URL -> розклад -> default.
  function pickTheme(search, date) {
    var m = /[?&]theme=([^&#]*)/.exec(search || '');
    if (m) {
      var asked = '';
      try { asked = decodeURIComponent(m[1]); } catch (e) { asked = ''; }
      asked = asked.toLowerCase();
      if (/^[a-z0-9-]+$/.test(asked)) { return asked; }
    }
    return scheduledTheme(date);
  }

  /* ---------- Допоміжне ---------- */

  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* без збереження теж працює */ }
  }

  function cssVar(name) {
    var v = '';
    try { v = window.getComputedStyle(document.documentElement).getPropertyValue(name); } catch (e) { v = ''; }
    // значення в лапках: "Тиждень Хелловіну" -> Тиждень Хелловіну
    return String(v).replace(/^\s*["']|["']\s*$/g, '').replace(/^\s+|\s+$/g, '');
  }

  function addStylesheet(href, onload, onerror) {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = onload;
    link.onerror = onerror;
    document.head.appendChild(link);
    return link;
  }

  /* ---------- Декор і кнопка ---------- */

  function buildDecor(themeName) {
    var title = cssVar('--theme-title');
    var items = cssVar('--decor-items').split(/\s+/);
    var motion = cssVar('--decor-motion');
    if (motion !== 'fall' && motion !== 'rise' && motion !== 'bob') { motion = 'fall'; }
    if (items.length === 1 && items[0] === '') { items = []; }

    var reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { reduce = false; }

    // Плашка з назвою теми
    if (title) {
      var badge = document.createElement('div');
      badge.className = 'theme-badge';
      badge.textContent = title;
      document.body.appendChild(badge);
    }

    // При «менше руху» декору й кнопки немає зовсім
    if (reduce || items.length === 0) { return; }

    var layer = document.createElement('div');
    layer.className = 'theme-decor';
    layer.setAttribute('aria-hidden', 'true');
    var count = Math.min(DECOR_MAX, 12);
    var i;
    for (i = 0; i < count; i = i + 1) {
      var el = document.createElement('span');
      el.className = 'theme-decor-item';
      el.textContent = items[i % items.length];
      // розкидаємо рівномірно, без випадковості, щоб вигляд був стабільним
      var slot = (i * 37) % count;
      el.style.left = Math.round((slot + 0.5) * 100 / count) + '%';
      el.style.top = ((i * 53) % 90) + '%';
      el.style.fontSize = (20 + (i * 7) % 16) + 'px';
      el.style.animationName = 'theme-' + motion;
      el.style.animationDuration = (16 + (i * 5) % 14) + 's';
      el.style.animationDelay = '-' + ((i * 3) % 16) + 's';
      el.style.setProperty('--drift', (((i % 5) - 2) * 18) + 'px');
      layer.appendChild(el);
    }
    document.body.insertBefore(layer, document.body.firstChild);

    // Кнопка в кутку: вмикає й вимикає декор
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-toggle';
    btn.textContent = items[0];
    document.body.appendChild(btn);

    function show(on) {
      var root = document.documentElement;
      if (on) { root.className = root.className.replace(/\s*theme-decor-off\b/, ''); }
      else if (root.className.indexOf('theme-decor-off') < 0) { root.className = root.className + ' theme-decor-off'; }
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      var label = on ? 'Вимкнути прикраси' : 'Увімкнути прикраси';
      btn.setAttribute('aria-label', label);
      btn.title = label;
    }
    show(storageGet(DECOR_KEY) !== 'off');
    btn.onclick = function () {
      var on = document.documentElement.className.indexOf('theme-decor-off') >= 0;
      show(on);
      storageSet(DECOR_KEY, on ? 'on' : 'off');
    };
  }

  /* ---------- Підпис автора (в усіх іграх і темах, навіть у default) ---------- */

  var SIGN_URL = 'https://yaroslavchess.com';
  var SIGN_TEXT = 'Ярослав Бартко \u00b7 yaroslavchess.com';

  // Підпис — звичайний блок наприкінці сторінки (не fixed), тому нічого не перекриває.
  // Кольори — зі змінних :root гри; у темі default base.css не підключається, тож стилі тут.
  function buildSignature() {
    if (document.getElementById('author-sign')) { return; }
    var style = document.createElement('style');
    style.textContent =
      '#author-sign{display:block;box-sizing:border-box;text-align:center;' +
      'padding:14px 16px;padding-bottom:calc(14px + env(safe-area-inset-bottom));' +
      'font:600 12px/1.3 Manrope,ui-sans-serif,system-ui,sans-serif;}' +
      '#author-sign a{color:var(--text-dim,inherit);text-decoration:none;' +
      'display:inline-block;padding:8px 10px;border-radius:8px;}' +
      '#author-sign a:hover,#author-sign a:focus-visible{text-decoration:underline;}';
    document.head.appendChild(style);

    var box = document.createElement('div');
    box.id = 'author-sign';
    var link = document.createElement('a');
    link.href = SIGN_URL;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = SIGN_TEXT;
    box.appendChild(link);
    document.body.appendChild(box);
  }

  function startSignature() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        try { buildSignature(); } catch (e) { /* без підпису гра теж працює */ }
      });
    } else {
      buildSignature();
    }
  }

  /* ---------- Смужка бренду вгорі (в усіх іграх і темах, навіть у default) ---------- */

  var BRAND_TEXT = 'Yaroslav Chess · шахова школа';
  var BRAND_LOGO = 'logo.png';   // лежить у shared/; якщо файлу немає — монограма «YC»

  // Адреса папки theme/ береться з адреси цього скрипта (потрібна для логотипа).
  function themeFolder() {
    var script = document.currentScript;
    if (!script) {
      var all = document.getElementsByTagName('script');
      script = all[all.length - 1];
    }
    return String(script.src).replace(/theme\.js(\?.*)?(#.*)?$/, '');
  }
  var THEME_FOLDER = themeFolder();   // викликається під час завантаження скрипта

  // Смужка — звичайний блок на початку сторінки (не fixed): прокручується разом зі сторінкою
  // і нічого не перекриває. Висота до 44 px. Кольори — зі змінних :root гри.
  function buildBrandBar() {
    if (document.getElementById('brand-bar')) { return; }
    var style = document.createElement('style');
    style.textContent =
      '#brand-bar{display:flex;align-items:center;justify-content:center;box-sizing:border-box;' +
      'position:relative;width:100%;height:44px;margin:0;padding:0 52px;overflow:hidden;' +
      'border-bottom:1px solid var(--hairline,currentColor);' +
      'font:700 13px/1 Manrope,ui-sans-serif,system-ui,sans-serif;}' +
      '#brand-bar a{display:flex;align-items:center;gap:8px;max-width:100%;min-width:0;height:44px;' +
      'color:var(--text-dim,inherit);text-decoration:none;}' +
      '#brand-bar a:hover,#brand-bar a:focus-visible{color:var(--text,inherit);}' +
      '#brand-bar .brand-mark{flex:none;width:36px;height:36px;border-radius:50%;object-fit:cover;}' +
      '#brand-bar .brand-mono{flex:none;display:flex;align-items:center;justify-content:center;' +
      'width:28px;height:28px;border-radius:50%;background:var(--gold);color:var(--on-gold);' +
      'font:800 12px/1 Manrope,ui-sans-serif,system-ui,sans-serif;letter-spacing:0;}' +
      '#brand-bar .brand-text{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '#brand-bar .sound-btn{position:absolute;top:0;right:4px;width:44px;height:44px;margin:0;padding:0;' +
      'border:0;background:transparent;cursor:pointer;font-size:22px;line-height:44px;text-align:center;' +
      'color:var(--text-dim,inherit);}' +
      '#brand-bar .sound-btn:hover,#brand-bar .sound-btn:focus-visible{color:var(--text,inherit);}';
    document.head.appendChild(style);

    var bar = document.createElement('div');
    bar.id = 'brand-bar';
    var link = document.createElement('a');
    link.href = SIGN_URL;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', BRAND_TEXT);

    function addMonogram() {
      var mono = document.createElement('span');
      mono.className = 'brand-mono';
      mono.setAttribute('aria-hidden', 'true');
      mono.textContent = 'YC';
      link.insertBefore(mono, link.firstChild);
    }

    var img = document.createElement('img');
    img.className = 'brand-mark';
    img.alt = '';
    img.width = 36;
    img.height = 36;
    img.onerror = function () {
      img.onerror = null;
      if (img.parentNode) { img.parentNode.removeChild(img); }
      addMonogram();
    };
    img.src = THEME_FOLDER + '../shared/' + BRAND_LOGO;
    link.appendChild(img);

    var text = document.createElement('span');
    text.className = 'brand-text';
    text.textContent = BRAND_TEXT;
    link.appendChild(text);

    bar.appendChild(link);
    addSoundButton(bar);
    document.body.insertBefore(bar, document.body.firstChild);
  }

  // Кнопка звуку 🔊/🔇 — одна на всі ігри. Є лише там, де підключено shared/sound.js
  // (у каталозі звуків немає — кнопки теж немає). Стан зберігає сам Sound (один ключ у localStorage).
  function addSoundButton(bar) {
    if (!window.Sound || typeof window.Sound.isMuted !== 'function') { return; }
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sound-btn';
    function show() {
      var muted = window.Sound.isMuted();
      btn.textContent = muted ? '\uD83D\uDD07' : '\uD83D\uDD0A';
      btn.setAttribute('aria-pressed', muted ? 'true' : 'false');
      btn.setAttribute('aria-label', muted ? 'Звук вимкнено. Натисніть, щоб увімкнути' : 'Звук увімкнено. Натисніть, щоб вимкнути');
      btn.title = muted ? 'Увімкнути звук' : 'Вимкнути звук';
    }
    btn.onclick = function () {
      window.Sound.setMuted(!window.Sound.isMuted());
      show();
      window.Sound.play('move');   // коротке підтвердження (лише коли звук увімкнено)
    };
    show();
    bar.appendChild(btn);
  }

  function startBrandBar() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        try { buildBrandBar(); } catch (e) { /* без смужки гра теж працює */ }
      });
    } else {
      buildBrandBar();
    }
  }

  /* ---------- Запуск ---------- */

  function start() {
    var name = pickTheme(window.location.search, new Date());
    if (name === 'default') { return; }

    // Адреса папки theme/ береться з адреси цього скрипта
    var script = document.currentScript;
    if (!script) {
      var all = document.getElementsByTagName('script');
      script = all[all.length - 1];
    }
    var base = String(script.src).replace(/theme\.js(\?.*)?(#.*)?$/, '');

    var themeLink;
    var cssReady = false;
    var domReady = false;

    function tryBuild() {
      if (!cssReady || !domReady) { return; }
      document.documentElement.setAttribute('data-theme', name);
      var meta = document.querySelector('meta[name="theme-color"]');
      var bg = cssVar('--bg');
      if (meta && bg) { meta.setAttribute('content', bg); }
      buildDecor(name);
    }

    var baseLink = addStylesheet(base + 'base.css', null, null);
    themeLink = addStylesheet(base + 'themes/' + name + '.css', function () {
      cssReady = true;
      tryBuild();
    }, function () {
      // такої теми немає — лишаємо гру без змін
      if (themeLink.parentNode) { themeLink.parentNode.removeChild(themeLink); }
      if (baseLink.parentNode) { baseLink.parentNode.removeChild(baseLink); }
    });

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { domReady = true; tryBuild(); });
    } else {
      domReady = true;
      tryBuild();
    }
  }

  try { startSignature(); } catch (e) { /* без підпису гра теж працює */ }
  try { startBrandBar(); } catch (e) { /* без смужки гра теж працює */ }
  try { start(); } catch (e) { /* якщо щось пішло не так — гра працює як раніше */ }
})();
