/* =============================================================
   محرك جدولة اليوم الترفيهي
   -------------------------------------------------------------
   القيد الإجباري : كل فريق يلعب كل لعبة مرة واحدة بالظبط.
   الهدف المرن    : تقليل تكرار المواجهات بين نفس الفريقين.
   السعة          : كل لعبة في الجولة الواحدة = فريقين.
   ============================================================= */
(function (global) {
  'use strict';

  /* ---------- أدوات عامة ---------- */

  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rnd) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function toMinutes(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
    if (!m) return null;
    return (+m[1]) * 60 + (+m[2]);
  }

  function fromMinutes(mins) {
    const m = ((mins % 1440) + 1440) % 1440;
    const h = Math.floor(m / 60), q = m % 60;
    return String(h).padStart(2, '0') + ':' + String(q).padStart(2, '0');
  }

  /* ---------- حساب جولات الفترة ---------- */

  function periodSlots(period) {
    const s = toMinutes(period.start);
    const e = toMinutes(period.end);
    const dur = Number(period.gameMinutes) || 0;
    const brk = Number(period.breakMinutes) || 0;
    const out = [];
    if (s === null || e === null || dur <= 0) return out;
    let cur = s;
    // حد أقصى للحماية من حلقة لا نهائية
    while (cur + dur <= e && out.length < 60) {
      out.push({ start: cur, end: cur + dur });
      cur += dur + brk;
    }
    return out;
  }

  /* ---------- تحليل الجدوى قبل التوليد ---------- */
  /*
     قاعدة إجبارية: مفيش أي فريق يرتاح في أي جولة.
     يعني كل فريق لازم يكون على لعبة في كل جولة من جولات الفترة، وده بيتحقق لما:
       ١) عدد الجولات المستخدمة في الفترة = عدد ألعاب الفترة بالظبط
          (كل فريق بيلعب كل لعبة مرة واحدة ⇒ عدد مبارياته = عدد الألعاب).
       ٢) عدد ألعاب الفترة ≥ نص عدد الفرق، عشان كل الفرق تلاقي مكان في نفس الجولة.
     لو الوقت المتاح فيه جولات زيادة، بنستخدم الأول منها بس والباقي بيفضل فاضي.
  */

  function analyze(model) {
    const n = (model.teams || []).length;
    const odd = n % 2 === 1;
    const nEff = odd ? n + 1 : n;          // فريق وهمي لو العدد فردي
    const periods = [];
    let totalGames = 0;
    const problems = [];
    const notes = [];

    (model.periods || []).forEach(function (p) {
      const slots = periodSlots(p);
      const games = (p.games || []).length;
      totalGames += games;

      const availableSlots = slots.length;             // اللي الوقت بيسمح بيه
      const minGamesNoRest = Math.ceil(nEff / 2);      // أقل عدد ألعاب عشان محدش يستنى
      const requiredSlots = games;                     // الجولات المستخدمة = عدد الألعاب
      const usedSlots = Math.min(availableSlots, games);
      const spareSlots = Math.max(0, availableSlots - games);
      const stepMin = (Number(p.gameMinutes) || 0) + (Number(p.breakMinutes) || 0);

      const info = {
        id: p.id,
        name: p.name,
        slotCount: usedSlots,                          // الجولات اللي الجدول هيستخدمها فعلاً
        availableSlots: availableSlots,
        spareSlots: spareSlots,
        gamesCount: games,
        needForGames: games,
        minGamesNoRest: minGamesNoRest,
        requiredSlots: requiredSlots,
        restPerTeam: 0,                                // القاعدة: صفر راحة دايماً
        idleStationsPerSlot: Math.max(0, games - Math.floor(nEff / 2)),
        ok: games > 0 && availableSlots >= games && games >= minGamesNoRest,
        slots: slots.slice(0, usedSlots)
      };
      periods.push(info);

      if (games === 0) {
        problems.push('الفترة «' + p.name + '» مفيهاش ألعاب.');
      } else if (availableSlots === 0) {
        problems.push('الفترة «' + p.name + '» مدتها أقل من مدة اللعبة الواحدة.');
      } else {
        if (games < minGamesNoRest) {
          const missing = minGamesNoRest - games;
          // لو زوّدنا الألعاب للحد المطلوب، الوقت كمان هيحتاج جولات أكتر — نقول الاتنين مرة واحدة
          let timeFix = '';
          if (availableSlots < minGamesNoRest) {
            const extraSlots = minGamesNoRest - availableSlots;
            const fitMin = Math.floor((toMinutes(p.end) - toMinutes(p.start)) / minGamesNoRest) - (Number(p.breakMinutes) || 0);
            timeFix = ' وانتبه: الوقت الحالي يكفي ' + availableSlots + ' جولة بس، فمحتاج كمان ' +
              (extraSlots * stepMin) + ' دقيقة في الفترة' +
              (fitMin > 0 ? '، أو تقلّل مدة اللعبة لـ ' + fitMin + ' دقيقة' : '') + '.';
          }
          problems.push(
            'الفترة «' + p.name + '» فيها ' + games + ' لعبة بس و' + n + ' فريق. ' +
            'كل لعبة بتشيل فريقين في الجولة، يعني ' + games + ' لعبة بتشغّل ' + (games * 2) + ' فريق فقط ' +
            'و' + (nEff - games * 2) + ' فريق هيقعد يستنى — وده ممنوع. ' +
            'الحل: زوّد ' + missing + ' لعبة في الفترة دي (تبقى ' + minGamesNoRest + ' لعبة على الأقل)، أو قلّل عدد الفرق.' +
            timeFix
          );
        }
        if (availableSlots < games) {
          const missing = games - availableSlots;
          problems.push(
            'الفترة «' + p.name + '» محتاجة ' + games + ' جولة (واحدة لكل لعبة) ومتاح ' + availableSlots + '. ' +
            'الحل: زوّد الفترة ' + (missing * stepMin) + ' دقيقة، أو قلّل مدة اللعبة، أو قلّل عدد الألعاب.'
          );
        }
      }

      if (info.ok && spareSlots > 0) {
        notes.push('في «' + p.name + '»: الوقت يسمح بـ ' + availableSlots + ' جولة والمحتاج ' + games +
          ' — الجدول هياخد ' + games + ' جولة وهيخلّص قبل نهاية الفترة بـ ' + (spareSlots * stepMin) +
          ' دقيقة (عشان محدش يقعد يستنى في النص).');
      }
      if (info.ok && info.idleStationsPerSlot > 0) {
        notes.push('في «' + p.name + '»: ' + info.idleStationsPerSlot + ' لعبة هتفضل فاضية في كل جولة ' +
          '(الفرق أقل من عدد الألعاب × ٢) — دي محطات فاضية مش فرق مستنية.');
      }
    });

    const maxDistinct = n - 1;
    const minRepeats = Math.max(0, totalGames - maxDistinct);

    if (odd && n > 0) {
      notes.push('عدد الفرق فردي (' + n + ')، فهيكون فيه فريق «بدون منافس» في كل جولة — هو واقف على لعبة مش مرتاح، بس يفضّل عدد زوجي.');
    }

    return {
      teamCount: n,
      isOdd: odd,
      totalGames: totalGames,
      totalSlots: periods.reduce(function (a, p) { return a + p.slotCount; }, 0),
      matchesPerTeam: totalGames,
      maxDistinctOpponents: maxDistinct,
      minRepeatsPerTeam: minRepeats,
      noRepeatPossible: n >= 2 && totalGames <= maxDistinct,
      // كل فريق يقدر يقابل كل الفرق التانية؟ لازم عدد مبارياته ≥ عدد الخصوم
      coveragePossible: n >= 2 && totalGames >= maxDistinct,
      coverageShortfall: Math.max(0, maxDistinct - totalGames),
      noRestGuaranteed: true,
      periods: periods,
      problems: problems,
      notes: notes,
      feasible: problems.length === 0 && n >= 2 && totalGames > 0
    };
  }

  /* ---------- حل فترة واحدة ---------- */
  /*
     teams  : مصفوفة أرقام (فهارس) الفرق — بيشمل الفريق الوهمي لو العدد فردي
     games  : عدد الألعاب في الفترة
     slotCnt: عدد الجولات (= عدد الألعاب، عشان كل فريق يلعب في كل جولة من غير راحة)
     pairCnt: مصفوفة عدّاد المواجهات السابقة [i][j]
     maxPair: أقصى عدد مرات مسموح لنفس المواجهة (1 = ممنوع التكرار نهائياً)
  */
  function solvePeriod(nTeams, games, slotCnt, pairCnt, maxPair, rnd, nodeLimit) {
    const played = [];                       // played[team][game]
    for (let i = 0; i < nTeams; i++) played.push(new Uint8Array(games));
    const remGames = new Int32Array(nTeams).fill(games);  // ألعاب باقية لكل فريق
    const remTeams = new Int32Array(games).fill(nTeams);  // فرق باقية لكل لعبة
    const assignment = [];                   // assignment[slot] = [{game,a,b}]
    let nodes = 0;

    function feasible(remainingSlots) {
      for (let g = 0; g < games; g++) if (Math.ceil(remTeams[g] / 2) > remainingSlots) return false;
      for (let i = 0; i < nTeams; i++) if (remGames[i] > remainingSlots) return false;
      return true;
    }

    function candidatesFor(g, busy) {
      const list = [];
      for (let i = 0; i < nTeams; i++) if (!busy[i] && !played[i][g]) list.push(i);
      return list;
    }

    function fillSlot(slot, pending, busy, out) {
      if (nodes++ > nodeLimit) throw new Error('BUDGET');

      if (pending.length === 0) {
        // قاعدة إجبارية: محدش يقعد يستنى — كل فريق لازم يكون على لعبة في الجولة دي
        for (let i = 0; i < nTeams; i++) if (!busy[i]) return false;
        assignment[slot] = out.slice();
        const remaining = slotCnt - slot - 1;
        if (!feasible(remaining)) return false;
        if (slot + 1 === slotCnt) {
          for (let i = 0; i < nTeams; i++) if (remGames[i] !== 0) return false;
          return true;
        }
        const nextPending = shuffle(pending0(), rnd);
        const nextBusy = new Uint8Array(nTeams);
        if (fillSlot(slot + 1, nextPending, nextBusy, [])) return true;
        return false;
      }

      // MRV: اختَر اللعبة الأقل خيارات
      let bestIdx = 0, bestCand = null, bestLen = Infinity;
      for (let k = 0; k < pending.length; k++) {
        const c = candidatesFor(pending[k], busy);
        if (c.length < bestLen) { bestLen = c.length; bestIdx = k; bestCand = c; }
        if (bestLen <= 1) break;
      }
      const g = pending[bestIdx];
      const rest = pending.slice(0, bestIdx).concat(pending.slice(bestIdx + 1));
      const cand = bestCand;

      // كل الأزواج الممكنة مرتّبة: الأقل تكراراً للمواجهة أولاً
      const pairs = [];
      for (let x = 0; x < cand.length; x++) {
        for (let y = x + 1; y < cand.length; y++) {
          const a = cand[x], b = cand[y];
          const met = pairCnt[a][b];
          if (met >= maxPair) continue;
          pairs.push({ a: a, b: b, cost: met * 100 + rnd() });
        }
      }
      pairs.sort(function (p, q) { return p.cost - q.cost; });

      const tryLimit = Math.min(pairs.length, 14);
      for (let k = 0; k < tryLimit; k++) {
        const pr = pairs[k];
        played[pr.a][g] = 1; played[pr.b][g] = 1;
        busy[pr.a] = 1; busy[pr.b] = 1;
        remGames[pr.a]--; remGames[pr.b]--;
        remTeams[g] -= 2;
        pairCnt[pr.a][pr.b]++; pairCnt[pr.b][pr.a]++;
        out.push({ game: g, a: pr.a, b: pr.b });

        if (fillSlot(slot, rest, busy, out)) return true;

        out.pop();
        pairCnt[pr.a][pr.b]--; pairCnt[pr.b][pr.a]--;
        remTeams[g] += 2;
        remGames[pr.a]++; remGames[pr.b]++;
        busy[pr.a] = 0; busy[pr.b] = 0;
        played[pr.a][g] = 0; played[pr.b][g] = 0;
      }

      // آخر خيار: اللعبة دي تفضل فاضية في الجولة دي
      return fillSlot(slot, rest, busy, out);
    }

    function pending0() {
      const a = [];
      for (let g = 0; g < games; g++) a.push(g);
      return a;
    }

    try {
      const ok = fillSlot(0, shuffle(pending0(), rnd), new Uint8Array(nTeams), []);
      return ok ? assignment : null;
    } catch (err) {
      if (err && err.message === 'BUDGET') return null;
      throw err;
    }
  }

  /* ---------- استراتيجية «الدورة الكاملة» ----------
     بنبني أول حاجة توزيع المواجهات بطريقة الدائرة (round-robin)، وده
     بيضمن بالبناء إن كل فريق يقابل كل الفرق التانية مرة واحدة خلال
     (عدد الفرق − ١) جولة. بعد كده بنوزّع الألعاب على المباريات دي.
     بتنفع لما عدد ألعاب الفترة = عدد جولاتها، وعدد الألعاب ≥ نصف الفرق. */

  function circleRounds(n, rnd) {
    const label = shuffle(Array.from({ length: n }, function (_, i) { return i; }), rnd);
    const rot = [];
    for (let i = 1; i < n; i++) rot.push(i);
    const rounds = [];
    for (let r = 0; r < n - 1; r++) {
      const pairs = [[label[0], label[rot[0]]]];
      for (let i = 1; i < n / 2; i++) pairs.push([label[rot[i]], label[rot[rot.length - i]]]);
      rounds.push(pairs);
      rot.unshift(rot.pop());          // تدوير
    }
    return rounds;
  }

  /* توزيع الألعاب على مباريات معروفة مسبقاً */
  function assignGames(matches, slotCount, nTeams, gCount, rnd, nodeLimit) {
    const teamUsed = [];
    for (let i = 0; i < nTeams; i++) teamUsed.push(new Uint8Array(gCount));
    const slotUsed = [];
    for (let s = 0; s < slotCount; s++) slotUsed.push(new Uint8Array(gCount));
    const assign = new Int32Array(matches.length).fill(-1);
    let nodes = 0;

    function rec(done) {
      if (done === matches.length) return true;
      if (nodes++ > nodeLimit) throw new Error('BUDGET');

      let best = -1, bestOpts = null;
      for (let i = 0; i < matches.length; i++) {
        if (assign[i] !== -1) continue;
        const m = matches[i];
        const opts = [];
        for (let g = 0; g < gCount; g++) {
          if (!slotUsed[m.slot][g] && !teamUsed[m.a][g] && !teamUsed[m.b][g]) opts.push(g);
        }
        if (opts.length === 0) return false;
        if (!bestOpts || opts.length < bestOpts.length) { best = i; bestOpts = opts; }
        if (opts.length === 1) break;
      }

      const m = matches[best];
      const order = shuffle(bestOpts, rnd);
      for (let k = 0; k < order.length; k++) {
        const g = order[k];
        assign[best] = g; slotUsed[m.slot][g] = 1; teamUsed[m.a][g] = 1; teamUsed[m.b][g] = 1;
        if (rec(done + 1)) return true;
        assign[best] = -1; slotUsed[m.slot][g] = 0; teamUsed[m.a][g] = 0; teamUsed[m.b][g] = 0;
      }
      return false;
    }

    try { return rec(0) ? Array.from(assign) : null; }
    catch (e) { return null; }
  }

  function backboneApplicable(analysis, nEff) {
    if (!analysis.periods.length) return false;
    return analysis.periods.every(function (p) {
      return p.gamesCount > 0 && p.gamesCount === p.slotCount && p.gamesCount >= nEff / 2;
    });
  }

  function backboneSolve(analysis, nEff, rnd, nodeLimit) {
    const rounds = circleRounds(nEff, rnd);
    const offset = (rnd() * rounds.length) | 0;
    const perPeriod = [];
    let globalSlot = 0;

    for (let pi = 0; pi < analysis.periods.length; pi++) {
      const info = analysis.periods[pi];
      const matches = [];
      for (let s = 0; s < info.slotCount; s++) {
        const pairs = rounds[(offset + globalSlot) % rounds.length];
        pairs.forEach(function (pr) { matches.push({ slot: s, a: pr[0], b: pr[1] }); });
        globalSlot++;
      }
      const got = assignGames(matches, info.slotCount, nEff, info.gamesCount, rnd, nodeLimit);
      if (!got) return null;

      const sol = [];
      for (let s = 0; s < info.slotCount; s++) sol.push([]);
      matches.forEach(function (m, i) { sol[m.slot].push({ game: got[i], a: m.a, b: m.b }); });
      perPeriod.push(sol);
    }
    return perPeriod;
  }

  /* ---------- تحسين موضعي: تقليل تكرار المواجهات ----------
     الفكرة: نلاقي فريقين (أ) و(ب) وجولتين (س) و(ص) بحيث في (س) الفريق أ على لعبة ١
     والفريق ب على لعبة ٢، وفي (ص) العكس بالظبط (أ على ٢ وب على ١).
     ساعتها نقدر نبدّل مكانهم في الجولتين مع بعض من غير ما نكسر أي شرط:
       • كل فريق لسه بيلعب كل لعبة مرة واحدة (اتبادلوا لعبتين بينهم في الاتجاهين)
       • كل فريق لسه شغّال في كل جولة (البديل في نفس الجولة)
       • عدد الفرق على كل لعبة في كل جولة ما اتغيّرش
     اللي بيتغيّر بس هو مين بيقابل مين — فنقبل التبديل لو قلّل التكرار. */

  function improvePairs(perPeriod, pairCnt, nEff, BYE, rnd, maxRounds) {
    // وزن: تكرار بين فريقين حقيقيين أهم من تكرار «بدون منافس»
    function w(x, y) { return (x === BYE || y === BYE) ? 0.4 : 1; }

    function delta(removes, adds) {
      let d = 0;
      for (let i = 0; i < removes.length; i++) {
        const x = removes[i][0], y = removes[i][1];
        if (pairCnt[x][y] > 1) d -= w(x, y);
        pairCnt[x][y]--; pairCnt[y][x]--;
      }
      for (let i = 0; i < adds.length; i++) {
        const x = adds[i][0], y = adds[i][1];
        if (pairCnt[x][y] >= 1) d += w(x, y);
        pairCnt[x][y]++; pairCnt[y][x]++;
      }
      return d;
    }

    function revert(removes, adds) {
      for (let i = 0; i < adds.length; i++) {
        const x = adds[i][0], y = adds[i][1];
        pairCnt[x][y]--; pairCnt[y][x]--;
      }
      for (let i = 0; i < removes.length; i++) {
        const x = removes[i][0], y = removes[i][1];
        pairCnt[x][y]++; pairCnt[y][x]++;
      }
    }

    let improved = true, rounds = 0;
    // خطوات «جانبية» (مش بتحسّن ولا بتوحّش) — بتساعدنا نهرب من الحلول المحلية
    let sideways = (maxRounds || 40) * nEff;

    while (improved && rounds++ < (maxRounds || 40)) {
      improved = false;

      for (let pi = 0; pi < perPeriod.length; pi++) {
        const sol = perPeriod[pi];
        const nSlots = sol.length;
        if (nSlots < 2) continue;

        // M[team][slot] = فهرس اللعبة  |  where[team][slot] = المباراة نفسها
        const M = [], W = [];
        for (let t = 0; t < nEff; t++) { M.push(new Int32Array(nSlots).fill(-1)); W.push(new Array(nSlots).fill(null)); }
        for (let sIdx = 0; sIdx < nSlots; sIdx++) {
          (sol[sIdx] || []).forEach(function (m) {
            M[m.a][sIdx] = m.game; W[m.a][sIdx] = m;
            M[m.b][sIdx] = m.game; W[m.b][sIdx] = m;
          });
        }

        const teamOrder = shuffle(Array.from({ length: nEff }, function (_, i) { return i; }), rnd);

        for (let ai = 0; ai < teamOrder.length; ai++) {
          const a = teamOrder[ai];
          for (let bi = 0; bi < teamOrder.length; bi++) {
            const b = teamOrder[bi];
            if (b === a) continue;

            for (let s1 = 0; s1 < nSlots; s1++) {
              const g1 = M[a][s1], g2 = M[b][s1];
              if (g1 < 0 || g2 < 0 || g1 === g2) continue;

              for (let s2 = s1 + 1; s2 < nSlots; s2++) {
                // الشرط: في الجولة التانية يكونوا متبادلين بالظبط
                if (M[a][s2] !== g2 || M[b][s2] !== g1) continue;

                const m1 = W[a][s1], m2 = W[b][s1], m3 = W[a][s2], m4 = W[b][s2];
                const pa = (m1.a === a) ? m1.b : m1.a;   // شريك أ في الجولة ١
                const pb = (m2.a === b) ? m2.b : m2.a;   // شريك ب في الجولة ١
                const qa = (m3.a === a) ? m3.b : m3.a;   // شريك أ في الجولة ٢
                const qb = (m4.a === b) ? m4.b : m4.a;   // شريك ب في الجولة ٢
                if (pa === b || pb === a || qa === b || qb === a) continue;

                const removes = [[a, pa], [b, pb], [a, qa], [b, qb]];
                const adds    = [[b, pa], [a, pb], [b, qa], [a, qb]];
                const d = delta(removes, adds);

                const takeIt = (d < -1e-9) ||
                  (Math.abs(d) < 1e-9 && sideways > 0 && rnd() < 0.35 && --sideways >= 0);

                if (takeIt) {
                  // نفّذ التبديل فعلياً
                  if (m1.a === a) m1.a = b; else m1.b = b;
                  if (m2.a === b) m2.a = a; else m2.b = a;
                  if (m3.a === a) m3.a = b; else m3.b = b;
                  if (m4.a === b) m4.a = a; else m4.b = a;

                  M[a][s1] = g2; M[b][s1] = g1; M[a][s2] = g1; M[b][s2] = g2;
                  W[a][s1] = m2; W[b][s1] = m1; W[a][s2] = m4; W[b][s2] = m3;
                  if (d < -1e-9) improved = true;   // الخطوات الجانبية ما تخلّيش اللوب لا نهائي
                } else {
                  revert(removes, adds);
                }
              }
            }
          }
        }
      }
    }
  }

  function computePairCnt(perPeriod, nEff) {
    const pc = [];
    for (let i = 0; i < nEff; i++) pc.push(new Int32Array(nEff));
    perPeriod.forEach(function (sol) {
      sol.forEach(function (slot) {
        (slot || []).forEach(function (m) { pc[m.a][m.b]++; pc[m.b][m.a]++; });
      });
    });
    return pc;
  }

  function hasRepeat(pairCnt, nEff) {
    for (let i = 0; i < nEff; i++) for (let j = i + 1; j < nEff; j++) if (pairCnt[i][j] > 1) return true;
    return false;
  }

  /* ---------- التوليد الكامل ---------- */
  /*
     options.strictNoRepeat : true = ممنوع تكرار أي مواجهة (قد يفشل)
     options.attempts       : عدد المحاولات العشوائية
     options.timeBudgetMs   : أقصى وقت
  */
  function generate(model, options) {
    options = options || {};
    const strict = !!options.strictNoRepeat;
    const attempts = options.attempts || (strict ? 220 : 90);
    const budget = options.timeBudgetMs || 6000;
    const analysis = analyze(model);

    if (!analysis.feasible) {
      return { ok: false, reason: 'infeasible', analysis: analysis };
    }
    if (strict && !analysis.noRepeatPossible) {
      return {
        ok: false, reason: 'strict-impossible', analysis: analysis,
        message: 'مستحيل رياضياً: كل فريق هيلعب ' + analysis.totalGames +
          ' مباراة وعنده ' + analysis.maxDistinctOpponents + ' خصم متاح بس. ' +
          'لازم عدد الألعاب الكلي يكون ' + analysis.maxDistinctOpponents + ' أو أقل، أو تزوّد عدد الفرق.'
      };
    }

    const teams = model.teams.slice();
    const isOdd = teams.length % 2 === 1;
    const nEff = isOdd ? teams.length + 1 : teams.length;
    const BYE = isOdd ? teams.length : -1;   // فهرس الفريق الوهمي

    const started = Date.now();
    const useBackbone = backboneApplicable(analysis, nEff);
    let best = null;

    for (let attempt = 0; attempt < attempts; attempt++) {
      // لازم نقطع على الوقت حتى لو ملقيناش حل، وإلا الشاشة بتتجمّد
      if (attempt > 0 && Date.now() - started > budget) break;
      const rnd = makeRng((options.seed || 1) * 7919 + attempt * 104729 + 12345);

      let perPeriod = null;

      // ① الدورة الكاملة — بتدّي أقل تكرار ممكن بالبناء
      if (useBackbone) {
        perPeriod = backboneSolve(analysis, nEff, rnd, options.backboneNodeLimit || 60000);
      }

      // ② الحل العام بالتراجع
      if (!perPeriod) {
        const running = [];
        for (let i = 0; i < nEff; i++) running.push(new Int32Array(nEff));
        const maxPair = strict ? 1 : 1000;
        const acc = [];
        let failed = false;
        for (let pi = 0; pi < model.periods.length; pi++) {
          const info = analysis.periods[pi];
          const res = solvePeriod(nEff, info.gamesCount, info.slotCount, running, maxPair, rnd,
            options.nodeLimit || (strict ? 120000 : 400000));
          if (!res) { failed = true; break; }
          acc.push(res);
        }
        if (!failed) perPeriod = acc;
      }
      if (!perPeriod) continue;

      const pairCnt = computePairCnt(perPeriod, nEff);
      improvePairs(perPeriod, pairCnt, nEff, BYE, rnd, options.improveRounds || 40);
      if (strict && hasRepeat(pairCnt, nEff)) continue;

      const scored = score(model, analysis, perPeriod, pairCnt, nEff, BYE);
      if (scored.stats.restViolations > 0) continue;   // القاعدة الإجبارية: صفر راحة
      if (!best || scored.penalty < best.penalty) best = scored;
      // وقفنا بدري لو وصلنا لأحسن نتيجة ممكنة رياضياً — مفيش فايدة من محاولات زيادة
      if (best.penalty === 0 || best.stats.isOptimal) break;
    }

    if (!best) {
      return {
        ok: false, reason: strict ? 'strict-not-found' : 'not-found', analysis: analysis,
        message: strict
          ? 'مالقيتش جدول من غير أي تكرار مواجهات بالأرقام دي. جرّب الخيار التاني، أو قلّل عدد الألعاب.'
          : 'مالقيتش حل صالح بالأرقام دي (مع شرط إن محدش يرتاح في أي جولة) — راجع تحذيرات الجدوى فوق.'
      };
    }

    return { ok: true, analysis: analysis, schedule: best.rows, stats: best.stats };
  }

  /* ---------- تحويل الحل لصفوف + إحصاءات ---------- */

  function score(model, analysis, perPeriod, pairCnt, nEff, BYE) {
    const teams = model.teams;
    const rows = [];
    let seq = 0;

    for (let pi = 0; pi < model.periods.length; pi++) {
      const p = model.periods[pi];
      const info = analysis.periods[pi];
      const sol = perPeriod[pi];

      for (let s = 0; s < sol.length; s++) {
        const slot = info.slots[s];
        (sol[s] || []).forEach(function (m) {
          const game = p.games[m.game];
          const aIsBye = m.a === BYE, bIsBye = m.b === BYE;
          const teamA = aIsBye ? null : teams[m.a];
          const teamB = bIsBye ? null : teams[m.b];
          if (!teamA && !teamB) return;
          rows.push({
            id: 'm' + (++seq),
            periodId: p.id,
            periodName: p.name,
            round: s + 1,
            start: fromMinutes(slot.start),
            end: fromMinutes(slot.end),
            startMin: slot.start,
            endMin: slot.end,
            gameId: game.id,
            gameName: game.name,
            place: game.place || '',
            supervisor: game.supervisor || '',
            teamAId: teamA ? teamA.id : '',
            teamA: teamA ? teamA.name : '— بدون منافس —',
            teamBId: teamB ? teamB.id : '',
            teamB: teamB ? teamB.name : '— بدون منافس —',
            solo: aIsBye || bIsBye,
            status: 'pending',
            confirmedBy: '',
            confirmedAt: '',
            scoreA: '',
            scoreB: '',
            note: ''
          });
        });
      }
    }

    rows.sort(function (a, b) { return a.startMin - b.startMin || a.gameName.localeCompare(b.gameName, 'ar'); });

    // إحصاءات
    const n = teams.length;
    let repeats = 0;
    const repeatPairs = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const c = pairCnt[i][j];
        if (c > 1) { repeats += c - 1; repeatPairs.push({ a: teams[i].name, b: teams[j].name, times: c }); }
      }
    }
    const distinctPerTeam = [];
    const restPerTeam = [];
    for (let i = 0; i < n; i++) {
      let d = 0;
      for (let j = 0; j < n; j++) if (j !== i && pairCnt[i][j] > 0) d++;
      distinctPerTeam.push({ team: teams[i].name, distinct: d });
    }
    const totalSlots = analysis.totalSlots;
    teams.forEach(function (t) {
      const busy = rows.filter(function (r) { return r.teamAId === t.id || r.teamBId === t.id; }).length;
      restPerTeam.push({ team: t.name, matches: busy, rest: totalSlots - busy });
    });

    const restVals = restPerTeam.map(function (r) { return r.rest; });
    const restSpread = restVals.length ? Math.max.apply(null, restVals) - Math.min.apply(null, restVals) : 0;

    // فحص القاعدة الإجبارية: مفيش فريق قاعد يستنى في أي جولة
    const idleSlots = [];
    const slotKeys = {};
    rows.forEach(function (r) {
      const k = r.periodId + '|' + r.round;
      if (!slotKeys[k]) slotKeys[k] = { periodName: r.periodName, round: r.round, start: r.start, teams: {} };
      if (r.teamAId) slotKeys[k].teams[r.teamAId] = true;
      if (r.teamBId) slotKeys[k].teams[r.teamBId] = true;
    });
    Object.keys(slotKeys).forEach(function (k) {
      const sl = slotKeys[k];
      const idle = teams.filter(function (t) { return !sl.teams[t.id]; });
      if (idle.length) {
        idleSlots.push({
          periodName: sl.periodName, round: sl.round, start: sl.start,
          teams: idle.map(function (t) { return t.name; })
        });
      }
    });
    const restViolations = idleSlots.reduce(function (a, x) { return a + x.teams.length; }, 0);

    // التغطية: فيه فريقين ما اتقابلوش خالص طول اليوم؟
    const uncoveredPairs = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (pairCnt[i][j] === 0) uncoveredPairs.push({ a: teams[i].name, b: teams[j].name });
      }
    }
    const pairsTotal = n * (n - 1) / 2;
    const pairsCovered = pairsTotal - uncoveredPairs.length;

    // الأولويات: الراحة ← فرق ما اتقابلوش ← تكرار المواجهات
    const penalty = restViolations * 1000000 + uncoveredPairs.length * 5000 + repeats * 1000 + restSpread * 10;

    return {
      rows: rows,
      penalty: penalty,
      stats: {
        penalty: penalty,
        totalMatches: rows.length,
        restViolations: restViolations,
        idleSlots: idleSlots,
        noRest: restViolations === 0,
        uncoveredPairs: uncoveredPairs,
        pairsCovered: pairsCovered,
        pairsTotal: pairsTotal,
        fullCoverage: uncoveredPairs.length === 0,
        coveragePossible: analysis.totalGames >= n - 1,
        repeats: repeats,
        repeatPairs: repeatPairs.sort(function (x, y) { return y.times - x.times; }),
        minRepeatsPossible: analysis.minRepeatsPerTeam > 0
          ? Math.ceil(n * analysis.minRepeatsPerTeam / 2) : 0,
        distinctPerTeam: distinctPerTeam,
        restPerTeam: restPerTeam,
        restSpread: restSpread,
        isOptimal: repeats <= (analysis.minRepeatsPerTeam > 0 ? Math.ceil(n * analysis.minRepeatsPerTeam / 2) : 0)
      }
    };
  }

  /* ---------- التحقق من صحة جدول جاهز ---------- */

  function validate(model, rows) {
    const errors = [];
    const teams = model.teams;
    const gameIds = [];
    model.periods.forEach(function (p) { (p.games || []).forEach(function (g) { gameIds.push(g.id); }); });

    // كل فريق × كل لعبة مرة واحدة
    teams.forEach(function (t) {
      gameIds.forEach(function (gid) {
        const c = rows.filter(function (r) {
          return r.gameId === gid && (r.teamAId === t.id || r.teamBId === t.id);
        }).length;
        if (c !== 1) {
          errors.push('الفريق «' + t.name + '» لعب اللعبة رقم ' + gid + ' عدد ' + c + ' مرة (المفروض مرة واحدة).');
        }
      });
    });

    // القاعدة الإجبارية: مفيش فريق قاعد يستنى في أي جولة
    const bySlot = {};
    rows.forEach(function (r) {
      const k = r.periodId + '|' + r.round;
      bySlot[k] = bySlot[k] || { name: r.periodName, round: r.round, start: r.start, ids: {} };
      if (r.teamAId) bySlot[k].ids[r.teamAId] = true;
      if (r.teamBId) bySlot[k].ids[r.teamBId] = true;
    });
    Object.keys(bySlot).forEach(function (k) {
      const sl = bySlot[k];
      const idle = teams.filter(function (t) { return !sl.ids[t.id]; });
      if (idle.length) {
        errors.push('في «' + sl.name + '» جولة ' + sl.round + ' (' + sl.start + '): ' +
          idle.map(function (t) { return t.name; }).join('، ') + ' قاعدين من غير لعبة.');
      }
    });

    // تعارض: فريق في مكانين في نفس الوقت
    const byTime = {};
    rows.forEach(function (r) {
      const k = r.start;
      byTime[k] = byTime[k] || [];
      byTime[k].push(r);
    });
    Object.keys(byTime).forEach(function (k) {
      const seen = {};
      byTime[k].forEach(function (r) {
        [r.teamAId, r.teamBId].forEach(function (tid) {
          if (!tid) return;
          if (seen[tid]) errors.push('تعارض الساعة ' + k + ': فريق واحد في لعبتين في نفس الوقت.');
          seen[tid] = true;
        });
      });
    });

    return errors;
  }

  global.Scheduler = {
    analyze: analyze,
    generate: generate,
    validate: validate,
    periodSlots: periodSlots,
    toMinutes: toMinutes,
    fromMinutes: fromMinutes
  };
})(window);
