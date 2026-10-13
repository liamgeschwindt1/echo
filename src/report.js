// Results report (section 11). `reportApp` must stay self-contained (no outer references):
// its source is inlined into the downloadable HTML file.

export const REPORT_CSS = `
.rep{--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#ddd;--card:#f7f7f7;--accent:#0072B2;
  --alert:#C0392B;--flag:#D68910;--log:#5D6D7E;color:var(--fg);background:var(--bg);
  font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:16px;box-sizing:border-box;max-width:1400px;margin:0 auto}
@media (prefers-color-scheme:dark){.rep:not(.light){--bg:#121212;--fg:#eee;--muted:#aaa;--line:#333;--card:#1e1e1e}}
.rep.dark{--bg:#121212;--fg:#eee;--muted:#aaa;--line:#333;--card:#1e1e1e}
.rep *{box-sizing:border-box}
.rep h1{font-size:1.35rem;margin:0 0 4px}
.rep .muted{color:var(--muted);font-size:.9rem}
.rep .banner{background:#fdebd0;color:#6e2c00;border-radius:8px;padding:10px 12px;margin:12px 0}
.rep.dark .banner{background:#4a3410;color:#ffe2b0}
@media (prefers-color-scheme:dark){.rep:not(.light) .banner{background:#4a3410;color:#ffe2b0}}
.rep .headline{font-size:1.1rem;margin:10px 0}
.rep .strip{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
.rep .stat{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px 10px;font-size:.9rem}
.rep .stat b{font-size:1.1rem;margin-right:4px}
.rep .filters{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 14px}
.rep .chip{border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:999px;padding:4px 10px;font-size:.85rem;cursor:pointer}
.rep .chip.on{background:var(--accent);border-color:var(--accent);color:#fff}
.rep .grid{display:block}
.rep .timeline{display:none}
.rep .cards{position:relative;padding-left:22px}
.rep .cards::before{content:"";position:absolute;left:7px;top:0;bottom:0;width:2px;background:var(--line)}
.rep .card{position:relative;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:12px;scroll-margin-top:12px}
.rep .card.hl{outline:2px solid var(--accent)}
.rep .card .dot{position:absolute;left:-21px;top:16px;width:12px;height:12px;border-radius:50%;border:2px solid var(--bg)}
.rep .card .time{font-size:.85rem;color:var(--muted)}
.rep .card .label{font-size:1.3rem;font-weight:600;margin:2px 0;word-break:break-word}
.rep .badge{display:inline-block;border-radius:6px;padding:1px 8px;font-size:.8rem;font-weight:600;color:#fff;margin-right:6px;text-transform:uppercase}
.rep .badge.alert{background:var(--alert)}.rep .badge.flag{background:var(--flag)}.rep .badge.log{background:var(--log)}
.rep .ev{font-size:.9rem;margin-top:6px}
.rep .ev table{border-collapse:collapse;width:100%}
.rep .ev td{padding:2px 6px 2px 0;vertical-align:top;word-break:break-word}
.rep .ev td.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.rep .expl{margin-top:8px}
.rep .flags span{display:inline-block;font-size:.75rem;border:1px solid var(--line);border-radius:4px;padding:0 5px;margin:2px 4px 0 0}
.rep details{margin-top:8px}
.rep pre{white-space:pre-wrap;word-break:break-all;font-size:.75rem;background:var(--bg);border:1px solid var(--line);padding:8px;border-radius:6px;max-height:320px;overflow:auto}
.rep footer{margin-top:20px;border-top:1px solid var(--line);padding-top:12px}
.rep footer button{margin:0 8px 8px 0}
.rep button.act{background:var(--accent);color:#fff;border:0;border-radius:8px;padding:8px 12px;font-size:.95rem;cursor:pointer}
.rep ul{padding-left:20px;margin:6px 0}
@media (min-width:900px){
  .rep .grid{display:grid;grid-template-columns:35% 65%;gap:16px;align-items:start}
  .rep .timeline{display:block;position:sticky;top:8px;max-height:calc(100vh - 16px);overflow-y:auto;border:1px solid var(--line);border-radius:10px;background:var(--card)}
  .rep .cards{padding-left:0}
  .rep .cards::before,.rep .card .dot{display:none}
}
.rep .timeline svg{display:block;width:100%}
.rep .timeline .bar{cursor:pointer}
.rep .timeline .bar.hl{stroke:var(--fg);stroke-width:2}
.rep .hidden{display:none!important}
`;

