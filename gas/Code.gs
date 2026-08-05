/**
 * ============================================================
 *  اليوم الترفيهي — الوسيط بين صفحة الويب وجوجل شيت
 * ------------------------------------------------------------
 *  الصق الملف ده في Apps Script بتاع الشيت، وبعدين:
 *  Deploy ▸ New deployment ▸ Web app
 *      Execute as        : Me
 *      Who has access    : Anyone
 *  وانسخ الرابط اللي بينتهي بـ /exec وحطّه في assets/config.js
 * ============================================================
 */

var SH_DATA = '_بيانات';
var SH_TEAMS = 'الفرق';
var SH_GAMES = 'الألعاب';
var SH_SCHED = 'الجدول';

/* الأعمدة المقروءة الأول، والتقنية في الآخر (بتتخبّى تلقائياً) */
var SCHED_COLS = [
  ['periodName', 'الفترة'],
  ['round', 'الجولة'],
  ['start', 'من'],
  ['end', 'إلى'],
  ['gameName', 'اللعبة'],
  ['place', 'المكان'],
  ['supervisor', 'المشرف'],
  ['teamA', 'الفريق الأول'],
  ['teamB', 'الفريق التاني'],
  ['status', 'الحالة'],
  ['confirmedBy', 'أكّدها'],
  ['confirmedAt', 'وقت التأكيد'],
  ['scoreA', 'نتيجة ١'],
  ['scoreB', 'نتيجة ٢'],
  ['note', 'ملاحظة'],
  ['id', 'id'],
  ['periodId', 'periodId'],
  ['gameId', 'gameId'],
  ['teamAId', 'teamAId'],
  ['teamBId', 'teamBId'],
  ['startMin', 'startMin'],
  ['endMin', 'endMin'],
  ['solo', 'solo']
];
var TECH_FROM = 16;   // أول عمود تقني (1-based)

/* ==================== المدخل ==================== */

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'ping';
  return handle(action, {});
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { }
  return handle(body.action || 'ping', body.payload || {});
}

