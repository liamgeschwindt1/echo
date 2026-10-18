const UPSAMPLE = 4;
// Placeholder, not measured: PHAT is less efficient than the Cramer-Rao bound; 1 means "no extra penalty".
export const PHAT_EFFICIENCY_PENALTY = 1;

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
  const floorTau = 1 / (fs * UPSAMPLE * Math.sqrt(12));
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
