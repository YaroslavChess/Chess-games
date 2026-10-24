/**
 * Приймає результати тренажера (POST, JSON у text/plain) і дописує їх у таблицю,
 * до якої прив'язаний скрипт. Аркуші створюються автоматично.
 * Інструкція: english/SETUP.md
 */

var ANSWERS_SHEET = 'Відповіді';
var SESSIONS_SHEET = 'Сесії';

var ANSWERS_HEADER = [
  'Час', 'Учень', 'Вкладка', 'Налаштування', 'Питання',
  'Відповідь учня', 'Правильна відповідь', 'Результат'
];
var SESSIONS_HEADER = [
  'Дата', 'Учень', 'Вкладка', 'Scope', 'Direction', 'Input Method',
  'Тривалість (с)', 'Пройдено карток', 'Точність (%)', 'Помилки', 'Статус'
];

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var data = JSON.parse(e.postData.contents);
    if (data.kind === 'answer') {
      appendAnswer_(data);
    } else if (data.kind === 'session') {
      appendSession_(data);
    }
    return ContentService.createTextOutput('ok');
  } catch (err) {
    return ContentService.createTextOutput('error: ' + err);
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

// Відкрийте URL веб-застосунку в браузері, щоб перевірити, що він розгорнутий.
function doGet() {
  return ContentService.createTextOutput('Chess-games results endpoint is running.');
}

function appendAnswer_(d) {
  var sheet = getSheet_(ANSWERS_SHEET, ANSWERS_HEADER);
  sheet.appendRow([
    new Date(d.ts),
    text_(d.student),
    text_(d.tab),
    text_(d.settings),
    text_(d.question),
    text_(d.given),
    text_(d.correct),
    d.ok ? 'правильно' : 'неправильно'
  ]);
}

function appendSession_(d) {
  var sheet = getSheet_(SESSIONS_SHEET, SESSIONS_HEADER);
  var mistakes = (d.mistakes || []).map(function (m) {
    return m.q + ' → ' + m.a + ' (×' + m.n + ')';
  }).join('\n');
  sheet.appendRow([
    new Date(d.ts),
    text_(d.student),
    text_(d.tab),
    text_(d.scope),
    text_(d.direction),
    text_(d.input),
    Number(d.duration) || 0,
    Number(d.cards) || 0,
    Number(d.accuracy) || 0,
    text_(mistakes),
    d.status === 'completed' ? 'завершено' : 'перервано'
  ]);
}

function getSheet_(name, header) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(header);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Рядки, що починаються з =, +, @ або -текст, інакше Sheets сприйме їх як формулу.
function text_(v) {
  var s = v == null ? '' : String(v);
  return /^([=+@]|-\S)/.test(s) ? "'" + s : s;
}