function handle(action, payload) {
  try {
    var data;
    switch (action) {
      case 'ping': data = doPing(); break;
      case 'pull': data = doPull(); break;
      case 'saveSetup': data = doSaveSetup(payload); break;
      case 'saveSchedule': data = doSaveSchedule(payload); break;
      case 'updateMatch': data = doUpdateMatch(payload); break;
      case 'shiftPending': data = doShift(payload); break;
      default: throw new Error('أمر غير معروف: ' + action);
    }
    return json({ ok: true, data: data });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ==================== التبويبات ==================== */

function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet(name) {
  var s = ss().getSheetByName(name);
  if (!s) s = ss().insertSheet(name);
  return s;
}

/* نسخة خفيفة بتتنده مع كل طلب من التطبيق — بتتأكد بس إن التبويبات موجودة */
function ensure() {
  var d = sheet(SH_DATA);
  if (!d.getRange('A1').getValue()) {
    d.getRange('A1').setValue(JSON.stringify({ config: DEFAULT_CONFIG(), teams: [], periods: [], meta: {} }));
    d.getRange('B1').setValue('⚠️ متلمسش العمود A — كل الإعدادات محفوظة فيه');
    d.hideSheet();
  }
  var sc = sheet(SH_SCHED);
  if (sc.getLastRow() === 0) writeSchedHeader(sc);
  sheet(SH_TEAMS);
  sheet(SH_GAMES);
  return true;
}

function DEFAULT_CONFIG() {
  return {
    title: 'اليوم الترفيهي',
    password: '5555',            // الأدمن
    supervisorPassword: '1234',  // المشرفين
    viewPassword: '',            // العرض فقط (فاضية = بدون كلمة سر)
    shiftMinutes: 0,
    pointsWin: 3,
    pointsDraw: 1,
    pointsLoss: 0,
    locked: false
  };
}

function writeSchedHeader(sc) {
  var head = SCHED_COLS.map(function (c) { return c[1]; });
  sc.getRange(1, 1, 1, head.length).setValues([head])
    .setFontWeight('bold').setBackground('#eef2f8');
  sc.setFrozenRows(1);
  // خلّي أعمدة الوقت نص عشان جوجل ميحوّلهاش لتاريخ
  sc.getRange(2, 3, sc.getMaxRows() - 1, 2).setNumberFormat('@');
  try { sc.hideColumns(TECH_FROM, SCHED_COLS.length - TECH_FROM + 1); } catch (e) { }
}

/* ==================== الأوامر ==================== */

function doPing() {
  ensure();
  return { version: 1, spreadsheet: ss().getName(), url: ss().getUrl() };
}

function readData() {
  ensure();
  var raw = sheet(SH_DATA).getRange('A1').getValue();
  try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
}

function writeData(obj) {
  sheet(SH_DATA).getRange('A1').setValue(JSON.stringify(obj));
}

function doPull() {
  var d = readData();
  return {
    config: d.config || {},
    teams: d.teams || [],
    periods: d.periods || [],
    meta: d.meta || {},
    schedule: readSchedule()
  };
}

function doSaveSetup(p) {
  ensure();
  var d = readData();
  d.config = p.config || {};
  d.teams = p.teams || [];
  d.periods = p.periods || [];
  d.meta = d.meta || {};
  d.meta.updatedAt = new Date().toISOString();
  writeData(d);
  writeTeamsSheet(d.teams);
  writeGamesSheet(d.periods);
  return { saved: true };
}

function writeTeamsSheet(teams) {
  var s = sheet(SH_TEAMS);
  s.clear();
  var rows = [['#', 'اسم الفريق', 'id']];
  teams.forEach(function (t, i) { rows.push([i + 1, t.name, t.id]); });
  s.getRange(1, 1, rows.length, 3).setValues(rows);
  s.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#eef2f8');
  s.setFrozenRows(1);
}

function writeGamesSheet(periods) {
  var s = sheet(SH_GAMES);
  s.clear();
  var rows = [['الفترة', 'من', 'إلى', 'مدة اللعبة', 'اللعبة', 'المكان', 'المشرف', 'id']];
  (periods || []).forEach(function (p) {
    (p.games || []).forEach(function (g) {
      rows.push([p.name, p.start, p.end, p.gameMinutes, g.name, g.place || '', g.supervisor || '', g.id]);
    });
  });
  s.getRange(1, 1, rows.length, 8).setValues(rows);
  s.getRange(1, 1, 1, 8).setFontWeight('bold').setBackground('#eef2f8');
  s.getRange(2, 2, Math.max(1, rows.length - 1), 2).setNumberFormat('@');
  s.setFrozenRows(1);
}

function readSchedule() {
  ensure();
  var s = sheet(SH_SCHED);
  var last = s.getLastRow();
  if (last < 2) return [];
  var values = s.getRange(2, 1, last - 1, SCHED_COLS.length).getValues();
  return values.filter(function (r) { return r[15] !== '' && r[15] != null; })  // فيه id
    .map(function (r) {
      var o = {};
      SCHED_COLS.forEach(function (c, i) { o[c[0]] = r[i]; });
      o.round = Number(o.round) || 0;
      o.startMin = Number(o.startMin) || 0;
      o.endMin = Number(o.endMin) || 0;
      o.solo = o.solo === true || o.solo === 'TRUE' || o.solo === 'صح';
      o.start = String(o.start);
      o.end = String(o.end);
      o.scoreA = o.scoreA === '' || o.scoreA == null ? '' : String(o.scoreA);
      o.scoreB = o.scoreB === '' || o.scoreB == null ? '' : String(o.scoreB);
      return o;
    });
}

function doSaveSchedule(p) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    ensure();
    var s = sheet(SH_SCHED);
    s.clear();
    writeSchedHeader(s);
    var rows = (p.schedule || []).map(function (m) {
      return SCHED_COLS.map(function (c) {
        var v = m[c[0]];
        return v === undefined || v === null ? '' : v;
      });
    });
    if (rows.length) {
      s.getRange(2, 1, rows.length, SCHED_COLS.length).setValues(rows);
      s.getRange(2, 3, rows.length, 2).setNumberFormat('@');
    }
    s.autoResizeColumns(1, 15);

    var d = readData();
    d.meta = p.meta || {};
    d.meta.updatedAt = new Date().toISOString();
    writeData(d);
    return { count: rows.length };
  } finally { lock.releaseLock(); }
}

