/* =============================================================
   طبقة البيانات
   -------------------------------------------------------------
   وضعان:
   1) local  : كل حاجة في المتصفح (localStorage) — للتجربة والإعداد.
   2) sheets : كل حاجة في جوجل شيت عن طريق رابط Apps Script.
   ============================================================= */
(function (global) {
  'use strict';

  const LS_DOC = 'funday.doc.v1';
  const LS_BACKEND = 'funday.backend.v1';
  const LS_SESSION = 'funday.session.v1';

  function nowIso() { return new Date().toISOString(); }

  function defaultDoc() {
    return {
      config: {
        title: 'اليوم الترفيهي',
        password: '5555',            // الأدمن
        supervisorPassword: '1234',  // المشرفين — الأدمن هو اللي بيحطها
        viewPassword: '',            // العرض فقط — فاضية = يفتح من غير كلمة سر
        shiftMinutes: 0,
        pointsWin: 3,
        pointsDraw: 1,
        pointsLoss: 0,
        locked: false
      },
      teams: [],
      periods: [],
      schedule: [],
      meta: { generatedAt: '', mode: '', stats: null, updatedAt: nowIso() }
    };
  }

  const Backend = {
    url: '',
    source: 'none',   // none | config | link | manual
    load: function () {
      // ١) رابط جاي في العنوان (?api=...) — الأولوية القصوى
      try {
        const q = new URLSearchParams(location.search).get('api');
        if (q) {
          this.url = decodeURIComponent(q).trim();
          this.source = 'link';
          localStorage.setItem(LS_BACKEND, JSON.stringify({ url: this.url }));
          return this.url;
        }
      } catch (e) { /* تجاهل */ }

      // ٢) رابط محفوظ يدوياً في المتصفح
      try {
        const raw = localStorage.getItem(LS_BACKEND);
        if (raw) {
          const saved = JSON.parse(raw).url || '';
          if (saved) { this.url = saved; this.source = 'manual'; return this.url; }
        }
      } catch (e) { /* تجاهل */ }

      // ٣) الرابط المكتوب في assets/config.js (بيشتغل لكل الناس على GitHub Pages)
      const cfg = global.FUNDAY_CONFIG || {};
      if (cfg.apiUrl) { this.url = String(cfg.apiUrl).trim(); this.source = 'config'; }
      return this.url;
    },
    save: function (url) {
      this.url = (url || '').trim();
      this.source = this.url ? 'manual' : 'none';
      if (this.url) localStorage.setItem(LS_BACKEND, JSON.stringify({ url: this.url }));
      else localStorage.removeItem(LS_BACKEND);
    },
    shareLink: function () {
      const base = location.origin + location.pathname;
      return this.url ? base + '?api=' + encodeURIComponent(this.url) : base;
    },
    get connected() { return !!this.url; }
  };

  async function callSheets(action, payload) {
    if (!Backend.connected) throw new Error('لسه مربوطش بجوجل شيت');
    const res = await fetch(Backend.url, {
      method: 'POST',
      // text/plain عشان المتصفح ميعملش preflight (Apps Script مبيردش عليه)
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, payload: payload || {} }),
      redirect: 'follow'
    });
    if (!res.ok) throw new Error('الاتصال فشل (' + res.status + ')');
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch (e) { throw new Error('رد غير مفهوم من الشيت — اتأكد إن الرابط هو رابط النشر /exec'); }
    if (!data.ok) throw new Error(data.error || 'خطأ من الشيت');
    return data.data;
  }

  function readLocal() {
    try {
      const raw = localStorage.getItem(LS_DOC);
      if (!raw) return defaultDoc();
      const d = JSON.parse(raw);
      const base = defaultDoc();
      return {
        config: Object.assign(base.config, d.config || {}),
        teams: d.teams || [],
        periods: d.periods || [],
        schedule: d.schedule || [],
        meta: Object.assign(base.meta, d.meta || {})
      };
    } catch (e) { return defaultDoc(); }
  }

  function writeLocal(doc) {
    doc.meta = doc.meta || {};
    doc.meta.updatedAt = nowIso();
    localStorage.setItem(LS_DOC, JSON.stringify(doc));
    return doc;
  }

  const API = {
    Backend: Backend,
    defaultDoc: defaultDoc,

    get mode() { return Backend.connected ? 'sheets' : 'local'; },

    /* تجربة الاتصال وإنشاء التبويبات لو مش موجودة */
    async ping() {
      return await callSheets('ping', {});
    },

    async pull() {
      if (!Backend.connected) return readLocal();
      const remote = await callSheets('pull', {});
      const base = defaultDoc();
      const doc = {
        config: Object.assign(base.config, remote.config || {}),
        teams: remote.teams || [],
        periods: remote.periods || [],
        schedule: remote.schedule || [],
        meta: Object.assign(base.meta, remote.meta || {})
      };
      writeLocal(doc);          // نسخة احتياطية محلية
      return doc;
    },

    /* حفظ الإعدادات (الفرق + الفترات + الألعاب) */
    async saveSetup(doc) {
      writeLocal(doc);
      if (!Backend.connected) return doc;
      await callSheets('saveSetup', {
        config: doc.config, teams: doc.teams, periods: doc.periods
      });
      return doc;
    },

    /* حفظ الجدول كامل (بعد التوليد) */
    async saveSchedule(doc) {
      writeLocal(doc);
      if (!Backend.connected) return doc;
      await callSheets('saveSchedule', { schedule: doc.schedule, meta: doc.meta });
      return doc;
    },

    /* تحديث مباراة واحدة — ده اللي المشرف بيستعمله */
    async updateMatch(doc, matchId, patch) {
      const row = doc.schedule.find(function (r) { return r.id === matchId; });
      if (row) Object.assign(row, patch);
      writeLocal(doc);
      if (!Backend.connected) return row;
      const saved = await callSheets('updateMatch', { id: matchId, patch: patch });
      if (row && saved) Object.assign(row, saved);
      return row;
    },

    /* تأخير كل المباريات اللي لسه ماتلعبتش */
    async shiftPending(doc, minutes) {
      const applied = [];
      doc.schedule.forEach(function (r) {
        if (r.status === 'done') return;
        r.startMin = (r.startMin || 0) + minutes;
        r.endMin = (r.endMin || 0) + minutes;
        r.start = global.Scheduler.fromMinutes(r.startMin);
        r.end = global.Scheduler.fromMinutes(r.endMin);
        applied.push(r.id);
      });
      doc.config.shiftMinutes = (doc.config.shiftMinutes || 0) + minutes;
      writeLocal(doc);
      if (!Backend.connected) return applied.length;
      await callSheets('shiftPending', { minutes: minutes });
      return applied.length;
    },

    /* الجلسة (الباسورد) */
    session: {
      get: function () {
        try { return JSON.parse(sessionStorage.getItem(LS_SESSION) || 'null'); }
        catch (e) { return null; }
      },
      set: function (v) { sessionStorage.setItem(LS_SESSION, JSON.stringify(v)); },
      clear: function () { sessionStorage.removeItem(LS_SESSION); }
    },

    localSnapshot: readLocal
  };

  Backend.load();
  global.API = API;
})(window);
