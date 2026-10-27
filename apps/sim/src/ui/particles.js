export function sourceColor(index) {
  return `hsl(${(index * 137.508 % 360).toFixed(3)} 85% 65%)`;
}

export function waveParticles(rings, { slice = 1.5, spatial = false, maxParticles = 6000 } = {}) {
  const live = rings.filter((ring) => ring.alpha > 0.02);
  const stride = Math.max(1, Math.ceil(live.length / 60));
  const count = Math.min(spatial ? 96 : 64, Math.floor(maxParticles / Math.ceil(live.length / stride || 1)));
  const particles = [];
  for (let index = 0; index < live.length; index += stride) {
    const ring = live[index];
    const radius = spatial ? ring.radius : ring.rho;
    if (!(radius > 0)) continue;
    for (let sample = 0; sample < count; sample++) {
      const vertical = spatial ? 1 - 2 * (sample + 0.5) / count : 0;
      const angle = spatial ? sample * 2.399963229728653 : sample * 2 * Math.PI / count;
      const horizontal = Math.sqrt(1 - vertical * vertical);
      const direction = [horizontal * Math.cos(angle), horizontal * Math.sin(angle), vertical];
      const position = [
        ring.center[0] + radius * direction[0],
        ring.center[1] + radius * direction[1],
        spatial ? ring.center[2] + radius * direction[2] : slice
      ];
      if (position[2] < 0 || (ring.valid && !ring.valid(position))) continue;
      particles.push({ position, color: ring.color, alpha: ring.alpha });
    }
  }
  return particles;
}

export function drawParticles(ctx, particles, project, dpr = 1) {
  ctx.save();
  for (const particle of particles) {
    const point = project(particle.position);
    if (!point) continue;
    ctx.fillStyle = particle.color;
    ctx.globalAlpha = Math.min(1, Math.max(0, particle.alpha));
    ctx.beginPath();
    ctx.arc(point[0], point[1], 1.8 * dpr, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.restore();
}