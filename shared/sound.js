/* Спільні звуки для шахових ігор. Підключення: <script src="../shared/sound.js"></script>
   (у кінці <body>, перед головним <script> гри).

   Sound.play(name)      — зіграти звук. Імена: move, capture, check, wrong, right, star, win, lose,
                           level, oink, oy. Невідоме ім'я — нічого не відбувається.
   Sound.setMuted(bool)  — вимкнути / увімкнути звук (запам'ятовується в localStorage).
   Sound.isMuted()       — чи вимкнено звук.

   Усі звуки синтезуються через WebAudio, гучність 0.4. Перший звук лунає лише після першого
   натискання користувача (так вимагають браузери).

   Свої файли: якщо в shared/sounds/ лежить <name>.mp3 або <name>.m4a — модуль грає його замість
   синтезу. Для right, wrong і win додатково грається голос, якщо є <name>-voice.mp3 або .m4a.
   Код міняти не треба. Докладніше — CLAUDE.md, розділ «Звуки». */
(function () {
  'use strict';

  var VOLUME = 0.4;                       // загальна гучність
  var MUTE_KEY = 'chess-sound-muted';     // localStorage: '1' — звук вимкнено
  var NAMES = ['move', 'capture', 'check', 'wrong', 'right', 'star', 'win', 'lose', 'level', 'oink', 'oy'];
  var VOICE_NAMES = ['right', 'wrong', 'win'];
  var VOICE_DELAY = { right: 0.3, wrong: 0.3, win: 0.7 };   // голос лунає трохи пізніше за звук
  var EXTENSIONS = ['mp3', 'm4a'];

  var ctx = null;          // AudioContext (з'являється після першого натискання)
  var master = null;       // головна гучність
  var muted = false;
  var files = {};          // name -> AudioBuffer зі shared/sounds/
  var voices = {};         // name -> AudioBuffer з голосом
  var filesStarted = false;

  // Папка shared/sounds/ береться з адреси цього скрипта.
  function soundsFolder() {
    var script = document.currentScript;
    if (!script) {
      var all = document.getElementsByTagName('script');
      script = all[all.length - 1];
    }
    return String(script.src).replace(/sound\.js(\?.*)?(#.*)?$/, '') + 'sounds/';
  }
  var FOLDER = soundsFolder();   // викликається під час завантаження скрипта

  try { muted = window.localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { muted = false; }

  /* ---------- Допоміжне для синтезу ---------- */

  // Один тон. o: f — частота, f2 — кінцева частота, at — коли (с від зараз), d — тривалість,
  // v — гучність, type — форма хвилі, lp — зріз низьких частот (робить звук м'якшим).
  function tone(o) {
    var t0 = ctx.currentTime + (o.at || 0);
    var osc = ctx.createOscillator();
    var env = ctx.createGain();
    var filt = ctx.createBiquadFilter();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t0);
    if (o.f2) { osc.frequency.exponentialRampToValueAtTime(o.f2, t0 + o.d); }
    filt.type = 'lowpass';
    filt.frequency.value = o.lp || 3200;
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(o.v || 0.3, t0 + (o.attack || 0.012));
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + o.d);
    osc.connect(filt);
    filt.connect(env);
    env.connect(master);
    osc.start(t0);
    osc.stop(t0 + o.d + 0.05);
  }

  // Короткий шум (стук, шурхіт): at — коли, d — тривалість, v — гучність, freq — «колір» шуму.
  function noise(at, d, v, freq) {
    var t0 = ctx.currentTime + at;
    var n = Math.floor(ctx.sampleRate * d);
    var buf = ctx.createBuffer(1, n, ctx.sampleRate);
    var data = buf.getChannelData(0);
    var i, src, filt, env;
    for (i = 0; i < n; i = i + 1) { data[i] = (Math.random() * 2 - 1) * (1 - i / n); }
    src = ctx.createBufferSource();
    filt = ctx.createBiquadFilter();
    env = ctx.createGain();
    src.buffer = buf;
    filt.type = 'bandpass';
    filt.frequency.value = freq;
    filt.Q.value = 0.9;
    env.gain.value = v;
    src.connect(filt);
    filt.connect(env);
    env.connect(master);
    src.start(t0);
  }

  // Хрюкання: низький пилкоподібний тон, що коливається (вібрато) і «тремтить» за гучністю.
  function grunt(at, f1, f2, d) {
    var t0 = ctx.currentTime + at;
    var osc = ctx.createOscillator();
    var vib = ctx.createOscillator();
    var vibDepth = ctx.createGain();
    var trem = ctx.createOscillator();
    var tremDepth = ctx.createGain();
    var amp = ctx.createGain();
    var env = ctx.createGain();
    var band = ctx.createBiquadFilter();
    var soft = ctx.createBiquadFilter();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f1, t0);
    osc.frequency.exponentialRampToValueAtTime(f2, t0 + d);
    vib.type = 'sine';
    vib.frequency.value = 22;
    vibDepth.gain.value = f1 * 0.12;
    vib.connect(vibDepth);
    vibDepth.connect(osc.frequency);
    trem.type = 'square';
    trem.frequency.value = 34;
    tremDepth.gain.value = 0.35;
    amp.gain.value = 0.65;
    trem.connect(tremDepth);
    tremDepth.connect(amp.gain);
    band.type = 'bandpass';
    band.frequency.setValueAtTime(600, t0);
    band.frequency.exponentialRampToValueAtTime(1100, t0 + d * 0.5);
    band.Q.value = 1.3;
    soft.type = 'lowpass';
    soft.frequency.value = 1600;
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(0.7, t0 + 0.025);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    osc.connect(band);
    band.connect(soft);
    soft.connect(amp);
    amp.connect(env);
    env.connect(master);
    osc.start(t0);
    vib.start(t0);
    trem.start(t0);
    osc.stop(t0 + d + 0.05);
    vib.stop(t0 + d + 0.05);
    trem.stop(t0 + d + 0.05);
  }

  /* ---------- Звуки (синтез) ---------- */

  var SYNTH = {
    // Тихий «стук» фігури по дошці.
    move: function () {
      tone({ f: 340, f2: 190, d: 0.09, v: 0.5, type: 'triangle', lp: 1800 });
      noise(0, 0.04, 0.18, 1400);
    },
    // Трохи важчий стук.
    capture: function () {
      noise(0, 0.12, 0.35, 800);
      tone({ f: 240, f2: 110, d: 0.15, v: 0.55, type: 'triangle', lp: 1500 });
      tone({ f: 560, f2: 320, d: 0.08, v: 0.2, at: 0.02, lp: 2000 });
    },
    // Дві м'які ноти: «увага».
    check: function () {
      tone({ f: 880, d: 0.12, v: 0.3, type: 'triangle', lp: 2200 });
      tone({ f: 660, d: 0.2, v: 0.3, type: 'triangle', lp: 2200, at: 0.12 });
    },
    // М'яке «бом-бом» вниз, без різкості.
    wrong: function () {
      tone({ f: 300, d: 0.16, v: 0.45, type: 'triangle', lp: 1400 });
      tone({ f: 225, d: 0.28, v: 0.45, type: 'triangle', lp: 1400, at: 0.14 });
    },
    // Світлий дзвіночок угору.
    right: function () {
      tone({ f: 660, d: 0.14, v: 0.35 });
      tone({ f: 880, d: 0.3, v: 0.35, at: 0.11 });
      tone({ f: 1760, d: 0.2, v: 0.08, at: 0.11 });
    },
    // Блискітки.
    star: function () {
      tone({ f: 1319, d: 0.2, v: 0.28 });
      tone({ f: 1760, d: 0.22, v: 0.26, at: 0.09 });
      tone({ f: 2349, d: 0.36, v: 0.22, at: 0.18 });
      tone({ f: 3136, d: 0.25, v: 0.07, at: 0.24 });
    },
    // Перемога: підйом і довгий акорд.
    win: function () {
      var notes = [523, 659, 784, 1047];
      var i;
      for (i = 0; i < notes.length; i = i + 1) {
        tone({ f: notes[i], d: 0.2, v: 0.35, type: 'triangle', lp: 2800, at: i * 0.13 });
      }
      tone({ f: 1047, d: 0.8, v: 0.3, type: 'triangle', lp: 2800, at: 0.52 });
      tone({ f: 784, d: 0.8, v: 0.2, type: 'triangle', lp: 2800, at: 0.52 });
      tone({ f: 659, d: 0.8, v: 0.2, type: 'triangle', lp: 2800, at: 0.52 });
      tone({ f: 2093, d: 0.4, v: 0.08, at: 0.7 });
    },
    // Програш: повільно вниз, але м'яко — без образи.
    lose: function () {
      tone({ f: 392, d: 0.3, v: 0.4, type: 'triangle', lp: 1500 });
      tone({ f: 349, d: 0.3, v: 0.4, type: 'triangle', lp: 1500, at: 0.28 });
      tone({ f: 294, d: 0.3, v: 0.4, type: 'triangle', lp: 1500, at: 0.56 });
      tone({ f: 247, d: 0.6, v: 0.4, type: 'triangle', lp: 1500, at: 0.84 });
    },
    // Новий рівень: три швидкі ноти вгору й «пінг».
    level: function () {
      tone({ f: 523, d: 0.12, v: 0.35, type: 'triangle', lp: 2800 });
      tone({ f: 659, d: 0.12, v: 0.35, type: 'triangle', lp: 2800, at: 0.11 });
      tone({ f: 784, d: 0.12, v: 0.35, type: 'triangle', lp: 2800, at: 0.22 });
      tone({ f: 1047, d: 0.4, v: 0.35, at: 0.33 });
    },
    // Кумедне «хрюк-хрюк».
    oink: function () {
      grunt(0, 210, 130, 0.17);
      grunt(0.21, 260, 120, 0.24);
    },
    // Короткий високий писк: угору й трішки вниз.
    oy: function () {
      tone({ f: 900, f2: 1700, d: 0.07, v: 0.4, type: 'triangle', lp: 3500 });
      tone({ f: 1700, f2: 1150, d: 0.16, v: 0.4, type: 'triangle', lp: 3500, at: 0.07 });
    }
  };

  /* ---------- Файли зі shared/sounds/ (необов'язкові) ---------- */

  // Завантажує <name>.mp3, а якщо його немає — <name>.m4a. Немає ні того, ні того — тихо лишаємо синтез.
  function loadFile(base, extIndex, done) {
    var xhr;
    if (extIndex >= EXTENSIONS.length) { return; }
    try {
      xhr = new XMLHttpRequest();
      xhr.open('GET', FOLDER + base + '.' + EXTENSIONS[extIndex], true);
      xhr.responseType = 'arraybuffer';
      xhr.onload = function () {
        var data = xhr.response;
        if (xhr.status !== 200 || !data || !data.byteLength) { loadFile(base, extIndex + 1, done); return; }
        try {
          ctx.decodeAudioData(data, function (buffer) { done(buffer); }, function () { loadFile(base, extIndex + 1, done); });
        } catch (e) { loadFile(base, extIndex + 1, done); }
      };
      xhr.onerror = function () { loadFile(base, extIndex + 1, done); };
      xhr.send();
    } catch (e) { /* без файлів синтез теж працює */ }
  }

  function loadAllFiles() {
    var i;
    if (filesStarted) { return; }
    filesStarted = true;
    function startOne(name, store) {
      loadFile(name, 0, function (buffer) { store[name] = buffer; });
    }
    for (i = 0; i < NAMES.length; i = i + 1) { startOne(NAMES[i], files); }
    for (i = 0; i < VOICE_NAMES.length; i = i + 1) {
      (function (name) {
        loadFile(name + '-voice', 0, function (buffer) { voices[name] = buffer; });
      })(VOICE_NAMES[i]);
    }
  }

  function playBuffer(buffer, delay) {
    var src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(master);
    src.start(ctx.currentTime + (delay || 0));
  }

  /* ---------- Запуск після першого натискання ---------- */

  function unlock() {
    var AC, comp;
    if (!ctx) {
      AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { return; }
      try {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = VOLUME;
        // м'який обмежувач, щоб кілька звуків разом не різали вухо
        comp = ctx.createDynamicsCompressor();
        master.connect(comp);
        comp.connect(ctx.destination);
      } catch (e) { ctx = null; return; }
      loadAllFiles();
    }
    if (ctx.state === 'suspended' && ctx.resume) {
      try { ctx.resume(); } catch (e) { /* ігноруємо */ }
    }
  }

  var GESTURES = ['pointerdown', 'mousedown', 'touchend', 'keydown', 'click'];
  (function () {
    var i;
    for (i = 0; i < GESTURES.length; i = i + 1) {
      document.addEventListener(GESTURES[i], unlock, true);
    }
  })();

  /* ---------- Публічний інтерфейс ---------- */

  function play(name) {
    if (muted || !ctx || !SYNTH[name]) { return; }
    try {
      if (ctx.state === 'suspended' && ctx.resume) { ctx.resume(); }
      if (files[name]) { playBuffer(files[name], 0); } else { SYNTH[name](); }
      if (voices[name]) { playBuffer(voices[name], VOICE_DELAY[name] || 0); }
    } catch (e) { /* звук не обов'язковий */ }
  }

  function setMuted(value) {
    muted = !!value;
    try { window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) { /* без збереження теж працює */ }
  }

  function isMuted() { return muted; }

  window.Sound = { play: play, setMuted: setMuted, isMuted: isMuted };
})();
