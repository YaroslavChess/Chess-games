// Перебір рівнів міні-шахів: чи справді розстановки й ліміти зірочок такі, як записано в index.html.
// Запуск: node --test mini-chess/tests/levels.test.js   (займає кілька секунд)
// Рушій береться прямо з index.html (між ENGINE:START і ENGINE:END).
//
// Рівні 2–5 (фігура проти пішаків) і рівень 1: ПОВНИЙ перебір усіх партій.
//   - фігура виграє, навіть коли пішаки грають найкраще (W — мінімум ходів проти найкращого захисту);
//   - W не менше 4 — перемога не за 1–2 ходи;
//   - ліміти зірочок збігаються з перебором: fast = W + 1, ok = W + 4;
//   - 3 зірки досяжні гарантовано: проти ВСІХ можливих відповідей, зокрема проти будь-якого ходу
//     Ведмедика (з'їсти, якщо можна, інакше будь-який) і будь-якого ходу Лисички (foxChoices).
// Рівні 6 і 7 надто великі для доведення «гарантовано»: перевіряємо лише, що 3 зірки існують
// (є послідовність ходів, у якій бот ходить вдало — але так, як він справді може ходити).
'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
var code = html.slice(html.indexOf('/* ENGINE:START */'), html.indexOf('/* ENGINE:END */'));
var sandbox = {};
vm.runInNewContext(code + '\nthis.MC = MiniChess;', sandbox);
var MC = sandbox.MC;

function key(s) {
  var k = s.turn;
  for (var i = 0; i < 25; i++) {
    var p = s.board[i];
    k += p ? (p.c === 'w' ? p.t.toUpperCase() : p.t) : '.';
  }
  return k;
}
function lost(s) { return s.start.w - MC.countPieces(s.board, 'w'); }
function captureFirst(ms) {
  var a = [], b = [];
  for (var i = 0; i < ms.length; i++) (ms[i].capture || ms[i].promo ? a : b).push(ms[i]);
  return a.concat(b);
}

// Мінімум ходів білих до перемоги проти найкращого захисту; Infinity — форсованої перемоги немає.
function Solver() {
  var memo = {};
  var self = this;
  this.moves = function (s) {
    if (s.over) return s.winner === 'w' ? 0 : Infinity;
    var k = key(s);
    if (memo[k] !== undefined) return memo[k];
    var ms = MC.legalMoves(s), best, i, r;
    if (s.turn === 'w') {
      best = Infinity;
      for (i = 0; i < ms.length; i++) {
        r = self.moves(MC.applyMove(s, ms[i]));
        if (r + 1 < best) best = r + 1;
      }
    } else {
      best = -1;
      for (i = 0; i < ms.length; i++) {
        r = self.moves(MC.applyMove(s, ms[i]));
        if (r > best) best = r;
        if (best === Infinity) break;
      }
    }
    memo[k] = best;
    return best;
  };
  // Найкращий хід білих: той, що веде до найшвидшої форсованої перемоги.
  this.bestMove = function (s) {
    var ms = MC.legalMoves(s), best = null, bv = Infinity;
    for (var i = 0; i < ms.length; i++) {
      var r = self.moves(MC.applyMove(s, ms[i]));
      if (best === null || r < bv) { best = ms[i]; bv = r; }
    }
    return best;
  };
}

// Що може зробити бот: 'any' — що завгодно, 'bear' — Ведмедик, 'fox' — Лисичка.
function support(kind, s) {
  var ms = MC.legalMoves(s);
  if (kind === 'any') return ms;
  if (kind === 'bear') {
    var caps = ms.filter(function (m) { return m.capture; });
    return caps.length ? caps : ms;
  }
  return MC.foxChoices(s, 3, 1e9);
}

// Чи можуть білі виграти не більше ніж за t своїх ходів, втративши не більше maxLost фігур.
// coop = false: що б не обрав бот зі свого списку (гарантовано); true: бот ходить вдало.
function canWin(kind, maxLost, coop) {
  var memo = {};
  function can(s, t) {
    if (lost(s) > maxLost) return false;
    var k = key(s) + t;
    if (memo[k] !== undefined) return memo[k];
    var ms = captureFirst(MC.legalMoves(s)), res = false;
    for (var i = 0; i < ms.length && !res; i++) {
      var ns = MC.applyMove(s, ms[i]);
      if (ns.over) { if (ns.winner === 'w' && lost(ns) <= maxLost) res = true; continue; }
      if (t <= 1 || lost(ns) > maxLost) continue;
      var rs = support(kind, ns), ok = !coop && rs.length > 0;
      for (var j = 0; j < rs.length && (coop ? !ok : ok); j++) {
        var n2 = MC.applyMove(ns, rs[j]);
        if (n2.over) {
          if (n2.winner === 'w' && lost(n2) <= maxLost) { if (coop) ok = true; } else if (!coop) ok = false;
          continue;
        }
        if (coop) { if (can(n2, t - 1)) ok = true; } else if (!can(n2, t - 1)) ok = false;
      }
      if (ok) res = true;
    }
    memo[k] = res;
    return res;
  }
  return can;
}