function findRowById(s, id) {
  var last = s.getLastRow();
  if (last < 2) return -1;
  var ids = s.getRange(2, 16, last - 1, 1).getValues();   // العمود 16 = id
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return -1;
}

function doUpdateMatch(p) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    ensure();
    var s = sheet(SH_SCHED);
    var row = findRowById(s, p.id);
    if (row === -1) throw new Error('المباراة مش موجودة في الشيت');

    var patch = p.patch || {};
    Object.keys(patch).forEach(function (k) {
      var col = -1;
      for (var i = 0; i < SCHED_COLS.length; i++) if (SCHED_COLS[i][0] === k) { col = i + 1; break; }
      if (col > 0) s.getRange(row, col).setValue(patch[k] === undefined ? '' : patch[k]);
    });

    var vals = s.getRange(row, 1, 1, SCHED_COLS.length).getValues()[0];
    var out = {};
    SCHED_COLS.forEach(function (c, i) { out[c[0]] = vals[i]; });
    out.scoreA = out.scoreA === '' || out.scoreA == null ? '' : String(out.scoreA);
    out.scoreB = out.scoreB === '' || out.scoreB == null ? '' : String(out.scoreB);
    return out;
  } finally { lock.releaseLock(); }
}

function doShift(p) {
  var minutes = Number(p.minutes) || 0;
  if (!minutes) return { changed: 0 };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    ensure();
    var s = sheet(SH_SCHED);
    var last = s.getLastRow();
    if (last < 2) return { changed: 0 };

    var n = last - 1;
    var status = s.getRange(2, 10, n, 1).getValues();          // الحالة
    var times = s.getRange(2, 3, n, 2).getValues();            // من / إلى
    var mins = s.getRange(2, 21, n, 2).getValues();            // startMin / endMin
    var changed = 0;

    for (var i = 0; i < n; i++) {
      if (String(status[i][0]) === 'done') continue;
      var sm = Number(mins[i][0]) + minutes;
      var em = Number(mins[i][1]) + minutes;
      mins[i][0] = sm; mins[i][1] = em;
      times[i][0] = fmtMin(sm); times[i][1] = fmtMin(em);
      changed++;
    }
    s.getRange(2, 3, n, 2).setNumberFormat('@').setValues(times);
    s.getRange(2, 21, n, 2).setValues(mins);

    var d = readData();
    d.config = d.config || {};
    d.config.shiftMinutes = (Number(d.config.shiftMinutes) || 0) + minutes;
    writeData(d);
    return { changed: changed };
  } finally { lock.releaseLock(); }
}

function fmtMin(m) {
  m = ((m % 1440) + 1440) % 1440;
  var h = Math.floor(m / 60), q = m % 60;
  return ('0' + h).slice(-2) + ':' + ('0' + q).slice(-2);
}

/* ============================================================
   ==================  التجهيز (SETUP)  =======================
   ------------------------------------------------------------
   شغّل الدالة setup() مرة واحدة بس من محرر Apps Script
   (اختارها من القائمة فوق واضغط ▶ Run)، أو من قائمة
   «اليوم الترفيهي ▸ تجهيز الشيت» جوه الشيت نفسه.

   بتعمل إيه؟
     • بتعمل كل التبويبات المطلوبة وترتّبها
     • بتحط الترويسات والتنسيق والاتجاه من اليمين للشمال
     • بتضيف قائمة منسدلة وتلوين تلقائي لعمود الحالة
     • بتحط الإعدادات الافتراضية (كلمة السر 5555 والنقاط)
     • بتعمل تبويب «تعليمات» فيه الخطوات
     • وبتطبع لك رابط التطبيق لو كنت نشرته

   آمنة إنك تشغّلها أكتر من مرة — مش بتمسح أي بيانات موجودة.
   ============================================================ */

