// Optional stage timing. A profile is a plain object { ms: {stage: total}, calls: {stage: count} }; without one the call is free.
export const newProfile = () => ({ ms: {}, calls: {} });

export function timed(profile, stage, fn) {
  if (!profile) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    profile.ms[stage] = (profile.ms[stage] || 0) + performance.now() - t0;
    profile.calls[stage] = (profile.calls[stage] || 0) + 1;
  }
}
