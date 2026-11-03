const UPSAMPLE = 4;
// Placeholder, not measured: PHAT is less efficient than the Cramer-Rao bound; 1 means "no extra penalty".
export const PHAT_EFFICIENCY_PENALTY = 1;
// Empirical: the best-case spread in the calibration run (about 0.04 degrees, i.e. 0.19 us of timing) is about 1/8 of a quarter-step
// of the up-sampled correlation. Fitted to that run, so treat it as a placeholder.
export const INTERPOLATION_FLOOR_FRACTION = 0.125;

/**
 * One-sigma azimuth uncertainty in degrees.
 *
 * Time delay between two mics (Carter / Cramer-Rao, band-limited white signal):
 *   var(tau) = (1 - g2) / (2 T g2 (4 pi^2 / 3) (f2^3 - f1^3)),  g2 = (s / (1 + s))^2,  s = linear SNR per mic
 * Each of the four mics is then assumed to carry independent timing error sigma_tau / sqrt(2), and a
 * least-squares plane-wave fit gives
 *   var(az) = c^2 var_t / (cos^2(el) * sum_k ((p_k - mean p) . e_az)^2),  e_az = (-sin az, cos az, 0).
 * The geometry sum is what makes the error depend on the array and on direction.
 */
export function azimuthUncertaintyDeg({ snrDb, windowS, band, positions, azimuthDeg, elevationDeg, c, fs }) {
  const s = 10 ** (snrDb / 10);
  const g2 = Math.min(0.999999, (s / (1 + s)) ** 2);
  const [f1, f2] = band;
  const bandTerm = ((4 * Math.PI ** 2) / 3) * (f2 ** 3 - f1 ** 3);
  const varTau = (1 - g2) / (2 * Math.max(windowS, 1e-4) * g2 * bandTerm);
  // Sub-sample interpolation cannot resolve a delay better than a fraction of the up-sampled step.
  const floorTau = (INTERPOLATION_FLOOR_FRACTION * 1) / (fs * UPSAMPLE * Math.sqrt(12));
  const sigmaTau = Math.max(Math.sqrt(varTau) * PHAT_EFFICIENCY_PENALTY, floorTau);
  const sigmaT = sigmaTau / Math.SQRT2;
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const e = [-Math.sin(az), Math.cos(az), 0];
  const mean = [0, 1, 2].map((a) => positions.reduce((acc, p) => acc + p[a], 0) / positions.length);
  const sum = positions.reduce((acc, p) => acc + ((p[0] - mean[0]) * e[0] + (p[1] - mean[1]) * e[1]) ** 2, 0);
  const sigmaAz = (c * sigmaT) / Math.sqrt(Math.max(sum, 1e-12)) / Math.max(Math.cos(el), 0.15);
  return Math.min(90, (sigmaAz * 180) / Math.PI);
}

/**
 * Multipath floor (degrees) on a bearing: a reflection a = 10^(-D/R / 20) of the direct level pulls the bearing towards
 * it in proportion to its relative level, more so the longer the paths are spread (up to multipath_spread_ref_ms), and
 * only for the part of the window the reflection actually falls in: (T - gap) / T, gap = delay of the strongest
 * reflection after the first arrival. No direct path: the picked path is itself indirect, a = 1. All placeholders.
 */
export function multipathSigmaDeg({ directToReflectedDb, delaySpreadS, reflectionGapS, windowS, settings }) {
  if (delaySpreadS === null || delaySpreadS === undefined || delaySpreadS <= 0) return 0;
  const a = directToReflectedDb === null || directToReflectedDb === undefined ? 1 : Math.min(1, 10 ** (-directToReflectedDb / 20));
  const spread = Math.min(1, delaySpreadS / (settings.multipath_spread_ref_ms / 1000));
  const gap = reflectionGapS ?? 0;
  const inWindow = windowS > 0 ? Math.max(0, Math.min(1, (windowS - gap) / windowS)) : 1;
  return settings.multipath_floor_deg * a * spread * inWindow;
}

/** Extra sigma of an overlapped window: overlap_sigma_deg at 0 dB, scaled by 10^(level_diff/20) (others minus own, dB). */
export const overlapSigmaDeg = (levelDiffDb, settings) => (levelDiffDb === null || levelDiffDb === undefined ? 0 : settings.overlap_sigma_deg * 10 ** (Math.min(levelDiffDb, 20) / 20));

/** Extra sigma for a node close to a wall: reflector_sigma_deg * exp(-d / reflector_scale_m). */
export const reflectorSigmaDeg = (distanceM, settings) => (distanceM === null || distanceM === undefined ? 0 : settings.reflector_sigma_deg * Math.exp(-distanceM / settings.reflector_scale_m));
