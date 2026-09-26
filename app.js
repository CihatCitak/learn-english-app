/* Learn English — kişisel tekrar & ilerleme PWA. Veri: data/*.json (tools/build_data.py üretir). */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const view = $('#view');
  const D = {}; // yüklenen veri
  let tab = 'home';
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const today = () => new Date().toISOString().slice(0, 10);
  const fmt = (n) => (n == null ? '—' : String(n).replace('.', ','));
  const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // markdown satır içi → html
  const md = (s) => esc(s)
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

  // ---------------------------------------------------------------- tema
  // Tema: data-theme + color-scheme (Android sanal tuş çubuğu ve kaydırma çubukları) + theme-color (durum çubuğu)
  const applyTheme = (t) => {
    document.documentElement.setAttribute('data-theme', t); LS.set('theme', t);
    document.documentElement.style.colorScheme = t;
    const bg = t === 'light' ? '#f4f5fa' : '#0f1117';
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bg));
  };
  applyTheme(LS.get('theme', window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  $('#themeBtn').onclick = () => applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');

  // ---------------------------------------------------------------- veri
  // Veri kaynağı: GitHub token varsa private repodan API ile, yoksa yanındaki data/ klasöründen (yerel geliştirme)
  const GH = { get owner() { return LS.get('ghOwner', 'CihatCitak'); }, get repo() { return LS.get('ghRepo', 'Learn-English'); }, get branch() { return LS.get('ghBranch', 'main'); }, get token() { return LS.get('ghToken', ''); } };
  const NAMES = ['meta', 'words', 'known', 'mistakes', 'missing', 'days', 'weeks', 'grammar'];
  async function fetchJson(name, bust) {
    if (GH.token) {
      const url = `https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/app/data/${name}.json?ref=${encodeURIComponent(GH.branch)}${bust ? '&t=' + Date.now() : ''}`;
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + GH.token, Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2022-11-28' }, cache: 'no-store' });
      if (!r.ok) throw new Error(`GitHub ${r.status}${r.status === 401 ? ' (token geçersiz)' : r.status === 404 ? ' (repo/dosya bulunamadı veya token yetkisiz)' : ''}`);
      return r.json();
    }
    const r = await fetch(`data/${name}.json${bust ? '?t=' + Date.now() : ''}`);
    if (!r.ok) throw new Error(`data/${name}.json ${r.status}`);
    return r.json();
  }
  async function load(bust) {
    let fromCache = false;
    try {
      const res = await Promise.all(NAMES.map((n) => fetchJson(n, bust)));
      NAMES.forEach((n, i) => (D[n] = res[i]));
      try { localStorage.setItem('dataCache', JSON.stringify(Object.fromEntries(NAMES.map((n) => [n, D[n]])))); LS.set('dataCacheAt', new Date().toISOString()); } catch {}
    } catch (e) {
      const c = LS.get('dataCache', null);
      if (!c) throw e;
      NAMES.forEach((n) => (D[n] = c[n]));
      fromCache = true;
      D.loadError = e.message;
    }
    D.wordMap = Object.fromEntries(D.words.map((w) => [w.word.toLowerCase(), w]));
    $('#builtAt').textContent = `veri: ${D.meta.built} · gün ${D.meta.lastDay}${GH.token ? ' · GitHub' : ' · yerel'}${fromCache ? ' · ÇEVRİMDIŞI (önbellek)' : ''}`;
  }
  $('#settingsBtn').onclick = () => { tab = 'settings'; LS.set('tab', tab); render(); };
  $('#refreshBtn').onclick = async () => {
    $('#builtAt').textContent = 'yenileniyor…';
    try { const reg = await navigator.serviceWorker?.getRegistration(); if (reg) await reg.update(); } catch {}
    await load(true); render();
  };
  // yeni service worker devreye girince sayfayı tazele (yeni kabuk)
  navigator.serviceWorker?.addEventListener('controllerchange', () => location.reload());

  // ---------------------------------------------------------------- modal
  const modal = $('#modal');
  const openModal = (title, html) => { $('#modalTitle').innerHTML = title; $('#modalBody').innerHTML = html; modal.hidden = false; };
  $('#modalClose').onclick = () => (modal.hidden = true);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') modal.hidden = true; });

  // ---------------------------------------------------------------- grafikler (inline SVG)
  function lineChart(series, labels, { max = 100, h = 150, unit = '%' } = {}) {
    const w = 640, padL = 30, padR = 8, padT = 12, padB = 24;
    const n = Math.max(...series.map((s) => s.values.length));
    const x = (i) => padL + (i * (w - padL - padR)) / Math.max(1, n - 1);
    const y = (v) => padT + (h - padT - padB) * (1 - v / max);
    let g = '';
    for (const gl of [0, 25, 50, 75, 100]) {
      const v = (gl / 100) * max;
      g += `<line x1="${padL}" x2="${w - padR}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${padL - 6}" y="${y(v) + 4}" font-size="10" fill="var(--muted)" text-anchor="end">${Math.round(v)}</text>`;
    }
    for (const s of series) {
      const pts = s.values.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean);
      g += `<polyline fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" points="${pts.join(' ')}"/>`;
      s.values.forEach((v, i) => { if (v != null) g += `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="${s.color}"/>`; });
    }
    labels.forEach((l, i) => { if (n <= 12 || i % Math.ceil(n / 12) === 0) g += `<text x="${x(i)}" y="${h - 6}" font-size="10" fill="var(--muted)" text-anchor="middle">${esc(l)}</text>`; });
    return `<svg class="chart" viewBox="0 0 ${w} ${h}">${g}</svg>`;
  }
  function barChart(groups, labels, { max = 100, h = 150 } = {}) {
    const w = 640, padL = 30, padR = 8, padT = 12, padB = 24;
    const n = labels.length, gw = (w - padL - padR) / n, bw = (gw * 0.7) / groups.length;
    const y = (v) => padT + (h - padT - padB) * (1 - v / max);
    let g = '';
    for (const gl of [0, 50, 100]) g += `<line x1="${padL}" x2="${w - padR}" y1="${y(gl)}" y2="${y(gl)}" stroke="var(--line)"/><text x="${padL - 6}" y="${y(gl) + 4}" font-size="10" fill="var(--muted)" text-anchor="end">${gl}</text>`;
    labels.forEach((l, i) => {
      groups.forEach((s, j) => {
        const v = s.values[i]; if (v == null) return;
        const x = padL + i * gw + gw * 0.15 + j * bw;
        g += `<rect x="${x}" y="${y(v)}" width="${bw - 3}" height="${y(0) - y(v)}" rx="4" fill="${s.color}"/><text x="${x + (bw - 3) / 2}" y="${y(v) - 4}" font-size="10" fill="var(--text)" text-anchor="middle">${v}</text>`;
      });
      g += `<text x="${padL + i * gw + gw / 2}" y="${h - 6}" font-size="10" fill="var(--muted)" text-anchor="middle">${esc(l)}</text>`;
    });
    return `<svg class="chart" viewBox="0 0 ${w} ${h}">${g}</svg>`;
  }
  const legend = (items) => `<div class="legend">${items.map((i) => `<span><i style="background:${i.color}"></i>${i.label}</span>`).join('')}</div>`;

  // ---------------------------------------------------------------- ÖZET
  function renderHome() {
    const m = D.meta, lessons = D.days.filter((d) => d.type === 'lesson' && d.total), exams = D.days.filter((d) => d.type === 'exam');
    const last = D.days[D.days.length - 1];
    const lastLesson = lessons[lessons.length - 1];
    const wk = D.weeks[D.weeks.length - 1];
    const mistOpen = D.mistakes.filter((x) => !x.closed && !x.isWordList);
    const hot = mistOpen.filter((x) => x.hot).length;
    const q = LS.get('quizStats', {}); const todayOk = Object.values(q).filter((s) => s.last === today() && s.lastOk).length, todayAll = Object.values(q).filter((s) => s.last === today()).length;

    let html = `<div class="tiles">
      <div class="tile"><div class="v">${m.words}</div><div class="l">öğrenilen kelime</div></div>
      <div class="tile"><div class="v">${m.known}</div><div class="l">bilinen (elenen)</div></div>
      <div class="tile"><div class="v">${m.lessons}<span class="small">+${m.exams}</span></div><div class="l">ders + sınav günü</div></div>
      <div class="tile"><div class="v" style="color:var(--bad)">${mistOpen.length}</div><div class="l">açık hata · ${hot} 🔴</div></div>
      <div class="tile"><div class="v" style="color:var(--ok)">${m.mistagesClosed ?? m.mistakesClosed}</div><div class="l">kapatılan hata</div></div>
      <div class="tile"><div class="v">${todayAll ? `${todayOk}/${todayAll}` : '—'}</div><div class="l">bugün sorulan (telefon)</div></div>
    </div>`;

    html += `<h2>Son gün</h2><div class="card tap" data-day="${last.day}"><div class="row between"><div><b>Gün ${last.day}</b> · ${esc(last.date)}</div>${scoreBadge(last)}</div><div class="sub mt">${md(last.topic)}</div></div>`;

    if (wk) {
      html += `<h2>Seviye (hafta ${wk.week})</h2><div class="card"><table class="kv">${Object.entries(wk.levels).map(([k, v]) => `<tr><td>${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`).join('')}</table></div>`;
    }

    html += `<h2>Günlük skor (%)</h2><div class="card">${lineChart([
      { values: lessons.map((d) => d.total.pct), color: 'var(--accent)' },
      { values: lessons.map((d) => (d.parts.yesterday ? pct(d.parts.yesterday.got, d.parts.yesterday.of) : null)), color: 'var(--ok)' },
    ], lessons.map((d) => 'g' + d.day))}${legend([{ color: 'var(--accent)', label: 'gün skoru' }, { color: 'var(--ok)', label: 'dün testi' }])}</div>`;

    html += `<h2>Haftalık sınavlar (%)</h2><div class="card">${barChart([
      { values: exams.map((e) => e.vocab?.pct ?? null), color: 'var(--accent)' },
      { values: exams.map((e) => e.general?.pct ?? null), color: 'var(--ok)' },
    ], exams.map((e, i) => 'Hafta ' + (i + 1)))}${legend([{ color: 'var(--accent)', label: 'kelime' }, { color: 'var(--ok)', label: 'genel' }])}</div>`;

    html += `<h2>Takvim</h2><div class="card">${calendar()}</div>`;

    if (wk && wk.goals.length) {
      html += `<h2>Bu haftanın hedefleri</h2><div class="card"><ul class="clean">${wk.goals.map((g) => `<li>${g.done ? '✅' : '⬜'} ${md(g.text)}</li>`).join('')}</ul></div>`;
    }
    view.innerHTML = html;
    view.querySelectorAll('[data-day]').forEach((el) => (el.onclick = () => showDay(+el.dataset.day)));
  }
  function scoreBadge(d) {
    if (d.type === 'exam') return `<span class="badge">K %${d.vocab?.pct ?? '?'} · G %${d.general?.pct ?? '?'}</span>`;
    if (!d.total) return `<span class="badge">${esc(d.score)}</span>`;
    const p = d.total.pct, cls = p >= 80 ? 'ok' : p >= 65 ? 'warn' : 'bad';
    return `<span class="badge ${cls}">%${p}</span>`;
  }
  function calendar() {
    const byDate = {}; D.days.forEach((d) => { if (d.day > 0) byDate[d.date] = d; });
    const end = new Date(); end.setHours(12);
    const start = new Date(end); start.setDate(end.getDate() - 41);
    while (start.getDay() !== 1) start.setDate(start.getDate() - 1); // pazartesi
    let html = '<div class="cal">' + ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pa'].map((h) => `<div class="h">${h}</div>`).join('');
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10), e = byDate[key];
      const cls = e ? (e.type === 'exam' ? 'exam' : 'on') : '';
      html += `<div class="d ${cls} ${key === today() ? 'today' : ''}" title="${key}">${e ? (e.type === 'exam' ? 'S' : e.day) : d.getDate()}</div>`;
    }
    return html + '</div><div class="small mt">Mavi = ders günü (numara = program günü) · yeşil S = sınav · sarı çerçeve = bugün</div>';
  }

  // ---------------------------------------------------------------- HATALAR
  const mf = { status: 'open', hot: false, q: '', cat: '' };
  function renderMistakes() {
    const all = D.mistakes.filter((x) => !x.isWordList);
    const cats = [...new Set(all.map((x) => x.category))];
    let list = all;
    if (mf.status === 'open') list = list.filter((x) => !x.closed);
    if (mf.status === 'closed') list = list.filter((x) => x.closed);
    if (mf.hot) list = list.filter((x) => x.hot);
    if (mf.cat) list = list.filter((x) => x.category === mf.cat);
    if (mf.q) { const q = mf.q.toLowerCase(); list = list.filter((x) => (x.title + ' ' + x.rule + ' ' + x.text).toLowerCase().includes(q)); }
    list.sort((a, b) => b.count - a.count || (b.days.at(-1) ?? 0) - (a.days.at(-1) ?? 0));
    let html = `<div class="row between"><h2>Hatalar</h2><span class="sub">${list.length} / ${all.length}</span></div>
      <input id="mq" placeholder="ara… (örn. however, edat, -ing)" value="${esc(mf.q)}">
      <div class="filters">
        ${['open:Açık', 'closed:Kapalı', 'all:Hepsi'].map((o) => { const [k, l] = o.split(':'); return `<button class="pill ${mf.status === k ? 'on' : ''}" data-st="${k}">${l}</button>`; }).join('')}
        <button class="pill ${mf.hot ? 'on' : ''}" id="hotBtn">🔴 kritik</button>
      </div>
      <div class="filters"><button class="pill ${!mf.cat ? 'on' : ''}" data-cat="">Tümü</button>${cats.map((c) => `<button class="pill ${mf.cat === c ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>`;
    html += list.length ? list.map((x) => `<div class="card tap mistake ${x.closed ? 'closed' : ''}" data-id="${x.id}">
        <div class="row between"><div class="title grow">${x.hot ? '🔴 ' : ''}${esc(x.title)}</div><span class="badge ${x.count >= 4 ? 'hot' : ''}">×${x.count}</span></div>
        ${x.examples[0] ? `<div class="meta"><span class="w">❌ ${esc(x.examples[0].wrong)}</span> → <span class="r">✅ ${esc(x.examples[0].right)}</span></div>` : (x.rule ? `<div class="meta">${md(x.rule).slice(0, 160)}</div>` : '')}
        <div class="meta"><span class="chip">${esc(x.category)}</span> ${x.days.length ? 'gün ' + x.days.slice(-6).join(', ') : ''}${x.closed ? ' · kapatıldı ✅' : ''}</div>
      </div>`).join('') : '<div class="empty">Sonuç yok</div>';
    view.innerHTML = html;
    $('#mq').oninput = (e) => { mf.q = e.target.value; renderMistakes(); const i = $('#mq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
    view.querySelectorAll('[data-st]').forEach((b) => (b.onclick = () => { mf.status = b.dataset.st; renderMistakes(); }));
    view.querySelectorAll('[data-cat]').forEach((b) => (b.onclick = () => { mf.cat = b.dataset.cat; renderMistakes(); }));
    $('#hotBtn').onclick = () => { mf.hot = !mf.hot; renderMistakes(); };
    view.querySelectorAll('[data-id]').forEach((el) => (el.onclick = () => showMistake(el.dataset.id)));
  }
  function showMistake(id) {
    const x = D.mistakes.find((m) => m.id === id);
    let html = `<div class="row" style="gap:6px;flex-wrap:wrap"><span class="badge ${x.count >= 4 ? 'hot' : ''}">×${x.count}</span>${x.closed ? '<span class="badge ok">kapatıldı</span>' : '<span class="badge bad">açık</span>'}<span class="chip">${esc(x.category)}</span></div>`;
    if (x.rule) html += `<h2>Kural</h2><div class="rule">${md(x.rule)}</div>`;
    if (x.examples.length) html += `<h2>Örnekler</h2><div class="ex">${x.examples.map((e) => `<div><span class="w">❌ ${md(e.wrong)}</span><br><span class="r">✅ ${md(e.right)}</span></div>`).join('')}</div>`;
    if (x.history && x.history.length) html += `<h2>Geçmiş</h2><ul class="timeline">${x.history.map((h) => `<li><span class="chip">${h.day != null ? 'g' + h.day : '—'}</span> ${md(h.text)}</li>`).join('')}</ul>`;
    else if (x.days.length) html += `<div class="mt small">Görüldüğü günler: ${x.days.join(', ')}</div>`;
    if (x.text) html += `<details class="mt"><summary class="small">Ham kayıt (mistakes.md)</summary><div class="raw">${md(x.text)}</div></details>`;
    openModal(esc(x.title), html);
  }

  // ---------------------------------------------------------------- SOR (kelime sorgusu, yerel)
  const qs = { mode: LS.get('quizMode', 'depth'), current: null, revealed: false };
  const stats = () => LS.get('quizStats', {});
  function quizQueue() {
    const st = stats(), t = today();
    const lastWeek = Math.max(...D.words.map((w) => w.week));
    const askedToday = (w) => st[w] && st[w].last === t;
    let pool;
    if (qs.mode === 'week') pool = D.words.filter((w) => w.week === lastWeek).map((w) => ({ word: w.word, meaning: w.meaning, depth: null }));
    else if (qs.mode === 'random') pool = D.words.map((w) => ({ word: w.word, meaning: w.meaning, depth: null }));
    else pool = D.missing.table.map((r) => ({ word: r.word, meaning: r.meaning, depth: r.depth, asked: r.asked, missed: r.missed, last: r.last }));
    pool = pool.filter((p) => !askedToday(p.word));
    if (qs.mode === 'depth') {
      // yerelde ✅ çıkan kelime 3 gün dinlenir (repo kuralıyla aynı), ❌ hemen geri gelir
      pool = pool.filter((p) => { const s = st[p.word]; if (!s || !s.lastOk) return true; return daysBetween(s.last, t) >= 3; });
    }
    if (qs.mode === 'random') pool.sort(() => Math.random() - 0.5);
    return pool;
  }
  const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
  function renderQuiz() {
    const st = stats(), t = today();
    const todayList = Object.entries(st).filter(([, s]) => s.last === t);
    const ok = todayList.filter(([, s]) => s.lastOk).length;
    const queue = quizQueue();
    if (!qs.current || !queue.find((p) => p.word === qs.current.word)) { qs.current = queue[0] || null; qs.revealed = false; }
    const c = qs.current;
    let html = `<div class="row between"><h2>Kelime sor</h2><span class="badge ${ok === todayList.length && todayList.length ? 'ok' : ''}">bugün ${ok}/${todayList.length}</span></div>
      <div class="filters">${[['depth', 'Derinlik sırası'], ['week', 'Bu hafta'], ['random', 'Rastgele']].map(([k, l]) => `<button class="pill ${qs.mode === k ? 'on' : ''}" data-mode="${k}">${l}</button>`).join('')}</div>`;
    if (!c) {
      html += `<div class="card empty">Bu modda bugün sorulacak kelime kalmadı 🎉<br><span class="small">Sıfırlamak için aşağıdaki düğmeyi kullan.</span></div>`;
    } else {
      const w = D.wordMap[c.word.toLowerCase()];
      html += `<div class="card">
        <div class="quiz-meta">${c.depth != null ? `derinlik ${fmt(c.depth)} · ${fmt(c.asked)} soruldu / ${fmt(c.missed)} kaçtı · son gün ${c.last}` : `gün ${w?.day ?? '?'}`} · sırada ${queue.length}</div>
        <div class="quiz-word">${esc(c.word)}</div>
        ${qs.revealed ? `<div class="quiz-answer"><div><b>${md(c.meaning)}</b></div>${w ? `<div class="mt">${md(w.example)}</div>` : ''}</div>
          <div class="btnrow"><button class="btn ok" id="qOk">✅ Bildim</button><button class="btn bad" id="qBad">❌ Bilemedim</button></div>`
        : `<input id="qGuess" placeholder="Türkçe anlamını yaz (isteğe bağlı)" autocomplete="off">
           <div class="btnrow"><button class="btn primary" id="qShow">Anlamı göster</button><button class="btn ghost" id="qSkip">Atla</button></div>`}
      </div>`;
    }
    const hist = Object.entries(st).sort((a, b) => (b[1].last > a[1].last ? 1 : -1)).slice(0, 12);
    if (hist.length) html += `<h2>Son cevaplar (telefonda)</h2><div class="card">${hist.map(([w, s]) => `<div class="row between" style="padding:4px 0"><span>${esc(w)}</span><span class="small">${s.last} · ✅${s.ok} ❌${s.bad}</span></div>`).join('')}</div>`;
    html += `<div class="btnrow"><button class="btn ghost" id="qReset">Yerel kayıtları sıfırla</button></div>
      <div class="small mt">Sonuçlar şimdilik sadece bu telefonda saklanır; GitHub'a yazmaz. Derinlik sırası <code>missingwords.md</code>'den gelir.</div>`;
    view.innerHTML = html;
    view.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { qs.mode = b.dataset.mode; LS.set('quizMode', qs.mode); qs.current = null; renderQuiz(); }));
    const show = () => { qs.revealed = true; renderQuiz(); };
    $('#qShow') && ($('#qShow').onclick = show);
    $('#qGuess') && ($('#qGuess').onkeydown = (e) => { if (e.key === 'Enter') show(); });
    $('#qSkip') && ($('#qSkip').onclick = () => { const q = quizQueue(); const i = q.findIndex((p) => p.word === c.word); qs.current = q[(i + 1) % q.length]; qs.revealed = false; renderQuiz(); });
    const answer = (okFlag) => { const s = st[c.word] || { ok: 0, bad: 0 }; s[okFlag ? 'ok' : 'bad']++; s.last = t; s.lastOk = okFlag; st[c.word] = s; LS.set('quizStats', st); qs.current = null; renderQuiz(); };
    $('#qOk') && ($('#qOk').onclick = () => answer(true));
    $('#qBad') && ($('#qBad').onclick = () => answer(false));
    $('#qReset').onclick = () => { if (confirm('Telefondaki kelime sorgu kayıtları silinsin mi?')) { LS.set('quizStats', {}); qs.current = null; renderQuiz(); } };
  }

  // ---------------------------------------------------------------- KELİMELER
  const wf = { q: '', set: 'learned', week: 0 };
  function renderWords() {
    const weeks = [...new Set(D.words.map((w) => w.week))].sort((a, b) => a - b);
    let list = wf.set === 'known' ? D.known : D.words;
    if (wf.week && wf.set === 'learned') list = list.filter((w) => w.week === wf.week);
    if (wf.q) { const q = wf.q.toLowerCase(); list = list.filter((w) => w.word.toLowerCase().includes(q) || w.meaning.toLowerCase().includes(q)); }
    list = [...list].sort((a, b) => b.day - a.day || a.word.localeCompare(b.word));
    let html = `<div class="row between"><h2>Kelimeler</h2><span class="sub">${list.length}</span></div>
      <input id="wq" placeholder="kelime veya anlam ara…" value="${esc(wf.q)}">
      <div class="filters"><button class="pill ${wf.set === 'learned' ? 'on' : ''}" data-set="learned">Öğrenilen (${D.words.length})</button><button class="pill ${wf.set === 'known' ? 'on' : ''}" data-set="known">Bilinen (${D.known.length})</button></div>`;
    if (wf.set === 'learned') html += `<div class="filters"><button class="pill ${!wf.week ? 'on' : ''}" data-week="0">Tümü</button>${weeks.map((w) => `<button class="pill ${wf.week === w ? 'on' : ''}" data-week="${w}">H${w}</button>`).join('')}</div>`;
    html += list.map((w) => `<div class="card tap word" data-w="${esc(w.word)}"><div class="row between"><div class="grow"><span class="w">${esc(w.word)}</span> <span class="m">— ${md(w.meaning)}</span></div><span class="chip">g${w.day}</span></div>${w.example ? `<div class="e">${md(w.example)}</div>` : `<div class="e small">${esc(w.when || '')}</div>`}</div>`).join('');
    view.innerHTML = html;
    $('#wq').oninput = (e) => { wf.q = e.target.value; renderWords(); const i = $('#wq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
    view.querySelectorAll('[data-set]').forEach((b) => (b.onclick = () => { wf.set = b.dataset.set; renderWords(); }));
    view.querySelectorAll('[data-week]').forEach((b) => (b.onclick = () => { wf.week = +b.dataset.week; renderWords(); }));
    view.querySelectorAll('.word').forEach((el) => (el.onclick = () => el.classList.toggle('open')));
  }

  // ---------------------------------------------------------------- GÜNLER + HAFTALAR
  const df = { tab: 'days' };
  function renderDays() {
    let html = `<div class="filters"><button class="pill ${df.tab === 'days' ? 'on' : ''}" data-dt="days">Günler</button><button class="pill ${df.tab === 'weeks' ? 'on' : ''}" data-dt="weeks">Haftalık raporlar</button></div>`;
    if (df.tab === 'days') {
      html += [...D.days].reverse().map((d) => `<div class="card tap day" data-day="${d.day}">
        <div class="row between"><div><b>Gün ${d.day}</b> <span class="small">${esc(d.date)}${d.week ? ' · H' + d.week : ''}</span></div>${scoreBadge(d)}</div>
        <div class="topic mt">${md(d.topic)}</div>
        ${d.total ? `<div class="score-bar"><i style="width:${d.total.pct}%"></i></div>` : ''}
      </div>`).join('');
    } else if (df.tab === 'weeks') {
      html += [...D.weeks].reverse().map((w) => {
        const m = w.metrics, v = (k) => m[k]?.value;
        return `<div class="card"><div class="row between"><b>Hafta ${w.week}</b><span class="small">${esc(w.start)} → ${esc(w.end)}</span></div>
          <div class="tiles mt">
            <div class="tile"><div class="v">%${fmt(v('vocabExam'))}</div><div class="l">kelime sınavı</div></div>
            <div class="tile"><div class="v">%${fmt(v('generalExam'))}</div><div class="l">genel sınav</div></div>
            <div class="tile"><div class="v">%${fmt(v('dailyAvg'))}</div><div class="l">günlük ort.</div></div>
            <div class="tile"><div class="v">${fmt(v('yesterdayAvg'))}</div><div class="l">dün testi ort.</div></div>
            <div class="tile"><div class="v">${fmt(v('words'))}</div><div class="l">kelime (küm.)</div></div>
            <div class="tile"><div class="v">${fmt(v('closed'))}</div><div class="l">kapatılan hata</div></div>
          </div>
          <table class="kv mt">${Object.entries(w.levels).map(([k, val]) => `<tr><td>${esc(k)}</td><td><b>${esc(val)}</b></td></tr>`).join('')}</table>
          <h2>Yeni yapabildiklerim</h2><ul class="clean">${w.cando.map((c) => `<li>✅ ${md(c)}</li>`).join('')}</ul>
          <h2>En zayıf</h2><ul class="clean">${w.weak.map((c) => `<li>${md(c)}</li>`).join('')}</ul>
          <h2>Hedefler</h2><ul class="clean">${w.goals.map((g) => `<li>${g.done ? '✅' : '⬜'} ${md(g.text)}</li>`).join('')}</ul>
          ${w.hasMonthly ? '<div class="small mt">📅 Bu raporda aylık bakış bölümü var (repo: ' + esc(w.file) + ')</div>' : ''}
        </div>`;
      }).join('');
    }
    view.innerHTML = html;
    view.querySelectorAll('[data-dt]').forEach((b) => (b.onclick = () => { df.tab = b.dataset.dt; renderDays(); }));
    view.querySelectorAll('[data-day]').forEach((el) => (el.onclick = () => showDay(+el.dataset.day)));
  }
  function showDay(n) {
    const d = D.days.find((x) => x.day === n);
    if (!d) return;
    let html = `<div class="small">${esc(d.date)} · ${d.week ? 'Hafta ' + d.week : ''}</div><div class="mt">${md(d.topic)}</div>`;
    if (d.parts && Object.keys(d.parts).length) {
      const names = { yesterday: 'Dün testi', depth: 'Derinlik turu', oldround: 'Eski tur', review: 'Tekrar', grammar: 'Gramer', reading: 'Okuma' };
      html += `<table class="kv mt">${Object.entries(d.parts).map(([k, v]) => `<tr><td>${names[k]}</td><td><b>${fmt(v.got)}/${v.of}</b> <span class="small">%${pct(v.got, v.of)}</span></td></tr>`).join('')}<tr><td>Toplam</td><td><b>${fmt(d.total?.got)}/${d.total?.of}</b> <span class="small">%${d.total?.pct}</span></td></tr></table>`;
    } else html += `<div class="mt"><b>${md(d.score)}</b></div>`;
    if (d.summary) html += `<h2>Özet</h2><div style="line-height:1.6">${md(d.summary)}</div>`;
    if (d.grammar) html += `<div class="mt small">📐 ${esc(d.grammar)}</div>`;
    if (d.file) html += `<div class="mt small">📄 ${esc(d.file)}</div>`;
    openModal(`Gün ${d.day}`, html);
  }

  // ---------------------------------------------------------------- GRAMER
  const gf = { q: '', tag: '' };
  function renderGrammar() {
    const tags = [...new Set(D.grammar.map((g) => g.tag))];
    let list = D.grammar;
    if (gf.tag) list = list.filter((g) => g.tag === gf.tag);
    if (gf.q) { const q = gf.q.toLowerCase(); list = list.filter((g) => JSON.stringify(g).toLowerCase().includes(q)); }
    list = [...list].reverse();
    let html = `<div class="row between"><h2>Gramer</h2><span class="sub">${list.length} konu</span></div>
      <input id="gq" placeholder="konu, kural veya örnek ara…" value="${esc(gf.q)}">
      <div class="filters"><button class="pill ${!gf.tag ? 'on' : ''}" data-tag="">Tümü</button>${tags.map((c) => `<button class="pill ${gf.tag === c ? 'on' : ''}" data-tag="${esc(c)}">${esc(c)}</button>`).join('')}</div>`;
    html += list.map((g) => {
      const sc = g.score ? pct(g.score.got, g.score.of) : null;
      return `<div class="card tap gram" data-g="${g.day}">
        <div class="row between"><div class="grow"><div class="title"><b>${esc(g.title)}</b></div><div class="small">gün ${g.day} · ${esc(g.date)} · ${esc(g.tag)}</div></div>${sc != null ? `<span class="badge ${sc >= 80 ? 'ok' : sc >= 65 ? 'warn' : 'bad'}">${fmt(g.score.got)}/${g.score.of}</span>` : ''}</div>
        <div class="meta mt">${esc(g.summary)}</div>
      </div>`;
    }).join('');
    html += `<h2>Müfredat</h2><div class="card"><ul class="clean">${D.meta.phases.map((p) => `<li><b>${esc(p[0])}</b>: ${md(p[1])}</li>`).join('')}</ul></div>`;
    view.innerHTML = html;
    $('#gq').oninput = (e) => { gf.q = e.target.value; renderGrammar(); const i = $('#gq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
    view.querySelectorAll('[data-tag]').forEach((b) => (b.onclick = () => { gf.tag = b.dataset.tag; renderGrammar(); }));
    view.querySelectorAll('[data-g]').forEach((el) => (el.onclick = () => showGrammar(+el.dataset.g)));
  }
  function showGrammar(day) {
    const g = D.grammar.find((x) => x.day === day);
    if (!g) return;
    let html = `<div class="small">gün ${g.day} · ${esc(g.date)} · ${esc(g.tag)}${g.score ? ` · derste ${fmt(g.score.got)}/${g.score.of}` : ''}</div>
      <div class="rule mt">${esc(g.summary)}</div>`;
    if (g.uses?.length) html += `<h2>Ne zaman kullanılır</h2><ul class="clean">${g.uses.map((u) => `<li>${md(u)}</li>`).join('')}</ul>`;
    if (g.forms?.length) html += `<h2>Yapı</h2><div class="tablewrap"><table class="kv forms">${g.forms.map((f) => `<tr><td>${esc(f[0])}</td><td><code>${esc(f[1])}</code></td><td>${esc(f[2])}</td></tr>`).join('')}</table></div>`;
    if (g.examples?.length) html += `<h2>Örnekler</h2><div class="ex">${g.examples.map((e) => `<div><div>${esc(e.en)}</div><div class="small">${esc(e.tr)}</div></div>`).join('')}</div>`;
    if (g.mistakes?.length) html += `<h2>Senin hataların</h2><div class="ex">${g.mistakes.map((m) => `<div><span class="w">❌ ${esc(m.wrong)}</span><br><span class="r">✅ ${esc(m.right)}</span>${m.note ? `<div class="small">${esc(m.note)}</div>` : ''}</div>`).join('')}</div>`;
    if (g.tips?.length) html += `<h2>İpuçları</h2><ul class="clean">${g.tips.map((u) => `<li>💡 ${md(u)}</li>`).join('')}</ul>`;
    if (g.file) html += `<div class="mt small">📄 ${esc(g.file)}${g.header ? ' · ' + esc(g.header) : ''}</div>`;
    openModal(esc(g.title), html);
  }

  // ---------------------------------------------------------------- AYARLAR (GitHub bağlantısı)
  function renderSettings() {
    const at = LS.get('dataCacheAt', '');
    view.innerHTML = `<h2>GitHub bağlantısı</h2>
      <div class="card">
        <div class="small">Veri private repodan GitHub API ile okunur. Token yalnızca bu telefonda (localStorage) saklanır; hiçbir yere gönderilmez, GitHub dışında hiçbir istek yapılmaz.</div>
        <label class="small mt">Repo sahibi</label><input id="sOwner" value="${esc(GH.owner)}" autocapitalize="off">
        <label class="small mt">Repo adı</label><input id="sRepo" value="${esc(GH.repo)}" autocapitalize="off">
        <label class="small mt">Dal</label><input id="sBranch" value="${esc(GH.branch)}" autocapitalize="off">
        <label class="small mt">Fine-grained token (Contents: Read-only)</label><input id="sToken" type="password" value="${esc(GH.token)}" placeholder="github_pat_…" autocapitalize="off" autocomplete="off">
        <div class="btnrow"><button class="btn primary" id="sSave">Kaydet ve bağlan</button><button class="btn ghost" id="sClear">Token'ı sil</button></div>
        <div id="sMsg" class="small mt">${GH.token ? 'Token kayıtlı.' : 'Token yok — yerel data/ klasöründen okunuyor (sadece PC’de çalışır).'}${at ? ' Son başarılı veri: ' + at.slice(0, 16).replace('T', ' ') : ''}</div>
      </div>
      <h2>Token nasıl alınır</h2>
      <div class="card small" style="line-height:1.7">
        1. GitHub → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token<br>
        2. Repository access: <b>Only select repositories</b> → Learn-English<br>
        3. Permissions → Repository permissions → <b>Contents: Read-only</b> (başka izin yok)<br>
        4. Expiration: istediğin süre (bitince buraya yenisini yapıştırırsın)<br>
        5. Token'ı yukarıya yapıştır → Kaydet
      </div>
      <h2>Uygulama</h2>
      <div class="card small">Kabuk sürümü: <b id="shellVer">—</b> · Veri: ${D.meta?.built ?? '—'} · Veri kaynağı: ${GH.token ? 'GitHub API' : 'yerel'}<br>Telefondaki kelime sorgu kayıtları ve token silinmez; sadece "Yerel kayıtları sıfırla" (Sor sekmesi) ve "Token'ı sil" ile.</div>`;
    $('#sSave').onclick = async () => {
      LS.set('ghOwner', $('#sOwner').value.trim()); LS.set('ghRepo', $('#sRepo').value.trim()); LS.set('ghBranch', $('#sBranch').value.trim() || 'main'); LS.set('ghToken', $('#sToken').value.trim());
      $('#sMsg').textContent = 'bağlanıyor…';
      try { await load(true); $('#sMsg').textContent = `✅ Bağlandı — veri ${D.meta.built}, gün ${D.meta.lastDay}`; render(); }
      catch (e) { $('#sMsg').textContent = '❌ ' + e.message; }
    };
    $('#sClear').onclick = () => { LS.set('ghToken', ''); renderSettings(); };
    // kabuk sürümünü service worker'dan sor
    const ctrl = navigator.serviceWorker?.controller;
    if (ctrl) {
      const onMsg = (e) => { if (e.data?.type === 'version') { const el = $('#shellVer'); if (el) el.textContent = e.data.version; navigator.serviceWorker.removeEventListener('message', onMsg); } };
      navigator.serviceWorker.addEventListener('message', onMsg);
      ctrl.postMessage('version');
    } else { const el = $('#shellVer'); if (el) el.textContent = 'sw yok'; }
  }

  // ---------------------------------------------------------------- sekmeler
  const tabs = { home: renderHome, mistakes: renderMistakes, quiz: renderQuiz, grammar: renderGrammar, words: renderWords, days: renderDays, settings: renderSettings };
  tab = LS.get('tab', 'home');
  function render() { (tabs[tab] || renderHome)(); document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab)); }
  document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; LS.set('tab', tab); window.scrollTo(0, 0); render(); }));

  load().then(render).catch((e) => { D.meta = D.meta || {}; view.innerHTML = `<div class="empty">Veri yüklenemedi: ${esc(e.message)}<br><span class="small">GitHub token girmen gerekiyor.</span></div>`; setTimeout(() => { tab = 'settings'; renderSettings(); }, 800); });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // her açılışta ve uygulama öne her geldiğinde yeni kabuk var mı diye bak (PWA'da tarayıcı bunu 24 saatte bir yapar)
      const check = () => reg.update().catch(() => {});
      check();
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    }).catch(() => {});
  }
})();