function seeded(seed) {
  return function () {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}

function pawnSteps(s) {
  var n = 0;
  for (var i = 0; i < 25; i++) if (s.board[i] && s.board[i].t === 'p') n += (i - i % 5) / 5;
  return n;
}

var PIECES = { 2: 'r', 3: 'b', 4: 'n', 5: 'q' };

/* ---------- Рівні 2–5 ---------- */

for (var lv = 2; lv <= 5; lv++) {
  (function (level) {
    var L = MC.LEVELS[level - 1];

    test('рівень ' + level + ': розстановка — одна фігура проти 3–5 пішаків', function () {
      var s = MC.createGame(level);
      assert.equal(MC.countPieces(s.board, 'w'), 1);
      var n = MC.countPieces(s.board, 'b');
      assert.ok(n >= 3 && n <= 5, 'пішаків: ' + n);
      var white = s.board.filter(function (p) { return p && p.c === 'w'; })[0];
      assert.equal(white.t, PIECES[level]);
      s.board.forEach(function (p, sq) {
        if (p && p.c === 'b') {
          assert.equal(p.t, 'p');
          assert.ok(sq >= 15, 'пішаки лише на 4–5 рядах');
        }
      });
      assert.equal(L.rules.promo, 'win', 'пішак на 1-му ряду — програш фігури');
    });

    test('рівень ' + level + ': фігура виграє проти найкращої гри пішаків, але не за 1–2 ходи', function () {
      var W = new Solver().moves(MC.createGame(level));
      assert.ok(W < Infinity, 'форсованої перемоги немає');
      assert.ok(W >= 4, 'перемога занадто швидка: ' + W + ' ходів');
      assert.equal(L.lim.fast, W + 1, 'fast має дорівнювати мінімум + 1 (мінімум ' + W + ')');
      assert.equal(L.lim.ok, W + 4, 'ok має дорівнювати мінімум + 4 (мінімум ' + W + ')');
      // Друга зірка не має даватися за будь-яку перемогу: ліміт менший за довжину найдовшої можливої партії.
      assert.ok(L.lim.ok < pawnSteps(MC.createGame(level)) + 1, 'ліміт ok надто великий');
    });

    test('рівень ' + level + ': 3 зірки досяжні гарантовано — проти будь-якої гри пішаків, Ведмедика й Лисички', function () {
      ['any', 'bear', 'fox'].forEach(function (kind) {
        var can = canWin(kind, 0, false);
        assert.equal(can(MC.createGame(level), L.lim.fast), true, kind);
        assert.equal(can(MC.createGame(level), L.lim.fast - 2), false, kind + ': за fast-2 ходів виграти не можна');
      });
    });

    test('рівень ' + level + ': найкраща гра проти кожного бота дає рівно 3 зірки', function () {
      var sol = new Solver();
      ['bear', 'fox'].forEach(function (foe) {
        for (var g = 0; g < 8; g++) {
          var s = MC.createGame(level), rnd = seeded(level * 100 + g);
          while (!s.over) {
            var m = s.turn === 'w' ? sol.bestMove(s) : (foe === 'fox' ? MC.botFox(s, rnd) : MC.botBear(s, rnd));
            s = MC.applyMove(s, m);
          }
          assert.equal(s.winner, 'w');
          assert.equal(MC.stars(s), 3, foe + ': ' + MC.whiteMoves(s) + ' ходів');
        }
      });
    });
  })(lv);
}

/* ---------- Рівень 1 ---------- */

test('рівень 1: білі виграють проти найкращого захисту за 5 ходів; 3 зірки гарантовано досяжні', function () {
  var L = MC.LEVELS[0];
  var W = new Solver().moves(MC.createGame(1));
  assert.equal(W, 5);
  assert.equal(L.lim.fast, W + 1);
  ['any', 'bear', 'fox'].forEach(function (kind) {
    assert.equal(canWin(kind, L.lim.loss, false)(MC.createGame(1), L.lim.fast), true, kind);
  });
});

test('рівень 1: «без жодної втрати» неможливо — Ведмедик завжди з’їдає першу висунуту пішаку', function () {
  // Тому друга зірка на рівні 1 — «мало втрат» (lim.loss), а не «без втрат».
  assert.equal(canWin('bear', 0, true)(MC.createGame(1), 12), false);
  assert.equal(canWin('bear', 1, true)(MC.createGame(1), 12), false);
  assert.equal(canWin('bear', 2, true)(MC.createGame(1), 12), true);
  assert.equal(MC.LEVELS[0].lim.loss, 2);
});

/* ---------- Рівні 6 і 7: 3 зірки існують проти обох ботів ---------- */

[[6, false], [7, false], [7, true]].forEach(function (c) {
  var level = c[0], real = c[1];
  test('рівень ' + level + (real ? ' (справжні правила)' : '') + ': 3 зірки існують проти Ведмедика й Лисички', function () {
    var L = MC.LEVELS[level - 1], lim = real ? L.limReal : L.lim;
    ['bear', 'fox'].forEach(function (kind) {
      var can = canWin(kind, lim.loss, true);
      assert.equal(can(MC.createGame(level, real), lim.fast), true, kind);
    });
  });
});