export function reportApp(root, data, opts) {
  opts = opts || {};
  const meta = data.meta || {};
  const report = data.report || { events: [], summary: {} };
  const periods = new Map((data.periods || []).map((p) => [p.id, p]));
  const families = data.families || {};
  const tz = meta.tz_name || undefined;
  let utc = data.time_display === 'utc';
  const filt = { pri: new Set(), fam: new Set(), disagree: false, quiet: false };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const famName = (f) => (families[f] && families[f].name) || f || 'unknown';
  const famColor = (f) => (f === 'context' || !families[f] ? '#999999' : families[f].color);
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v.toFixed(d) : '-');
  const fmtT = (ms, withDate) => {
    const o = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: utc ? 'UTC' : tz };
    if (withDate) Object.assign(o, { year: 'numeric', month: 'short', day: 'numeric' });
    try {
      return new Intl.DateTimeFormat(undefined, o).format(new Date(ms)) + (utc ? ' UTC' : '');
    } catch (e) {
      return new Date(ms).toISOString();
    }
  };
  const fmtDur = (s) => (s < 60 ? `${num(s, 1)} s` : s < 3600 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);
  const agreeText = { agree: 'Both models agree', partial: 'Only one model', disagree: 'Models disagree', none: 'Neither model sure' };

  const events = (report.events || [])
    .map((e, i) => {
      const ps = e.period_ids.map((id) => periods.get(id)).filter(Boolean);
      const start = Math.min(...ps.map((p) => Date.parse(p.start)));
      const end = Math.max(...ps.map((p) => Date.parse(p.end)));
      return { e, ps, start, end, idx: i, tod: ps[0] ? ps[0].time_of_day : null };
    })
    .filter((x) => x.ps.length)
    .sort((a, b) => a.start - b.start);
  events.forEach((x, i) => (x.id = `ev${i}`));

  function agreementLine(x) {
    if (x.e.agreement === 'partial') {
      const p = x.ps[0];
      const yTop = p.yamnet && p.yamnet.top && p.yamnet.top[0];
      const cTop = p.clap && p.clap.top && p.clap.top[0];
      const yOk = yTop && p.yamnet.family_scores && Object.values(p.yamnet.family_scores).some((v) => v >= ((data.settings && data.settings.yamnet_min) || 0.2));
      if (yOk) return 'Only YAMNet';
      if (cTop) return 'Only CLAP';
    }
    return agreeText[x.e.agreement] || x.e.agreement;
  }

  function evidence(p) {
    const y = (p.yamnet && p.yamnet.top) || [];
    const c = (p.clap && p.clap.top) || [];
    let h = '<table>';
    h += `<tr><td colspan="3"><b>YAMNet</b> <span class="muted">(${(p.yamnet && p.yamnet.n) || 0} readings)</span></td></tr>`;
    if (!y.length) h += '<tr><td colspan="3" class="muted">No readings</td></tr>';
    for (const l of y) h += `<tr><td>${esc(l.raw_label)}</td><td class="muted">${esc(l.label || famName(l.family))}</td><td class="n">${num(l.mean, 2)} / max ${num(l.max, 2)}</td></tr>`;
    h += `<tr><td colspan="3"><b>CLAP</b> <span class="muted">(${(p.clap && p.clap.n) || 0} readings, ${esc(p.clap && p.clap.window_s)} s window${p.clap && p.clap.clap_unreliable ? ', unreliable for this period' : ''})</span></td></tr>`;
    if (!c.length) h += '<tr><td colspan="3" class="muted">No readings</td></tr>';
    for (const l of c) h += `<tr><td>${esc(l.class)}</td><td class="muted">${esc(famName(l.family))}</td><td class="n">${num(l.mean, 2)}</td></tr>`;
    h += '</table>';
    return h;
  }

  function card(x) {
    const e = x.e;
    const p0 = x.ps[0];
    const dur = (x.end - x.start) / 1000;
    const avg = x.ps.map((p) => p.level_avg_dbfs);
    const peak = Math.max(...x.ps.map((p) => p.level_peak_dbfs));
    const delta = Math.max(...x.ps.map((p) => p.delta_over_floor_db));
    const notes = x.ps.flatMap((p) => p.notes_in_period || []);
    const merge = (report.merges || []).filter((m) => m.period_ids.some((id) => e.period_ids.includes(id)));
    const dq = (report.data_quality || []).filter((d) => d.period_ids.some((id) => e.period_ids.includes(id)));
    const mn = e.matches_note === true ? 'yes' : e.matches_note === false ? 'no' : 'not stated';
    let h = `<div class="dot" style="background:${famColor(e.family)}"></div>`;
    h += `<div class="time">${esc(fmtT(x.start))} - ${esc(fmtT(x.end))} · ${esc(fmtDur(dur))} · ${esc(x.tod)}</div>`;
    h += `<div class="label">${esc(e.final_label)}</div>`;
    h += `<div><span class="badge ${esc(e.priority)}">${esc(e.priority)}</span><span class="muted">${esc(famName(e.family))} · confidence ${num(e.confidence, 2)}</span></div>`;
    if (e.priority_raised) h += `<div class="muted">Priority raised: ${esc(e.priority_reason)}</div>`;
    h += `<div class="ev"><b>${esc(agreementLine(x))}</b></div>`;
    for (const p of x.ps) h += `<div class="ev">${x.ps.length > 1 ? `<div class="muted">${esc(p.id)}</div>` : ''}${evidence(p)}</div>`;
    h += `<div class="ev">Level (relative): avg ${num(avg.length === 1 ? avg[0] : Math.max(...avg), 1)} dBFS, peak ${num(peak, 1)} dBFS, ${num(delta, 1)} dB above floor${p0.onset === 'impulse' ? ' · impulse' : ''}${x.ps.some((p) => p.sustained) ? ' · sustained' : ''}</div>`;
    if (e.explanation) h += `<div class="expl">${esc(e.explanation)}</div>`;
    if (e.flags && e.flags.length) h += `<div class="flags">${e.flags.map((f) => `<span>${esc(f)}</span>`).join('')}</div>`;
    for (const m of merge) h += `<div class="muted">Merged ${esc(m.period_ids.join(', '))}: ${esc(m.reason)}</div>`;
    for (const d of dq) h += `<div class="muted">Data quality: ${esc(d.issue)}</div>`;
    for (const n of notes) h += `<div class="ev">Note at ${esc(fmtT(Date.parse(n.timestamp)))}: "${esc(n.text)}" · matches note: ${mn}</div>`;
    h += `<details><summary>Raw detail</summary><pre>${esc(JSON.stringify({ event: e, periods: x.ps }, null, 2))}</pre></details>`;
    return h;
  }

  function timelineSvg(collapse) {
    const t0 = Date.parse(meta.started_at) || (events[0] ? events[0].start : Date.now());
    const t1 = Date.parse(meta.ended_at) || (events.length ? events[events.length - 1].end : t0 + 1000);
    // Piecewise time->y map: active ranges at full scale, long gaps squeezed to GAP px.
    const GAP = 28;
    const PAD = 10_000;
    let ranges = [];
    const notes = data.notes || [];
    const marks = events.map((x) => [x.start - PAD, x.end + PAD]).concat(notes.map((n) => [Date.parse(n.timestamp) - PAD, Date.parse(n.timestamp) + PAD]));
    if (collapse && marks.length) {
      marks.sort((a, b) => a[0] - b[0]);
      for (const [a, b] of marks) {
        const last = ranges[ranges.length - 1];
        if (last && a <= last[1] + 60_000) last[1] = Math.max(last[1], b);
        else ranges.push([Math.max(t0, a), Math.min(t1, b)]);
      }
    } else ranges = [[t0, t1]];
    const active = ranges.reduce((s, r) => s + Math.max(1, r[1] - r[0]), 0) / 1000;
    const pps = Math.max(0.05, Math.min(8, 1400 / Math.max(1, active)));
    const segs = [];
    let y = 20;
    ranges.forEach((r, i) => {
      if (i > 0 || (collapse && r[0] > t0 + 60_000)) y += GAP;
      segs.push({ a: r[0], b: r[1], y });
      y += Math.max(1, ((r[1] - r[0]) / 1000) * pps);
    });
    const H = y + 20;
    const yOf = (t) => {
      for (const s of segs) if (t <= s.b) return t < s.a ? s.y : s.y + ((t - s.a) / 1000) * pps;
      const s = segs[segs.length - 1];
      return s.y + ((s.b - s.a) / 1000) * pps;
    };
    const W = 300;
    const AX = 78;
    let out = `<svg viewBox="0 0 ${W} ${H}" height="${H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">`;
    // Level sparkline behind the bars.
    const lv = (data.level_series || []).filter((l) => isFinite(l.rms_dbfs));
    if (lv.length) {
      const pts = [];
      for (const l of lv) {
        const t = Date.parse(l.t);
        if (collapse && !segs.some((s) => t >= s.a && t <= s.b)) continue;
        const x = AX + ((Math.max(-90, Math.min(0, l.rms_dbfs)) + 90) / 90) * (W - AX - 4);
        pts.push(`${x.toFixed(1)},${yOf(t).toFixed(1)}`);
      }
      if (pts.length > 1) out += `<polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-opacity="0.18" stroke-width="1"/>`;
    }
    // Axis labels at segment starts and every ~80 px.
    let lastY = -1e9;
    for (const s of segs) {
      const step = Math.max(10_000, Math.ceil(80 / pps) * 1000);
      for (let t = s.a; t <= s.b; t += step) {
        const yy = yOf(t);
        if (yy - lastY < 40) continue;
        lastY = yy;
        out += `<line x1="${AX - 4}" x2="${W}" y1="${yy}" y2="${yy}" stroke="currentColor" stroke-opacity="0.12"/><text x="2" y="${yy + 4}" font-size="10" fill="currentColor" fill-opacity="0.7">${esc(fmtT(t))}</text>`;
      }
    }
    for (let i = 1; i < segs.length; i++) {
      const gy = segs[i].y - GAP / 2;
      out += `<text x="${AX}" y="${gy + 4}" font-size="10" fill="currentColor" fill-opacity="0.5">⋯ quiet ${esc(fmtDur((segs[i].a - segs[i - 1].b) / 1000))}</text>`;
    }
    // Bars in greedy lanes.
    const lanes = [];
    const laneW = 22;
    for (const x of events) {
      const y0 = yOf(x.start);
      const y1 = Math.max(y0 + 4, yOf(x.end));
      let lane = lanes.findIndex((end) => end < y0 - 2);
      if (lane < 0) lane = lanes.length;
      lanes[lane] = y1;
      const bx = AX + 4 + (lane % 8) * (laneW + 4);
      out += `<rect class="bar" data-ev="${x.id}" x="${bx}" y="${y0}" width="${laneW}" height="${y1 - y0}" rx="3" fill="${famColor(x.e.family)}"><title>${esc(x.e.final_label)} ${esc(fmtT(x.start))}</title></rect>`;
    }
    for (const n of notes) {
      const ny = yOf(Date.parse(n.timestamp));
      out += `<path d="M${AX - 2} ${ny - 4} L${AX + 4} ${ny} L${AX - 2} ${ny + 4} Z" fill="currentColor"><title>${esc(n.text)}</title></path>`;
    }
    return out + '</svg>';
  }

  const counts = { alert: 0, flag: 0, log: 0 };
  for (const x of events) if (x.e.priority in counts) counts[x.e.priority]++;
  const disagreements = events.filter((x) => x.e.agreement === 'disagree').length;
  const quiet = events.filter((x) => x.tod === 'night').length;
  const famsPresent = [...new Set(events.map((x) => x.e.family))];
  const startMs = Date.parse(meta.started_at);
  const endMs = Date.parse(meta.ended_at);
  const s = data.settings || {};
  const models = [s.yamnet_enabled !== false ? 'YAMNet' : null, s.clap_enabled !== false ? `CLAP (${s.clap_window_s || 10} s window)` : null].filter(Boolean).join(' + ');
  let collapse = true;

  function render() {
    let h = '';
    h += `<h1>${esc(meta.session_label || 'Sound labelling session')}</h1>`;
    h += `<div class="muted">${isFinite(startMs) ? esc(fmtT(startMs, true)) : ''}${isFinite(endMs) ? ` - ${esc(fmtT(endMs))} · ${esc(fmtDur((endMs - startMs) / 1000))}` : ''}${meta.location_text ? ` · ${esc(meta.location_text)}` : ''}</div>`;
    h += `<div class="muted">Device: ${esc(data.device || meta.device || 'not recorded')} · Models: ${esc(models || 'none')}</div>`;
    h += `<div class="muted">${report.source === 'gemini' ? `Report by ${esc(report.model)} at ${esc(fmtT(Date.parse(report.generated_at), true))}` : 'Report: basic (deterministic)'}</div>`;
    if (report.source !== 'gemini') h += `<div class="banner">Basic report: Gemini was not used (${esc(report.fallback_reason || 'unknown reason')}).</div>`;
    if (report.summary && report.summary.headline) h += `<div class="headline">${esc(report.summary.headline)}</div>`;
    h += `<div class="strip"><span class="stat"><b>${counts.alert}</b>alert</span><span class="stat"><b>${counts.flag}</b>flag</span><span class="stat"><b>${counts.log}</b>log</span><span class="stat"><b>${disagreements}</b>model disagreements</span><span class="stat"><b>${quiet}</b>quiet-hours events</span></div>`;
    if (report.summary && report.summary.quiet_hours_summary) h += `<div><b>Quiet hours:</b> ${esc(report.summary.quiet_hours_summary)}</div>`;
    if (report.summary && report.summary.overall_notes && report.summary.overall_notes.length) h += `<ul>${report.summary.overall_notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`;
    h += '<div class="filters">';
    for (const p of ['alert', 'flag', 'log']) h += `<button class="chip${filt.pri.has(p) ? ' on' : ''}" data-f="pri" data-v="${p}">${p}</button>`;
    for (const f of famsPresent) h += `<button class="chip${filt.fam.has(f) ? ' on' : ''}" data-f="fam" data-v="${esc(f)}"><span style="color:${famColor(f)}">●</span> ${esc(famName(f))}</button>`;
    h += `<button class="chip${filt.disagree ? ' on' : ''}" data-f="disagree">Disagreements only</button>`;
    h += `<button class="chip${filt.quiet ? ' on' : ''}" data-f="quiet">Quiet hours only</button>`;
    h += `<button class="chip${collapse ? ' on' : ''}" data-f="collapse">Collapse silent gaps</button>`;
    h += `<button class="chip${utc ? ' on' : ''}" data-f="utc">UTC</button>`;
    h += '</div>';
    h += `<div class="grid"><div class="timeline">${timelineSvg(collapse)}</div><div class="cards">`;
    if (!events.length) h += '<div class="muted">No events to report.</div>';
    for (const x of events) h += `<div class="card" id="${x.id}" data-pri="${esc(x.e.priority)}" data-fam="${esc(x.e.family)}" data-ag="${esc(x.e.agreement)}" data-tod="${esc(x.tod)}">${card(x)}</div>`;
    h += '</div></div>';
    h += '<footer>';
    h += '<div>';
    if (opts.onRegenerate) h += '<button class="act" data-a="regen">Regenerate</button>';
    h += '<button class="act" data-a="json">Download JSON</button><button class="act" data-a="html">Download report HTML</button>';
    h += '</div>';
    const dqAll = report.data_quality || [];
    if (dqAll.length) h += `<b>Data-quality notes</b><ul>${dqAll.map((d) => `<li>${d.period_ids.length ? `${esc(d.period_ids.join(', '))}: ` : ''}${esc(d.issue)}</li>`).join('')}</ul>`;
    if (report.validation && report.validation.dropped && report.validation.dropped.length) h += `<div class="muted">${report.validation.dropped.length} event(s) from Gemini were dropped by validation.</div>`;
    if (report.validation && report.validation.priority_reset && report.validation.priority_reset.length) h += `<div class="muted">${report.validation.priority_reset.length} lowered priority(ies) were reset to the default.</div>`;
    h += '<div class="muted">Levels are relative and uncalibrated. Audio never left the device.</div>';
    h += '</footer>';
    root.innerHTML = h;
    applyFilters();
    wire();
  }

  function applyFilters() {
    for (const x of events) {
      const show =
        (!filt.pri.size || filt.pri.has(x.e.priority)) &&
        (!filt.fam.size || filt.fam.has(x.e.family)) &&
        (!filt.disagree || x.e.agreement === 'disagree') &&
        (!filt.quiet || x.tod === 'night');
      const c = root.querySelector(`#${x.id}`);
      if (c) c.classList.toggle('hidden', !show);
      const b = root.querySelector(`.bar[data-ev="${x.id}"]`);
      if (b) b.style.opacity = show ? '1' : '0.15';
    }
  }

  function download(name, type, text) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function wire() {
    root.querySelectorAll('.chip').forEach((b) =>
      b.addEventListener('click', () => {
        const f = b.dataset.f;
        const v = b.dataset.v;
        if (f === 'pri' || f === 'fam') filt[f].has(v) ? filt[f].delete(v) : filt[f].add(v);
        else if (f === 'disagree' || f === 'quiet') filt[f] = !filt[f];
        else if (f === 'collapse') collapse = !collapse;
        else if (f === 'utc') utc = !utc;
        render();
      })
    );
    root.querySelectorAll('.bar').forEach((b) =>
      b.addEventListener('click', () => {
        const c = root.querySelector(`#${b.dataset.ev}`);
        if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' });
      })
    );
    root.querySelectorAll('[data-a]').forEach((b) =>
      b.addEventListener('click', () => {
        const a = b.dataset.a;
        if (a === 'regen') opts.onRegenerate();
        else if (a === 'json') opts.onDownloadJson ? opts.onDownloadJson() : download(`echo-${meta.session_id || 'session'}.json`, 'application/json', JSON.stringify(data.export || data, null, 2));
        else if (a === 'html') opts.onDownloadHtml ? opts.onDownloadHtml() : download(`echo-report-${meta.session_id || 'session'}.html`, 'text/html', document.documentElement.outerHTML);
      })
    );
    if (typeof IntersectionObserver === 'function') {
      const io = new IntersectionObserver(
        (entries) => {
          for (const en of entries) {
            if (!en.isIntersecting) continue;
            root.querySelectorAll('.bar.hl, .card.hl').forEach((el) => el.classList.remove('hl'));
            en.target.classList.add('hl');
            const bar = root.querySelector(`.bar[data-ev="${en.target.id}"]`);
            if (bar) bar.classList.add('hl');
          }
        },
        { rootMargin: '0px 0px -70% 0px' }
      );
      root.querySelectorAll('.card').forEach((c) => io.observe(c));
    }
  }

  root.classList.add('rep');
  if (data.theme === 'dark') root.classList.add('dark');
  if (data.theme === 'light') root.classList.add('light');
  render();
}

// One self-contained file: inline CSS, inline JS, embedded data, no external requests.
export function buildStandaloneHtml(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const title = String(data.meta?.session_label || 'Sound labelling report').replace(/[<>&"]/g, '');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<title>${title}</title><style>body{margin:0}${REPORT_CSS}</style></head>
<body><div id="app"></div>
<script type="application/json" id="data">${json}</script>
<script>(${reportApp.toString()})(document.getElementById('app'), JSON.parse(document.getElementById('data').textContent), {});</script>
</body></html>`;
}
