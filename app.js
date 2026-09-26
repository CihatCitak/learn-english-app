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
  const nowIso = () => new Date().toISOString().slice(0, 16);
  const fmt = (n) => (n == null ? '—' : String(n).replace('.', ','));
  const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // markdown satır içi → html
  const md = (s) => esc(s)
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

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
  const API = () => `https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/`;
  const HDR = (accept) => ({ Authorization: 'Bearer ' + GH.token, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' });
  const NAMES = ['meta', 'words', 'known', 'mistakes', 'missing', 'days', 'weeks', 'grammar'];
  async function fetchJson(name, bust) {
    if (GH.token) {
      const url = `${API()}app/data/${name}.json?ref=${encodeURIComponent(GH.branch)}${bust ? '&t=' + Date.now() : ''}`;
      const r = await fetch(url, { headers: HDR('application/vnd.github.raw+json'), cache: 'no-store' });
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
    D.lastWeek = Math.max(...D.words.map((w) => w.week));
    D.lastLessonDay = Math.max(...D.words.map((w) => w.day));
    $('#builtAt').textContent = `veri: ${D.meta.built} · gün ${D.meta.lastDay}${GH.token ? '' : ' · yerel'}${fromCache ? ' · çevrimdışı' : ''}`;
  }
  $('#settingsBtn').onclick = () => { tab = 'settings'; LS.set('tab', tab); render(); };
  $('#refreshBtn').onclick = async () => {
    $('#builtAt').textContent = 'yenileniyor…';
    try { const reg = await navigator.serviceWorker?.getRegistration(); if (reg) await reg.update(); } catch {}
    syncLog().catch(() => {});
    await load(true); render();
  };
  // yeni service worker devreye girince sayfayı tazele (yeni kabuk)
  navigator.serviceWorker?.addEventListener('controllerchange', () => location.reload());

  // ---------------------------------------------------------------- sorgu günlüğü → GitHub (app/quiz_log.json)
  // Her ✅/❌ önce telefonda kuyruğa girer, sonra GitHub'daki quiz_log.json'a eklenir (token'da Contents: Read and write gerekir).
  // Ders tarafı: tools/apply_quiz_log.py bu kayıtları missingwords.md sayaçlarına işler.
  const LOG_PATH = 'app/quiz_log.json';
  const pending = () => LS.get('pendingLog', []);
  function logEntry(kind, key, mode, ok) {
    const p = pending(); p.push({ t: nowIso(), kind, key, mode, ok }); LS.set('pendingLog', p);
    scheduleSync();
  }
  let syncTimer = null, syncing = false;
  function scheduleSync() { clearTimeout(syncTimer); syncTimer = setTimeout(() => syncLog().catch(() => {}), 3000); }
  const b64enc = (s) => btoa(unescape(encodeURIComponent(s)));
  const b64dec = (s) => decodeURIComponent(escape(atob(s.replace(/\n/g, ''))));
  async function ghGetFile(path) {
    const r = await fetch(`${API()}${path}?ref=${encodeURIComponent(GH.branch)}&t=${Date.now()}`, { headers: HDR('application/vnd.github+json'), cache: 'no-store' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('GitHub ' + r.status);
    const j = await r.json();
    return { sha: j.sha, json: JSON.parse(b64dec(j.content)) };
  }
  async function ghPutFile(path, obj, sha, message) {
    const body = { message, content: b64enc(JSON.stringify(obj, null, 1) + '\n'), branch: GH.branch };
    if (sha) body.sha = sha;
    const r = await fetch(`${API()}${path}`, { method: 'PUT', headers: { ...HDR('application/vnd.github+json'), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(r.status === 403 || r.status === 404 ? 'yazma izni yok (token: Contents Read and write olmalı)' : r.status === 409 ? 'çakışma' : 'GitHub ' + r.status);
  }
  async function syncLog() {
    if (!GH.token || syncing || !navigator.onLine) return;
    const p = pending(); if (!p.length) return;
    syncing = true;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const f = await ghGetFile(LOG_PATH);
          const log = f?.json && Array.isArray(f.json.entries) ? f.json : { entries: [], processedThrough: null };
          log.entries.push(...p);
          await ghPutFile(LOG_PATH, log, f?.sha, `quiz log: +${p.length} (telefon)`);
          LS.set('pendingLog', pending().slice(p.length));
          LS.set('lastSync', nowIso()); LS.set('syncError', '');
          break;
        } catch (e) { if (e.message !== 'çakışma' || attempt) { LS.set('syncError', e.message); throw e; } }
      }
    } finally { syncing = false; if (tab === 'quiz' || tab === 'settings' || tab === 'mistakes') renderSyncBadge(); }
  }
  function syncStatusText() {
    const n = pending().length, err = LS.get('syncError', ''), at = LS.get('lastSync', '');
    if (!GH.token) return 'günlük sadece telefonda (token yok)';
    if (err) return `gönderilemedi: ${err}${n ? ` · bekleyen ${n}` : ''}`;
    if (n) return `bekleyen ${n} kayıt`;
    return at ? `GitHub'a yazıldı · ${at.slice(5, 16).replace('T', ' ')}` : 'henüz kayıt yok';
  }
  function renderSyncBadge() { const el = $('#syncStatus'); if (el) el.textContent = syncStatusText(); }
  window.addEventListener('online', () => syncLog().catch(() => {}));

  // ---------------------------------------------------------------- modal
  const modal = $('#modal');
  const openModal = (title, html) => { $('#modalTitle').innerHTML = title; $('#modalBody').innerHTML = html; modal.hidden = false; };
  $('#modalClose').onclick = () => (modal.hidden = true);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') modal.hidden = true; });

  // ---------------------------------------------------------------- grafikler (inline SVG)
  function lineChart(series, labels, { max = 100, h = 150 } = {}) {
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

  // ---------------------------------------------------------------- telefon istatistikleri (yerel)
  const wordStats = () => LS.get('quizStats', {});
  const mistakeStats = () => LS.get('mistakeStats', {});
  function todayCounts() {
    const t = today(); let ok = 0, all = 0;
    for (const st of [wordStats(), mistakeStats()]) for (const s of Object.values(st)) if (s.last === t) { all++; if (s.lastOk) ok++; }
    return { ok, all };
  }

  // ---------------------------------------------------------------- ÖZET
  function renderHome() {
    const m = D.meta, lessons = D.days.filter((d) => d.type === 'lesson' && d.total), exams = D.days.filter((d) => d.type === 'exam');
    const last = D.days[D.days.length - 1];
    const wk = D.weeks[D.weeks.length - 1], prev = D.weeks[D.weeks.length - 2];
    const mistOpen = D.mistakes.filter((x) => !x.closed && !x.isWordList);
    const hot = mistOpen.filter((x) => x.hot).length;
    const critical = D.missing.table.filter((r) => r.depth >= 8).length;
    const tc = todayCounts();
    const phase = m.phases[Math.min(m.phases.length - 1, Math.floor((D.lastWeek - 1) / 4))];

    let html = `<div class="tiles">
      <div class="tile"><div class="v">${m.words}</div><div class="l">öğrenilen kelime</div></div>
      <div class="tile tap" data-go="quiz:depth"><div class="v" style="color:var(--hot)">${critical}</div><div class="l">kritik kelime (derinlik ≥ 8)</div></div>
      <div class="tile"><div class="v">${m.lessons}<span class="small">+${m.exams}</span></div><div class="l">ders + sınav günü</div></div>
      <div class="tile tap" data-go="mistakes:"><div class="v" style="color:var(--bad)">${mistOpen.length}</div><div class="l">açık hata · ${hot} kritik</div></div>
      <div class="tile"><div class="v" style="color:var(--ok)">${m.mistakesClosed}</div><div class="l">kapatılan hata</div></div>
      <div class="tile tap" data-go="quiz:"><div class="v">${tc.all ? `${tc.ok}/${tc.all}` : '—'}</div><div class="l">bugün sorulan</div></div>
    </div>`;

    html += `<h2>Son gün</h2><div class="card tap" data-day="${last.day}"><div class="row between"><div><b>Gün ${last.day}</b> · ${esc(last.date)}</div>${scoreBadge(last)}</div><div class="sub mt clamp2">${md(shortTopic(last.topic))}</div></div>`;

    if (wk) {
      html += `<h2>Seviye (hafta ${wk.week})</h2><div class="card"><table class="kv">${Object.entries(wk.levels).map(([k, v]) => {
        const p = prev?.levels?.[k]; const pv = p ? p.replace(/\s*[↑↓→]\s*$/, '') : '';
        return `<tr><td>${esc(k)}</td><td>${pv && pv !== v.replace(/\s*[↑↓→]\s*$/, '') ? `<span class="small">${esc(pv)} → </span>` : ''}<b>${esc(v)}</b></td></tr>`;
      }).join('')}</table></div>`;
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
    if (phase) html += `<div class="card small"><b>${esc(phase[0])}</b> ${md(phase[1])}</div>`;
    view.innerHTML = html;
    view.querySelectorAll('[data-day]').forEach((el) => (el.onclick = () => showDay(+el.dataset.day)));
    view.querySelectorAll('[data-go]').forEach((el) => (el.onclick = () => { const [t, mode] = el.dataset.go.split(':'); if (mode) { qs.mode = mode; LS.set('quizMode', mode); qs.current = null; } tab = t; LS.set('tab', t); window.scrollTo(0, 0); render(); }));
  }
  const shortTopic = (t) => (t || '').split(' · ')[0];
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
    return html + '</div><div class="small mt">Mavi: ders günü (numara = program günü) · yeşil S: sınav · sarı çerçeve: bugün</div>';
  }

  // ---------------------------------------------------------------- HATALAR (liste + tekrar modu)
  const mf = { status: 'open', hot: false, q: '', cat: '', view: 'list' };
  const ms = { current: null, revealed: false };
  function renderMistakes() {
    let html = `<div class="row between"><h2>Hatalar</h2><div class="filters" style="margin:0"><button class="pill ${mf.view === 'list' ? 'on' : ''}" data-mv="list">Liste</button><button class="pill ${mf.view === 'drill' ? 'on' : ''}" data-mv="drill">Tekrar</button></div></div>`;
    html += mf.view === 'drill' ? drillHtml() : listHtml();
    view.innerHTML = html;
    view.querySelectorAll('[data-mv]').forEach((b) => (b.onclick = () => { mf.view = b.dataset.mv; renderMistakes(); }));
    if (mf.view === 'drill') bindDrill(); else bindList();
  }
  function listHtml() {
    const all = D.mistakes.filter((x) => !x.isWordList);
    const cats = [...new Set(all.map((x) => x.category))];
    let list = all;
    if (mf.status === 'open') list = list.filter((x) => !x.closed);
    if (mf.status === 'closed') list = list.filter((x) => x.closed);
    if (mf.hot) list = list.filter((x) => x.hot);
    if (mf.cat) list = list.filter((x) => x.category === mf.cat);
    if (mf.q) { const q = mf.q.toLowerCase(); list = list.filter((x) => (x.title + ' ' + x.rule + ' ' + x.text).toLowerCase().includes(q)); }
    list.sort((a, b) => b.count - a.count || (b.days.at(-1) ?? 0) - (a.days.at(-1) ?? 0));
    mf.list = list;
    let html = `<input id="mq" placeholder="ara: however, edat, -ing…" value="${esc(mf.q)}">
      <div class="filters">
        ${['open:Açık', 'closed:Kapalı', 'all:Hepsi'].map((o) => { const [k, l] = o.split(':'); return `<button class="pill ${mf.status === k ? 'on' : ''}" data-st="${k}">${l}</button>`; }).join('')}
        <button class="pill ${mf.hot ? 'on' : ''}" id="hotBtn">🔴 kritik</button><span class="sub" style="align-self:center">${list.length} / ${all.length}</span>
      </div>
      <div class="filters"><button class="pill ${!mf.cat ? 'on' : ''}" data-cat="">Tümü</button>${cats.map((c) => `<button class="pill ${mf.cat === c ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>`;
    html += list.length ? list.map((x) => `<div class="card tap mistake ${x.closed ? 'closed' : ''}" data-id="${x.id}">
        <div class="row between"><div class="title grow clamp2">${x.hot ? '🔴 ' : ''}${esc(clip(x.title, 90))}</div><span class="badge ${x.count >= 4 ? 'hot' : ''}">×${x.count}</span></div>
        ${x.examples[0] ? `<div class="meta"><span class="w">❌ ${esc(x.examples[0].wrong)}</span><br><span class="r">✅ ${esc(x.examples[0].right)}</span></div>` : (x.rule ? `<div class="meta">${md(clip(x.rule, 140))}</div>` : '')}
        <div class="meta"><span class="chip">${esc(x.category)}</span> ${x.days.length ? 'gün ' + x.days.slice(-5).join(', ') : ''}${x.closed ? ' · kapatıldı' : ''}</div>
      </div>`).join('') : '<div class="empty">Sonuç yok</div>';
    return html;
  }
  function bindList() {
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
  // Tekrar modu: yanlış cümle gösterilir, kafanda düzelt, doğrusunu gör, ✅/❌ ver. Kaynak: katalog örnekleri.
  function drillQueue() {
    const st = mistakeStats(), t = today();
    let pool = D.mistakes.filter((x) => !x.isWordList && !x.closed && x.examples.length);
    pool = pool.filter((x) => { const s = st[x.id]; if (!s) return true; if (s.last === t) return false; return !s.lastOk || daysBetween(s.last, t) >= 3; });
    pool.sort((a, b) => (b.hot - a.hot) || (b.count - a.count));
    return pool;
  }
  function drillHtml() {
    const queue = drillQueue();
    if (!ms.current || !queue.find((x) => x.id === ms.current.id)) { ms.current = queue[0] || null; ms.revealed = false; ms.exIdx = 0; }
    const x = ms.current;
    let html = `<div class="small" id="syncStatus">${syncStatusText()}</div>`;
    if (!x) return html + `<div class="card empty">Bugün tekrar edilecek hata kalmadı.<br><span class="small">✅ verilen hata 3 gün dinlenir, ❌ ertesi gün geri gelir.</span></div>`;
    const ex = x.examples[ms.exIdx % x.examples.length];
    html += `<div class="card">
      <div class="quiz-meta">${x.hot ? '🔴 ' : ''}${esc(x.category)} · ×${x.count} · sırada ${queue.length}</div>
      <div class="drill-wrong">❌ ${md(ex.wrong)}</div>
      ${ms.revealed ? `<div class="quiz-answer"><div class="r">✅ ${md(ex.right)}</div>${x.rule ? `<div class="mt small" style="color:var(--text)">${md(x.rule)}</div>` : ''}</div>
        <div class="btnrow"><button class="btn ok" id="dOk">✅ Bildim</button><button class="btn bad" id="dBad">❌ Bilemedim</button></div>`
      : `<div class="small mt" style="text-align:center">Hatayı bul ve kafanda düzelt</div>
         <div class="btnrow"><button class="btn primary" id="dShow">Doğrusunu göster</button><button class="btn ghost" id="dSkip">Atla</button></div>`}
    </div>`;
    return html;
  }
  function bindDrill() {
    const x = ms.current; if (!x) return;
    $('#dShow') && ($('#dShow').onclick = () => { ms.revealed = true; renderMistakes(); });
    $('#dSkip') && ($('#dSkip').onclick = () => { const q = drillQueue(); const i = q.findIndex((m) => m.id === x.id); ms.current = q[(i + 1) % q.length]; ms.revealed = false; ms.exIdx = Math.floor(Math.random() * 9); renderMistakes(); });
    const answer = (ok) => { const st = mistakeStats(); const s = st[x.id] || { ok: 0, bad: 0 }; s[ok ? 'ok' : 'bad']++; s.last = today(); s.lastOk = ok; st[x.id] = s; LS.set('mistakeStats', st); logEntry('mistake', x.id + ' ' + x.title, 'drill', ok); ms.current = null; renderMistakes(); };
    $('#dOk') && ($('#dOk').onclick = () => answer(true));
    $('#dBad') && ($('#dBad').onclick = () => answer(false));
  }

  // ---------------------------------------------------------------- SOR (kelime sorgusu)
  // Modlar: depth (derinlik sırası, EN→TR) · yday (dün testi: son dersin 5 kelimesi) · week (bu hafta) · random
  //         tr (TR→EN üretim) · blank (örnek cümlede boşluk) · exam (sınav provası: bu hafta + derinlik ilk 10, oturum)
  const MODES = [['depth', 'Derinlik'], ['yday', 'Dün testi'], ['week', 'Bu hafta'], ['random', 'Rastgele'], ['tr', 'TR → EN'], ['blank', 'Boşluk'], ['exam', 'Sınav provası']];
  const qs = { mode: LS.get('quizMode', 'depth'), current: null, revealed: false, exam: null };
  if (!MODES.find((m) => m[0] === qs.mode)) qs.mode = 'depth';
  const statKey = (mode, word) => (mode === 'tr' || mode === 'blank' ? mode + ':' + word : word);
  const rowOf = (word) => D.missing.table.find((r) => r.word.toLowerCase() === word.toLowerCase());
  function blankOf(w) {
    if (!w?.example || !/\*\*(.+?)\*\*/.test(w.example)) return null;
    // kelimeyi ___ yap, italik notları (kelimeyi ele verebilir) at
    return w.example.replace(/\*\*(.+?)\*\*/g, '___').replace(/\*\([^)]*\)\*/g, '').replace(/\s{2,}/g, ' ').trim();
  }
  function quizQueue() {
    const st = wordStats(), t = today(), mode = qs.mode;
    const toItem = (w) => ({ word: w.word, meaning: w.meaning, row: rowOf(w.word) });
    let pool;
    if (mode === 'yday') pool = D.words.filter((w) => w.day === D.lastLessonDay).map(toItem);
    else if (mode === 'week') pool = D.words.filter((w) => w.week === D.lastWeek).map(toItem);
    else if (mode === 'random') pool = shuffle(D.words.map(toItem));
    else pool = D.missing.table.map((r) => ({ word: r.word, meaning: r.meaning, row: r })); // depth, tr, blank: derinlik sırası
    if (mode === 'blank') pool = pool.filter((p) => blankOf(D.wordMap[p.word.toLowerCase()]));
    pool = pool.filter((p) => { const s = st[statKey(mode, p.word)]; if (!s) return true; if (s.last === t) return false; return !s.lastOk || daysBetween(s.last, t) >= 3; });
    return pool;
  }
  function examList() {
    const week = D.words.filter((w) => w.week === D.lastWeek).map((w) => ({ word: w.word, meaning: w.meaning, part: 'A' }));
    const inWeek = new Set(week.map((w) => w.word.toLowerCase()));
    const past = D.missing.table.filter((r) => !inWeek.has(r.word.toLowerCase())).slice(0, 10).map((r) => ({ word: r.word, meaning: r.meaning, part: 'B' }));
    return [...shuffle(week), ...past];
  }
  function renderQuiz() {
    const st = wordStats(), t = today(), mode = qs.mode;
    const tc = todayCounts();
    let html = `<div class="row between"><h2>Sor</h2><span class="badge ${tc.ok === tc.all && tc.all ? 'ok' : ''}">bugün ${tc.ok}/${tc.all}</span></div>
      <div class="filters">${MODES.map(([k, l]) => `<button class="pill ${mode === k ? 'on' : ''}" data-mode="${k}">${l}</button>`).join('')}</div>
      <div class="small" id="syncStatus" style="margin:-4px 0 10px">${syncStatusText()}</div>`;
    if (mode === 'exam') html += examHtml();
    else {
      const queue = quizQueue();
      if (!qs.current || !queue.find((p) => p.word === qs.current.word)) { qs.current = queue[0] || null; qs.revealed = false; }
      const c = qs.current;
      if (!c) html += `<div class="card empty">Bu modda bugün sorulacak kelime kalmadı.<br><span class="small">✅ çıkan kelime 3 gün dinlenir, ❌ ertesi gün geri gelir.</span></div>`;
      else {
        const w = D.wordMap[c.word.toLowerCase()], r = c.row;
        const meta = `${r ? `derinlik ${fmt(r.depth)} · ${fmt(r.asked)} soruldu / ${fmt(r.missed)} kaçtı` : `gün ${w?.day ?? '?'}`} · sırada ${queue.length}`;
        const prompt = mode === 'tr' ? `<div class="quiz-word small-word">${md(c.meaning)}</div><div class="small" style="text-align:center">İngilizcesini düşün</div>`
          : mode === 'blank' ? `<div class="quiz-sentence">${md(blankOf(w))}</div><div class="small" style="text-align:center">(${md(c.meaning)})</div>`
          : `<div class="quiz-word">${esc(c.word)}</div>`;
        const answerBox = mode === 'tr' || mode === 'blank'
          ? `<div class="quiz-answer"><div><b>${esc(c.word)}</b></div>${w ? `<div class="mt">${md(w.example)}</div>` : ''}</div>`
          : `<div class="quiz-answer"><div><b>${md(c.meaning)}</b></div>${w ? `<div class="mt">${md(w.example)}</div>` : ''}</div>`;
        html += `<div class="card"><div class="quiz-meta">${meta}</div>${prompt}
          ${qs.revealed ? `${answerBox}<div class="btnrow"><button class="btn ok" id="qOk">✅ Bildim</button><button class="btn bad" id="qBad">❌ Bilemedim</button></div>`
          : `<input id="qGuess" placeholder="${mode === 'tr' || mode === 'blank' ? 'İngilizcesini yaz (isteğe bağlı)' : 'Türkçe anlamını yaz (isteğe bağlı)'}" autocomplete="off" autocapitalize="off">
             <div class="btnrow"><button class="btn primary" id="qShow">Cevabı göster</button><button class="btn ghost" id="qSkip">Atla</button></div>`}
        </div>`;
      }
      const hist = Object.entries(st).sort((a, b) => (b[1].last > a[1].last ? 1 : -1)).slice(0, 10);
      if (hist.length) html += `<h2>Son cevaplar</h2><div class="card">${hist.map(([w, s]) => `<div class="row between" style="padding:4px 0"><span>${esc(w)}</span><span class="small">${s.last.slice(5)} · ✅${s.ok} ❌${s.bad}</span></div>`).join('')}</div>`;
    }
    html += `<div class="btnrow"><button class="btn ghost" id="qReset">Telefondaki kayıtları sıfırla</button></div>`;
    view.innerHTML = html;
    view.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { qs.mode = b.dataset.mode; LS.set('quizMode', qs.mode); qs.current = null; qs.revealed = false; renderQuiz(); }));
    $('#qReset').onclick = () => { if (confirm('Telefondaki kelime ve hata sorgu kayıtları silinsin mi? (GitHub\'a gönderilenler kalır)')) { LS.set('quizStats', {}); LS.set('mistakeStats', {}); qs.current = null; qs.exam = null; renderQuiz(); } };
    if (mode === 'exam') { bindExam(); return; }
    const c = qs.current; if (!c) return;
    const show = () => { qs.revealed = true; renderQuiz(); };
    $('#qShow') && ($('#qShow').onclick = show);
    $('#qGuess') && ($('#qGuess').onkeydown = (e) => { if (e.key === 'Enter') show(); });
    $('#qSkip') && ($('#qSkip').onclick = () => { const q = quizQueue(); const i = q.findIndex((p) => p.word === c.word); qs.current = q[(i + 1) % q.length]; qs.revealed = false; renderQuiz(); });
    const answer = (ok) => { const k = statKey(mode, c.word); const s = st[k] || { ok: 0, bad: 0 }; s[ok ? 'ok' : 'bad']++; s.last = t; s.lastOk = ok; st[k] = s; LS.set('quizStats', st); logEntry('word', c.word, mode, ok); qs.current = null; renderQuiz(); };
    $('#qOk') && ($('#qOk').onclick = () => answer(true));
    $('#qBad') && ($('#qBad').onclick = () => answer(false));
  }
  // Sınav provası: pazar formatı — bu haftanın kelimeleri + derinlik ilk 10, bağlamsız, tek oturum, sonunda skor
  function examHtml() {
    const ex = qs.exam;
    if (!ex) {
      const n = D.words.filter((w) => w.week === D.lastWeek).length;
      return `<div class="card"><b>Hafta ${D.lastWeek} provası</b><div class="small mt">${n} kelime (bu hafta) + 10 kelime (derinlik sırası). Sınavdaki gibi: sadece İngilizce, bağlam yok, her kelimeye tahmin zorunlu. Sonunda skor ve kaçanlar listelenir.</div>
        <div class="btnrow"><button class="btn primary" id="exStart">Başla</button></div></div>`;
    }
    if (ex.i >= ex.list.length) {
      const ok = ex.results.filter((r) => r.ok).length, miss = ex.results.filter((r) => !r.ok);
      const a = ex.results.filter((r) => r.part === 'A'), b = ex.results.filter((r) => r.part === 'B');
      return `<div class="card"><div class="quiz-meta">Prova bitti</div><div class="quiz-word">${ok}/${ex.list.length}</div>
        <div class="small" style="text-align:center">Bu hafta ${a.filter((r) => r.ok).length}/${a.length} · geçmiş ${b.filter((r) => r.ok).length}/${b.length}</div>
        ${miss.length ? `<h2>Kaçanlar</h2><div class="ex">${miss.map((r) => `<div><b>${esc(r.word)}</b> — ${md(r.meaning)}</div>`).join('')}</div>` : '<div class="mt" style="text-align:center">Hepsi doğru.</div>'}
        <div class="btnrow"><button class="btn primary" id="exStart">Yeniden</button><button class="btn ghost" id="exClose">Kapat</button></div></div>`;
    }
    const c = ex.list[ex.i];
    return `<div class="card"><div class="quiz-meta">${ex.i + 1} / ${ex.list.length} · parça ${c.part}${c.part === 'B' ? ' (geçmiş haftalar)' : ''}</div>
      <div class="quiz-word">${esc(c.word)}</div>
      ${ex.revealed ? `<div class="quiz-answer"><b>${md(c.meaning)}</b></div><div class="btnrow"><button class="btn ok" id="exOk">✅ Bildim</button><button class="btn bad" id="exBad">❌ Bilemedim</button></div>`
      : `<input id="exGuess" placeholder="Türkçe anlamını yaz" autocomplete="off"><div class="btnrow"><button class="btn primary" id="exShow">Cevabı göster</button></div>`}
    </div>`;
  }
  function bindExam() {
    $('#exStart') && ($('#exStart').onclick = () => { qs.exam = { list: examList(), i: 0, results: [], revealed: false }; renderQuiz(); });
    $('#exClose') && ($('#exClose').onclick = () => { qs.exam = null; renderQuiz(); });
    const ex = qs.exam; if (!ex || ex.i >= ex.list.length) return;
    const show = () => { ex.revealed = true; renderQuiz(); };
    $('#exShow') && ($('#exShow').onclick = show);
    $('#exGuess') && ($('#exGuess').onkeydown = (e) => { if (e.key === 'Enter') show(); });
    const answer = (ok) => { const c = ex.list[ex.i]; ex.results.push({ ...c, ok }); logEntry('word', c.word, 'exam', ok); ex.i++; ex.revealed = false; renderQuiz(); };
    $('#exOk') && ($('#exOk').onclick = () => answer(true));
    $('#exBad') && ($('#exBad').onclick = () => answer(false));
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

  // ---------------------------------------------------------------- GÜNLER + HAFTALIK RAPORLAR
  const df = { tab: 'days' };
  function renderDays() {
    let html = `<div class="filters"><button class="pill ${df.tab === 'days' ? 'on' : ''}" data-dt="days">Günler</button><button class="pill ${df.tab === 'weeks' ? 'on' : ''}" data-dt="weeks">Haftalık raporlar</button></div>`;
    if (df.tab === 'days') {
      html += [...D.days].reverse().map((d) => `<div class="card tap day" data-day="${d.day}">
        <div class="row between"><div><b>Gün ${d.day}</b> <span class="small">${esc(d.date)}${d.week ? ' · H' + d.week : ''}</span></div>${scoreBadge(d)}</div>
        <div class="topic mt clamp2">${md(shortTopic(d.topic))}</div>
        ${d.total ? `<div class="score-bar"><i style="width:${d.total.pct}%"></i></div>` : ''}
      </div>`).join('');
    } else {
      html += [...D.weeks].reverse().map((w, idx, arr) => {
        const m = w.metrics, v = (k) => m[k]?.value, prev = arr[idx + 1];
        const delta = (k, suffix = '') => { const a = v(k), b = prev?.metrics?.[k]?.value; if (a == null || b == null) return ''; const d = Math.round((a - b) * 10) / 10; return d ? `<span class="small" style="color:${d > 0 ? 'var(--ok)' : 'var(--bad)'}"> ${d > 0 ? '+' : ''}${fmt(d)}${suffix}</span>` : ''; };
        return `<div class="card"><div class="row between"><b>Hafta ${w.week}</b><span class="small">${esc(w.start)} → ${esc(w.end)}</span></div>
          <div class="tiles mt">
            <div class="tile"><div class="v">%${fmt(v('vocabExam'))}${delta('vocabExam')}</div><div class="l">kelime sınavı</div></div>
            <div class="tile"><div class="v">%${fmt(v('generalExam'))}${delta('generalExam')}</div><div class="l">genel sınav</div></div>
            <div class="tile"><div class="v">%${fmt(v('dailyAvg'))}${delta('dailyAvg')}</div><div class="l">günlük ort.</div></div>
            <div class="tile"><div class="v">${fmt(v('yesterdayAvg'))}${delta('yesterdayAvg')}</div><div class="l">dün testi ort.</div></div>
            <div class="tile"><div class="v">${fmt(v('words'))}</div><div class="l">kelime (küm.)</div></div>
            <div class="tile"><div class="v">${fmt(v('closed'))}${delta('closed')}</div><div class="l">kapatılan hata</div></div>
          </div>
          <table class="kv mt">${Object.entries(w.levels).map(([k, val]) => `<tr><td>${esc(k)}</td><td><b>${esc(val)}</b></td></tr>`).join('')}</table>
          <h2>Yeni yapabildiklerim</h2><ul class="clean">${w.cando.map((c) => `<li>${md(c)}</li>`).join('')}</ul>
          <h2>En zayıf</h2><ul class="clean">${w.weak.map((c) => `<li>${md(c)}</li>`).join('')}</ul>
          <h2>Hedefler</h2><ul class="clean">${w.goals.map((g) => `<li>${g.done ? '✅' : '⬜'} ${md(g.text)}</li>`).join('')}</ul>
          ${w.hasMonthly ? '<div class="small mt">Bu raporda aylık bakış bölümü var: ' + esc(w.file) + '</div>' : ''}
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
      html += `<table class="kv mt">${Object.entries(d.parts).map(([k, v]) => `<tr><td>${names[k] || k}</td><td><b>${fmt(v.got)}/${v.of}</b> <span class="small">%${pct(v.got, v.of)}</span></td></tr>`).join('')}<tr><td>Toplam</td><td><b>${fmt(d.total?.got)}/${d.total?.of}</b> <span class="small">%${d.total?.pct}</span></td></tr></table>`;
    } else html += `<div class="mt"><b>${md(d.score)}</b></div>`;
    if (d.summary) html += `<h2>Özet</h2><div style="line-height:1.6">${md(d.summary)}</div>`;
    if (d.grammar) html += `<div class="mt small">${esc(d.grammar)}</div>`;
    if (d.file) html += `<div class="mt small">${esc(d.file)}</div>`;
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
        <div class="meta mt clamp2">${esc(g.summary)}</div>
      </div>`;
    }).join('');
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
    if (g.tips?.length) html += `<h2>İpuçları</h2><ul class="clean">${g.tips.map((u) => `<li>${md(u)}</li>`).join('')}</ul>`;
    if (g.file) html += `<div class="mt small">${esc(g.file)}${g.header ? ' · ' + esc(g.header) : ''}</div>`;
    openModal(esc(g.title), html);
  }

  // ---------------------------------------------------------------- AYARLAR (GitHub bağlantısı)
  function renderSettings() {
    const at = LS.get('dataCacheAt', '');
    view.innerHTML = `<h2>GitHub bağlantısı</h2>
      <div class="card">
        <div class="small">Veri private repodan GitHub API ile okunur; sorgu cevapların aynı repoya <code>app/quiz_log.json</code> olarak yazılır. Token yalnızca bu telefonda saklanır, GitHub dışında hiçbir istek yapılmaz.</div>
        <label class="small mt">Repo sahibi</label><input id="sOwner" value="${esc(GH.owner)}" autocapitalize="off">
        <label class="small mt">Repo adı</label><input id="sRepo" value="${esc(GH.repo)}" autocapitalize="off">
        <label class="small mt">Dal</label><input id="sBranch" value="${esc(GH.branch)}" autocapitalize="off">
        <label class="small mt">Fine-grained token (Contents: Read and write)</label><input id="sToken" type="password" value="${esc(GH.token)}" placeholder="github_pat_…" autocapitalize="off" autocomplete="off">
        <div class="btnrow"><button class="btn primary" id="sSave">Kaydet ve bağlan</button><button class="btn ghost" id="sClear">Token'ı sil</button></div>
        <div id="sMsg" class="small mt">${GH.token ? 'Token kayıtlı.' : 'Token yok: yerel data/ klasöründen okunuyor (sadece PC).'}${at ? ' Son veri: ' + at.slice(0, 16).replace('T', ' ') : ''}</div>
      </div>
      <h2>Sorgu günlüğü</h2>
      <div class="card"><div class="small" id="syncStatus">${syncStatusText()}</div>
        <div class="btnrow"><button class="btn ghost" id="sSync">Şimdi gönder</button></div>
        <div class="small mt">Her ✅/❌ önce telefonda birikir, birkaç saniye sonra GitHub'a yazılır. Ders sonunda bu kayıtlar kelime derinlik havuzuna işlenir.</div></div>
      <h2>Token nasıl alınır</h2>
      <div class="card small" style="line-height:1.7">
        1. GitHub → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token<br>
        2. Repository access: <b>Only select repositories</b> → Learn-English<br>
        3. Permissions → Repository permissions → <b>Contents: Read and write</b> (başka izin yok; Metadata otomatik gelir)<br>
        4. Expiration: istediğin süre (bitince buraya yenisini yapıştırırsın)<br>
        5. Token'ı yukarıya yapıştır → Kaydet
      </div>
      <h2>Uygulama</h2>
      <div class="card small">Kabuk sürümü: <b id="shellVer">—</b> · Veri: ${D.meta?.built ?? '—'} · Kaynak: ${GH.token ? 'GitHub API' : 'yerel'}<br>Telefondaki sorgu kayıtları ve token silinmez; sadece "Telefondaki kayıtları sıfırla" (Sor) ve "Token'ı sil" ile.</div>`;
    $('#sSave').onclick = async () => {
      LS.set('ghOwner', $('#sOwner').value.trim()); LS.set('ghRepo', $('#sRepo').value.trim()); LS.set('ghBranch', $('#sBranch').value.trim() || 'main'); LS.set('ghToken', $('#sToken').value.trim());
      $('#sMsg').textContent = 'bağlanıyor…';
      try { await load(true); $('#sMsg').textContent = `✅ Bağlandı — veri ${D.meta.built}, gün ${D.meta.lastDay}`; render(); }
      catch (e) { $('#sMsg').textContent = '❌ ' + e.message; }
    };
    $('#sClear').onclick = () => { LS.set('ghToken', ''); renderSettings(); };
    $('#sSync').onclick = async () => { $('#syncStatus').textContent = 'gönderiliyor…'; try { await syncLog(); } catch {} renderSyncBadge(); };
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

  load().then(() => { render(); syncLog().catch(() => {}); }).catch((e) => { D.meta = D.meta || {}; view.innerHTML = `<div class="empty">Veri yüklenemedi: ${esc(e.message)}<br><span class="small">GitHub token girmen gerekiyor.</span></div>`; setTimeout(() => { tab = 'settings'; renderSettings(); }, 800); });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // her açılışta ve uygulama öne her geldiğinde yeni kabuk var mı diye bak (PWA'da tarayıcı bunu 24 saatte bir yapar)
      const check = () => reg.update().catch(() => {});
      check();
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { check(); syncLog().catch(() => {}); } });
    }).catch(() => {});
  }
})();