function setup() {
  var report = [];
  var s = ss();

  /* ① التبويبات */
  ensure();
  report.push('✔ التبويبات: ' + SH_SCHED + '، ' + SH_TEAMS + '، ' + SH_GAMES + '، ' + SH_DATA);

  /* ② الإعدادات الافتراضية (من غير ما نلمس اللي متسجّل) */
  var d = readData();
  var def = DEFAULT_CONFIG();
  d.config = d.config || {};
  var added = [];
  for (var k in def) {
    if (d.config[k] === undefined || d.config[k] === '') { d.config[k] = def[k]; added.push(k); }
  }
  d.teams = d.teams || [];
  d.periods = d.periods || [];
  d.meta = d.meta || {};
  writeData(d);
  report.push('✔ الإعدادات: كلمة السر «' + d.config.password + '»' +
    (added.length ? ' (اتضاف: ' + added.join('، ') + ')' : ' (كانت متسجّلة)'));

  /* ③ تنسيق تبويب الجدول */
  formatScheduleSheet_();
  report.push('✔ تنسيق الجدول: ترويسة ثابتة + قائمة للحالة + تلوين تلقائي للمباريات اللي تمّت');

  /* ④ تبويبات القراءة */
  writeTeamsSheet(d.teams);
  writeGamesSheet(d.periods);
  report.push('✔ تبويبات الفرق والألعاب اتجهّزت (' + d.teams.length + ' فريق، ' +
    countGames_(d.periods) + ' لعبة)');

  /* ⑤ تبويب التعليمات */
  buildHelpSheet_();
  report.push('✔ تبويب «تعليمات» اتعمل');

  /* ⑥ الترتيب والاتجاه */
  [SH_SCHED, SH_TEAMS, SH_GAMES, 'تعليمات'].forEach(function (n) {
    var sh = s.getSheetByName(n);
    if (sh) { try { sh.setRightToLeft(true); } catch (e) { } }
  });
  orderSheets_(['تعليمات', SH_SCHED, SH_TEAMS, SH_GAMES]);
  removeDefaultSheet_();
  report.push('✔ ترتيب التبويبات والاتجاه من اليمين للشمال');

  /* ⑦ رابط التطبيق */
  var url = webAppUrl_();
  report.push(url
    ? '✔ رابط التطبيق:\n' + url + '\n\nانسخه وحطّه في ملف assets/config.js'
    : '⚠ لسه منشرتش السكربت.\nاعمل: Deploy ▸ New deployment ▸ Web app\n   Execute as: Me\n   Who has access: Anyone\nوبعدين شغّل setup() تاني عشان يجيب لك الرابط.');

  var msg = 'تمّ التجهيز ✅\n\n' + report.join('\n\n');
  Logger.log(msg);
  alert_('تجهيز اليوم الترفيهي', msg);
  return msg;
}

