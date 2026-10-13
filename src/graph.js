import { familyColor, GREY } from './watchlist.js';

const MAX_GREY_LINES = 8;

// Two canvases (level + scores) sharing one time axis. "Now" is fixed at the
// horizontal centre; history drifts left; the right half is always blank.
export class Grapher {
  constructor(levelCanvas, scoreCanvas, { onScrub } = {}) {
    this.levelCanvas = levelCanvas;
    this.scoreCanvas = scoreCanvas;
    this.onScrub = onScrub || (() => {});

    this.windowSec = 60; // total axis width; history shown = windowSec / 2
    this.paused = false;
    this.scrubT = null; // ms timestamp when frozen, else null

    this.levelPoints = []; // { t, rms, peak, wind }
    this.series = new Map(); // key -> { family, relevant, model, dashed, points: [{t,score}], peak }
    this.markers = []; // { t, note }
    this.hiddenFamilies = new Set();
    this.windThreshold = 0.4;

    this._resize();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this.scoreCanvas);
    this._ro.observe(this.levelCanvas);

    this._bindPointer();
    this._raf = requestAnimationFrame(() => this._tick());
  }

  _resize() {
    for (const canvas of [this.levelCanvas, this.scoreCanvas]) {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    }
  }

  setWindowSec(sec) {
    this.windowSec = sec;
    this._prune();
  }

  setPaused(paused) {
    this.paused = paused;
    if (paused) {
      if (!this.scrubT) this.scrubT = Date.now();
    } else {
      this.scrubT = null;
    }
  }

  toggleFamily(family) {
    if (this.hiddenFamilies.has(family)) this.hiddenFamilies.delete(family);
    else this.hiddenFamilies.add(family);
  }

  addLevelPoint(point) {
    this.levelPoints.push(point);
    this._prune();
  }

  addScorePoint(key, { t, score, family, relevant, model, dashed }) {
    let s = this.series.get(key);
    if (!s) {
      s = { family, relevant, model, dashed: !!dashed, points: [], peak: 0 };
      this.series.set(key, s);
    }
    s.points.push({ t, score });
    if (score > s.peak) s.peak = score;
    this._prune();
  }

  addMarker(t, note) {
    this.markers.push({ t, note });
  }

  _prune() {
    const cutoff = Date.now() - this.windowSec * 1000 - 5000;
    this.levelPoints = this.levelPoints.filter((p) => p.t >= cutoff);
    for (const s of this.series.values()) {
      s.points = s.points.filter((p) => p.t >= cutoff);
      s.peak = s.points.reduce((m, p) => Math.max(m, p.score), 0);
    }
    this.markers = this.markers.filter((m) => m.t >= cutoff);
  }

  _bindPointer() {
    const canvas = this.scoreCanvas;
    let dragging = false;
    const handle = (clientX) => {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const frac = x / rect.width;
      const now = this.paused && this.scrubT ? this.scrubT : Date.now();
      const historySec = this.windowSec / 2;
      const t = now - historySec * 1000 + frac * this.windowSec * 1000;
      this.scrubT = t;
      this.paused = true;
      this.onScrub(t);
    };
    canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      handle(e.clientX);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (dragging) handle(e.clientX);
    });
    window.addEventListener('pointerup', () => {
      dragging = false;
    });
  }

  topAt(t, model) {
    const tolerance = 1500;
    const rows = [];
    for (const [key, s] of this.series) {
      if (model && s.model !== model) continue;
      let closest = null;
      for (const p of s.points) {
        if (Math.abs(p.t - t) <= tolerance && (!closest || Math.abs(p.t - t) < Math.abs(closest.t - t))) {
          closest = p;
        }
      }
      if (closest) rows.push({ key, family: s.family, relevant: s.relevant, score: closest.score });
    }
    rows.sort((a, b) => b.score - a.score);
    return rows.slice(0, 5);
  }

  _tick() {
    this._draw();
    this._raf = requestAnimationFrame(() => this._tick());
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    this._ro.disconnect();
  }

  _xFor(t, width, nowMs) {
    const historyMs = (this.windowSec / 2) * 1000;
    const frac = (t - (nowMs - historyMs)) / (this.windowSec * 1000);
    return frac * width;
  }

  _draw() {
    const nowMs = this.paused && this.scrubT ? this.scrubT : Date.now();
    this._drawLevel(nowMs);
    this._drawScores(nowMs);
  }

  _drawLevel(nowMs) {
    const canvas = this.levelCanvas;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    this._drawBackground(ctx, width, height, nowMs);

    const minDb = -80;
    const maxDb = 0;
    const toY = (db) => height - ((db - minDb) / (maxDb - minDb)) * height;

    // wind shading
    ctx.save();
    ctx.fillStyle = 'rgba(153,153,153,0.18)';
    let windStart = null;
    for (let i = 0; i < this.levelPoints.length; i++) {
      const p = this.levelPoints[i];
      const isWindy = (p.wind || 0) >= this.windThreshold;
      const x = this._xFor(p.t, width, nowMs);
      if (isWindy && windStart === null) windStart = x;
      if (!isWindy && windStart !== null) {
        ctx.fillRect(windStart, 0, x - windStart, height);
        windStart = null;
      }
    }
    if (windStart !== null) ctx.fillRect(windStart, 0, width - windStart, height);
    ctx.restore();

    if (this.levelPoints.length > 1) {
      ctx.beginPath();
      ctx.moveTo(this._xFor(this.levelPoints[0].t, width, nowMs), toY(this.levelPoints[0].rms));
      for (const p of this.levelPoints) {
        ctx.lineTo(this._xFor(p.t, width, nowMs), toY(Number.isFinite(p.rms) ? p.rms : minDb));
      }
      ctx.lineTo(this._xFor(this.levelPoints[this.levelPoints.length - 1].t, width, nowMs), height);
      ctx.lineTo(this._xFor(this.levelPoints[0].t, width, nowMs), height);
      ctx.closePath();
      ctx.fillStyle = 'rgba(37,99,235,0.35)';
      ctx.fill();

      ctx.beginPath();
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 1 * (window.devicePixelRatio || 1);
      for (let i = 0; i < this.levelPoints.length; i++) {
        const p = this.levelPoints[i];
        const x = this._xFor(p.t, width, nowMs);
        const y = toY(Number.isFinite(p.peak) ? p.peak : minDb);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    this._drawNowLine(ctx, width, height);
  }

  _drawBackground(ctx, width, height, nowMs) {
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--graph-bg') || '#0b0f1a';
    ctx.fillRect(0, 0, width, height);
    // future half (right of now) rendered slightly darker to show it's blank
    const centerX = width / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(centerX, 0, width - centerX, height);
  }

  _drawNowLine(ctx, width, height) {
    const centerX = width / 2;
    ctx.save();
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.5 * (window.devicePixelRatio || 1);
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, height);
    ctx.stroke();
    ctx.restore();
  }

  _visibleGreyKeys(nowMs, width) {
    // A grey (non-relevant) class is drawn only if it's in the top 5 of some
    // currently-visible window; cap at 8, keep highest peak.
    const candidates = [];
    for (const [key, s] of this.series) {
      if (s.relevant) continue;
      if (this.hiddenFamilies.has(s.family)) continue;
      const visiblePoints = s.points.filter((p) => this._xFor(p.t, width, nowMs) >= 0);
      if (visiblePoints.length === 0) continue;
      let inTop5 = false;
      // group points by nearest 500ms bucket to approximate "a window"
      const buckets = new Map();
      for (const p of visiblePoints) {
        const b = Math.round(p.t / 500);
        if (!buckets.has(b)) buckets.set(b, []);
        buckets.get(b).push(p.score);
      }
      for (const scores of buckets.values()) {
        const rank = this._rankInWindow(key, Math.max(...scores));
        if (rank <= 5) {
          inTop5 = true;
          break;
        }
      }
      if (inTop5) candidates.push({ key, peak: s.peak });
    }
    candidates.sort((a, b) => b.peak - a.peak);
    return new Set(candidates.slice(0, MAX_GREY_LINES).map((c) => c.key));
  }

  _rankInWindow(key, score) {
    // Approximate rank of `score` among all current peaks (cheap heuristic).
    let rank = 1;
    for (const [k, s] of this.series) {
      if (k === key) continue;
      if (s.peak > score) rank++;
    }
    return rank;
  }

  _drawScores(nowMs) {
    const canvas = this.scoreCanvas;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    this._drawBackground(ctx, width, height, nowMs);

    const toY = (score) => height - Math.max(0, Math.min(1, score)) * height;
    const greyKeys = this._visibleGreyKeys(nowMs, width);

    for (const [key, s] of this.series) {
      if (s.relevant && this.hiddenFamilies.has(s.family)) continue;
      if (!s.relevant && !greyKeys.has(key)) continue;
      if (s.points.length < 1) continue;

      let color = s.relevant ? familyColor(s.family) : GREY;
      let alpha = s.relevant ? 1 : Math.max(0.25, Math.min(0.8, s.peak));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = (s.relevant ? 1.5 : 1) * (window.devicePixelRatio || 1);
      if (s.dashed || s.family === 'Context') ctx.setLineDash([6, 4]);
      ctx.beginPath();
      let started = false;
      for (const p of s.points) {
        const x = this._xFor(p.t, width, nowMs);
        const y = toY(p.score);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else if (s.model === 'clap') {
          // stepped line for the slower CLAP cadence
          const prevX = this._xFor(s.points[s.points.indexOf(p) - 1]?.t ?? p.t, width, nowMs);
          ctx.lineTo(x, toY(s.points[s.points.indexOf(p) - 1]?.score ?? p.score));
          ctx.lineTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    // markers
    for (const m of this.markers) {
      const x = this._xFor(m.t, width, nowMs);
      if (x < 0 || x > width) continue;
      ctx.save();
      ctx.strokeStyle = '#f59e0b';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.5 * (window.devicePixelRatio || 1);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#f59e0b';
      ctx.font = `${11 * (window.devicePixelRatio || 1)}px sans-serif`;
      ctx.fillText(m.note.slice(0, 24), Math.min(x + 4, width - 100), 14 * (window.devicePixelRatio || 1));
      ctx.restore();
    }

    // scrub cursor
    if (this.paused && this.scrubT) {
      const x = this._xFor(this.scrubT, width, nowMs);
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1 * (window.devicePixelRatio || 1);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.restore();
    } else {
      this._drawNowLine(ctx, width, height);
    }
  }
}
