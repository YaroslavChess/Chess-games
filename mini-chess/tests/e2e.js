// Прогін у браузері: node mini-chess/tests/e2e.js
// Потрібен Playwright з Chromium. Сторінка віддається з index.html через перехоплення запитів
// (адреса http://mini-chess.test/), а Ably підмінено локальною заглушкою: повідомлення між
// вкладками (різні контексти браузера = різні пристрої) пересилає сам тест і зберігає їх як
// історію каналу. Тест не ходить в інтернет і не потребує ключа. Шрифти Google підмінено порожнім CSS.
'use strict';

var fs = require('fs');
var path = require('path');
var assert = require('assert/strict');
var playwright = require('playwright');

var ORIGIN = 'http://mini-chess.test';
// Справжній ключ у тестах не використовуємо: офлайн-сценарії — із заглушкою, онлайн — з тестовим.
var SOURCE = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
var KEY_LINE = /var ABLY_KEY = (['"])[^'"]*\1;/;
assert.ok(KEY_LINE.test(SOURCE), 'рядок ABLY_KEY має бути в index.html');
var HTML = SOURCE.replace(KEY_LINE, "var ABLY_KEY = '<КЛЮЧ_ABLY>';");
var HTML_ONLINE = SOURCE.replace(KEY_LINE, "var ABLY_KEY = 'test.key:for-e2e-only';");

// «Сервер» заглушки Ably: канали з підписаними сторінками й історією повідомлень.
var hub = { pages: [], history: {} };
async function hubPublish(source, channel, name, data) {
  var msg = { name: name, data: data };
  (hub.history[channel] = hub.history[channel] || []).push(msg);
  for (var i = 0; i < hub.pages.length; i++) {
    var p = hub.pages[i];
    if (p === source.page || p.isClosed()) continue;
    p.evaluate(function (a) { if (window.__ablyDeliver) window.__ablyDeliver(a.c, a.m); }, { c: channel, m: msg }).catch(function () {});
  }
}

// Заглушка Ably з тим самим API, що використовує сторінка (лише цим API сторінка й користується).
function fakeAbly() {
  var subs = {};
  window.__ablyDeliver = function (channel, msg) {
    var list = subs[channel] || [];
    for (var i = 0; i < list.length; i++) list[i]({ name: msg.name, data: msg.data });
  };
  window.Ably = {
    Realtime: function () {
      var closed = false;
      this.connection = { on: function (fn) { setTimeout(function () { fn({ current: 'connected' }); }, 10); } };
      this.channels = {
        get: function (name) {
          return {
            subscribe: function (fn) {
              (subs[name] = subs[name] || []).push(function (m) { if (!closed) fn(m); });
              return Promise.resolve();
            },
            publish: function (n, d) {
              if (!closed) window.__ablyPublish(name, n, JSON.parse(JSON.stringify(d)));
              return Promise.resolve();
            },
            history: function () {
              return window.__ablyHistory(name).then(function (items) { return { items: items }; });
            }
          };
        }
      };
      this.close = function () { closed = true; };
    }
  };
}

async function onlineContext(browser, device) {
  var ctx = await browser.newContext(device);
  await ctx.exposeBinding('__ablyPublish', function (source, c, n, d) { return hubPublish(source, c, n, d); });
  await ctx.exposeBinding('__ablyHistory', function (source, c) {
    return (hub.history[c] || []).slice().reverse();
  });
  await ctx.addInitScript(fakeAbly);
  return ctx;
}

function log(msg) { process.stdout.write(msg + '\n'); }

async function newPage(ctx, html, problems, query) {
  var page = await ctx.newPage();
  hub.pages.push(page);
  page.on('console', function (m) { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', function (e) { problems.push('pageerror: ' + e.message); });
  page.on('request', function (r) {
    var u = r.url();
    if (u.indexOf(ORIGIN) !== 0 && u.indexOf('data:') !== 0 && u.indexOf('https://fonts.googleapis.com/') !== 0) {
      problems.push('зовнішній запит: ' + u);
    }
  });
  await page.route('https://fonts.googleapis.com/**', function (route) {
    route.fulfill({ status: 200, contentType: 'text/css', body: '' });
  });
  await page.route(ORIGIN + '/**', function (route) {
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  });
  await page.goto(ORIGIN + '/' + (query || ''));
  return page;
}

async function noHScroll(page, where) {
  var r = await page.evaluate(function () {
    return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
  });
  assert.ok(r.sw <= r.cw, where + ': горизонтальний скрол ' + r.sw + ' > ' + r.cw);
}

// Ходи гравця вибирає «Лисичка»: читаємо дошку з aria-label клітинок.
async function pickMove(page, level, real, color) {
  return page.evaluate(function (a) {
    var names = { 'пішак': 'p', 'тура': 'r', 'слон': 'b', 'кінь': 'n', 'ферзь': 'q', 'король': 'k' };
    var s = window.MiniChess.createGame(a.level, a.real, '5/5/5/5/5', a.color);
    var sqs = document.querySelectorAll('#board .sq');
    for (var i = 0; i < 25; i++) {
      var m = /, (білі|чорні): (\S+)$/.exec(sqs[i].getAttribute('aria-label'));
      s.board[i] = m ? { c: m[1] === 'білі' ? 'w' : 'b', t: names[m[2]], id: i + 1 } : null;
    }
    // Стартову кількість і втечі беремо зі справжньої гри та з підпису «Утекли: N».
    s.start = window.MiniChess.createGame(a.level, a.real).start;
    var esc = /Утекли: (\d+)/.exec(document.getElementById('tray-top').textContent);
    s.escaped = { w: 0, b: esc ? parseInt(esc[1], 10) : 0 };
    var mv = window.MiniChess.botFox(s);
    return mv ? [mv.from, mv.to] : null;
  }, { level: level, real: real, color: color });
}

async function tapSq(page, sq) {
  await page.locator('#board .sq').nth(sq).click();
}

async function resultVisible(page) {
  return page.locator('#result').isVisible();
}

// Грає за білих, доки не з'явиться результат. Повертає заголовок результату.
async function playToEnd(page, level, real) {
  for (var turn = 0; turn < 120; turn++) {
    await page.waitForFunction(function () {
      return !document.getElementById('result').classList.contains('hidden') ||
        document.getElementById('status-txt').textContent === 'Твій хід';
    }, null, { timeout: 10000 });
    if (await resultVisible(page)) return page.locator('#result-title').textContent();
    var mv = await pickMove(page, level, real, 'w');
    assert.ok(mv, 'має бути хід');
    await tapSq(page, mv[0]);
    await tapSq(page, mv[1]);
    await page.waitForTimeout(50);
  }
  throw new Error('гра не закінчилась');
}

async function teacherLogin(page, pin) {
  await page.click('#btn-lock');
  for (var i = 0; i < 4; i++) await page.locator('#pin-pad button', { hasText: pin.charAt(i) }).first().click();
  await page.waitForSelector('#scr-teacher:not(.hidden)');
}

async function waitPiece(page, sq, re) {
  await page.waitForFunction(function (a) {
    return new RegExp(a.re).test(document.querySelectorAll('#board .sq')[a.sq].getAttribute('aria-label'));
  }, { sq: sq, re: re.source }, { timeout: 5000 });
}

async function waitStatus(page, text) {
  await page.waitForFunction(function (t) { return document.getElementById('status-txt').textContent === t; }, text, { timeout: 5000 });
}

async function progress(page) {
  return page.evaluate(function () { return JSON.parse(localStorage.getItem('mini-chess-progress-v1') || 'null'); });
}

async function main() {
  var browser = await playwright.chromium.launch();
  var problems = [];
  var device = { viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  var ctx = await browser.newContext(device);
  var page = await newPage(ctx, HTML, problems);

  log('1. Карта рівнів');
  await noHScroll(page, 'карта');
  assert.equal(await page.locator('.tile').count(), 7);
  assert.equal(await page.locator('.tile.locked').count(), 6);
  await page.locator('.tile').nth(3).click({ force: true });
  assert.ok(await page.locator('#scr-map').isVisible(), 'закритий рівень не відкривається');

  log('2. Підказка рівня 1');
  await page.locator('.tile').nth(0).click({ force: true });
  assert.ok(await page.locator('#scr-intro').isVisible());
  assert.match(await page.locator('#hint-text').textContent(), /Пішак ходить/);
  assert.ok(await page.locator('#hint-board .pc-wrap').count() >= 1);
  await noHScroll(page, 'підказка');

  log('3. Рівень 1 проти Ведмедика: тап показує крапки, гра до перемоги');
  await page.click('#btn-bear');
  var box = await page.locator('#board .sq').nth(0).boundingBox();
  assert.ok(box.width >= 40, 'клітинка ' + box.width + ' px');
  await tapSq(page, 7);   // c2
  assert.equal(await page.locator('#board .sq.mv').count(), 1, 'у пішака c2 один хід');
  await tapSq(page, 22);  // c5 (порожня) — зняти вибір
  await tapSq(page, 17);  // c4 — пішак суперника: крапки «не для гри»
  assert.equal(await page.locator('#board .sq.foe').count(), 1);
  await tapSq(page, 17);
  await noHScroll(page, 'гра');
  var title = await playToEnd(page, 1, false);
  assert.equal(title, 'Перемога!');
  var pr = await progress(page);
  assert.ok(pr.stars[0] >= 1 && pr.stars[0] <= 2, 'зірочки за Ведмедика: ' + pr.stars[0]);
  assert.ok(await page.locator('#result-stars .star-on').count() === pr.stars[0]);

  log('4. «Далі» → рівень 2, гра проти Лисички до кінця');
  await page.locator('#result-actions button', { hasText: 'Далі' }).click();
  assert.match(await page.locator('#intro-title').textContent(), /Рівень 2/);
  await page.click('#btn-fox');
  assert.match(await page.locator('#goal-line').textContent(), /утече/);
  title = await playToEnd(page, 2, false);
  assert.ok(['Перемога!', 'Нічия', 'Спробуй ще раз!'].indexOf(title) >= 0, title);
  log('   рівень 2 проти Лисички: ' + title);
  await page.locator('#result-actions button', { hasText: 'Додому' }).click();
  assert.ok(await page.locator('#scr-map').isVisible());

  log('5. Замок вчителя: неправильний і правильний пароль, відкрити всі рівні');
  await page.click('#btn-lock');
  for (var i = 0; i < 4; i++) await page.locator('#pin-pad button', { hasText: '9' }).click();
  await page.waitForTimeout(500);
  assert.ok(await page.locator('#pin').isVisible(), 'з паролем 9999 не пускає');
  var pin = '1234';
  for (i = 0; i < 4; i++) await page.locator('#pin-pad button', { hasText: pin.charAt(i) }).first().click();
  await page.waitForSelector('#scr-teacher:not(.hidden)');
  await page.click('#btn-unlock-all');
  assert.equal((await progress(page)).all, true);
  await noHScroll(page, 'панель вчителя');
  log('   кімната без ключа Ably показує пояснення');
  await page.click('#btn-create-room');
  assert.match(await page.locator('#teacher-msg').textContent(), /ключ Ably/);
  await page.click('#btn-home');
  assert.equal(await page.locator('.tile.locked').count(), 0);

  log('6. Рівень 7, справжні правила, кілька ходів');
  await page.locator('.tile').nth(6).click({ force: true });
  assert.ok(await page.locator('#rules-toggle').isVisible());
  assert.equal(await page.locator('#rules-toggle [data-real="0"]').getAttribute('aria-checked'), 'true', 'за замовчуванням — для малят');
  await page.click('#rules-toggle [data-real="1"]');
  assert.match(await page.locator('#hint-text').textContent(), /Мат/);
  await page.click('#btn-bear');
  assert.match(await page.locator('#goal-line').textContent(), /мат/);
  for (i = 0; i < 3; i++) {
    await page.waitForFunction(function () { return document.getElementById('status-txt').textContent === 'Твій хід'; });
    var mv = await pickMove(page, 7, true, 'w');
    await tapSq(page, mv[0]);
    await tapSq(page, mv[1]);
  }
  await page.click('#btn-home');

  log('7. Звук вимикається й запам’ятовується');
  await page.click('#btn-sound');
  assert.equal((await progress(page)).mute, true);
  await page.reload();
  assert.equal(await page.locator('#btn-sound').getAttribute('aria-pressed'), 'true');

  log('8. Сховища: лише прогрес у localStorage');
  var st = await page.evaluate(function () {
    return { ls: Object.keys(localStorage), ss: sessionStorage.length, ck: document.cookie };
  });
  assert.deepEqual(st.ls, ['mini-chess-progress-v1']);
  assert.equal(st.ss, 0);
  assert.equal(st.ck, '');
  var cookies = await ctx.cookies();
  assert.equal(cookies.length, 0);
  await ctx.close();

  log('9. Онлайн: вчитель (рівень 2, учень білими) дає посилання, учень відкриває його й одразу грає');
  var tctx = await onlineContext(browser, device);
  var sctx = await onlineContext(browser, device);
  var teacher = await newPage(tctx, HTML_ONLINE, problems);
  await teacherLogin(teacher, pin);
  await teacher.locator('#teacher-levels button').nth(1).click();
  assert.equal(await teacher.locator('#teacher-side [data-side="w"]').getAttribute('aria-checked'), 'true', 'за замовчуванням учень білими');
  await teacher.click('#btn-create-room');
  await teacher.waitForSelector('#scr-game:not(.hidden)');
  var code = await teacher.locator('#room-code').textContent();
  assert.match(code, /^\d{6}$/);
  var link = await teacher.locator('#link-input').inputValue();
  assert.equal(link, ORIGIN + '/?room=' + code);
  assert.ok(await teacher.locator('#btn-copy').isVisible(), 'кнопка «Скопіювати»');
  assert.equal(teacher.url(), link, 'у вчителя в адресі теж ?room=');
  await teacher.click('#btn-copy');
  await teacher.waitForFunction(function () { return document.getElementById('link-done').textContent !== ''; });
  var a1 = await teacher.locator('#board .sq').nth(0).evaluate(function (n) { return n.style.left + ' ' + n.style.top; });
  assert.equal(a1, '80% 0%', 'у вчителя дошка перевернута (a1 справа вгорі)');
  await noHScroll(teacher, 'онлайн вчитель');

  var student = await newPage(sctx, HTML_ONLINE, problems, '?room=' + code);
  await student.waitForSelector('#scr-game:not(.hidden)');
  assert.match(await student.locator('#top-title').textContent(), /Рівень 2/);
  assert.equal(await student.locator('#status-txt').textContent(), 'Твій хід');
  assert.ok(await student.locator('#link-box').isHidden(), 'учень не бачить посилання');
  assert.ok(await student.locator('#btn-restart').isHidden(), 'учень не починає нову гру');
  await teacher.waitForFunction(function () { return /Учень у грі/.test(document.getElementById('net-status').textContent); });

  log('   учень ходить турою c1→c3, вчитель бачить хід');
  await tapSq(student, 2);
  await tapSq(student, 12);
  await waitPiece(teacher, 12, /білі: тура/);
  await waitStatus(teacher, 'Твій хід');
  log('   вчитель ходить пішаком a4→a3, учень бачить хід');
  await tapSq(teacher, 15);
  await tapSq(teacher, 10);
  await waitPiece(student, 10, /чорні: пішак/);
  await waitStatus(student, 'Твій хід');

  log('   учень не може ходити за вчителя');
  await tapSq(student, 18);
  await tapSq(student, 13);
  await student.waitForTimeout(300);
  assert.match(await student.locator('#board .sq').nth(18).getAttribute('aria-label'), /чорні: пішак/);

  log('   учень оновлює сторінку — партія на місці');
  await student.reload();
  await student.waitForSelector('#scr-game:not(.hidden)');
  await waitPiece(student, 12, /білі: тура/);
  await waitPiece(student, 10, /чорні: пішак/);
  await waitStatus(student, 'Твій хід');
  await tapSq(student, 12);
  await tapSq(student, 10);   // тура c3 б’є пішака a3
  await waitPiece(teacher, 10, /білі: тура/);

  log('   вчитель закриває вкладку й відкриває посилання знову — він знову вчитель');
  await teacher.close();
  teacher = await newPage(tctx, HTML_ONLINE, problems, '?room=' + code);
  await teacher.waitForSelector('#scr-game:not(.hidden)');
  await waitPiece(teacher, 10, /білі: тура/);
  assert.ok(await teacher.locator('#link-box').isVisible(), 'у вчителя знову посилання');
  a1 = await teacher.locator('#board .sq').nth(0).evaluate(function (n) { return n.style.left + ' ' + n.style.top; });
  assert.equal(a1, '80% 0%', 'після оновлення в учителя дошка перевернута');
  await waitStatus(teacher, 'Твій хід');

  log('   «Почати знову» у вчителя скидає партію в учня');
  await teacher.click('#btn-restart');
  await waitPiece(student, 2, /білі: тура/);
  await noHScroll(student, 'онлайн учень');
  await teacher.close();
  await student.close();

  log('10. Онлайн: учень чорними, рівень 1, вхід за кодом вручну');
  teacher = await newPage(tctx, HTML_ONLINE, problems);
  await teacherLogin(teacher, pin);
  await teacher.locator('#teacher-levels button').nth(0).click();
  await teacher.click('#teacher-side [data-side="b"]');
  await teacher.click('#btn-create-room');
  await teacher.waitForSelector('#scr-game:not(.hidden)');
  code = await teacher.locator('#room-code').textContent();
  a1 = await teacher.locator('#board .sq').nth(0).evaluate(function (n) { return n.style.left + ' ' + n.style.top; });
  assert.equal(a1, '0% 80%', 'вчитель білими — дошка не перевернута');
  await waitStatus(teacher, 'Твій хід');
  student = await newPage(sctx, HTML_ONLINE, problems);
  await student.click('#btn-join');
  for (i = 0; i < code.length; i++) await student.locator('#join-pad button', { hasText: code.charAt(i) }).first().click();
  await student.waitForSelector('#scr-game:not(.hidden)');
  a1 = await student.locator('#board .sq').nth(0).evaluate(function (n) { return n.style.left + ' ' + n.style.top; });
  assert.equal(a1, '80% 0%', 'учень чорними — дошка перевернута');
  assert.match(await student.locator('#status-txt').textContent(), /Вчитель/);
  assert.equal(student.url(), ORIGIN + '/?room=' + code, 'після входу за кодом адреса з ?room=');
  await tapSq(teacher, 7);    // c2→c3
  await tapSq(teacher, 12);
  await waitPiece(student, 12, /білі: пішак/);
  await waitStatus(student, 'Твій хід');

  log('   обидва закрили вкладки; учень на новому пристрої відкриває посилання — стан з історії');
  await teacher.close();
  await student.close();
  var s2ctx = await onlineContext(browser, device);
  student = await newPage(s2ctx, HTML_ONLINE, problems, '?room=' + code);
  await student.waitForSelector('#scr-game:not(.hidden)');
  await waitPiece(student, 12, /білі: пішак/);
  await waitStatus(student, 'Твій хід');
  log('   «Додому» прибирає кімнату з адреси');
  await student.click('#btn-home');
  assert.equal(student.url(), ORIGIN + '/');
  await tctx.close();
  await sctx.close();
  await s2ctx.close();
  await browser.close();

  if (problems.length) {
    log('ПРОБЛЕМИ:\n' + problems.join('\n'));
    process.exit(1);
  }
  log('OK: усі сценарії пройдено, помилок у консолі й зовнішніх запитів немає.');
}

main().catch(function (e) {
  process.stderr.write((e && e.stack) || String(e));
  process.stderr.write('\n');
  process.exit(1);
});
