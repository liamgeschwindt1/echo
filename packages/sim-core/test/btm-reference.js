// Independent exact reference: Biot-Tolstoy-Medwin (BTM) impulse response of an infinite rigid wedge, in the closed form of
// Svensson, Fred and Vanderkooy (1999), transformed numerically to the frequency domain. Used only by tests and scripts.
// Geometry: the edge is the z axis, angles are measured from the 0-face through the exterior region (0 < theta < wedge angle).
// Returns the complex diffracted pressure times 4 pi for a unit point source (free field would be e^{-jkR}/R), time convention e^{+jwt}.

function betaSum(nu, thS, thR, eta) {
  const ch = Math.cosh(nu * eta);
  let sum = 0;
  for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const ang = nu * (Math.PI + a * thS + b * thR);
    const den = ch - Math.cos(ang);
    sum += Math.sin(ang) / den;
  }
  return sum;
}

export function btmDiffracted({ wedgeAngle, rS, thS, zS = 0, rR, thR, zR = 0, f, c, samples = 400000 }) {
  const nu = Math.PI / wedgeAngle;
  const dz = zS - zR;
  const base = rS * rS + rR * rR + dz * dz;
  // earliest arrival: shortest src -> edge -> receiver
  const l0 = Math.hypot(rS, zS - (zS * rR + zR * rS) / (rS + rR)) + Math.hypot(rR, zR - (zS * rR + zR * rS) / (rS + rR));
  const tau0 = l0 / c;
  const omega = 2 * Math.PI * f;
  // tau = tau0 + w^2; integrate over w with Simpson; h(tau) 2 w is smooth because h ~ 1/sqrt(tau - tau0)
  const spanTau = Math.max(40 * l0 / c, 400 / f);
  const W = Math.sqrt(spanTau);
  const n = samples;
  const dw = W / n;
  let sr = 0;
  let si = 0;
  for (let i = 0; i < n; i++) {
    const w = (i + 0.5) * dw;
    const g = gAt(w);
    const ph = -omega * (tau0 + w * w);
    sr += g * Math.cos(ph);
    si += g * Math.sin(ph);
  }
  function gAt(w) {
    const tau = tau0 + w * w;
    const ct = c * tau;
    const arg = (ct * ct - base) / (2 * rS * rR);
    const eta = Math.acosh(Math.max(arg, 1));
    const sinhEta = Math.sinh(eta);
    // h(tau) = -(nu c / (2 pi)) * sum beta / (rS rR sinh eta), normalised so free field is e^{-jkR}/R (checked: half-plane shadow boundary gives 1/2); the factor 2 w is the Jacobian of tau = tau0 + w^2
    const h = -((nu * c) / (2 * Math.PI)) * betaSum(nu, thS, thR, eta) / (rS * rR * sinhEta);
    return h * 2 * w;
  }
  return [sr * dw, si * dw];
}
