import { airAbsorptionDbPerM, dbToPa, digitalPerPa, speedOfSound } from '@echo/sim-core/physics.js';

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const number = (value, digits = 3) => Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: digits }) : 'Not available';
const value = (v) => Array.isArray(v) ? v.map(value).join(', ') : typeof v === 'number' ? number(v) : v === true ? 'Yes' : v === false ? 'No' : v && typeof v === 'object' ? JSON.stringify(v) : v ?? 'Not available';
const point = (p) => p ? `(${p.map((x) => number(x, 2)).join(', ')}) m` : 'No position fix';
const paragraph = (text, className = '') => `<p class="${className}">${escape(text)}</p>`;
const formula = (text) => `<pre class="formula">${escape(text)}</pre>`;
const badge = (text, tone = '') => `<span class="badge ${tone}">${escape(text)}</span>`;
const metric = (name, val, detail = '') => `<div class="metric"><span>${escape(name)}</span><strong>${escape(val)}</strong><small>${escape(detail)}</small></div>`;
const table = (headers, rows) => rows.length ? `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th scope="col">${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escape(value(cell))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : paragraph('No records for this step.', 'muted');
const raw = (path, label = 'All recorded inputs and outputs') => `<details class="raw" data-path="${escape(JSON.stringify(path))}"><summary>${escape(label)}</summary><div class="raw-content"></div></details>`;
const recordedTable = (path, columns, label) => `<details class="raw" data-path="${escape(JSON.stringify(path))}" data-columns="${escape(JSON.stringify(columns))}"><summary>${escape(label)}</summary><div class="raw-content table-wrap"></div></details>`;
const stage = (id, index, title, summary, content, open = false) => `<details class="stage" id="${id}"${open ? ' open' : ''}><summary><span class="step-number">${index}</span><span><strong>${escape(title)}</strong><small>${escape(summary)}</small></span><span class="chevron" aria-hidden="true">+</span></summary><div class="stage-body">${content}</div></details>`;

function nodeCards(result, render) {
  return (result.nodes ?? []).map((n, ni) => `<details class="node"><summary><strong>${escape(n.node_id)}</strong> ${badge(n.localisation_status ?? 'Unknown status', n.usable ? 'good' : 'warn')}</summary><div class="node-body">${render(n, ni)}</div></details>`).join('');
}

function fixSummary(result) {
  if (result.fix?.position) return `${result.fix.method ?? 'Solver'} · ${point(result.fix.position)}`;
  if (result.fix?.negative_range) return 'No fix: rays meet behind a node';
  if (result.fix?.poorly_conditioned) return 'No fix: ray geometry is poorly conditioned';
  if ((result.usable_nodes ?? 0) < 2) return 'No fix: fewer than two usable bearings';
  return 'No position fix recorded';
}

function sourceReport(data, result, ri) {
  const s = data.scenario.settings;
  const prefix = ['results', ri];
  const nodePath = (ni) => [...prefix, 'nodes', ni];
  const source = data.scenario.sources.find((x) => x.id === result.source_id);
  const fixed = result.fix?.position;
  const track = result.track;
  const errors = (track?.fixes ?? []).map((f) => f.error_m).filter(Number.isFinite).sort((a, b) => a - b);
  const mid = Math.floor(errors.length / 2);
  const median = errors.length ? errors.length % 2 ? errors[mid] : (errors[mid - 1] + errors[mid]) / 2 : null;
  const header = `<header class="source-heading" id="source-${ri}"><div>${badge('Source ' + (ri + 1))}<h2>${escape(result.source_id)} <span>${escape(source?.clip ?? '')}</span></h2>${paragraph(fixSummary(result), 'muted')}</div>${badge(fixed ? result.fix.fix_suspect ? 'Fix needs review' : 'Position found' : 'No position fix', fixed && !result.fix.fix_suspect ? 'good' : 'warn')}</header>
    <div class="metrics">${metric('Usable bearings', result.usable_nodes ?? 'Not available', `${result.heard_nodes ?? 'Unknown'} nodes heard sound`)}${metric('3D position error', fixed ? `${number(result.error_3d_m, 2)} m` : 'No fix', 'Simulator truth comparison')}${metric('Track fixes', track?.fixes?.length ?? 'Not recorded', `Median horizontal error: ${number(median, 2)} m`)}</div>`;

  const windows = nodeCards(result, (n, ni) => {
    const win = n.window_s;
    const length = win ? win[1] - win[0] : null;
    return paragraph('Find audible frames, keep the bearing window inside the source arrival span, and select an onset-gated, adaptive or fixed window.')
      + formula(`SNR = 10 log10(source band power / noise band power)\nChosen-window SNR = ${number(n.window_snr_db)} dB\nUsable signal gate = ${number(s.min_snr_db)} dB\nWindow duration = end − start = ${win ? `${number(win[1])} − ${number(win[0])} = ${number(length)}` : 'not recorded'} s`)
      + table(['Quantity', 'Recorded result'], [
        ['Localisation band (Hz)', s.localisation_band_hz], ['Detection band (Hz)', s.detection_band_hz],
        ['Active window (s)', n.active_window_s], ['Arrival span (s)', n.arrival_span_s], ['Chosen window (s)', win],
        ['Window policy', n.window_policy], ['Trigger', n.trigger?.type], ['Trigger rise (dB)', n.trigger?.rise_db],
        ['Reflection guard (s)', n.reflection_guard?.delay_s], ['Adaptive stop', n.adaptive_stop],
        ['In-band SNR (dB)', n.snr_db], ['Detection-band SNR (dB)', n.snr_detection_db],
        ['Broadband detection', n.detected_broadband], ['Heard', n.heard], ['Usable bearing', n.usable]
      ]) + raw(nodePath(ni), 'Window decisions and all recorded node fields');
  });

  const bearings = nodeCards(result, (n, ni) => {
    const b = n.bearing;
    if (!b) return paragraph('No bearing was retained at this node. Check the window and signal gate in step 4.', 'notice') + raw(nodePath(ni));
    return paragraph('Hann-windowed, localisation-band GCC-PHAT measures pairwise microphone arrival delays at 4× interpolated sampling. A plane-wave least-squares fit converts those delays into a direction toward the sound.')
      + formula('PHAT cross-spectrum = Xᵢ(f) conj(Xⱼ(f)) / |Xᵢ(f) conj(Xⱼ(f))|\nΔtᵢⱼ = lag of the correlation peak\n(pⱼ − pᵢ) · u = c Δtᵢⱼ\nAzimuth = atan2(uᵧ, uₓ)\nElevation = asin(u_z)\nFlat arrays cannot resolve the elevation sign.')
      + table(['Quantity', 'Saved output'], [
        ['Direction u', b.direction], ['Azimuth (degrees)', b.azimuth_deg], ['Elevation (degrees)', b.elevation_deg],
        ['Elevation sign assumed', b.elevation_sign_assumed], ['Elevation confidence', b.elevation_confidence],
        ['Cross-mic residual (s)', b.residual_s], ['Array aliasing limit (Hz)', n.aliasing_limit_hz],
        ['Band above aliasing', n.band_above_aliasing], ['Azimuth error (degrees; simulator truth)', n.azimuth_error_deg]
      ]) + paragraph('Individual GCC curves, pairwise TDOAs and normal-equation matrices are not retained in this export. Values above are the actual saved solver outputs, not a reconstructed execution trace.', 'muted')
      + raw([...nodePath(ni), 'bearing'], 'Every recorded bearing field')
      + raw([...nodePath(ni), 'progressive'], 'Recorded growing-window bearing steps');
  });

  const weights = nodeCards(result, (n, ni) => {
    const terms = n.weight_terms;
    return paragraph('Noise, motion and multipath widen the bearing uncertainty. Overlap and nearby walls add further uncertainty for position fitting.')
      + formula('σ_bearing = min(90°, √(σ_noise² + σ_motion² + σ_multipath²))\nσ_total = min(90°, √(σ_bearing² + σ_overlap² + σ_reflector²))\nReported node weight = 1 / σ_total² (degrees)\nThe fix additionally reweights by range, using σ in radians.')
      + formula('Timing variance (CRB): (1 − γ²) / [2Tγ²(4π²/3)(f₂³ − f₁³)]\nγ² = (SNR_linear / (1 + SNR_linear))²; SNR_linear = 10^(SNR_dB / 10)\nTiming interpolation floor = 0.125 / (4 f_s √12) (placeholder)\nσ_t = max(√timing variance × PHAT penalty, interpolation floor) / √2\nσ_azimuth (radians) = c σ_t / [√Σ((p_k − mean p) · e_az)² × max(cos elevation, 0.15)]\nσ_azimuth (degrees) = min(90, σ_azimuth × 180 / π)\nσ_overlap = overlap_sigma_deg × 10^(min(level_difference_dB, 20) / 20)\nσ_reflector = reflector_sigma_deg × exp(−distance / reflector_scale_m)\nMultipath term scales with reflected/direct amplitude, delay spread and window overlap.')
      + (terms ? formula(`σ_total = min(90°, √(${number(terms.uncertainty_deg)}² + ${number(terms.overlap_deg)}² + ${number(terms.reflector_deg)}²)) = ${number(terms.total_deg)}°\nReported weight = 1 / ${number(terms.total_deg)}² = ${number(n.weight, 8)}`) : paragraph('No weight: this node has no usable bearing.', 'notice'))
      + table(['Quantity', 'Result'], [
        ['Noise term including motion (degrees)', n.bearing?.uncertainty_noise_deg],
        ['Motion term (degrees)', n.bearing?.uncertainty_motion_deg],
        ['Multipath term (degrees)', n.bearing?.uncertainty_multipath_deg],
        ['Nearest reflector (m)', n.nearest_reflector_m], ['Overlapped sources', n.overlapped_with],
        ['Reliable', n.reliable], ['Uncertainty valid', n.uncertainty_valid]
      ]) + raw(nodePath(ni));
  });

  const fix = result.fix;
  const fixes = paragraph('Intersect usable bearing rays. The default solver works horizontally; trusted elevations can rescue poorly conditioned horizontal geometry with a weighted 3D fit. Consensus and leave-one-out checks reject conflicting rays.')
    + formula('Σᵢ wᵢ (I − uᵢuᵢᵀ)(x − oᵢ) = 0\nFirst pass: wᵢ = 1 / σᵢ²\nTwo range reweightings: wᵢ = 1 / (max(tᵢ, 1) σᵢ)²\nNormalised residual = perpendicular miss / (max(tᵢ, 1) tan(min(σᵢ, 60°)))\nNegative range or crossing angle below the gate → poorly conditioned')
    + paragraph(fixSummary(result), fixed ? 'notice good-notice' : 'notice')
    + table(['Decision / result', 'Recorded value'], [
      ['Solver used', fix?.method], ['Position (x east, y north, z up)', point(fix?.position)],
      ['Inlier nodes', fix?.inlier_nodes], ['Ranges along inlier rays (m)', fix?.ranges_m],
      ['Horizontal crossing (degrees)', fix?.max_crossing_angle_horizontal_deg], ['3D crossing (degrees)', fix?.max_angle_3d_deg],
      ['Crossing gate (degrees)', s.fix_min_crossing_deg], ['Poorly conditioned', fix?.poorly_conditioned],
      ['Negative range', fix?.negative_range], ['Height clamped to prior', fix?.z_clamped], ['Height from nodes', fix?.z_from_nodes],
      ['Height prior (m; unresolved elevation only)', s.source_height_prior_m], ['Suspect reasons', fix?.suspect_reasons],
      ['Multipath suspect (simulator-only)', fix?.multipath_suspect], ['Available at (s)', fix?.ready_s]
    ])
    + table(['Rejected node', 'Reason', 'Residual (sigma)'], (fix?.rejected_nodes ?? []).map((n) => [n.node_id, n.reason, n.residual_sigma]))
    + table(['Leave-one-out node', 'Residual (sigma)'], (fix?.loo_residuals ?? []).map((n) => [n.node_id, n.residual_sigma]))
    + formula(`Validation only (simulator truth):\nEstimated = ${point(fixed)}\nTruth = ${point(result.true_position)}\nHorizontal error = √(Δx² + Δy²) = ${number(result.error_horizontal_m)} m\n3D error = √(Δx² + Δy² + Δz²) = ${number(result.error_3d_m)} m`)
    + paragraph('Suspect checks: below_ground, negative_range, range_ratio, loo_residual, outside_scene and weak_consensus. Rejected RANSAC hypotheses and per-iteration fit matrices are not retained.', 'muted')
    + raw([...prefix, 'fix'], 'Full saved fix and diagnostics');

  const tracking = paragraph('Align each node to a common emission time, solve rolling rays, then smooth positions with a constant-velocity alpha-beta filter. This is separate from the whole-event fix.')
    + formula(`Arrival time = emission time + |estimated position − node| / c\nWindow = [arrival time, arrival time + ${number(track?.window_s)} s]\nGate = max(${number(s.track_gate_min_deg)}°, ${number(s.track_gate_sigma)} × combined σ) + motion allowance\nTrusted positive elevation: pre-fix gate = at least ${number(s.track_pre_fix_elevation_gate_deg)}° around a recent bearing\nx⁻ = x + v Δt; residual = raw fix − x⁻\nx = x⁻ + ${number(s.track_alpha)} × residual\nv = v + (${number(s.track_beta)} / Δt) × residual`)
    + table(['Quantity', 'Result'], [
      ['Alignment', track?.alignment], ['Filter', track?.filter], ['Window (s)', track?.window_s], ['Interval (s)', track?.interval_s],
      ['Accepted observations', track?.observations?.length], ['Track fixes', track?.fixes?.length],
      ['Gate-rejected observations', track?.rejected_count], ['Dominated windows', track?.dominated_count],
      ['Median filtered horizontal error (m; simulator truth)', median]
    ])
    + paragraph('Track error_m and raw_error_m are horizontal errors, not 3D errors. Individual rejected-window records and internal alignment iterations are not retained.', 'muted')
    + recordedTable([...prefix, 'track', 'observations'], [['t_emit_s', 'Emission time (s)'], ['node_id', 'Node'], ['window_s', 'Arrival window (s)'], ['azimuth_deg', 'Azimuth (°)'], ['snr_db', 'SNR (dB)'], ['uncertainty_deg', 'Sigma (°)']], 'Read every accepted observation as a table')
    + recordedTable([...prefix, 'track', 'fixes'], [['t_emit_s', 'Emission time (s)'], ['raw_position', 'Raw position (m)'], ['position', 'Filtered position (m)'], ['velocity_mps', 'Horizontal velocity (m/s)'], ['method', 'Solver'], ['error_m', 'Filtered error (m)'], ['raw_error_m', 'Raw error (m)']], 'Read every track fix as a table (errors compare simulator truth)')
    + raw([...prefix, 'track', 'observations'], 'Every accepted rolling observation')
    + raw([...prefix, 'track', 'fixes'], 'Every track fix: raw / filtered position, velocity, timing, inliers and error')
    + raw([...prefix, 'track'], 'Full recorded track output');

  const bt = result.backtrace;
  const backtrace = paragraph('Back-trace measured bearings through visible reflections and diffraction-edge hypotheses. Rank points supported by multiple nodes, then cluster nearby candidates. These candidates do not replace the robust position fix.')
    + formula('Candidate score = Σ support weights × angle factor / (1 + mean path / 100 m)\nDefault angle factor = 1 above 20°; below that, (angle / 20°)²\nDefaults shown here are placeholders; back-trace constants are not all exported.')
    + table(['Rank', 'Position (m)', 'Score', 'Supporting nodes', 'Hypotheses'], (bt?.candidates ?? []).map((c) => [c.rank, c.position, c.score, c.n_nodes, c.hypotheses]))
    + table(['Validation (simulator truth)', 'Result'], [['True candidate rank', bt?.true_rank], ['True candidate error (m)', bt?.true_error_m], ['Total candidates', bt?.n_candidates]])
    + paragraph('The engine retains at most ten candidates and the top three in this export. All saved support records and ray branches are below.', 'muted')
    + raw([...prefix, 'backtrace'], 'Recorded candidates, support, edge hypotheses and traces');

  const lab = data.labelling;
  const events = lab?.events?.filter((e) => e.source_id === result.source_id) ?? [];
  const labels = lab ? paragraph('Run the echo app stack on omni and beamformed audio (or manifest labels in oracle mode). Associate detected periods with this source arrival, then pool labels and score against the simulator manifest.')
    + formula('Beamformed audio: align microphone signals to the measured direction, then average\nCLAP: audio/text cosine scores → pooled label scores\nYAMNet + agreement / priority rules → reported label and confidence\nAssociation: period starts near arrival, or while the source is sounding')
    + table(['Node', 'Input', 'Detected', 'Label', 'Confidence', 'Priority', 'Correct (manifest)'], events.map((e) => [e.node_id, e.input, e.detected, e.label, e.confidence, e.priority, e.correct]))
    + paragraph(`Mode: ${lab.mode ?? 'Not recorded'}. CLAP window: ${lab.clap_mode ?? 'Not recorded'}. Model tensors and embeddings are not exported. Confidence is not a real-world accuracy guarantee.`, 'muted')
    + raw(['labelling'], 'Every label, source aggregation, score, model identifier and association rule')
    : paragraph(s.labelling_enabled ? 'Labelling was enabled, but no completed labelling block exists for these results. It may still be running, have failed, or not have been saved with the results. Wait for completion, then export again; check Settings → Labelling for errors.' : 'Labelling was disabled for this run. No classifier was run as part of the saved localisation results.', 'notice');

  return `<section class="source">${header}
    ${stage(`windows-${ri}`, '04', 'Find sound & choose windows', 'Per-node detection, signal gates and window policy', windows)}
    ${stage(`bearings-${ri}`, '05', 'Estimate direction', 'GCC-PHAT delays → azimuth and elevation', bearings)}
    ${stage(`weights-${ri}`, '06', 'Quantify uncertainty', 'Noise, motion, multipath, overlap and wall terms → weights', weights)}
    ${stage(`fix-${ri}`, '07', 'Solve the position', fixSummary(result), fixes, true)}
    ${stage(`track-${ri}`, '08', 'Follow the moving sound', `${track?.fixes?.length ?? 0} fixes · ${track?.rejected_count ?? 'unknown'} gate rejections`, tracking)}
    ${stage(`backtrace-${ri}`, '09', 'Test indirect paths', 'Reflection and edge hypotheses → ranked candidates', backtrace)}
    ${stage(`labels-${ri}`, '10', 'Label the event', lab ? `${events.length} node/input label records` : 'No completed labelling results', labels)}
    ${raw(prefix, 'Complete source result, including every field not summarised above')}
    </section>`;
}

// Self-contained so the report works without the simulator tab or any external scripts.
export function bindReport(doc, nav, host) {
  const data = JSON.parse(doc.getElementById('report-data').textContent);
  const json = JSON.stringify(data, null, 2);
  const status = doc.getElementById('copy-status');
  const button = doc.getElementById('copy-json');
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      if (!nav.clipboard?.writeText) throw new Error('Clipboard access is unavailable in this browser');
      await nav.clipboard.writeText(json);
      status.textContent = 'JSON copied. Includes every exported field.';
    } catch (err) {
      status.textContent = `Could not copy JSON: ${err.message}. Open "Complete JSON" below and select the text to copy manually.`;
      const details = doc.getElementById('complete-json');
      details.open = true;
      details.querySelector('pre').textContent = json;
      details.scrollIntoView({ behavior: 'smooth' });
    } finally {
      button.disabled = false;
    }
  });
  doc.getElementById('print-report').addEventListener('click', () => {
    const sections = [...doc.querySelectorAll('.stage, .node')].map((d) => [d, d.open]);
    try {
      for (const [details] of sections) details.open = true;
      host.print();
    } finally {
      for (const [details, open] of sections) details.open = open;
    }
  });
  for (const [id, open] of [['expand-steps', true], ['collapse-steps', false]]) {
    doc.getElementById(id).addEventListener('click', () => {
      for (const details of doc.querySelectorAll('.stage')) details.open = open;
    });
  }
  for (const details of doc.querySelectorAll('.raw')) {
    details.addEventListener('toggle', () => {
      if (!details.open || details.dataset.loaded) return;
      const path = JSON.parse(details.dataset.path);
      const record = path.reduce((current, key) => current?.[key], data);
      const pre = details.querySelector('.raw-content');
      if (details.dataset.columns && Array.isArray(record) && record.length) {
        const columns = JSON.parse(details.dataset.columns);
        const table = doc.createElement('table');
        const head = table.createTHead().insertRow();
        for (const [, label] of columns) {
          const th = doc.createElement('th');
          th.scope = 'col';
          th.textContent = label;
          head.append(th);
        }
        const body = table.createTBody();
        for (const row of record) {
          const tr = body.insertRow();
          for (const [key] of columns) {
            const cell = row[key];
            tr.insertCell().textContent = cell === null || cell === undefined ? 'Not recorded' : typeof cell === 'object' ? JSON.stringify(cell) : String(cell);
          }
        }
        pre.append(table);
      } else {
        pre.textContent = record === undefined ? 'Not recorded in this export.' : JSON.stringify(record, null, 2);
      }
      details.dataset.loaded = 'true';
    });
  }
  const complete = doc.getElementById('complete-json');
  complete.addEventListener('toggle', () => {
    if (complete.open) complete.querySelector('pre').textContent = json;
  });
}

const STYLE = `
  :root { color-scheme: light; --ink:#162b35; --muted:#526972; --line:#dce5e3; --teal:#087f75; --pale:#e8f4ee; --orange:#ac5715; --paper:#f7f8f4; }
  * { box-sizing:border-box; } html { scroll-behavior:smooth; scroll-padding-top:90px; }
  body { margin:0; background:var(--paper); color:var(--ink); font:15px/1.6 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  button { cursor:pointer; font:inherit; border:1px solid var(--line); border-radius:9px; background:#fff; color:var(--ink); padding:10px 17px; font-weight:600; }
  button:hover { background:var(--pale); } button:focus-visible,summary:focus-visible,a:focus-visible { outline:3px solid var(--teal); outline-offset:4px; }
  button:disabled { cursor:wait; opacity:.6; } .primary { background:var(--teal); border-color:var(--teal); color:white; } .primary:hover { background:#06675e; }
  .topbar { position:sticky; top:0; z-index:3; background:#ffffffed; border-bottom:1px solid var(--line); backdrop-filter:blur(12px); }
  .topbar-inner { max-width:1440px; margin:auto; padding:14px 32px; display:flex; justify-content:space-between; gap:16px; align-items:center; }
  .brand { font-size:14px; font-weight:800; letter-spacing:.14em; } .brand span { color:var(--teal); }
  .actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; } #copy-status { max-width:450px; font-size:13px; color:var(--muted); }
  .layout { max-width:1440px; margin:auto; display:grid; grid-template-columns:210px minmax(0,1fr); gap:42px; padding:36px 32px 72px; }
  aside { position:sticky; top:110px; align-self:start; max-height:calc(100vh - 130px); overflow:auto; }
  aside strong { font-size:11px; text-transform:uppercase; letter-spacing:.16em; color:var(--muted); display:block; margin:0 0 14px; }
  aside a { display:block; color:var(--muted); text-decoration:none; padding:8px 10px; border-radius:7px; overflow-wrap:anywhere; }
  aside a:hover { background:var(--pale); color:var(--teal); } aside .divider { border-top:1px solid var(--line); margin:18px 0; }
  main { min-width:0; } h1 { font-size:clamp(32px,4vw,50px); letter-spacing:-.04em; line-height:1.12; margin:16px 0; }
  h2 { font-size:26px; letter-spacing:-.025em; margin:8px 0; overflow-wrap:anywhere; } h2 span { font-size:16px; font-weight:400; color:var(--muted); }
  h3 { font-size:17px; } .eyebrow { color:var(--teal); text-transform:uppercase; letter-spacing:.13em; font-size:11px; font-weight:800; }
  .hero { margin-bottom:26px; } .hero p { max-width:760px; color:var(--muted); font-size:17px; } .muted { color:var(--muted); font-size:13px; }
  .metrics { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; margin:22px 0; }
  .metric { background:#fff; border:1px solid var(--line); border-radius:13px; padding:19px; box-shadow:0 3px 12px #162b3504; }
  .metric span { display:block; color:var(--muted); font-size:12px; font-weight:600; } .metric strong { display:block; font-size:26px; letter-spacing:-.03em; margin:5px 0; }
  .metric small { display:block; color:var(--muted); font-size:11px; } .badge { display:inline-block; border-radius:20px; padding:4px 10px; background:#edf0f1; font-size:11px; font-weight:700; }
  .badge.good { color:#076347; background:#dcf3e6; } .badge.warn { color:#85410c; background:#fff0da; }
  .notice { border-left:3px solid #d99532; background:#fff5e4; border-radius:0 8px 8px 0; padding:14px 18px; font-size:13px; }
  .good-notice { border-color:var(--teal); background:var(--pale); }
  .controls { display:flex; gap:8px; margin:24px 0 16px; } .controls button { font-size:12px; padding:7px 12px; }
  .stage { border:1px solid var(--line); background:#fff; border-radius:12px; margin:12px 0; overflow:hidden; }
  summary { cursor:pointer; } .stage > summary { display:flex; align-items:center; gap:16px; padding:20px 22px; list-style:none; }
  .stage > summary::-webkit-details-marker { display:none; } .stage > summary:hover { background:#f7fbf8; }
  .step-number { background:var(--pale); color:var(--teal); width:38px; height:38px; display:grid; place-items:center; border-radius:10px; font-size:12px; font-weight:800; flex-shrink:0; }
  .stage > summary strong { display:block; font-size:16px; } .stage > summary small { display:block; color:var(--muted); font-size:12px; margin-top:3px; }
  .chevron { margin-left:auto; font-size:24px; color:var(--teal); } .stage[open] > summary .chevron { transform:rotate(45deg); }
  .stage-body { padding:4px 24px 24px; border-top:1px solid var(--line); }
  .formula { background:#152e36; color:#d7f1e6; border-radius:9px; padding:18px; font:12px/1.85 ui-monospace,SFMono-Regular,Consolas,monospace; white-space:pre-wrap; overflow-wrap:anywhere; }
  .table-wrap { overflow-x:auto; margin:18px 0; } table { width:100%; border-collapse:collapse; font-size:12px; text-align:left; }
  th { background:#f0f5f2; color:var(--muted); font-weight:700; white-space:nowrap; } td,th { padding:10px 12px; border-bottom:1px solid var(--line); }
  td { vertical-align:top; overflow-wrap:anywhere; } td:first-child { font-weight:600; } tbody tr:hover { background:#f7faf7; }
  .node { border:1px solid var(--line); border-radius:9px; margin:14px 0; } .node > summary { padding:12px 16px; } .node summary .badge { margin-left:10px; }
  .node-body { padding:0 16px 16px; } .source { margin:44px 0; } .source-heading { display:flex; justify-content:space-between; align-items:center; gap:16px; }
  .raw { font-size:12px; margin:16px 0; } .raw > summary { color:var(--teal); font-weight:600; } .raw-content,#complete-json pre { white-space:pre-wrap; overflow-wrap:anywhere; background:#f1f5f2; border:1px solid var(--line); border-radius:8px; padding:16px; max-height:560px; overflow:auto; font:11px/1.7 ui-monospace,Consolas,monospace; }
  #complete-json { margin-top:28px; } #complete-json > summary { font-weight:700; } footer { margin-top:38px; color:var(--muted); font-size:12px; border-top:1px solid var(--line); padding-top:20px; }
  @media(max-width:900px) { .layout { grid-template-columns:1fr; gap:0; padding:22px 16px; } aside { display:none; } .topbar-inner { padding:12px 16px; flex-wrap:wrap; } #copy-status { max-width:100%; } }
  @media(max-width:550px) { .metrics { grid-template-columns:1fr; } .source-heading { align-items:start; flex-direction:column; } .stage > summary { padding:16px 12px; gap:10px; } .stage-body { padding:4px 12px 16px; } }
  @media print { .topbar,aside,.controls { display:none; } .layout { display:block; padding:0; } body { background:white; font-size:11px; } .stage { break-inside:avoid; } .formula { background:#eef4f0; color:#152e36; } .raw-content { max-height:none; } }
`;

export function renderResultsReport(exportData, { title = 'Simulation results', stale = false } = {}) {
  // Normalise once to exactly the same JSON representation used by Copy JSON.
  const data = JSON.parse(JSON.stringify(exportData));
  if (!Array.isArray(data.results) || !data.scenario?.settings) throw new Error('The export has no simulation results or settings');
  const s = data.scenario.settings;
  const c = speedOfSound(s.temperature_c);
  const rendering = data.rendering;
  const located = data.results.filter((r) => r.fix?.position).length;
  const setup = paragraph('Coordinates use metres: x east, y north, z up. The scenario and microphone positions below belong to these results, not to later editor changes.')
    + table(['Node', 'Position (m)', 'Array', 'Microphones'], data.scenario.nodes.map((n) => [n.id, n.position, n.mic_array_name ?? n.mic_layout, data.nodes?.find((x) => x.id === n.id)?.mic_positions_assumed?.length]))
    + table(['Source', 'Clip', 'Start (s)', 'Level at 1 m (dB SPL)', 'Path keyframes'], data.scenario.sources.map((x) => [x.id, x.clip, x.start_s, x.level_1m_db, x.keyframes?.length]))
    + formula('Target clip pressure = 20 × 10⁻⁶ × 10^(level_1m_db / 20) Pa\nClip gain = target pressure / loudest 125 ms RMS\nThe clip RMS and calibrated sample arrays are not retained in this export.')
    + table(['Source', 'Target pressure at 1 m (Pa)'], data.scenario.sources.map((x) => [x.id, number(dbToPa(x.level_1m_db), 6)]))
    + raw(['scenario'], 'Complete scenario: settings, nodes, source keyframes, buildings and map')
    + raw(['nodes'], 'Assumed and rendered microphone positions');
  const physics = paragraph('The renderer finds direct, ground-reflected, wall-reflected and diffracted paths according to the scenario settings. It applies travel delay, spreading and frequency-dependent filters before mixing sound.')
    + formula(`Speed of sound = 331.3 + 0.606 × temperature\nc = 331.3 + 0.606 × ${number(s.temperature_c)} = ${number(c)} m/s\nPath travel delay = path length / c\nDigital gain = 10^(dbfs_ref_db / 20) / (20 × 10⁻⁶ × 10^(spl_ref_db / 20))\nDigital gain = ${number(digitalPerPa(s.spl_ref_db, s.dbfs_ref_db), 6)} float units / Pa`)
    + table(['Physics input', 'Value'], [['Temperature (°C)', s.temperature_c], ['Humidity (%)', s.humidity_pct], ['Pressure (kPa)', s.pressure_kpa], ['Air absorption', s.air_absorption], ['Ground reflectivity', s.ground_reflectivity], ['Reflection order', s.reflection_order], ['Diffraction order', s.diffraction_order], ['Diffraction model', s.diffraction_model], ['Path prune (dB)', s.path_prune_db]])
    + table(['Frequency (Hz)', 'ISO 9613-1 absorption (dB/m; derived from settings)'], [250, 1000, 4000].map((f) => [f, s.air_absorption ? number(airAbsorptionDbPerM(f, s.temperature_c, s.humidity_pct, s.pressure_kpa), 6) : 'Off']))
    + data.results.map((r, ri) => `<h3>${escape(r.source_id)}: saved array-centre paths</h3>` + nodeCards(r, (n, ni) => formula(`Path delay = length / ${number(c)} m/s\nSaved delay spread = ${number(n.delay_spread_s)} s\nChosen path index = ${n.picked_path_index ?? 'None'} (${n.picked_path_type ?? 'No match'})`)
      + table(['Path', 'Length (m)', 'Delay (s)', 'Relative level (dB)', 'Azimuth (°)', 'Elevation (°)'], (n.paths ?? []).map((p) => [p.type, p.length_m, p.delay_s, p.level_db_re_direct, p.arrival_azimuth_deg, p.arrival_elevation_deg]))
      + paragraph('Relative path levels are 1 kHz pressure comparisons without air absorption; see level_reference. These are centre-path diagnostics, not the actual per-microphone render audit.', 'muted')
      + raw(['results', ri, 'nodes', ni, 'paths'], 'Every saved path: surfaces, delays, diffraction loss and phase'))).join('');
  const render = paragraph('Calibrated clip spectra pass through each acoustic path, then sum per microphone. Inverse FFT returns the signal; ambient and self noise are added before converting Pascals to digital floats.')
    + formula('Y_m(f) = Σ_sources Σ_paths X_source(f) H_path(f) exp(−j 2π f τ)\nH_path includes spreading, bounce gains, air absorption and diffraction\noutput_m(t) = (inverseFFT(Y_m) + ambient noise + mic self-noise) × digital gain × mic gain')
    + (rendering ? table(['Recorded render quantity', 'Value'], [
      ['Sample rate (Hz)', rendering.sample_rate_hz], ['Samples per microphone', rendering.samples_per_mic],
      ['Rendered duration (s)', rendering.duration_s], ['Full-buffer FFT size', rendering.fft_size], ['Full-buffer frequency bins', rendering.frequency_bins],
      ['Noise enabled', s.noise_enabled], ['Ambient noise (dB SPL)', s.noise_floor_db_spl], ['Mic self-noise (dB SPL)', s.mic_self_noise_db_spl], ['Seed', s.seed]
    ]) + raw(['rendering'], 'Actual per-microphone render audit: each static source/path delay, 1 kHz gain and applied filter')
      : paragraph('Rendered audio and its audit are not available for these saved results. Press Create again to include the render audit.', 'notice'))
    + paragraph('Moving sources use crossfaded pieces along their route; the full-buffer FFT size is not each piece FFT size. The engine does not retain per-piece moving-path audits. Empty audit lists for a moving source mean “not recorded”, not “no sound”. FFT spectra, waveform samples and activity-frame arrays are deliberately excluded from JSON.', 'muted');
  const settings = table(['Threshold / setting', 'Value', 'Placeholder', 'Meaning'], Object.entries(data.thresholds ?? {}).map(([key, t]) => [key, t.value, t.placeholder, t.note]))
    + raw(['constants'], 'All exported physics constants')
    + raw(['thresholds'], 'Every exported threshold, exact value and placeholder marker')
    + raw(['changelog'], 'Export schema history')
    + raw(['notes'], 'All export caveats');
  const payload = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)} — echo-sim results</title><style>${STYLE}</style></head>
    <body><header class="topbar"><div class="topbar-inner"><div class="brand">ECHO<span> / SIM</span></div><div class="actions"><span id="copy-status" role="status" aria-live="polite"></span><button id="print-report">Print / PDF</button><button class="primary" id="copy-json">Copy JSON</button></div></div></header>
    <div class="layout"><aside><strong>Calculation trail</strong><a href="#setup">01 · Scene & calibration</a><a href="#physics">02 · Acoustic paths</a><a href="#render">03 · Microphone render</a><div class="divider"></div>${data.results.map((r, i) => `<a href="#source-${i}">${escape(r.source_id)}</a>`).join('')}<div class="divider"></div><a href="#settings">11 · Constants & thresholds</a><a href="#complete-json">Complete JSON</a></aside>
    <main><header class="hero"><span class="eyebrow">Simulation report · schema ${escape(data.schema)}</span><h1>${escape(title)}</h1>${paragraph('From sound source to position fix. Follow each calculation stage, inspect decisions at each node, and see exactly what the simulation recorded.')}
    <div class="metrics">${metric('Sources located', `${located} / ${data.results.length}`, 'Whole-event position fixes')}${metric('Microphone nodes', data.scenario.nodes.length, `${data.nodes?.reduce((sum, n) => sum + (n.mic_positions_assumed?.length ?? 0), 0) ?? 0} microphones`)}${metric('Track fixes', data.results.reduce((sum, r) => sum + (r.track?.fixes?.length ?? 0), 0), 'Rolling common-time positions')}</div></header>
    ${stale ? paragraph('The editor has changed since these results were created. This report uses the original result snapshot. Press Create for results matching the current editor.', 'notice') : ''}
    ${paragraph('SIMULATED, not real-world validation. Formulas explain the implementation; numeric outputs are saved results or explicitly labelled calculations from settings. This is not a full execution trace: intermediate FFT bins, solver matrices, rejected hypotheses and some moving-source internals are not retained.', 'notice')}
    <div class="controls"><button id="expand-steps">Expand all steps</button><button id="collapse-steps">Collapse all steps</button></div>
    ${stage('setup', '01', 'Set up scene & calibrate sound', 'Source levels, keyframes, node geometry and microphones', setup)}
    ${stage('physics', '02', 'Find acoustic paths', 'Travel time, reflection, diffraction and attenuation', physics)}
    ${stage('render', '03', 'Render microphone signals', 'Filtered path spectra + noise → digital microphone audio', render)}
    ${data.results.map((r, i) => sourceReport(data, r, i)).join('')}
    ${stage('settings', '11', 'Inspect constants & thresholds', 'Exact scenario values and placeholder warnings', settings)}
    <details id="complete-json"><summary>Complete JSON — same data as Copy JSON</summary><pre tabindex="0"></pre></details>
    <footer>All times are scenario seconds. Positions are world metres. No audio, spectra or embeddings are included. This report is a standalone snapshot and does not update when the simulation changes.${(data.notes ?? []).map((n) => paragraph(n)).join('')}</footer></main></div>
    <script id="report-data" type="application/json">${payload}</script><script>(${bindReport.toString()})(document, navigator, window);</script></body></html>`;
}

export function openResultsReport(data, { host = window, ...options } = {}) {
  const html = renderResultsReport(data, options);
  const tab = host.open('', '_blank');
  if (!tab) throw new Error('Your browser blocked the report tab. Allow pop-ups for this simulator and try again.');
  try {
    tab.opener = null;
    tab.document.open();
    tab.document.write(html);
    tab.document.close();
  } catch (err) {
    tab.close();
    throw err;
  }
  return tab;
}
