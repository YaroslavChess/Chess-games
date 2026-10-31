/* Перетягування фігур і стрілки (як на Lichess) для будь-якої шахової дошки.
   Підключення: <script src="../shared/board-ui.js"></script>, далі BoardUI.attach(...).
   Покрокова інструкція й приклад — розділ «Перетягування і стрілки» у CLAUDE.md.

   Модуль не знає правил шахів і не знає, як гра малює дошку (div-клітинки чи SVG).
   Усе питає в гри через функції в opts. Клітинки — рядки 'a1'..'h8' з боку білих.
   Стрілки й кружечки лише малюються поверх дошки й ніяк не впливають на гру.
   Якщо цей файл не завантажився — гра працює тапами, як раніше. */
var BoardUI = (function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var MOVE_PX_MOUSE = 4;      // на скільки px зсунути мишу, щоб почалося перетягування
  var MOVE_PX_TOUCH = 8;      // те саме для пальця
  var TOUCH_SCALE = 1.5;      // під пальцем фігура більша, щоб її було видно
  var BACK_MS = 180;          // скільки триває повернення фігури після нелегального відпускання
  var CLICK_GUARD_MS = 500;   // скільки після перетягування ігнорувати «клік» від того самого жесту

  // Кольори — лише змінні :root гри. --blue може не бути: тоді стрілка світла (--text).
  var CSS = '' +
    '.bui-layer{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:4;overflow:visible;}' +
    '.bui-shape{opacity:.8;}' +
    '.bui-shape line{stroke-linecap:round;}' +
    '.bui-shape circle{fill:none;}' +
    '.bui-preview{opacity:.5;}' +
    '.bui-green line,.bui-green circle{stroke:var(--green);}.bui-green polygon{fill:var(--green);}' +
    '.bui-red line,.bui-red circle{stroke:var(--danger);}.bui-red polygon{fill:var(--danger);}' +
    '.bui-blue line,.bui-blue circle{stroke:var(--blue, var(--text));}.bui-blue polygon{fill:var(--blue, var(--text));}' +
    '.bui-yellow line,.bui-yellow circle{stroke:var(--gold);}.bui-yellow polygon{fill:var(--gold);}' +
    '.bui-hover{fill:var(--gold-soft);fill-opacity:.35;stroke:var(--gold-soft);stroke-opacity:.9;}' +
    '.bui-ghost{position:fixed;z-index:1000;pointer-events:none;margin:0;padding:0;transform-origin:50% 50%;}' +
    '.bui-tools{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;width:100%;}' +
    '.bui-btn{appearance:none;-webkit-appearance:none;flex:1 1 120px;min-height:46px;padding:8px 14px;' +
      'border:1px solid var(--hairline);border-radius:var(--radius-sm, 8px);background:var(--panel-2);color:var(--text);' +
      'font-family:\'Manrope\',ui-sans-serif,system-ui,sans-serif;font-weight:700;font-size:1rem;cursor:pointer;' +
      '-webkit-tap-highlight-color:transparent;}' +
    '.bui-btn:focus-visible{outline:2px solid var(--gold-soft);outline-offset:2px;}' +
    '.bui-btn:disabled{opacity:.4;cursor:default;}' +
    '.bui-btn.bui-on{background:var(--gold);color:var(--on-gold);border-color:var(--gold-soft);}';

  function addCss() {
    var el;
    if (document.getElementById('bui-style')) { return; }
    el = document.createElement('style');
    el.id = 'bui-style';
    el.appendChild(document.createTextNode(CSS));
    (document.head || document.documentElement).appendChild(el);
  }

  function reducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }

  function now() { return new Date().getTime(); }

  function svgEl(name) { return document.createElementNS(SVG_NS, name); }

  // Колір за клавішами: без клавіш — зелений, Shift — червоний, Alt — синій, Shift+Alt — жовтий.
  function colorOf(e) {
    if (e.shiftKey && e.altKey) { return 'yellow'; }
    if (e.shiftKey) { return 'red'; }
    if (e.altKey) { return 'blue'; }
    return 'green';
  }

  // Копія всіх обчислених стилів (шрифт, колір, розмір...) — щоб копія фігури виглядала так само.
  function copyStyle(from, to) {
    var cs = window.getComputedStyle(from), i, name;
    for (i = 0; i < cs.length; i++) {
      name = cs[i];
      to.style.setProperty(name, cs.getPropertyValue(name));
    }
  }

  // ---------- Головна функція ----------
  function attach(board, opts) {
    opts = opts || {};
    var ui = {
      shapes: [],        // намальоване: { from, to, color }; from === to — кружечок
      pen: false,        // режим олівця (для телефона)
      mode: '',          // '' | 'press' (натиснув фігуру) | 'drag' (тягне) | 'draw' (малює)
      pointerId: null,
      touch: false,
      from: null, hover: null, targets: [], color: 'green',
      startX: 0, startY: 0,
      ghost: null, ghostW: 0, ghostH: 0, origin: null, originOpacity: '',
      backTimer: null,
      guardUntil: 0,
      flipped: null,
      layer: null, tools: null, penBtn: null, clearBtn: null, ownTools: false,
      saved: { touchAction: board.style.touchAction, cursor: board.style.cursor },
      observer: null
    };

    if (!window.PointerEvent || !board) { return emptyHandle(); }
    addCss();

    // ----- Виклики гри -----
    function squareAt(x, y) {
      try { return opts.squareFromPoint ? (opts.squareFromPoint(x, y) || null) : null; } catch (e) { return null; }
    }
    function rectOf(sq) {
      try { return opts.squareRect ? opts.squareRect(sq) : null; } catch (e) { return null; }
    }
    function flippedNow() {
      try { return opts.isFlipped ? !!opts.isFlipped() : false; } catch (e) { return false; }
    }
    function canDrag(sq) {
      try { return !!(opts.canDrag && opts.canDrag(sq)); } catch (e) { return false; }
    }
    function targetsOf(sq) {
      var t = null;
      try { t = opts.legalTargets ? opts.legalTargets(sq) : null; } catch (e) { t = null; }
      return t && t.length ? t : [];
    }
    function pieceOf(sq) {
      try { return opts.pieceElement ? opts.pieceElement(sq) : null; } catch (e) { return null; }
    }

    // ----- Шар для стрілок і підсвітки (SVG поверх дошки) -----
    function makeLayer() {
      var parent = board.parentNode, pos;
      pos = window.getComputedStyle(parent).position;
      if (pos === 'static') { parent.style.position = 'relative'; }
      ui.layer = svgEl('svg');
      ui.layer.setAttribute('class', 'bui-layer');
      ui.layer.setAttribute('aria-hidden', 'true');
      parent.appendChild(ui.layer);
    }

    // Центр і розмір клітинки в координатах шару.
    function boxOf(sq, base) {
      var r = rectOf(sq);
      if (!r || !r.width) { return null; }
      return { x: r.left - base.left + r.width / 2, y: r.top - base.top + r.height / 2, w: r.width, h: r.height,
        left: r.left - base.left, top: r.top - base.top };
    }

    function drawArrow(a, b, color, extra) {
      var dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy), s = a.w;
      if (!len) { return; }
      var ux = dx / len, uy = dy / len;
      var tipx = b.x - ux * s * 0.12, tipy = b.y - uy * s * 0.12;
      var bx = tipx - ux * s * 0.42, by = tipy - uy * s * 0.42;
      var px = -uy * s * 0.24, py = ux * s * 0.24;
      var g = svgEl('g'), line = svgEl('line'), head = svgEl('polygon');
      g.setAttribute('class', 'bui-shape bui-arrow bui-' + color + (extra ? ' ' + extra : ''));
      line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
      line.setAttribute('x2', bx); line.setAttribute('y2', by);
      line.setAttribute('stroke-width', s * 0.17);
      head.setAttribute('points', tipx + ',' + tipy + ' ' + (bx + px) + ',' + (by + py) + ' ' + (bx - px) + ',' + (by - py));
      g.appendChild(line);
      g.appendChild(head);
      ui.layer.appendChild(g);
    }

    function drawCircle(a, color, extra) {
      var g = svgEl('g'), c = svgEl('circle');
      g.setAttribute('class', 'bui-shape bui-circle bui-' + color + (extra ? ' ' + extra : ''));
      c.setAttribute('cx', a.x); c.setAttribute('cy', a.y);
      c.setAttribute('r', a.w * 0.44);
      c.setAttribute('stroke-width', a.w * 0.075);
      g.appendChild(c);
      ui.layer.appendChild(g);
    }

    function drawShape(sh, base, extra) {
      var a = boxOf(sh.from, base), b;
      if (!a) { return; }
      if (sh.from === sh.to) { drawCircle(a, sh.color, extra); return; }
      b = boxOf(sh.to, base);
      if (b) { drawArrow(a, b, sh.color, extra); }
    }

    function redraw() {
      var base, i, h, r;
      if (!ui.layer) { return; }
      ui.flipped = flippedNow();
      while (ui.layer.firstChild) { ui.layer.removeChild(ui.layer.firstChild); }
      base = ui.layer.getBoundingClientRect();
      if (!base.width) { return; }
      // клітинка під фігурою, яку тягнуть
      if (ui.mode === 'drag' && ui.hover) {
        h = boxOf(ui.hover, base);
        if (h) {
          r = svgEl('rect');
          r.setAttribute('class', 'bui-hover');
          r.setAttribute('x', h.left); r.setAttribute('y', h.top);
          r.setAttribute('width', h.w); r.setAttribute('height', h.h);
          r.setAttribute('stroke-width', Math.max(2, h.w * 0.05));
          ui.layer.appendChild(r);
        }
      }
      for (i = 0; i < ui.shapes.length; i++) { drawShape(ui.shapes[i], base, ''); }
      // те, що зараз малюють (ще не відпустили)
      if (ui.mode === 'draw' && ui.hover) { drawShape({ from: ui.from, to: ui.hover, color: ui.color }, base, 'bui-preview'); }
    }

    // ----- Стрілки -----
    // Та сама стрілка тим самим кольором — прибрати; іншим кольором — перефарбувати.
    function toggleShape(from, to, color) {
      var i, sh;
      for (i = 0; i < ui.shapes.length; i++) {
        sh = ui.shapes[i];
        if (sh.from === from && sh.to === to) {
          if (sh.color === color) { ui.shapes.splice(i, 1); } else { sh.color = color; }
          shapesChanged();
          return;
        }
      }
      ui.shapes.push({ from: from, to: to, color: color });
      shapesChanged();
    }

    function shapesChanged() {
      if (ui.clearBtn) { ui.clearBtn.disabled = !ui.shapes.length; }
      redraw();
    }

    function clearShapes() {
      if (!ui.shapes.length) { redraw(); return; }
      ui.shapes = [];
      shapesChanged();
    }

    // ----- Фігура, що їде за пальцем -----
    function makeGhost(sq, x, y) {
      var el = pieceOf(sq), r, wrap, inner;
      if (!el || !el.getBoundingClientRect) { return; }
      r = el.getBoundingClientRect();
      if (!r.width) { r = rectOf(sq); }
      if (!r || !r.width) { return; }
      wrap = document.createElement('div');
      wrap.className = 'bui-ghost';
      wrap.setAttribute('aria-hidden', 'true');
      wrap.style.width = r.width + 'px';
      wrap.style.height = r.height + 'px';
      inner = (el instanceof SVGElement && el.ownerSVGElement) ? cloneSvgPart(el, r) : cloneHtml(el);
      if (!inner) { return; }
      wrap.appendChild(inner);
      document.body.appendChild(wrap);
      ui.ghost = wrap;
      ui.ghostW = r.width;
      ui.ghostH = r.height;
      ui.origin = el;
      ui.originOpacity = el.style.opacity;
      el.style.opacity = '0.3';
      placeGhost(x, y);
    }

    // Звичайний елемент (div, span, img або ціле <svg>).
    function cloneHtml(el) {
      var c = el.cloneNode(true);
      copyStyle(el, c);
      c.removeAttribute('id');
      c.style.position = 'absolute';
      c.style.left = '0'; c.style.top = '0'; c.style.right = 'auto'; c.style.bottom = 'auto';
      c.style.width = '100%'; c.style.height = '100%';
      c.style.margin = '0';
      c.style.transform = 'none';
      c.style.transition = 'none';
      c.style.animation = 'none';
      c.style.opacity = '1';
      c.style.visibility = 'visible';
      c.style.pointerEvents = 'none';
      return c;
    }

    // Частина SVG-дошки (<g>, <use>, <image>, <text>): кладемо копію в нове маленьке <svg>.
    function cloneSvgPart(el, r) {
      var owner = el.ownerSVGElement, svg = svgEl('svg'), g = svgEl('g'), c, inv, p1, p2, m, cs, props, i;
      try {
        inv = owner.getScreenCTM().inverse();
        p1 = owner.createSVGPoint(); p1.x = r.left; p1.y = r.top; p1 = p1.matrixTransform(inv);
        p2 = owner.createSVGPoint(); p2.x = r.right; p2.y = r.bottom; p2 = p2.matrixTransform(inv);
        m = inv.multiply(el.parentNode.getScreenCTM());
      } catch (e) { return null; }
      svg.setAttribute('viewBox', p1.x + ' ' + p1.y + ' ' + (p2.x - p1.x) + ' ' + (p2.y - p1.y));
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      svg.style.overflow = 'visible';
      g.setAttribute('transform', 'matrix(' + m.a + ' ' + m.b + ' ' + m.c + ' ' + m.d + ' ' + m.e + ' ' + m.f + ')');
      c = el.cloneNode(true);
      c.removeAttribute('id');
      cs = window.getComputedStyle(el);
      props = ['fill', 'stroke', 'stroke-width', 'color', 'font-size', 'font-family', 'font-weight'];
      for (i = 0; i < props.length; i++) { c.style.setProperty(props[i], cs.getPropertyValue(props[i])); }
      c.style.opacity = '1';
      g.appendChild(c);
      svg.appendChild(g);
      return svg;
    }

    function placeGhost(x, y) {
      if (!ui.ghost) { return; }
      ui.ghost.style.left = (x - ui.ghostW / 2) + 'px';
      ui.ghost.style.top = (y - ui.ghostH / 2) + 'px';
      ui.ghost.style.transform = ui.touch ? 'scale(' + TOUCH_SCALE + ')' : 'none';
    }

    function dropGhost() {
      if (ui.backTimer) { clearTimeout(ui.backTimer); ui.backTimer = null; }
      if (ui.ghost && ui.ghost.parentNode) { ui.ghost.parentNode.removeChild(ui.ghost); }
      if (ui.origin) { ui.origin.style.opacity = ui.originOpacity; }
      ui.ghost = null;
      ui.origin = null;
    }

    // Нелегальне відпускання: фігура плавно повертається на свою клітинку.
    function ghostBack(sq) {
      var r = rectOf(sq), g = ui.ghost;
      if (!g || !r || !r.width || reducedMotion()) { dropGhost(); return; }
      g.style.transition = 'left ' + BACK_MS + 'ms ease, top ' + BACK_MS + 'ms ease, transform ' + BACK_MS + 'ms ease';
      g.style.left = (r.left + r.width / 2 - ui.ghostW / 2) + 'px';
      g.style.top = (r.top + r.height / 2 - ui.ghostH / 2) + 'px';
      g.style.transform = 'none';
      ui.backTimer = setTimeout(dropGhost, BACK_MS + 20);
    }

    // ----- Події вказівника (миша, палець, стилус) -----
    function onDown(e) {
      var sq, mouse = (e.pointerType === 'mouse');
      ui.guardUntil = 0; // новий жест — старий «клік» уже не прийде
      if (!e.isPrimary || ui.mode) { return; }
      if (ui.flipped !== null && ui.flipped !== flippedNow()) { redraw(); }
      sq = squareAt(e.clientX, e.clientY);
      ui.pointerId = e.pointerId;
      ui.touch = !mouse;
      ui.startX = e.clientX;
      ui.startY = e.clientY;
      if (mouse && e.button === 2) { startDraw(e, sq); return; }
      if (e.button !== 0) { return; }
      if (ui.pen) { startDraw(e, sq); return; }
      if (mouse && ui.shapes.length) { clearShapes(); } // лівий клік по дошці стирає стрілки
      if (!sq || !canDrag(sq)) { return; }
      ui.mode = 'press';
      ui.from = sq;
      if (mouse) { e.preventDefault(); } // щоб не виділявся текст і не тягнулася картинка
    }

    function startDraw(e, sq) {
      e.preventDefault();
      if (!sq) { return; }
      ui.mode = 'draw';
      ui.from = sq;
      ui.hover = sq;
      ui.color = colorOf(e);
      redraw();
    }

    function onMove(e) {
      var dx, dy, limit, sq;
      if (!ui.mode || e.pointerId !== ui.pointerId) { return; }
      if (ui.mode === 'press') {
        dx = e.clientX - ui.startX;
        dy = e.clientY - ui.startY;
        limit = ui.touch ? MOVE_PX_TOUCH : MOVE_PX_MOUSE;
        if (dx * dx + dy * dy < limit * limit) { return; }
        startDrag(e);
        return;
      }
      sq = squareAt(e.clientX, e.clientY);
      if (ui.mode === 'drag') {
        placeGhost(e.clientX, e.clientY);
        if (sq !== ui.hover) { ui.hover = sq; redraw(); }
        e.preventDefault();
      } else if (ui.mode === 'draw') {
        if (sq !== ui.hover || colorOf(e) !== ui.color) {
          ui.hover = sq;
          ui.color = colorOf(e);
          redraw();
        }
        e.preventDefault();
      }
    }

    function startDrag(e) {
      dropGhost(); // якщо попередня фігура ще поверталася
      ui.mode = 'drag';
      ui.targets = targetsOf(ui.from);
      if (opts.onDragStart) {
        try { opts.onDragStart(ui.from); } catch (err) { /* помилка гри не ламає перетягування */ }
      }
      makeGhost(ui.from, e.clientX, e.clientY);
      ui.hover = squareAt(e.clientX, e.clientY);
      redraw();
    }

    function onUp(e) {
      var sq, mode = ui.mode, from = ui.from, ok, i;
      if (!mode || e.pointerId !== ui.pointerId) { return; }
      ui.mode = '';
      ui.hover = null;
      if (mode === 'press') { return; } // це тап — далі звичайний клік гри
      ui.guardUntil = now() + CLICK_GUARD_MS;
      sq = squareAt(e.clientX, e.clientY);
      if (mode === 'draw') {
        if (sq) { toggleShape(from, sq, colorOf(e)); } else { redraw(); }
        return;
      }
      // mode === 'drag'
      ok = false;
      for (i = 0; i < ui.targets.length; i++) { if (ui.targets[i] === sq) { ok = true; } }
      redraw();
      if (ok && sq !== from) {
        dropGhost();
        if (opts.onDrop) {
          try { opts.onDrop(from, sq); } catch (err) { if (window.console) { console.error(err); } }
        }
      } else {
        ghostBack(from);
      }
    }

    function onCancel(e) {
      var mode = ui.mode;
      if (!mode || e.pointerId !== ui.pointerId) { return; }
      ui.mode = '';
      ui.hover = null;
      if (mode === 'drag') { ghostBack(ui.from); }
      redraw();
    }

    // Під час перетягування й малювання сторінка не скролиться.
    function onTouchMove(e) {
      if (ui.mode || ui.pen) { if (e.cancelable) { e.preventDefault(); } }
    }

    // Клік після перетягування й будь-який клік у режимі олівця не доходить до гри.
    // Клавіатура (Enter/пробіл, e.detail === 0) працює завжди.
    function onClickCapture(e) {
      if (!board.contains(e.target) || e.detail === 0) { return; }
      if (ui.pen || now() < ui.guardUntil) {
        ui.guardUntil = 0;
        e.stopPropagation();
        e.preventDefault();
      }
    }

    function onContextMenu(e) { e.preventDefault(); }
    function onDragStartNative(e) { e.preventDefault(); }
    function onResize() { redraw(); }

    // ----- Кнопки «Олівець» і «Стерти» -----
    function makeTools() {
      var box = opts.tools;
      if (opts.tools === false) { return; }
      if (!box) {
        box = document.createElement('div');
        board.parentNode.parentNode.insertBefore(box, board.parentNode.nextSibling);
        ui.ownTools = true;
      }
      box.className = (box.className ? box.className + ' ' : '') + 'bui-tools';
      ui.tools = box;
      ui.penBtn = document.createElement('button');
      ui.penBtn.type = 'button';
      ui.penBtn.className = 'bui-btn bui-pen';
      ui.penBtn.setAttribute('aria-pressed', 'false');
      ui.penBtn.textContent = '✏︎ Олівець';
      ui.penBtn.title = 'Малювати стрілки пальцем: протягни — стрілка, тапни — кружечок';
      ui.penBtn.addEventListener('click', function () { setPen(!ui.pen); });
      ui.clearBtn = document.createElement('button');
      ui.clearBtn.type = 'button';
      ui.clearBtn.className = 'bui-btn bui-clear';
      ui.clearBtn.textContent = 'Стерти';
      ui.clearBtn.title = 'Стерти всі стрілки й кружечки';
      ui.clearBtn.disabled = true;
      ui.clearBtn.addEventListener('click', clearShapes);
      box.appendChild(ui.penBtn);
      box.appendChild(ui.clearBtn);
    }

    function setPen(on) {
      ui.pen = !!on;
      if (ui.mode === 'press') { ui.mode = ''; }
      board.style.touchAction = ui.pen ? 'none' : ui.saved.touchAction;
      board.style.cursor = ui.pen ? 'crosshair' : ui.saved.cursor;
      if (ui.penBtn) {
        ui.penBtn.className = 'bui-btn bui-pen' + (ui.pen ? ' bui-on' : '');
        ui.penBtn.setAttribute('aria-pressed', ui.pen ? 'true' : 'false');
      }
    }

    // Скасувати перетягування чи малювання (наприклад, гра перемальовує дошку).
    function cancel() {
      var mode = ui.mode;
      ui.mode = '';
      ui.hover = null;
      if (mode === 'drag') { dropGhost(); }
      redraw();
    }

    function destroy() {
      cancel();
      dropGhost();
      board.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      board.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('click', onClickCapture, true);
      board.removeEventListener('contextmenu', onContextMenu);
      board.removeEventListener('dragstart', onDragStartNative);
      window.removeEventListener('resize', onResize);
      if (ui.observer) { try { ui.observer.disconnect(); } catch (e) {} }
      if (ui.layer && ui.layer.parentNode) { ui.layer.parentNode.removeChild(ui.layer); }
      if (ui.tools) {
        if (ui.ownTools && ui.tools.parentNode) { ui.tools.parentNode.removeChild(ui.tools); }
        else {
          if (ui.penBtn && ui.penBtn.parentNode) { ui.penBtn.parentNode.removeChild(ui.penBtn); }
          if (ui.clearBtn && ui.clearBtn.parentNode) { ui.clearBtn.parentNode.removeChild(ui.clearBtn); }
        }
      }
      setPen(false);
    }

    function getShapes() {
      var out = [], i;
      for (i = 0; i < ui.shapes.length; i++) {
        out.push({ from: ui.shapes[i].from, to: ui.shapes[i].to, color: ui.shapes[i].color });
      }
      return out;
    }

    // ----- Старт -----
    makeLayer();
    makeTools();
    board.style.webkitTouchCallout = 'none';
    board.style.webkitUserSelect = 'none';
    board.style.userSelect = 'none';
    board.addEventListener('pointerdown', onDown);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    board.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('click', onClickCapture, true);
    board.addEventListener('contextmenu', onContextMenu);
    board.addEventListener('dragstart', onDragStartNative);
    window.addEventListener('resize', onResize);
    try {
      if (window.ResizeObserver) {
        ui.observer = new ResizeObserver(function () { redraw(); });
        ui.observer.observe(board);
      }
    } catch (e) { ui.observer = null; }
    redraw();

    return {
      clearShapes: clearShapes,               // стерти всі стрілки й кружечки
      getShapes: getShapes,                   // [{ from, to, color }], кружечок: from === to
      redraw: redraw,                         // перемалювати (після перевороту дошки чи зміни розміру)
      setPen: setPen,                         // увімкнути/вимкнути олівець
      isPen: function () { return ui.pen; },
      isBusy: function () { return ui.mode !== ''; }, // зараз тягнуть фігуру або малюють
      cancel: cancel,
      destroy: destroy
    };
  }

  // Браузер без pointer events: нічого не робимо, гра працює тапами.
  function emptyHandle() {
    function nothing() {}
    return {
      clearShapes: nothing, getShapes: function () { return []; }, redraw: nothing, setPen: nothing,
      isPen: function () { return false; }, isBusy: function () { return false; }, cancel: nothing, destroy: nothing
    };
  }

  return { attach: attach };
})();