/* تجهيز + بيانات تجريبية جاهزة تجرّب عليها على طول */
function setupWithSampleData() {
  setup();
  var d = readData();
  if ((d.teams && d.teams.length) || (d.periods && d.periods.length)) {
    if (!confirm_('فيه بيانات متسجّلة بالفعل. تستبدلها بالبيانات التجريبية؟')) {
      alert_('تمام', 'مالمستش حاجة.');
      return;
    }
  }
  d.teams = [];
  for (var i = 1; i <= 8; i++) d.teams.push({ id: 't' + i, name: 'فريق ' + toAr_(i) });

  d.periods = [
    { id: 'p1', name: 'الفترة الصباحية', start: '10:00', end: '12:00', gameMinutes: 30, breakMinutes: 0, games: [] },
    { id: 'p2', name: 'الفترة المسائية', start: '14:00', end: '16:00', gameMinutes: 20, breakMinutes: 0, games: [] }
  ];
  var g1 = ['شد الحبل', 'كرة السلة', 'سباق الجري', 'الكرسي الموسيقي'];
  var g2 = ['تنس الطاولة', 'الدومينو', 'سباق الأكياس', 'الأسئلة السريعة', 'كرة القدم', 'الذاكرة'];
  g1.forEach(function (n, i) { d.periods[0].games.push({ id: 'p1g' + (i + 1), name: n, place: '', supervisor: '' }); });
  g2.forEach(function (n, i) { d.periods[1].games.push({ id: 'p2g' + (i + 1), name: n, place: '', supervisor: '' }); });

  writeData(d);
  writeTeamsSheet(d.teams);
  writeGamesSheet(d.periods);
  alert_('تمّ ✅', 'اتحطّت بيانات تجريبية: ٨ فرق، فترتين، ١٠ ألعاب.\n\n' +
    'افتح التطبيق واضغط «احسب الخيارين» عشان تشوف الجدول.');
}

/* ==================== أدوات التجهيز ==================== */

function formatScheduleSheet_() {
  var sh = sheet(SH_SCHED);
  var maxRows = sh.getMaxRows();

  if (sh.getLastRow() === 0) writeSchedHeader(sh);

  sh.getRange(1, 1, 1, SCHED_COLS.length)
    .setValues([SCHED_COLS.map(function (c) { return c[1]; })])
    .setFontWeight('bold').setBackground('#e8eef7').setFontColor('#16202f');
  sh.setFrozenRows(1);

  // أعمدة الوقت لازم تفضل نص عشان جوجل ميحوّلهاش لتاريخ
  sh.getRange(2, 3, maxRows - 1, 2).setNumberFormat('@');

  // قائمة منسدلة لعمود الحالة (العمود العاشر)
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['pending', 'done'], true)
    .setAllowInvalid(false)
    .setHelpText('pending = لسه ماتلعبتش   |   done = تمّت')
    .build();
  sh.getRange(2, 10, maxRows - 1, 1).setDataValidation(rule);

  // تلوين تلقائي: الصف كله أخضر لما الحالة = done
  var all = sh.getRange(2, 1, maxRows - 1, SCHED_COLS.length);
  var done = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$J2="done"')
    .setBackground('#e6f4ea')
    .setRanges([all]).build();
  sh.setConditionalFormatRules([done]);

  // عرض الأعمدة
  var widths = [130, 55, 60, 60, 150, 110, 110, 130, 130, 80, 100, 150, 70, 70, 140];
  widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });

  // خبّي الأعمدة التقنية
  try { sh.hideColumns(TECH_FROM, SCHED_COLS.length - TECH_FROM + 1); } catch (e) { }
}

