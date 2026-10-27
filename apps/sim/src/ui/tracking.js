export function drawLocalisationTrack(ctx, result, time, { project, dpr = 1, color = '#ffb000' }) {
  const fixes = result.track?.fixes.filter((fix) => fix.t_s <= time) || [];
  if (!fixes.length) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5 * dpr;
  ctx.setLineDash([]);
  ctx.beginPath();
  let previous = null;
  for (const fix of fixes) {
    const point = project(fix.position);
    if (!point) {
      previous = null;
      continue;
    }
    if (previous && fix.t_s - previous.t_s <= result.track.interval_s * 1.5) ctx.lineTo(point[0], point[1]);
    else ctx.moveTo(point[0], point[1]);
    previous = fix;
  }
  ctx.stroke();
  for (const fix of fixes.slice(0, -1)) {
    const point = project(fix.position);
    if (!point) continue;
    ctx.beginPath();
    ctx.arc(point[0], point[1], 4 * dpr, 0, 2 * Math.PI);
    ctx.stroke();
  }
  const latest = fixes[fixes.length - 1];
  const point = project(latest.position);
  if (point) {
    ctx.lineWidth = 2.5 * dpr;
    ctx.beginPath();
    ctx.arc(point[0], point[1], 8 * dpr, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.font = `${11 * dpr}px monospace`;
    const stale = time - latest.t_s > result.track.interval_s * 1.5;
    ctx.fillText(`${result.source_id} ${stale ? 'last fix' : 'fix'} ${latest.t_s.toFixed(2)} s`, point[0] + 12 * dpr, point[1] - 10 * dpr);
  }
  ctx.restore();
}
