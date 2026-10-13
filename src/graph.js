// Live graph overlay (section 4.3). Draws only while visible.
const KEEP_MS = 10 * 60_000;
const MAX_CONTEXT_LINES = 8;
const MAX_TARGET_LINES = 10;
const GREYS = ['#777', '#999', '#555', '#aaa', '#666', '#888', '#bbb', '#444'];

export class LiveGraph {
  constructor(levelCanvas, scoreCanvas, { familyColor, isTarget }) {
    this.levelCanvas = levelCanvas;
    this.scoreCanvas = scoreCanvas;
    this.familyColor = familyColor;
    this.isTarget = isTarget;
    this.level = [];
    this.series = new Map(); // key -> { model, label, family, points: [{t, v}] }
    this.latestTop = { yamnet: new Set(), clap: new Set() };
    this.bands = () => [];
    this.windowS = 60;
    this.model = 'both';
    this.yAxis = 'fixed';
    this.visible = false;
    this.raf = null;
  }

  addLevel(t, rms) {
    this.level.push({ t, v: rms });
    this._trim(this.level, t);
  }

  // scores: [{ label, family, score }]
  addScores(model, t, scores) {
    const sorted = [...scores].sort((a, b) => b.score - a.score);
    this.latestTop[model] = new Set(sorted.slice(0, 5).map((s) => s.label));
    for (const s of scores) {
      if (s.score < 0.01 && !this.series.has(`${model}:${s.label}`)) continue;
      const key = `${model}:${s.label}`;
      let ser = this.series.get(key);
      if (!ser) this.series.set(key, (ser = { model, label: s.label, family: s.family, points: [] }));
      ser.points.push({ t, v: s.score });
      this._trim(ser.points, t);
    }
  }

  clear() {
    this.level = [];
    this.series.clear();
  }

  _trim(arr, now) {
    while (arr.length && arr[0].t < now - KEEP_MS) arr.shift();
  }

  show() {
    this.visible = true;
    const loop = () => {
      if (!this.visible) return;
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  hide() {
    this.visible = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  _prep(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  draw() {
    const now = Date.now();
    const span = this.windowS * 1000;
    const t0 = now - span;
    const t1 = now + span;
    const css = getComputedStyle(document.documentElement);
    const fg = css.getPropertyValue('--fg').trim() || '#000';
    const muted = css.getPropertyValue('--muted').trim() || '#888';
    const xOf = (t, w) => ((t - t0) / (t1 - t0)) * w;

    // Top: relative level with period bands.
    {
      const { ctx, w, h } = this._prep(this.levelCanvas);
      const lo = -90;
      const hi = 0;
      const yOf = (v) => h - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * h;
      ctx.fillStyle = 'rgba(0,114,178,0.18)';
      for (const b of this.bands(now)) {
        if (b.end < t0 || b.start > now) continue;
        const x0 = Math.max(0, xOf(b.start, w));
        const x1 = Math.min(xOf(now, w), xOf(b.end, w));
        ctx.fillRect(x0, 0, Math.max(1, x1 - x0), h);
      }
      this._grid(ctx, w, h, muted, [-80, -60, -40, -20].map((v) => [yOf(v), `${v}`]));
      ctx.strokeStyle = fg;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      let first = true;
      for (const p of this.level) {
        if (p.t < t0) continue;
        const x = xOf(p.t, w);
        const y = yOf(p.v);
        first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        first = false;
      }
      ctx.stroke();
      this._nowLine(ctx, xOf(now, w), h, muted);
      ctx.fillStyle = muted;
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText('Relative level (uncalibrated, dBFS)', 6, 12);
    }

    // Bottom: scores.
    {
      const { ctx, w, h } = this._prep(this.scoreCanvas);
      const lines = this._pickLines(t0);
      let yMax = 1;
      if (this.yAxis === 'auto') {
        yMax = 0.05;
        for (const s of lines) for (const p of s.points) if (p.t >= t0) yMax = Math.max(yMax, p.v);
        yMax = Math.min(1, yMax * 1.1);
      }
      const yOf = (v) => h - (v / yMax) * (h - 4);
      const ticks = [0.25, 0.5, 0.75, 1].map((f) => f * yMax);
      this._grid(ctx, w, h, muted, ticks.map((v) => [yOf(v), v.toFixed(2)]));
      let grey = 0;
      for (const s of lines) {
        const target = this.isTarget(s.family);
        ctx.strokeStyle = target ? this.familyColor(s.family) : GREYS[grey++ % GREYS.length];
        ctx.lineWidth = target ? 2 : 1;
        ctx.setLineDash(s.model === 'clap' ? [6, 4] : []);
        ctx.beginPath();
        let first = true;
        for (const p of s.points) {
          if (p.t < t0) continue;
          const x = xOf(p.t, w);
          const y = yOf(p.v);
          first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          first = false;
        }
        ctx.stroke();
        const last = s.points[s.points.length - 1];
        if (last && last.t >= t0) {
          ctx.setLineDash([]);
          ctx.fillStyle = ctx.strokeStyle;
          ctx.font = '11px system-ui, sans-serif';
          ctx.fillText(`${s.model === 'clap' ? 'C' : 'Y'} ${s.label}`, xOf(last.t, w) + 4, Math.max(10, yOf(last.v)));
        }
      }
      ctx.setLineDash([]);
      this._nowLine(ctx, xOf(now, w), h, muted);
      ctx.fillStyle = muted;
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText(`Scores (0-${yMax.toFixed(2)}). Solid: YAMNet, dashed: CLAP softmax`, 6, 12);
    }
  }

  _pickLines(t0) {
    const models = this.model === 'both' ? ['yamnet', 'clap'] : [this.model];
    const targets = [];
    const context = [];
    for (const s of this.series.values()) {
      if (!models.includes(s.model)) continue;
      let max = 0;
      for (const p of s.points) if (p.t >= t0 && p.v > max) max = p.v;
      if (max < 0.02) continue;
      if (this.isTarget(s.family)) targets.push({ s, max });
      else if (this.latestTop[s.model].has(s.label)) context.push({ s, max });
    }
    const top = (arr, n) => arr.sort((a, b) => b.max - a.max).slice(0, n).map((x) => x.s);
    return [...top(context, MAX_CONTEXT_LINES), ...top(targets, MAX_TARGET_LINES)];
  }

  _grid(ctx, w, h, color, ticks) {
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 1;
    for (const [y] of ticks) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.font = '10px system-ui, sans-serif';
    for (const [y, label] of ticks) ctx.fillText(label, w - 30, y - 2);
  }

  _nowLine(ctx, x, h, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