function buildHelpSheet_() {
  var sh = sheet('تعليمات');
  sh.clear();
  try { sh.clearConditionalFormatRules(); } catch (e) { }

  var url = webAppUrl_();
  var rows = [
    ['🏆 اليوم الترفيهي — تعليمات'],
    [''],
    ['الشيت ده بيخزّن بيانات تطبيق تنظيم اليوم الترفيهي. الإدخال بيتم من التطبيق مش من هنا.'],
    [''],
    ['① النشر'],
    ['Deploy ▸ New deployment ▸ Web app     |     Execute as: Me     |     Who has access: Anyone'],
    ['رابط التطبيق:', url || '(لسه منشرتش — انشر وبعدين شغّل setup تاني)'],
    ['الرابط ده يتحط في ملف assets/config.js جوه المشروع، وبعدين يترفع على GitHub Pages.'],
    [''],
    ['② كلمة السر'],
    ['الافتراضية 5555 — تقدر تغيّرها من صفحة «الإعداد» جوه التطبيق.'],
    [''],
    ['③ التبويبات'],
    ['الجدول', 'كل المباريات وحالتها والنتائج — ده اللي بتتابعه لايف يوم اليوم الترفيهي'],
    ['الفرق', 'أسماء الفرق (للقراءة — التعديل من التطبيق)'],
    ['الألعاب', 'الفترات والألعاب (للقراءة — التعديل من التطبيق)'],
    ['_بيانات', 'مخفي، فيه كل الإعدادات. ⚠️ متلمسوش.'],
    [''],
    ['④ عمود الحالة'],
    ['pending', 'المباراة لسه ماتلعبتش'],
    ['done', 'المشرف أكّد إنها اتلعبت — الصف بيتلوّن أخضر تلقائياً'],
    [''],
    ['⑤ ملاحظة مهمة عن التقسيم'],
    ['كل فريق بيلعب عدد مباريات = عدد الألعاب الكلي، وعنده (عدد الفرق − ١) خصم متاح.'],
    ['فلو عدد الألعاب أكبر من (عدد الفرق − ١)، تكرار المواجهات بيبقى حتمي رياضياً.'],
    ['عشان صفر تكرار: خلّي عدد الألعاب = عدد الفرق − ١ (مثلاً ٨ فرق و٧ ألعاب).'],
    ['ملحوظة: ٤ فرق و٦ فرق مستحيل فيهم صفر تكرار مهما عملت.'],
    [''],
    ['⑥ القائمة'],
    ['من فوق: «اليوم الترفيهي» فيها التجهيز ومسح الجدول وعرض الرابط.']
  ];

  sh.getRange(1, 1, rows.length, 2).setValues(rows.map(function (r) {
    return [r[0] || '', r.length > 1 ? r[1] : ''];
  }));

  sh.getRange(1, 1).setFontSize(16).setFontWeight('bold');
  [5, 10, 13, 19, 23, 29].forEach(function (r) {
    sh.getRange(r, 1, 1, 2).setFontWeight('bold').setBackground('#e8eef7');
  });
  sh.getRange(7, 2).setFontWeight('bold');
  sh.setColumnWidth(1, 260);
  sh.setColumnWidth(2, 560);
  sh.getRange(1, 1, rows.length, 2).setVerticalAlignment('middle').setWrap(true);
  sh.setFrozenRows(1);
}

function orderSheets_(names) {
  var s = ss();
  names.forEach(function (n, i) {
    var sh = s.getSheetByName(n);
    if (sh) { s.setActiveSheet(sh); s.moveActiveSheet(i + 1); }
  });
  var first = s.getSheetByName(names[0]);
  if (first) s.setActiveSheet(first);
}

/* يشيل تبويب Sheet1 الفاضي اللي جوجل بيعمله لوحده */
function removeDefaultSheet_() {
  var s = ss();
  ['Sheet1', 'ورقة1', 'الورقة1'].forEach(function (n) {
    var sh = s.getSheetByName(n);
    if (sh && sh.getLastRow() === 0 && sh.getLastColumn() === 0 && s.getSheets().length > 1) {
      try { s.deleteSheet(sh); } catch (e) { }
    }
  });
}

function countGames_(periods) {
  var n = 0;
  (periods || []).forEach(function (p) { n += (p.games || []).length; });
  return n;
}

function toAr_(n) {
  return String(n).replace(/[0-9]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.charAt(+d); });
}

function webAppUrl_() {
  try {
    var u = ScriptApp.getService().getUrl();
    return u && u.indexOf('/exec') !== -1 ? u : '';
  } catch (e) { return ''; }
}

/* بتشتغل من الشيت ومن المحرر — من غير ما ترمي خطأ لو مفيش واجهة */
function alert_(title, msg) {
  try { SpreadsheetApp.getUi().alert(title, msg, SpreadsheetApp.getUi().ButtonSet.OK); }
  catch (e) { Logger.log(title + '\n' + msg); }
}

/* لو مفيش واجهة (شغّال من المحرر) بنرفض العمليات المدمّرة عشان
   حد ميمسحش بيانات بالغلط وهو بيجرّب الدوال */
