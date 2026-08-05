/* =============================================================
   اليوم الترفيهي — واجهة التطبيق (موبايل أولاً)
   ============================================================= */
(function () {
  'use strict';

  const S = window.Scheduler;
  const $ = function (s, r) { return (r || document).querySelector(s); };

  let doc = API.defaultDoc();
  let role = 'admin';          // admin | sup | view — بيتحدد من الرابط
  let locked = false;          // الفلاتر اللي جاية في الرابط مقفولة ومش بتتغيّر
  const scoreDraft = {};       // 'matchId|a' → القيمة اللي المشرف كاتبها ولسه مأكّدش
  let filters = { period: '', game: '', sup: '' };
  let tab = 'supervisor';
  let dirty = false;
  let working = false;
  let compare = null;          // نتائج مقارنة الخيارين
  let scheduleView = 'time';   // time | team | game
  let pollTimer = null;
  let clockTimer = null;

  /* ================= أدوات ================= */

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function uid(p) { return (p || 'x') + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3); }
  function nowMin() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function clockText() {
    const d = new Date();
    return arDigits(String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'));
  }
  /* عرض الوقت بأرقام عربية عشان يتناسق مع باقي الشاشة */
  function tm(v) { return arDigits(esc(v)); }
  function ar(n) { return new Intl.NumberFormat('ar-EG').format(n); }
  /* خانة فاضية أو مش رقم = صفر */
  function numOr0(v) {
    if (v === '' || v == null) return 0;
    const n = Number(String(v).trim());
    return isNaN(n) ? 0 : n;
  }
  function scoreOrZero(v) { return String(numOr0(v)); }
  /* يحوّل الأرقام الإنجليزية جوه أي نص لأرقام عربية عشان الشكل يبقى متناسق */
  function arDigits(s) {
    return String(s).replace(/[0-9]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'[+d]; });
  }

  let toastTimer = null;
  function toast(msg, kind) {
    const old = $('.toast'); if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg;
    document.body.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.remove(); }, kind === 'bad' ? 5200 : 2600);
  }

  function setPath(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = /^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i];
      cur = cur[k];
      if (cur == null) return;
    }
    const last = parts[parts.length - 1];
    cur[/^\d+$/.test(last) ? Number(last) : last] = value;
  }

  function localSave() {
    try { localStorage.setItem('funday.doc.v1', JSON.stringify(doc)); } catch (e) { }
  }

  function markDirty() { dirty = true; localSave(); updateSaveBar(); }

  function updateSaveBar() {
    const b = $('#saveBar');
    if (b) b.classList.toggle('hidden', !dirty);
  }

  /* ================= الدخول ================= */

  function loginStatus(html, cls) {
    const el = $('#loginStatus');
    if (el) { el.innerHTML = html; el.className = 'small ' + (cls || 'muted'); }
  }

  /* ------- قراءة الرابط: الدور والفلاتر المبدئية ------- */
  function readUrl() {
    let q;
    try { q = new URLSearchParams(location.search); } catch (e) { return {}; }
    const rq = q.get('role');
    role = (rq === 'sup' || rq === 'view') ? rq : 'admin';
    locked = q.get('lock') === '1';
    const f = {
      period: q.get('period') || '',
      game: q.get('game') || '',
      sup: q.get('sup') ? decodeURIComponent(q.get('sup')) : ''
    };
    if (f.period || f.game || f.sup) {
      filters = f;
      // الرابط اللي الأدمن عمله باسم مشرف معيّن = ده هو صاحب الجهاز ده
      if (f.sup) { try { localStorage.setItem('funday.myName', f.sup); } catch (e) { } }
    } else {
      try { filters = JSON.parse(localStorage.getItem('funday.filters') || 'null') || filters; }
      catch (e) { }
    }
    return { key: q.get('k') || '' };
  }

  function saveFilters() {
    try { localStorage.setItem('funday.filters', JSON.stringify(filters)); } catch (e) { }
  }

  const RANK = { view: 1, sup: 2, admin: 3 };

  function checkPassword(val) {
    const admin = String(doc.config.password || '5555');
    const sup = String(doc.config.supervisorPassword || '');
    const view = String(doc.config.viewPassword || '');
    if (val === admin) return 'admin';
    // كل دور له كلمة سره — رابط العرض ما بيحملش كلمة سر المشرفين أبداً
    if (role === 'sup' && sup && val === sup) return 'sup';
    if (role === 'view') {
      if (view && val === view) return 'view';
      if (!view) return 'view';           // مفيش كلمة سر للعرض = مفتوح
      if (sup && val === sup) return 'view';   // كلمة سر المشرف تنفع للعرض كمان
    }
    return null;
  }

  async function boot() {
    const urlInfo = readUrl();
    API.Backend.load();
    if (!API.Backend.connected) loginStatus('يشتغل على الجهاز — من غير ربط بجوجل شيت');
    if (role !== 'admin') {
      const hint = $('#loginHint');
      if (hint) hint.textContent = 'اكتب كلمة سر المشرفين';
    }

    try {
      doc = await API.pull();
      loginStatus(API.Backend.connected
        ? '✅ متصل بجوجل شيت' : 'البيانات محفوظة على الجهاز');
    } catch (e) {
      doc = API.localSnapshot();
      if (API.Backend.connected) {
        loginStatus('⚠️ مفيش اتصال بجوجل شيت — شغّال على آخر نسخة محفوظة');
        toast('مقدرتش أوصل لجوجل شيت — شغّال على النسخة المحلية', 'bad');
      }
    }
    const title = doc.config.title || 'اليوم الترفيهي';
    const suffix = role === 'sup' ? ' — المشرفين' : role === 'view' ? ' — عرض' : '';
    $('#loginTitle').textContent = title + suffix;
    document.title = title + (suffix || ' — منظّم الجدول');

    /* رابط العرض من غير كلمة سر = يفتح على طول */
    if (role === 'view' && !String(doc.config.viewPassword || '')) {
      API.session.set({ ok: true, role: 'view', at: Date.now() });
      showApp(); return;
    }

    /* دخول مباشر لو الرابط فيه كلمة السر */
    if (urlInfo.key) {
      const r = checkPassword(urlInfo.key);
      if (r) { API.session.set({ ok: true, role: r, at: Date.now() }); showApp(); return; }
      loginStatus('⚠️ كلمة السر اللي في الرابط مش مظبوطة', 'small');
    }

    const sess = API.session.get();
    if (sess && sess.ok) {
      // مينفعش حد يترقّى لدور أعلى بمجرد تغيير الرابط
      if (RANK[role] > RANK[sess.role || 'view']) { API.session.clear(); showLogin(); return; }
      showApp();
    } else showLogin();
  }

  function showLogin() {
    $('#login').classList.remove('hidden');
    $('#shell').classList.add('hidden');
    document.body.classList.add('no-nav');
    setTimeout(function () { $('#loginPass').focus(); }, 150);
  }

  function showApp() {
    $('#login').classList.add('hidden');
    $('#shell').classList.remove('hidden');

    const allowed = {
      admin: ['supervisor', 'board', 'schedule', 'results', 'setup'],
      sup: ['supervisor'],
      view: ['board', 'schedule', 'results']
    }[role];

    Array.prototype.forEach.call(document.querySelectorAll('#tabbar button'), function (b) {
      b.classList.toggle('hidden', allowed.indexOf(b.dataset.tab) === -1);
    });

    if (role === 'sup') {
      // المشرف بيشوف شاشة واحدة بس — من غير تبويبات
      tab = 'supervisor';
      $('#tabbar').classList.add('hidden');
      document.body.classList.add('no-nav');
    } else {
      $('#tabbar').classList.remove('hidden');
      document.body.classList.remove('no-nav');
      if (allowed.indexOf(tab) === -1) tab = allowed[0];
      if (role === 'admin' && !doc.schedule.length && (!doc.teams.length || !doc.periods.length)) tab = 'setup';
    }
    render();
    startPolling();
  }

  $('#loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    const val = $('#loginPass').value.trim();
    const r = checkPassword(val);
    if (r) {
      API.session.set({ ok: true, role: r, at: Date.now() });
      $('#loginErr').classList.add('hidden');
      showApp();
    } else {
      $('#loginErr').classList.remove('hidden');
      $('#loginPass').value = '';
      $('#loginPass').focus();
    }
  });

  /* ================= التحديث الدوري ================= */

  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(async function () {
      if (!API.Backend.connected || dirty || working) return;
      if (['supervisor', 'board', 'results'].indexOf(tab) === -1) return;
      if (document.hidden) return;
      // ما نعيدش الرسم والمشرف بيكتب — بيضيّع اللي في إيده
      const ae = document.activeElement;
      if (ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return;
      try {
        const fresh = await API.pull();
        doc = fresh;
        render();
      } catch (e) { /* تجاهل بهدوء */ }
      // ٤٥ ثانية: كفاية للمتابعة، ومش بتستنزف بطارية الموبايلات ولا حصة السكربت
    }, 45000);

    clearInterval(clockTimer);
    clockTimer = setInterval(function () {
      const c = $('#liveClock'); if (c) c.textContent = clockText();
      if (tab === 'board' || tab === 'supervisor') render();
    }, 30000);
  }

  /* ================= التنقّل ================= */

  $('#tabbar').addEventListener('click', function (e) {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    compare = null;
    window.scrollTo(0, 0);
    render();
  });

  $('#btnRefresh').addEventListener('click', async function () {
    if (dirty && !confirm('فيه تعديلات لسه ماتحفظتش. تحدّث وتلغيها؟')) return;
    try { doc = await API.pull(); dirty = false; render(); toast('اتحدّث'); }
    catch (e) { toast(e.message, 'bad'); }
  });

  function render() {
    $('#appTitle').textContent = doc.config.title || 'اليوم الترفيهي';
    const chip = $('#backendChip');
    if (API.Backend.connected) { chip.textContent = 'جوجل شيت'; chip.className = 'chip on'; }
    else { chip.textContent = 'محلي'; chip.className = 'chip off'; }

    Array.prototype.forEach.call(document.querySelectorAll('#tabbar button'), function (b) {
      b.classList.toggle('active', b.dataset.tab === tab);
    });

    const v = $('#view');
    if (tab === 'setup') v.innerHTML = viewSetup();
    else if (tab === 'schedule') v.innerHTML = viewSchedule();
    else if (tab === 'supervisor') v.innerHTML = viewSupervisor();
    else if (tab === 'results') v.innerHTML = viewResults();
    else if (tab === 'board') v.innerHTML = viewBoard();
    restoreDrafts();
    updateSaveBar();
  }

  /* الأرقام اللي المشرف كاتبها لازم تعيش بعد أي إعادة رسم (تحديث تلقائي مثلاً) */
  function restoreDrafts() {
    Object.keys(scoreDraft).forEach(function (k) {
      const p = k.split('|');
      const el = document.querySelector('.sc[data-id="' + p[0] + '"][data-side="' + p[1] + '"]');
      if (el && scoreDraft[k] !== '') el.value = scoreDraft[k];
    });
  }

  function clearDraft(id) {
    delete scoreDraft[id + '|a'];
    delete scoreDraft[id + '|b'];
  }

  /* ================= شاشة الإعداد ================= */

  function viewSetup() {
    const a = S.analyze(doc);
    const src = { config: 'من ملف المشروع', link: 'من الرابط', manual: 'محفوظ في الجهاز', none: '' }[API.Backend.source] || '';

    let h = '';

    /* --- تحذير: تعديل الإعدادات بعد توليد الجدول --- */
    if (doc.schedule.length) {
      h += '<div class="alert warn">فيه جدول متولّد بالفعل (' + ar(doc.schedule.length) + ' مباراة). ' +
        'أي تعديل في الفرق أو الألعاب هنا <b>مش هيغيّر الجدول لوحده</b> — لازم تروح لصفحة الجدول ' +
        'وتعمل «إعادة توليد» بعد ما تخلّص.</div>';
    }

    /* --- الاتصال --- */
    h += '<div class="card">' +
      '<div class="card-head"><h2>🔗 الربط بجوجل شيت</h2>' +
      '<span class="chip ' + (API.Backend.connected ? 'on' : 'off') + '">' +
      (API.Backend.connected ? 'متصل ' + esc(src) : 'غير متصل') + '</span></div>' +
      '<div class="field"><label>رابط النشر بتاع Apps Script (بينتهي بـ /exec)</label>' +
      '<input id="apiUrl" type="url" dir="ltr" placeholder="https://script.google.com/macros/s/.../exec" value="' + esc(API.Backend.url) + '"></div>' +
      '<div class="btn-row">' +
      '<button class="btn primary" data-action="api-save">حفظ واختبار</button>' +
      '<button class="btn" data-action="api-share">نسخ رابط المشاركة</button>' +
      '</div>' +
      '<p class="small muted" style="margin-top:10px">من غير الربط التطبيق شغّال على جهازك بس. مع الربط كل المشرفين بيشوفوا نفس الجدول لايف. خطوات الإعداد في ملف <code>README.md</code>.</p>' +
      '</div>';

    /* --- إعدادات عامة --- */
    h += '<div class="card">' +
      '<div class="card-head"><h2>⚙️ إعدادات عامة</h2></div>' +
      '<div class="grid2">' +
      '<div class="field"><label>اسم اليوم</label><input data-path="config.title" value="' + esc(doc.config.title) + '"></div>' +
      '<div class="field"><label>كلمة السر</label><input data-path="config.password" value="' + esc(doc.config.password) + '"></div>' +
      '</div>' +
      '<div class="grid3">' +
      '<div class="field"><label>نقاط الفوز</label><input type="number" inputmode="numeric" data-path="config.pointsWin" value="' + esc(doc.config.pointsWin) + '"></div>' +
      '<div class="field"><label>نقاط التعادل</label><input type="number" inputmode="numeric" data-path="config.pointsDraw" value="' + esc(doc.config.pointsDraw) + '"></div>' +
      '<div class="field"><label>نقاط الخسارة</label><input type="number" inputmode="numeric" data-path="config.pointsLoss" value="' + esc(doc.config.pointsLoss) + '"></div>' +
      '</div>' +
      '<p class="small muted">كلمة السر دي للأدمن — الصفحة دي كلها. المشرفين ليهم كلمة سر تانية تحت 👇</p>' +
      '</div>';

    /* --- رابط المشرفين --- */
    h += supervisorLinkCard();

    /* --- الفرق --- */
    h += '<div class="card">' +
      '<div class="card-head"><h2>👥 الفرق</h2><span class="chip">' + ar(doc.teams.length) + '</span></div>' +
      '<div class="pill-row">' +
      [4, 6, 8, 10, 12].map(function (n) {
        return '<button class="btn sm" data-action="teams-quick" data-n="' + n + '">' + ar(n) + ' فرق</button>';
      }).join('') +
      '</div><div class="spacer"></div><div class="list">' +
      doc.teams.map(function (t, i) {
        return '<div class="row-item">' +
          '<span class="idx">' + ar(i + 1) + '</span>' +
          '<input data-path="teams.' + i + '.name" value="' + esc(t.name) + '" placeholder="اسم الفريق">' +
          '<button class="icon-btn danger" data-action="team-del" data-i="' + i + '">✕</button>' +
          '</div>';
      }).join('') +
      '</div><div class="spacer"></div>' +
      '<button class="btn block" data-action="team-add">➕ إضافة فريق</button>' +
      (doc.teams.length % 2 === 1 ? '<div class="alert warn" style="margin-top:10px">عدد الفرق فردي — هيكون فيه فريق «بدون منافس» في كل لعبة. يفضّل عدد زوجي.</div>' : '') +
      '</div>';

    /* --- الفترات والألعاب --- */
    h += '<div class="card"><div class="card-head"><h2>🕐 الفترات والألعاب</h2></div>';
    if (!doc.periods.length) {
      h += '<p class="muted small">لسه مفيش فترات. ابدأ بإضافة فترة (مثلاً من ١٠:٠٠ لـ ١٢:٠٠).</p>';
    }
    doc.periods.forEach(function (p, pi) {
      const info = a.periods[pi] || {};
      const okBadge = info.ok
        ? '<span class="chip on">' + ar(info.slotCount) + ' جولة ✓</span>'
        : '<span class="chip off">محتاجة ' + ar(info.requiredSlots || 0) + ' جولة</span>';
      h += '<div class="card tight" style="background:var(--card2)">' +
        '<div class="card-head">' +
        '<input data-path="periods.' + pi + '.name" value="' + esc(p.name) + '" style="flex:1;min-width:120px" placeholder="اسم الفترة">' +
        okBadge +
        '<button class="icon-btn danger" data-action="period-del" data-p="' + pi + '">✕</button>' +
        '</div>' +
        '<div class="grid2">' +
        '<div class="field"><label>من الساعة</label><input type="time" data-recalc data-path="periods.' + pi + '.start" value="' + esc(p.start) + '"></div>' +
        '<div class="field"><label>لغاية الساعة</label><input type="time" data-recalc data-path="periods.' + pi + '.end" value="' + esc(p.end) + '"></div>' +
        '<div class="field"><label>مدة اللعبة (دقيقة)</label><input type="number" inputmode="numeric" min="1" data-recalc data-path="periods.' + pi + '.gameMinutes" value="' + esc(p.gameMinutes) + '"></div>' +
        '<div class="field"><label>راحة بين الجولات</label><input type="number" inputmode="numeric" min="0" data-recalc data-path="periods.' + pi + '.breakMinutes" value="' + esc(p.breakMinutes || 0) + '"></div>' +
        '</div>' +
        '<h3>ألعاب الفترة (' + ar((p.games || []).length) + ')</h3>' +
        '<div class="list">' +
        (p.games || []).map(function (g, gi) {
          return '<div class="row-item" style="flex-wrap:wrap">' +
            '<span class="idx">' + ar(gi + 1) + '</span>' +
            '<input data-path="periods.' + pi + '.games.' + gi + '.name" value="' + esc(g.name) + '" placeholder="اسم اللعبة" style="flex:2 1 130px">' +
            '<button class="icon-btn danger" data-action="game-del" data-p="' + pi + '" data-g="' + gi + '">✕</button>' +
            '<input data-path="periods.' + pi + '.games.' + gi + '.place" value="' + esc(g.place || '') + '" placeholder="المكان" style="flex:1 1 110px">' +
            '<input data-path="periods.' + pi + '.games.' + gi + '.supervisor" value="' + esc(g.supervisor || '') + '" placeholder="المشرف" style="flex:1 1 110px">' +
            '</div>';
        }).join('') +
        '</div><div class="spacer"></div>' +
        '<button class="btn sm block" data-action="game-add" data-p="' + pi + '">➕ إضافة لعبة</button>' +
        '</div>';
    });
    h += '<div class="spacer"></div><button class="btn block" data-action="period-add">➕ إضافة فترة</button></div>';

    /* --- إعادة الضبط --- */
    h += resetCard();

    /* --- شريط الحفظ --- */
    h += '<div id="saveBar" class="card ' + (dirty ? '' : 'hidden') + '" style="position:sticky;bottom:8px;z-index:30">' +
      '<div class="btn-row">' +
      '<button class="btn primary big" data-action="save-setup">💾 حفظ الإعدادات</button>' +
      '</div></div>';

    return h;
  }

  /* ================= إعادة الضبط ليوم جديد ================= */

  function resetCard() {
    const n = doc.schedule.length;
    const done = doc.schedule.filter(function (r) { return r.status === 'done'; }).length;
    const games = allGames().length;

    let h = '<div class="card"><div class="card-head"><h2>♻️ يوم جديد</h2></div>' +
      '<p class="small muted">خلّصت اليوم وعايز تبدأ يوم تاني؟ اختار مستوى المسح اللي يناسبك. ' +
      (n ? 'التطبيق هينزّل لك <b>نسخة CSV</b> من اليوم الحالي قبل ما يمسح.' : '') + '</p>';

    if (!n && !doc.teams.length && !games) {
      return h + '<div class="alert">مفيش حاجة تتمسح — التطبيق فاضي أصلاً.</div></div>';
    }

    h += '<div class="list">';

    if (n) {
      h += '<div class="row-item" style="flex-direction:column;align-items:stretch;gap:6px">' +
        '<div><b>١ · مسح النتائج بس</b>' +
        '<div class="small muted">الجدول والمواعيد يفضلوا زي ما هم، وبس التأكيدات والدرجات تتمسح. ' +
        'مفيد لو هتعيد نفس اليوم بنفس التوزيع.</div></div>' +
        '<button class="btn sm warn block" data-action="reset-results">مسح ' + ar(done) + ' تأكيد ودرجاتهم</button>' +
        '</div>';

      h += '<div class="row-item" style="flex-direction:column;align-items:stretch;gap:6px">' +
        '<div><b>٢ · مسح الجدول</b>' +
        '<div class="small muted">الفرق والفترات والألعاب يفضلوا، والجدول بس يتمسح عشان تولّد توزيع جديد.</div></div>' +
        '<button class="btn sm warn block" data-action="reset-schedule">مسح الجدول (' + ar(n) + ' مباراة)</button>' +
        '</div>';
    }

    h += '<div class="row-item" style="flex-direction:column;align-items:stretch;gap:6px">' +
      '<div><b>٣ · يوم جديد من الصفر</b>' +
      '<div class="small muted">يمسح الفرق والفترات والألعاب والجدول كله. ' +
      'كلمات السر وإعدادات النقاط بتفضل زي ما هي.</div></div>' +
      '<button class="btn sm danger block" data-action="reset-all">🆕 ابدأ يوم جديد من الصفر</button>' +
      '</div>';

    h += '</div>';

    if (API.Backend.connected) {
      h += '<p class="small muted" style="margin-top:10px">المسح بيتم على جوجل شيت كمان. ' +
        'لو عايز تحتفظ باليوم في الشيت نفسه، افتح الشيت واختار من قائمة ' +
        '«🏆 اليوم الترفيهي ▸ 📦 أرشفة اليوم» قبل ما تمسح.</p>';
    }
    return h + '</div>';
  }

  /* ================= رابط المشرفين (للأدمن) ================= */

  function supLink(opt) {
    opt = opt || {};
    const p = [];
    // لو التطبيق نفسه اتفتح برابط فيه api، ورّثه للمشرفين
    if (API.Backend.source === 'link' && API.Backend.url) p.push('api=' + encodeURIComponent(API.Backend.url));
    p.push('role=' + (opt.view ? 'view' : 'sup'));
    if (opt.lock) p.push('lock=1');
    // مهم: رابط العرض بياخد كلمة سر العرض بس — عمره ما يحمل كلمة سر المشرفين
    const key = opt.view ? doc.config.viewPassword : doc.config.supervisorPassword;
    if (opt.withKey && key) p.push('k=' + encodeURIComponent(key));
    if (opt.sup) p.push('sup=' + encodeURIComponent(opt.sup));
    if (opt.period) p.push('period=' + encodeURIComponent(opt.period));
    if (opt.game) p.push('game=' + encodeURIComponent(opt.game));
    return location.origin + location.pathname + '?' + p.join('&');
  }

  function supervisorLinkCard() {
    const sups = allSupervisors();
    const games = allGames();

    let h = '<div class="card"><div class="card-head"><h2>🔗 رابط المشرفين</h2>' +
      '<span class="chip">' + ar(sups.length) + ' مشرف</span></div>' +
      '<p class="small muted">رابط منفصل بيفتح شاشة التأكيد وتسجيل الدرجات بس — من غير الإعدادات ولا الجدول ولا النتائج.</p>' +

      '<div class="field"><label>كلمة سر المشرفين (انت اللي بتحطها)</label>' +
      '<input data-path="config.supervisorPassword" value="' + esc(doc.config.supervisorPassword || '') + '" placeholder="مثلاً 1234"></div>';

    if (!doc.config.supervisorPassword) {
      h += '<div class="alert warn">حط كلمة سر للمشرفين الأول، وبعدين احفظ الإعدادات.</div>';
    }
    if (String(doc.config.supervisorPassword || '') === String(doc.config.password || '')) {
      h += '<div class="alert warn">كلمة سر المشرفين زي بتاعة الأدمن — يبقى أي مشرف يقدر يدخل صفحتك. خليها مختلفة.</div>';
    }

    h += '<h3>الرابط العام (كل المشرفين)</h3>' +
      '<div class="btn-row">' +
      '<button class="btn primary" data-action="copy-link" data-key="1">📋 نسخ رابط بدخول مباشر</button>' +
      '<button class="btn" data-action="copy-link">نسخ رابط يطلب كلمة السر</button>' +
      '</div>' +
      '<p class="small muted" style="margin-top:8px">«دخول مباشر» بيحط كلمة السر جوه الرابط — أسهل للمشرفين، بس أي حد ياخد الرابط يدخل من غير ما يسأل.</p>';

    if (sups.length) {
      h += '<h3 style="margin-top:14px">رابط مخصّص لكل مشرف 🔒</h3>' +
        '<p class="small muted">بيفتح على مبارياته هو بس، ومفيش خيار يختار مشرف تاني. ' +
        'أي تأكيد بيتسجّل باسمه تلقائياً.</p><div class="list">' +
        sups.map(function (s) {
          return '<div class="row-item">' +
            '<span style="flex:1;font-weight:600">' + esc(s) + '</span>' +
            '<button class="btn sm" data-action="copy-link" data-key="1" data-lock="1" data-sup="' + esc(s) + '">📋 نسخ</button>' +
            '</div>';
        }).join('') + '</div>';
    } else if (games.length) {
      h += '<div class="alert" style="margin-top:12px">لو كتبت اسم المشرف جنب كل لعبة تحت، هيظهر لك هنا رابط مخصّص لكل واحد فيهم.</div>';
    }

    if (games.length) {
      h += '<details style="margin-top:12px"><summary class="small">رابط مخصّص لكل لعبة</summary><div class="list" style="margin-top:8px">' +
        games.map(function (g) {
          return '<div class="row-item">' +
            '<span style="flex:1"><b>' + esc(g.name) + '</b><br><span class="small muted">' + esc(g.period) + '</span></span>' +
            '<button class="btn sm" data-action="copy-link" data-key="1" data-lock="1" data-game="' + esc(g.id) + '" data-period="' + esc(g.periodId) + '">📋 نسخ</button>' +
            '</div>';
        }).join('') + '</div></details>';
    }

    h += '<div class="alert" style="margin-top:12px">الروابط المخصّصة عليها 🔒 يعني مقفولة — المشرف مش هيقدر يغيّرها. ' +
      'الرابط العام فوق مفتوح والمشرف بيختار منه بنفسه.</div>';
    h += '</div>';

    /* --- رابط العرض فقط --- */
    h += '<div class="card"><div class="card-head"><h2>👁️ رابط العرض فقط</h2></div>' +
      '<p class="small muted">بيوري <b>كل التفاصيل</b> — الجدول كامل وشاشة العرض وترتيب الفرق — ' +
      'من غير أي إمكانية تعديل خالص. مفيش تأكيد ولا درجات ولا تأخير ولا إعدادات. ' +
      'مناسب للمشاركين أو أي حد عايز يتفرّج بس.</p>' +
      '<div class="field"><label>كلمة سر العرض (سيبها فاضية = يفتح من غير كلمة سر)</label>' +
      '<input data-path="config.viewPassword" value="' + esc(doc.config.viewPassword || '') + '" placeholder="فاضية = مفتوح للكل"></div>' +
      '<div class="btn-row">' +
      '<button class="btn primary block" data-action="copy-link" data-key="1" data-view="1">📋 نسخ رابط العرض</button>' +
      '</div>' +
      '<p class="small muted" style="margin-top:8px">الرابط ده <b>مش بيحمل كلمة سر المشرفين</b>، ' +
      'فمحدش ياخده يقدر يوصل لشاشة التعديل.</p>' +
      '</div>';

    return h;
  }

  /* ================= شاشة الجدول ================= */

  function analysisPanel(a) {
    let h = '<div class="card"><div class="card-head"><h2>📐 فحص الأرقام</h2></div>';
    h += '<div class="stats">' +
      '<div class="stat"><div class="v">' + ar(a.teamCount) + '</div><div class="k">فريق</div></div>' +
      '<div class="stat"><div class="v">' + ar(a.totalGames) + '</div><div class="k">لعبة</div></div>' +
      '<div class="stat"><div class="v">' + ar(a.totalSlots) + '</div><div class="k">جولة</div></div>' +
      '<div class="stat ' + (a.minRepeatsPerTeam ? 'warn' : 'ok') + '"><div class="v">' + ar(a.minRepeatsPerTeam) + '</div><div class="k">أقل تكرار ممكن</div></div>' +
      '</div>';

    if (a.problems.length) {
      h += '<div class="alert bad" style="margin-top:12px"><b>لازم تظبط ده الأول:</b><ul>' +
        a.problems.map(function (p) { return '<li>' + arDigits(esc(p)) + '</li>'; }).join('') + '</ul></div>';
    }
    if (a.notes.length) {
      h += '<div class="alert" style="margin-top:10px"><b>معلومات:</b><ul>' +
        a.notes.map(function (p) { return '<li>' + arDigits(esc(p)) + '</li>'; }).join('') + '</ul></div>';
    }
    if (a.teamCount >= 2 && a.totalGames > 0) {
      h += a.noRepeatPossible
        ? '<div class="alert good">ممكن نعمل جدول من غير أي تكرار مواجهات: ' + ar(a.totalGames) +
        ' لعبة و' + ar(a.maxDistinctOpponents) + ' خصم متاح لكل فريق.</div>'
        : '<div class="alert warn"><b>تنبيه رياضي:</b> كل فريق هيلعب ' + ar(a.totalGames) +
        ' مباراة، ومتاح له ' + ar(a.maxDistinctOpponents) + ' خصم مختلف بس. يعني كل فريق لازم يقابل ' +
        ar(a.minRepeatsPerTeam) + ' فريق مرتين على الأقل — مفيش حل يمنع ده. ' +
        'لو عايز صفر تكرار: خلّي عدد الألعاب الكلي ' + ar(a.maxDistinctOpponents) + ' أو أقل، أو زوّد عدد الفرق.</div>';
    }
    h += '</div>';
    return h;
  }

  function optionCard(res, title, subtitle, key) {
    let h = '<div class="card"><div class="card-head"><h2>' + esc(title) + '</h2></div>' +
      '<p class="small muted">' + esc(subtitle) + '</p>';
    if (!res.ok) {
      h += '<div class="alert bad">' + arDigits(esc(res.message || 'مفيش حل ممكن بالأرقام الحالية.')) + '</div></div>';
      return h;
    }
    const st = res.stats;
    h += '<div class="stats">' +
      '<div class="stat"><div class="v">' + ar(st.totalMatches) + '</div><div class="k">مباراة</div></div>' +
      '<div class="stat ' + (st.repeats ? 'warn' : 'ok') + '"><div class="v">' + ar(st.repeats) + '</div><div class="k">مواجهة مكررة</div></div>' +
      '<div class="stat ok"><div class="v">✓</div><div class="k">كل لعبة مرة</div></div>' +
      '<div class="stat"><div class="v">' + ar(st.restSpread) + '</div><div class="k">فرق الراحة</div></div>' +
      '</div>';
    if (st.repeats === 0) h += '<div class="alert good" style="margin-top:10px">كل فريق هيقابل خصم مختلف في كل مباراة. 🎯</div>';
    else if (st.isOptimal) h += '<div class="alert good" style="margin-top:10px">' + ar(st.repeats) + ' تكرار — وده أقل عدد ممكن رياضياً بالأرقام دي. ✔</div>';
    else h += '<div class="alert warn" style="margin-top:10px">أحسن جدول لقيته فيه ' + ar(st.repeats) + ' تكرار. ' +
      'الحد النظري ' + ar(st.minRepeatsPossible) + '، بس هو مش دايماً قابل للتحقيق — في تركيبات معيّنة (زي ٤ أو ٦ فرق) بيكون مستحيل رياضياً توصل له.</div>';

    if (st.repeatPairs.length) {
      h += '<details style="margin-top:8px"><summary class="small">شوف المواجهات المكررة (' + ar(st.repeatPairs.length) + ')</summary>' +
        '<ul class="small muted">' + st.repeatPairs.slice(0, 25).map(function (r) {
          return '<li>' + esc(r.a) + ' × ' + esc(r.b) + ' — ' + ar(r.times) + ' مرات</li>';
        }).join('') + '</ul></details>';
    }
    h += '<div class="spacer"></div><button class="btn primary block big" data-action="adopt" data-key="' + key + '">اعتمد الجدول ده</button></div>';
    return h;
  }

  function viewSchedule() {
    const a = S.analyze(doc);
    let h = analysisPanel(a);

    if (compare) {
      h += '<div class="alert">اختار الجدول اللي يناسبك:</div>';
      h += optionCard(compare.balanced, '① كل لعبة مرة + أقل تكرار',
        'ضمان أكيد إن كل فريق يلعب كل لعبة مرة واحدة، والتكرار في المواجهات أقل ما يمكن.', 'balanced');
      h += optionCard(compare.strict, '② صفر تكرار مواجهات',
        'كل فريق يقابل خصم مختلف في كل مباراة — مع ضمان كل لعبة مرة واحدة كمان.', 'strict');
      h += '<button class="btn ghost block" data-action="cancel-compare">إلغاء</button>';
      return h;
    }

    if (!doc.schedule.length) {
      h += '<div class="card center">' +
        '<p class="muted">لسه مفيش جدول.</p>' +
        '<button class="btn primary block big" data-action="compare" ' + (a.feasible ? '' : 'disabled') + '>' +
        (working ? '⏳ بحسب…' : '🎲 احسب الخيارين') + '</button>' +
        (a.feasible ? '<p class="small muted" style="margin-top:8px">هجرّب مئات التوزيعات وأعرض لك أحسن نتيجة لكل خيار.</p>'
          : '<p class="small muted" style="margin-top:8px">ظبّط التحذيرات اللي فوق الأول.</p>') +
        '</div>';
      return h;
    }

    /* الجدول موجود */
    const done = doc.schedule.filter(function (r) { return r.status === 'done'; }).length;
    h += '<div class="card"><div class="card-head"><h2>🗓️ الجدول</h2>' +
      '<span class="chip">' + ar(doc.schedule.length) + ' مباراة</span></div>' +
      '<div class="pill-row">' +
      [['time', 'حسب الوقت'], ['team', 'حسب الفريق'], ['game', 'حسب اللعبة']].map(function (o) {
        return '<button class="btn sm ' + (scheduleView === o[0] ? 'primary' : '') + '" data-action="sv" data-v="' + o[0] + '">' + o[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="spacer"></div>' +
      '<div class="btn-row no-print">' +
      '<button class="btn sm" data-action="print">🖨️ طباعة</button>' +
      '<button class="btn sm" data-action="csv">⬇️ CSV</button>' +
      (role === 'admin' ? '<button class="btn sm danger" data-action="regen">♻️ إعادة توليد</button>' : '') +
      '</div>' +
      (role === 'admin' && done ? '<div class="alert warn" style="margin-top:10px">' + ar(done) + ' مباراة اتأكدت خلاص — إعادة التوليد هتمسحها.</div>' : '') +
      '</div>';

    if (scheduleView === 'time') h += tableByTime();
    else if (scheduleView === 'team') h += tableByTeam();
    else h += tableByGame();

    return h;
  }

  function slotsOf() {
    const map = new Map();
    doc.schedule.forEach(function (r) {
      const k = r.periodId + '|' + r.round;
      if (!map.has(k)) map.set(k, { key: k, periodName: r.periodName, round: r.round, start: r.start, end: r.end, startMin: r.startMin });
    });
    return Array.from(map.values()).sort(function (x, y) { return x.startMin - y.startMin; });
  }

  function tableByTime() {
    const slots = slotsOf();
    let h = '';
    slots.forEach(function (s) {
      const rows = doc.schedule.filter(function (r) { return r.periodId + '|' + r.round === s.key; });
      h += '<div class="card tight"><div class="card-head">' +
        '<h2>' + tm(s.start) + ' – ' + tm(s.end) + '</h2>' +
        '<span class="chip">' + esc(s.periodName) + ' • جولة ' + ar(s.round) + '</span></div>' +
        '<div class="table-wrap"><table><thead><tr><th>اللعبة</th><th>الفريق الأول</th><th>الفريق التاني</th><th>الحالة</th></tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr><td class="cell-game"><b>' + esc(r.gameName) + '</b>' +
            (r.place ? '<br><span class="muted small">' + esc(r.place) + '</span>' : '') + '</td>' +
            '<td>' + esc(r.teamA) + '</td><td>' + esc(r.teamB) + '</td>' +
            '<td>' + statusBadge(r) + '</td></tr>';
        }).join('') +
        '</tbody></table></div></div>';
    });
    return h;
  }

  function tableByTeam() {
    const slots = slotsOf();
    let h = '<div class="card tight"><div class="card-head"><h2>مصفوفة الفرق × الجولات</h2></div>' +
      '<div class="table-wrap"><table class="matrix"><thead><tr><th>الفريق</th>' +
      slots.map(function (s) { return '<th>' + tm(s.start) + '</th>'; }).join('') +
      '</tr></thead><tbody>';
    doc.teams.forEach(function (t) {
      h += '<tr><td><b>' + esc(t.name) + '</b></td>';
      slots.forEach(function (s) {
        const m = doc.schedule.find(function (r) {
          return r.periodId + '|' + r.round === s.key && (r.teamAId === t.id || r.teamBId === t.id);
        });
        if (!m) { h += '<td class="rest">راحة</td>'; return; }
        const opp = m.teamAId === t.id ? m.teamB : m.teamA;
        h += '<td><span class="g">' + esc(m.gameName) + '</span><span class="o">ضد ' + esc(opp) + '</span></td>';
      });
      h += '</tr>';
    });
    h += '</tbody></table></div><p class="small muted" style="margin-top:8px">مرّر الجدول بأصبعك يمين وشمال.</p></div>';
    return h;
  }

  function tableByGame() {
    let h = '';
    doc.periods.forEach(function (p) {
      (p.games || []).forEach(function (g) {
        const rows = doc.schedule.filter(function (r) { return r.gameId === g.id; })
          .sort(function (x, y) { return x.startMin - y.startMin; });
        if (!rows.length) return;
        h += '<div class="card tight"><div class="card-head"><h2>' + esc(g.name) + '</h2>' +
          '<span class="chip">' + esc(p.name) + '</span></div>' +
          (g.place || g.supervisor ? '<p class="small muted">' +
            (g.place ? '📍 ' + esc(g.place) + ' ' : '') +
            (g.supervisor ? '👤 ' + esc(g.supervisor) : '') + '</p>' : '') +
          '<div class="table-wrap"><table><thead><tr><th>الوقت</th><th>الفريقين</th><th>الحالة</th></tr></thead><tbody>' +
          rows.map(function (r) {
            return '<tr><td>' + tm(r.start) + '</td><td>' + esc(r.teamA) + ' × ' + esc(r.teamB) + '</td><td>' + statusBadge(r) + '</td></tr>';
          }).join('') + '</tbody></table></div></div>';
      });
    });
    return h;
  }

  function statusBadge(r) {
    if (r.status === 'done') {
      const sc = (r.scoreA !== '' && r.scoreB !== '') ? ' ' + esc(r.scoreA) + '–' + esc(r.scoreB) : '';
      return '<span class="badge done">تمّت' + sc + '</span>';
    }
    const n = nowMin();
    if (n >= r.startMin && n < r.endMin) return '<span class="badge now">جارية</span>';
    if (n >= r.endMin) return '<span class="badge" style="color:var(--warn)">متأخرة</span>';
    return '<span class="badge">لسه</span>';
  }

  /* ================= شاشة المشرف ================= */

  function allGames() {
    const out = [];
    doc.periods.forEach(function (p) {
      (p.games || []).forEach(function (g) {
        out.push({
          id: g.id, name: g.name, periodId: p.id, period: p.name,
          place: g.place, supervisor: g.supervisor
        });
      });
    });
    return out;
  }

  /* أسماء المشرفين المسجّلة على الألعاب */
  function allSupervisors() {
    const set = {};
    allGames().forEach(function (g) { if (g.supervisor && String(g.supervisor).trim()) set[String(g.supervisor).trim()] = 1; });
    doc.schedule.forEach(function (r) { if (r.supervisor && String(r.supervisor).trim()) set[String(r.supervisor).trim()] = 1; });
    return Object.keys(set).sort(function (a, b) { return a.localeCompare(b, 'ar'); });
  }

  function filteredRows() {
    return doc.schedule.filter(function (r) {
      if (filters.period && r.periodId !== filters.period) return false;
      if (filters.game && r.gameId !== filters.game) return false;
      if (filters.sup && String(r.supervisor || '').trim() !== filters.sup) return false;
      return true;
    }).sort(function (x, y) { return x.startMin - y.startMin; });
  }

  function viewSupervisor() {
    if (!doc.schedule.length) {
      return '<div class="card center"><p class="muted">لسه مفيش جدول متولّد.</p>' +
        (role === 'admin'
          ? '<button class="btn primary block" data-action="goto" data-tab="schedule">روح لصفحة الجدول</button>'
          : '<p class="small muted">الأدمن لسه معملش الجدول. جرّب تاني بعد شوية.</p>' +
            '<button class="btn block" data-action="reload">↻ تحديث</button>') +
        '</div>';
    }

    const games = allGames();
    const sups = allSupervisors();
    const myName = localStorage.getItem('funday.myName') || filters.sup || '';

    // لو الفلتر على فترة، خلّي قائمة الألعاب بتاعتها بس
    const gamesForPeriod = games.filter(function (g) { return !filters.period || g.periodId === filters.period; });
    if (filters.game && !gamesForPeriod.some(function (g) { return g.id === filters.game; })) filters.game = '';

    function opts(list, cur, allLabel) {
      return '<option value="">' + allLabel + '</option>' + list.map(function (o) {
        return '<option value="' + esc(o.v) + '"' + (String(o.v) === String(cur) ? ' selected' : '') + '>' + esc(o.t) + '</option>';
      }).join('');
    }

    const lockSup = locked && !!filters.sup;
    const lockPeriod = locked && !!filters.period;
    const lockGame = locked && !!filters.game;

    let h = '<div class="card">' +
      '<div class="card-head"><h2>✅ ' + (role === 'sup' ? 'شاشة المشرف' : 'المشرف') + '</h2>' +
      '<span class="chip" id="liveClock">' + clockText() + '</span></div>';

    if (lockSup) {
      // رابط مخصّص: الاسم ثابت ومش بيتغيّر، وكل تأكيد بيتسجّل عليه
      h += '<div class="alert good" style="margin-bottom:10px">👤 <b>' + esc(filters.sup) + '</b>' +
        '<div class="small muted" style="margin-top:2px">كل تأكيد هيتسجّل باسمك</div></div>';
    } else {
      h += '<div class="field"><label>المشرف</label><select id="fSup">' +
        opts(sups.map(function (s) { return { v: s, t: s }; }), filters.sup, '— كل المشرفين —') +
        '</select></div>';
    }

    const boxes = [];
    if (lockPeriod) {
      const p = doc.periods.find(function (x) { return x.id === filters.period; });
      if (p) boxes.push('<span class="chip">📅 ' + esc(p.name) + '</span>');
    } else {
      boxes.push('<div class="field"><label>الفترة</label><select id="fPeriod">' +
        opts(doc.periods.map(function (p) { return { v: p.id, t: p.name }; }), filters.period, '— كل الفترات —') +
        '</select></div>');
    }
    if (lockGame) {
      const g = games.find(function (x) { return x.id === filters.game; });
      if (g) boxes.push('<span class="chip">🎮 ' + esc(g.name) + '</span>');
    } else {
      boxes.push('<div class="field"><label>اللعبة</label><select id="fGame">' +
        opts(gamesForPeriod.map(function (g) { return { v: g.id, t: g.name }; }), filters.game, '— كل الألعاب —') +
        '</select></div>');
    }
    const chips = boxes.filter(function (b) { return b.indexOf('<span') === 0; });
    const fields = boxes.filter(function (b) { return b.indexOf('<div') === 0; });
    if (chips.length) h += '<div class="pill-row" style="margin-bottom:8px">' + chips.join('') + '</div>';
    if (fields.length) h += (fields.length > 1 ? '<div class="grid2">' : '') + fields.join('') + (fields.length > 1 ? '</div>' : '');

    if (!lockSup) {
      h += '<div class="field"><label>اسمي (بيتسجّل مع التأكيد)</label>' +
        '<input id="myName" value="' + esc(myName) + '" placeholder="اسم المشرف"></div>';
    }

    if (!locked && (filters.period || filters.game || filters.sup)) {
      h += '<button class="btn sm ghost block" data-action="clear-filters">مسح الفلاتر</button>';
    }
    h += '</div>';

    const rows = filteredRows();
    if (!rows.length) return h + '<div class="card center muted">مفيش مباريات بالفلاتر دي.</div>';

    const n = nowMin();
    const doneCount = rows.filter(function (r) { return r.status === 'done'; }).length;
    h += '<div class="card tight"><div class="card-head"><h2>تقدّمي</h2>' +
      '<span class="chip">' + ar(doneCount) + ' / ' + ar(rows.length) + '</span></div>' +
      '<div class="bar"><i style="width:' + Math.round(doneCount / rows.length * 100) + '%"></i></div></div>';

    rows.forEach(function (r) {
      const isNow = n >= r.startMin && n < r.endMin;
      const late = r.status !== 'done' && n >= r.endMin;
      h += '<div class="match ' + (isNow ? 'now ' : '') + (r.status === 'done' ? 'done' : '') + '">' +
        '<div class="card-head" style="margin-bottom:4px">' +
        '<div><div class="time">' + tm(r.start) + ' – ' + tm(r.end) + '</div>' +
        '<div class="meta">' + esc(r.gameName) + (r.place ? ' • ' + esc(r.place) : '') + ' • جولة ' + ar(r.round) + '</div></div>' +
        (isNow ? '<span class="badge now">دلوقتي</span>' : late ? '<span class="badge" style="color:var(--warn)">متأخرة</span>' : '') +
        '</div>' +
        '<div class="vs"><div class="t">' + esc(r.teamA) + '</div><div class="x">ضد</div><div class="t">' + esc(r.teamB) + '</div></div>';

      if (r.status === 'done') {
        h += '<div class="alert good small" style="margin:0">تمّ التأكيد' +
          (r.confirmedBy ? ' — ' + esc(r.confirmedBy) : '') +
          ((r.scoreA !== '' && r.scoreB !== '') ? ' • النتيجة ' + esc(r.scoreA) + ' – ' + esc(r.scoreB) : '') +
          '</div>' +
          '<div class="spacer"></div><button class="btn sm ghost block" data-action="undo" data-id="' + esc(r.id) + '">تراجع عن التأكيد</button>';
      } else if (!r.solo) {
        h += '<div class="grid2">' +
          '<div class="field"><label>نتيجة ' + esc(r.teamA) + '</label>' +
          '<input type="number" inputmode="numeric" placeholder="0" class="sc" data-id="' + esc(r.id) + '" data-side="a" value="' + esc(r.scoreA) + '"></div>' +
          '<div class="field"><label>نتيجة ' + esc(r.teamB) + '</label>' +
          '<input type="number" inputmode="numeric" placeholder="0" class="sc" data-id="' + esc(r.id) + '" data-side="b" value="' + esc(r.scoreB) + '"></div>' +
          '</div>' +
          '<p class="small muted center" style="margin:-2px 0 8px">الخانة الفاضية بتتسجّل صفر</p>' +
          '<button class="btn good block big" data-action="confirm" data-id="' + esc(r.id) + '">✔ تمّت اللعبة</button>';
      } else {
        h += '<button class="btn good block big" data-action="confirm" data-id="' + esc(r.id) + '">✔ تمّت</button>';
      }
      h += '</div>';
    });

    return h;
  }

  /* ================= شاشة النتائج ================= */

  function leaderboard() {
    const cfg = doc.config;
    const W = Number(cfg.pointsWin) || 0, D = Number(cfg.pointsDraw) || 0, L = Number(cfg.pointsLoss) || 0;
    const map = new Map();
    doc.teams.forEach(function (t) {
      map.set(t.id, { id: t.id, name: t.name, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, noScore: 0 });
    });
    doc.schedule.forEach(function (r) {
      if (r.status !== 'done' || !r.teamAId || !r.teamBId) return;
      const A = map.get(r.teamAId), B = map.get(r.teamBId);
      if (!A || !B) return;
      A.played++; B.played++;
      // الخانة الفاضية بتتحسب صفر
      const sa = numOr0(r.scoreA), sb = numOr0(r.scoreB);
      if (r.scoreA === '' || r.scoreA == null || r.scoreB === '' || r.scoreB == null) { A.noScore++; B.noScore++; }
      A.gf += sa; A.ga += sb; B.gf += sb; B.ga += sa;
      if (sa > sb) { A.w++; B.l++; A.pts += W; B.pts += L; }
      else if (sa < sb) { B.w++; A.l++; B.pts += W; A.pts += L; }
      else { A.d++; B.d++; A.pts += D; B.pts += D; }
    });
    return Array.from(map.values()).sort(function (x, y) {
      return y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || x.name.localeCompare(y.name, 'ar');
    });
  }

  function viewResults() {
    if (!doc.schedule.length) {
      return '<div class="card center"><p class="muted">لسه مفيش جدول.</p>' +
        '<button class="btn primary block" data-action="goto" data-tab="schedule">روح لصفحة الجدول</button></div>';
    }
    const total = doc.schedule.length;
    const done = doc.schedule.filter(function (r) { return r.status === 'done'; }).length;
    const n = nowMin();
    const late = doc.schedule.filter(function (r) { return r.status !== 'done' && n >= r.endMin; });

    let h = '<div class="card"><div class="card-head"><h2>📊 متابعة اليوم</h2>' +
      '<span class="chip" id="liveClock">' + clockText() + '</span></div>' +
      '<div class="bar"><i style="width:' + Math.round(done / total * 100) + '%"></i></div>' +
      '<p class="small muted" style="margin-top:8px">' + ar(done) + ' من ' + ar(total) + ' مباراة اتأكدت' +
      (doc.config.shiftMinutes ? ' • الجدول متأخر ' + ar(doc.config.shiftMinutes) + ' دقيقة' : '') + '</p>';

    if (late.length) {
      h += '<div class="alert warn"><b>' + ar(late.length) + ' مباراة عدّى وقتها ولسه ماتأكدتش:</b><ul>' +
        late.slice(0, 8).map(function (r) {
          return '<li>' + tm(r.start) + ' — ' + esc(r.gameName) + ' (' + esc(r.teamA) + ' × ' + esc(r.teamB) + ')' +
            (r.supervisor ? ' — ' + esc(r.supervisor) : '') + '</li>';
        }).join('') + '</ul></div>';
    }
    h += '</div>';

    /* تأخير الجدول — للأدمن بس */
    if (role === 'admin') {
      h += '<div class="card"><div class="card-head"><h2>⏱️ تأخير الجدول</h2></div>' +
        '<p class="small muted">بيأخّر كل المباريات اللي لسه ماتلعبتش. المباريات اللي تمّت مبتتغيّرش.</p>' +
        '<div class="btn-row">' +
        [5, 10, 15, 30].map(function (m) {
          return '<button class="btn warn" data-action="shift" data-m="' + m + '">+' + ar(m) + ' د</button>';
        }).join('') +
        '<button class="btn ghost" data-action="shift" data-m="-5">−٥ د</button>' +
        '</div></div>';
    }

    /* مباريات اتأكدت من غير نتيجة كاملة — مش بتتحسب في الترتيب */
    const missing = doc.schedule.filter(function (r) {
      return r.status === 'done' && r.teamAId && r.teamBId &&
        (r.scoreA === '' || r.scoreA == null || r.scoreB === '' || r.scoreB == null);
    }).sort(function (x, y) { return x.startMin - y.startMin; });

    if (missing.length && role === 'admin') {
      h += '<div class="card"><div class="card-head"><h2>⚠️ خانات فاضية</h2>' +
        '<span class="chip off">' + ar(missing.length) + '</span></div>' +
        '<p class="small muted">المباريات دي فيها خانة فاضية. الترتيب بيحسبها <b>صفر</b> دلوقتي، ' +
        'بس الشيت لسه فاضي. صحّح الأرقام هنا، أو صفّرها كلها بضغطة واحدة.</p>' +
        '<button class="btn warn block" data-action="fill-zeros">٠ اعتبر كل الخانات الفاضية = صفر</button>';
      missing.forEach(function (r) {
        h += '<div class="match" style="margin-top:10px">' +
          '<div class="meta">' + tm(r.start) + ' • ' + esc(r.gameName) + '</div>' +
          '<div class="grid2" style="margin-top:8px">' +
          '<div class="field"><label>' + esc(r.teamA) + '</label>' +
          '<input type="number" inputmode="numeric" placeholder="0" class="sc" data-id="' + esc(r.id) + '" data-side="a" value="' + esc(r.scoreA) + '"></div>' +
          '<div class="field"><label>' + esc(r.teamB) + '</label>' +
          '<input type="number" inputmode="numeric" placeholder="0" class="sc" data-id="' + esc(r.id) + '" data-side="b" value="' + esc(r.scoreB) + '"></div>' +
          '</div>' +
          '<button class="btn good block" data-action="save-score" data-id="' + esc(r.id) + '">💾 حفظ النتيجة</button>' +
          '</div>';
      });
      h += '</div>';
    }

    /* الترتيب */
    const lb = leaderboard();
    h += '<div class="card tight"><div class="card-head"><h2>🏅 ترتيب الفرق</h2></div>' +
      '<div class="table-wrap"><table><thead><tr>' +
      '<th>#</th><th>الفريق</th><th>لعب</th><th>ف</th><th>ت</th><th>خ</th><th>له</th><th>عليه</th><th>النقاط</th>' +
      '</tr></thead><tbody>' +
      lb.map(function (t, i) {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : ar(i + 1);
        return '<tr><td>' + medal + '</td><td><b>' + esc(t.name) + '</b></td>' +
          '<td>' + ar(t.played) + '</td><td>' + ar(t.w) + '</td><td>' + ar(t.d) + '</td><td>' + ar(t.l) + '</td>' +
          '<td>' + ar(t.gf) + '</td><td>' + ar(t.ga) + '</td><td><b>' + ar(t.pts) + '</b></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="btn-row no-print" style="margin-top:10px">' +
      '<button class="btn sm" data-action="print">🖨️ طباعة</button>' +
      '<button class="btn sm" data-action="csv">⬇️ CSV</button></div></div>';

    return h;
  }

  /* ================= شاشة العرض ================= */

  function viewBoard() {
    if (!doc.schedule.length) return '<div class="card center muted">لسه مفيش جدول.</div>';
    const n = nowMin();
    const current = doc.schedule.filter(function (r) { return n >= r.startMin && n < r.endMin; })
      .sort(function (a, b) { return a.gameName.localeCompare(b.gameName, 'ar'); });
    const upcoming = doc.schedule.filter(function (r) { return r.startMin > n; });
    const nextStart = upcoming.length ? Math.min.apply(null, upcoming.map(function (r) { return r.startMin; })) : null;
    const next = nextStart === null ? [] : doc.schedule.filter(function (r) { return r.startMin === nextStart; });

    let h = '<div class="card board center"><div class="clock" id="liveClock">' + clockText() + '</div>' +
      '<div class="muted small">' + esc(doc.config.title || 'اليوم الترفيهي') + '</div></div>';

    h += '<h2 style="margin:14px 4px 8px">🔴 دلوقتي</h2>';
    if (!current.length) h += '<div class="card center muted">مفيش مباريات شغالة دلوقتي</div>';
    else {
      h += '<div class="board-grid">' + current.map(function (r) {
        return '<div class="match now"><div class="meta">' + esc(r.gameName) +
          (r.place ? ' • ' + esc(r.place) : '') + '</div>' +
          '<div class="vs"><div class="t">' + esc(r.teamA) + '</div><div class="x">ضد</div><div class="t">' + esc(r.teamB) + '</div></div>' +
          '<div class="center meta">' + tm(r.start) + ' – ' + tm(r.end) + ' • ' + statusBadge(r) + '</div></div>';
      }).join('') + '</div>';
    }

    if (next.length) {
      h += '<h2 style="margin:16px 4px 8px">⏭️ الجاي — ' + tm(next[0].start) + '</h2>' +
        '<div class="board-grid">' + next.map(function (r) {
          return '<div class="match"><div class="meta">' + esc(r.gameName) +
            (r.place ? ' • ' + esc(r.place) : '') + '</div>' +
            '<div class="vs"><div class="t">' + esc(r.teamA) + '</div><div class="x">ضد</div><div class="t">' + esc(r.teamB) + '</div></div></div>';
        }).join('') + '</div>';
    }
    return h;
  }

  /* ================= الأحداث ================= */

  document.addEventListener('input', function (e) {
    const el = e.target;
    if (el.dataset && el.dataset.path) {
      let v = el.value;
      if (el.type === 'number') v = v === '' ? '' : Number(v);
      setPath(doc, el.dataset.path, v);
      markDirty();
    }
    if (el.id === 'myName') localStorage.setItem('funday.myName', el.value);
    if (el.classList && el.classList.contains('sc')) {
      scoreDraft[el.dataset.id + '|' + el.dataset.side] = el.value;
    }
  });

  document.addEventListener('change', function (e) {
    const el = e.target;
    if (el.id === 'fSup') {
      filters.sup = el.value;
      if (el.value && !localStorage.getItem('funday.myName')) localStorage.setItem('funday.myName', el.value);
      saveFilters(); render(); return;
    }
    if (el.id === 'fPeriod') { filters.period = el.value; filters.game = ''; saveFilters(); render(); return; }
    if (el.id === 'fGame') { filters.game = el.value; saveFilters(); render(); return; }
    if (el.dataset && el.dataset.recalc !== undefined) render();
  });

  document.addEventListener('click', async function (e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const act = btn.dataset.action;

    try {
      /* --- التنقّل --- */
      if (act === 'goto') { tab = btn.dataset.tab; render(); return; }
      if (act === 'clear-filters') { filters = { period: '', game: '', sup: '' }; saveFilters(); render(); return; }
      if (act === 'reload') {
        try { doc = await API.pull(); render(); toast('اتحدّث'); } catch (err) { toast(err.message, 'bad'); }
        return;
      }
      if (act === 'sv') { scheduleView = btn.dataset.v; render(); return; }
      if (act === 'print') { window.print(); return; }
      if (act === 'csv') { downloadCsv(); return; }

      /* --- الربط --- */
      if (act === 'api-save') {
        const url = $('#apiUrl').value.trim();
        API.Backend.save(url);
        if (!url) { toast('اتفصل الربط — شغّال محلي'); render(); return; }
        btn.textContent = 'بجرّب…';
        try {
          await API.ping();
          toast('الاتصال شغّال ✓', 'good');
          doc = await API.pull();
          dirty = false;
        } catch (err) { toast(err.message, 'bad'); }
        render(); return;
      }
      if (act === 'api-share') {
        const link = API.Backend.shareLink();
        try { await navigator.clipboard.writeText(link); toast('الرابط اتنسخ ✓', 'good'); }
        catch (err) { prompt('انسخ الرابط ده:', link); }
        return;
      }
      if (act === 'copy-link') {
        if (btn.dataset.view !== '1' && !doc.config.supervisorPassword) { toast('حط كلمة سر للمشرفين الأول', 'bad'); return; }
        if (dirty) { toast('احفظ الإعدادات الأول عشان كلمة السر توصل للمشرفين', 'bad'); return; }
        const link = supLink({
          withKey: btn.dataset.key === '1',
          lock: btn.dataset.lock === '1',
          view: btn.dataset.view === '1',
          sup: btn.dataset.sup || '',
          period: btn.dataset.period || '',
          game: btn.dataset.game || ''
        });
        try { await navigator.clipboard.writeText(link); toast('الرابط اتنسخ ✓', 'good'); }
        catch (err) { prompt('انسخ الرابط ده:', link); }
        return;
      }

      /* --- الفرق --- */
      if (act === 'teams-quick') {
        const n = Number(btn.dataset.n);
        if (doc.teams.length && !confirm('هيتم استبدال قائمة الفرق الحالية. تمام؟')) return;
        doc.teams = [];
        for (let i = 1; i <= n; i++) doc.teams.push({ id: uid('t'), name: 'فريق ' + arDigits(i) });
        markDirty(); render(); return;
      }
      if (act === 'team-add') {
        doc.teams.push({ id: uid('t'), name: 'فريق ' + arDigits(doc.teams.length + 1) });
        markDirty(); render(); return;
      }
      if (act === 'team-del') {
        doc.teams.splice(Number(btn.dataset.i), 1);
        markDirty(); render(); return;
      }

      /* --- الفترات والألعاب --- */
      if (act === 'period-add') {
        const last = doc.periods[doc.periods.length - 1];
        doc.periods.push({
          id: uid('p'),
          name: 'الفترة ' + arDigits(doc.periods.length + 1),
          start: last ? last.end : '10:00',
          end: last ? '16:00' : '12:00',
          gameMinutes: 30, breakMinutes: 0,
          games: []
        });
        markDirty(); render(); return;
      }
      if (act === 'period-del') {
        if (!confirm('تحذف الفترة دي بألعابها؟')) return;
        doc.periods.splice(Number(btn.dataset.p), 1);
        markDirty(); render(); return;
      }
      if (act === 'game-add') {
        const p = doc.periods[Number(btn.dataset.p)];
        p.games = p.games || [];
        p.games.push({ id: uid('g'), name: 'لعبة ' + arDigits(p.games.length + 1), place: '', supervisor: '' });
        markDirty(); render(); return;
      }
      if (act === 'game-del') {
        doc.periods[Number(btn.dataset.p)].games.splice(Number(btn.dataset.g), 1);
        markDirty(); render(); return;
      }

      /* --- الحفظ --- */
      if (act === 'save-setup') {
        btn.textContent = 'بحفظ…';
        await API.saveSetup(doc);
        dirty = false;
        toast(API.Backend.connected ? 'اتحفظ على جوجل شيت ✓' : 'اتحفظ على الجهاز ✓', 'good');
        render(); return;
      }

      /* --- التوليد --- */
      if (act === 'compare') { await runCompare(); return; }
      if (act === 'cancel-compare') { compare = null; render(); return; }
      if (act === 'regen') {
        if (!confirm('هيتولّد جدول جديد وكل التأكيدات والنتائج هتتمسح. متأكد؟')) return;
        compare = null; doc.schedule = []; render();
        await runCompare(); return;
      }
      if (act === 'adopt') {
        const res = compare[btn.dataset.key];
        if (!res || !res.ok) return;
        const errs = S.validate(doc, res.schedule);
        if (errs.length) { toast('الجدول فيه مشكلة: ' + errs[0], 'bad'); return; }
        doc.schedule = res.schedule;
        doc.config.shiftMinutes = 0;
        doc.meta = {
          generatedAt: new Date().toISOString(),
          mode: btn.dataset.key === 'strict' ? 'صفر تكرار' : 'أقل تكرار',
          stats: res.stats,
          updatedAt: new Date().toISOString()
        };
        compare = null;
        btn.textContent = 'بحفظ…';
        await API.saveSchedule(doc);
        toast('الجدول اتعتمد واتحفظ ✓', 'good');
        tab = 'schedule'; scheduleView = 'time';
        window.scrollTo(0, 0); render(); return;
      }

      /* --- المشرف --- */
      if (act === 'confirm') {
        const id = btn.dataset.id;
        const row = doc.schedule.find(function (r) { return r.id === id; });
        if (!row) return;
        const sa = document.querySelector('.sc[data-id="' + id + '"][data-side="a"]');
        const sb = document.querySelector('.sc[data-id="' + id + '"][data-side="b"]');
        const vA = sa ? sa.value.trim() : (scoreDraft[id + '|a'] || '');
        const vB = sb ? sb.value.trim() : (scoreDraft[id + '|b'] || '');

        const patch = {
          status: 'done',
          // الرابط المقفول بيفرض اسم صاحبه
          confirmedBy: (locked && filters.sup) ? filters.sup : (localStorage.getItem('funday.myName') || '').trim(),
          confirmedAt: new Date().toISOString(),
          // أي خانة فاضية بتتسجّل صفر
          scoreA: row.solo ? vA : scoreOrZero(vA),
          scoreB: row.solo ? vB : scoreOrZero(vB)
        };
        btn.textContent = '…';
        await API.updateMatch(doc, id, patch);
        clearDraft(id);
        toast('اتسجّل ✓', 'good');
        render(); return;
      }
      /* --- إعادة الضبط --- */
      if (act === 'reset-results') {
        const done = doc.schedule.filter(function (r) { return r.status === 'done'; }).length;
        if (!confirm('هيتمسح ' + ar(done) + ' تأكيد وكل الدرجات.\nالجدول والمواعيد هيفضلوا زي ما هم.\n\nمتأكد؟')) return;
        if (doc.schedule.length) downloadCsv();
        btn.textContent = 'بمسح…';
        doc.schedule.forEach(function (r) {
          r.status = 'pending'; r.confirmedBy = ''; r.confirmedAt = '';
          r.scoreA = ''; r.scoreB = ''; r.note = '';
        });
        Object.keys(scoreDraft).forEach(function (k) { delete scoreDraft[k]; });
        await API.saveSchedule(doc);
        toast('اتمسحت النتائج ✓', 'good');
        render(); return;
      }

      if (act === 'reset-schedule') {
        if (!confirm('هيتمسح الجدول كله (' + ar(doc.schedule.length) + ' مباراة) بنتايجه.\n' +
          'الفرق والفترات والألعاب هيفضلوا.\n\nمتأكد؟')) return;
        if (doc.schedule.length) downloadCsv();
        btn.textContent = 'بمسح…';
        doc.schedule = [];
        doc.meta = { generatedAt: '', mode: '', stats: null, updatedAt: new Date().toISOString() };
        doc.config.shiftMinutes = 0;
        Object.keys(scoreDraft).forEach(function (k) { delete scoreDraft[k]; });
        await API.saveSchedule(doc);
        await API.saveSetup(doc);
        toast('اتمسح الجدول ✓', 'good');
        tab = 'schedule'; compare = null; render(); return;
      }

      if (act === 'reset-all') {
        if (!confirm('يوم جديد من الصفر:\n\n• ' + ar(doc.teams.length) + ' فريق\n• ' +
          ar(allGames().length) + ' لعبة\n• ' + ar(doc.schedule.length) + ' مباراة\n\nكله هيتمسح. متأكد؟')) return;
        if (!confirm('تأكيد أخير — مفيش رجوع بعد كده.\nهنزّل لك نسخة CSV الأول.\n\nأمسح؟')) return;
        if (doc.schedule.length) downloadCsv();
        btn.textContent = 'بمسح…';
        doc.teams = [];
        doc.periods = [];
        doc.schedule = [];
        doc.meta = { generatedAt: '', mode: '', stats: null, updatedAt: new Date().toISOString() };
        doc.config.shiftMinutes = 0;
        Object.keys(scoreDraft).forEach(function (k) { delete scoreDraft[k]; });
        filters = { period: '', game: '', sup: '' }; saveFilters();
        await API.saveSetup(doc);
        await API.saveSchedule(doc);
        dirty = false; compare = null;
        toast('جاهز ليوم جديد ✓', 'good');
        tab = 'setup'; window.scrollTo(0, 0); render(); return;
      }

      if (act === 'fill-zeros') {
        const blanks = doc.schedule.filter(function (r) {
          return r.status === 'done' && r.teamAId && r.teamBId &&
            (r.scoreA === '' || r.scoreA == null || r.scoreB === '' || r.scoreB == null);
        });
        if (!blanks.length) { toast('مفيش خانات فاضية'); return; }
        if (!confirm('هيتحط صفر في ' + ar(blanks.length) + ' مباراة مكان الخانات الفاضية. تمام؟')) return;
        btn.textContent = 'بحفظ…';
        blanks.forEach(function (r) { r.scoreA = scoreOrZero(r.scoreA); r.scoreB = scoreOrZero(r.scoreB); });
        await API.saveSchedule(doc);   // كتابة واحدة للجدول كله بدل طلب لكل مباراة
        toast('اتصفّرت ' + ar(blanks.length) + ' مباراة ✓', 'good');
        render(); return;
      }
      if (act === 'save-score') {
        const id = btn.dataset.id;
        const a = (document.querySelector('.sc[data-id="' + id + '"][data-side="a"]') || {}).value;
        const b = (document.querySelector('.sc[data-id="' + id + '"][data-side="b"]') || {}).value;
        btn.textContent = '…';
        await API.updateMatch(doc, id, { scoreA: scoreOrZero(a), scoreB: scoreOrZero(b) });
        clearDraft(id);
        toast('اتحفظت ✓', 'good');
        render(); return;
      }
      if (act === 'undo') {
        if (!confirm('تتراجع عن التأكيد؟')) return;
        await API.updateMatch(doc, btn.dataset.id, {
          status: 'pending', confirmedBy: '', confirmedAt: '', scoreA: '', scoreB: ''
        });
        render(); return;
      }

      /* --- التأخير --- */
      if (act === 'shift') {
        const m = Number(btn.dataset.m);
        if (!confirm((m > 0 ? 'تأخير ' : 'تقديم ') + Math.abs(m) + ' دقيقة لكل المباريات اللي لسه ماتلعبتش؟')) return;
        btn.textContent = '…';
        const c = await API.shiftPending(doc, m);
        toast('اتعدّل ' + ar(c) + ' مباراة ✓', 'good');
        render(); return;
      }
    } catch (err) {
      toast(err.message || 'حصل خطأ', 'bad');
      render();
    }
  });

  /* ================= التوليد ================= */

  async function runCompare() {
    working = true; render();
    const yieldUi = function () { return new Promise(function (r) { setTimeout(r, 40); }); };
    await yieldUi();   // خلّي الشاشة ترسم "بحسب…" الأول
    try {
      const balanced = S.generate(doc, { strictNoRepeat: false, seed: 3, timeBudgetMs: 2500 });
      await yieldUi();
      const strict = S.generate(doc, { strictNoRepeat: true, seed: 11, timeBudgetMs: 3000 });
      compare = { balanced: balanced, strict: strict };
      if (!balanced.ok && !strict.ok) toast('مفيش حل بالأرقام دي — راجع التحذيرات', 'bad');
    } catch (err) {
      toast(err.message || 'فشل التوليد', 'bad');
    }
    working = false;
    window.scrollTo(0, 0);
    render();
  }

  /* ================= تصدير CSV ================= */

  function downloadCsv() {
    const head = ['الفترة', 'الجولة', 'من', 'لـ', 'اللعبة', 'المكان', 'المشرف', 'الفريق الأول', 'الفريق التاني', 'الحالة', 'أكّدها', 'نتيجة ١', 'نتيجة ٢'];
    const lines = [head];
    doc.schedule.slice().sort(function (a, b) { return a.startMin - b.startMin; }).forEach(function (r) {
      lines.push([r.periodName, r.round, r.start, r.end, r.gameName, r.place, r.supervisor,
        r.teamA, r.teamB, r.status === 'done' ? 'تمّت' : 'لسه', r.confirmedBy, r.scoreA, r.scoreB]);
    });
    const csv = '﻿' + lines.map(function (row) {
      return row.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const d = new Date();
    const stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
    a.download = (doc.config.title || 'اليوم الترفيهي').replace(/[\\/:*?"<>|]/g, '') + ' - ' + stamp + '.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
  }

  /* ================= إقلاع ================= */
  boot();
})();