function confirm_(msg) {
  try {
    var ui = SpreadsheetApp.getUi();
    return ui.alert('تأكيد', msg, ui.ButtonSet.YES_NO) === ui.Button.YES;
  } catch (e) {
    Logger.log('العملية دي محتاجة تأكيد. شغّلها من جوه الشيت من قائمة «🏆 اليوم الترفيهي».');
    return false;
  }
}

/* ==================== قائمة الشيت ==================== */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🏆 اليوم الترفيهي')
    .addItem('⚙️ تجهيز الشيت (Setup)', 'setup')
    .addItem('🧪 تجهيز + بيانات تجريبية', 'setupWithSampleData')
    .addSeparator()
    .addItem('🔗 عرض رابط التطبيق', 'showAppUrl')
    .addSeparator()
    .addItem('📦 أرشفة اليوم', 'archiveDay')
    .addItem('🗑️ مسح الجدول فقط', 'clearSchedule')
    .addItem('💣 مسح كل حاجة', 'resetAll')
    .addToUi();
}

function showAppUrl() {
  var url = webAppUrl_();
  alert_('رابط التطبيق', url
    ? url + '\n\nحطّه في ملف assets/config.js'
    : 'لسه منشرتش السكربت.\n\nDeploy ▸ New deployment ▸ Web app\nExecute as: Me\nWho has access: Anyone');
}

/**
 * بتاخد نسخة من الجدول الحالي في تبويب جديد قبل ما تمسحه.
 * ملاحظة: دي بتشتغل من قائمة الشيت على طول من غير ما تعيد النشر،
 * لأن قوائم الشيت بتشغّل آخر نسخة محفوظة من الكود.
 */
function archiveDay() {
  ensure();
  var src = sheet(SH_SCHED);
  if (src.getLastRow() < 2) { alert_('مفيش حاجة', 'الجدول فاضي — مفيش حاجة تتأرشف.'); return; }

  var d = readData();
  var title = (d.config && d.config.title) ? String(d.config.title) : 'اليوم الترفيهي';
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  var name = ('📦 ' + title + ' ' + stamp).substring(0, 95);

  // لو الاسم متكرر زوّد رقم
  var base = name, i = 2;
  while (ss().getSheetByName(name)) { name = (base + ' (' + (i++) + ')').substring(0, 99); }

  var copy = src.copyTo(ss());
  copy.setName(name);
  try { copy.setRightToLeft(true); } catch (e) { }
  try { copy.showColumns(1, SCHED_COLS.length); } catch (e) { }
  ss().setActiveSheet(copy);
  ss().moveActiveSheet(ss().getSheets().length);

  var rows = src.getLastRow() - 1;
  alert_('اتأرشف ✅', 'اتحفظت نسخة من ' + rows + ' مباراة في تبويب:\n\n' + name +
    '\n\nدلوقتي تقدر تمسح الجدول وتبدأ يوم جديد.');
}

function clearSchedule() {
  if (!confirm_('هيتمسح الجدول كله بالتأكيدات والنتائج. متأكد؟')) return;
  var s = sheet(SH_SCHED);
  s.clear();
  writeSchedHeader(s);
  formatScheduleSheet_();
  var d = readData();
  d.meta = {};
  writeData(d);
  alert_('تمّ', 'اتمسح الجدول. الفرق والألعاب زي ما هي.');
}

function resetAll() {
  if (!confirm_('هيتمسح كل حاجة: الفرق والألعاب والجدول والإعدادات. متأكد؟')) return;
  var d = { config: DEFAULT_CONFIG(), teams: [], periods: [], meta: {} };
  writeData(d);
  var s = sheet(SH_SCHED);
  s.clear();
  writeSchedHeader(s);
  formatScheduleSheet_();
  writeTeamsSheet([]);
  writeGamesSheet([]);
  alert_('تمّ', 'اترجع كل حاجة زي أول مرة. كلمة السر رجعت 5555.');
}
