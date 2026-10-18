// Rigid-wedge edge diffraction: Kouyoumjian-Pathak uniform theory of diffraction (UTD) with the Fresnel transition function.
// Time convention e^{+j w t}, so a delay tau is the factor e^{-j w tau}, the same as the renderer.
// Pure and DOM-free. See docs/diffraction-validation.md for the references and the checks against an exact solution.

export const DIFFRACTION_REFERENCES = [
  'R. G. Kouyoumjian and P. H. Pathak, "A uniform geometrical theory of diffraction for an edge in a perfectly conducting surface", Proc. IEEE 62(11), 1448-1461, 1974.',
  'J. B. Keller, "Geometrical theory of diffraction", J. Opt. Soc. Am. 52(2), 116-130, 1962.',
  'M. A. Biot and I. Tolstoy, J. Acoust. Soc. Am. 29, 381-391, 1957; H. Medwin, J. Acoust. Soc. Am. 69, 1060-1064, 1981 (BTM, used as the independent exact reference).',
  'U. P. Svensson, R. I. Fred and J. Vanderkooy, "An analytic secondary source model of edge diffraction impulse responses", J. Acoust. Soc. Am. 106(5), 2331-2344, 1999.'
];

const SQRT_PI = Math.sqrt(Math.PI);

// Series for the Fresnel integrals C(s) and S(s) (argument convention cos(pi t^2 / 2)), accurate to ~1e-10 for s <= 3.1.
function fresnelCS(s) {
  const h = Math.PI / 2;
  const s2 = s * s;
  const s4 = s2 * s2;
  let c = 0;
  let sn = 0;
  let termC = s; // s^(4n+1) (pi/2)^(2n) / (2n)!
  let termS = h * s * s2; // (pi/2)^(2n+1) s^(4n+3) / (2n+1)!
  for (let n = 0; n < 60; n++) {
    c += (n % 2 ? -1 : 1) * termC / (4 * n + 1);
    sn += (n % 2 ? -1 : 1) * termS / (4 * n + 3);
    termC *= (h * h * s4) / ((2 * n + 1) * (2 * n + 2));
    termS *= (h * h * s4) / ((2 * n + 2) * (2 * n + 3));
    if (Math.abs(termC) < 1e-18 && Math.abs(termS) < 1e-18) break;
  }
  return [c, sn];
}

const ASYMPTOTIC_FROM = 15;

/** Kouyoumjian-Pathak transition function F(x) = 2j sqrt(x) e^{jx} * integral_{sqrt x}^{inf} e^{-j t^2} dt, returned as [re, im]. */
export function fresnelF(x) {
  if (x <= 0) return [0, 0];
  if (x >= ASYMPTOTIC_FROM) {
    // F ~ sum_m (2m-1)!! / (-2j x)^m
    let re = 1;
    let im = 0;
    let coef = 1;
    for (let m = 1; m <= 12; m++) {
      coef *= (2 * m - 1) / (2 * x);
      // (-2j x)^-m = (j/(2x))^m: j^m cycles 1, j, -1, -j
      const ph = m % 4;
      const t = coef;
      if (ph === 0) re += t;
      else if (ph === 1) im += t;
      else if (ph === 2) re -= t;
      else im -= t;
    }
    return [re, im];
  }
  const s = Math.sqrt((2 * x) / Math.PI);
  const [C, S] = fresnelCS(s);
  // integral_0^inf e^{-j t^2} dt = (sqrt(pi)/2) e^{-j pi/4}; integral_0^sqrt(x) = sqrt(pi/2) (C(s) - j S(s))
  const k = Math.sqrt(Math.PI / 2);
  const iRe = (SQRT_PI / 2) * Math.SQRT1_2 - k * C;
  const iIm = -(SQRT_PI / 2) * Math.SQRT1_2 + k * S;
  // F = 2j sqrt(x) e^{jx} * (iRe + j iIm)
  const cx = Math.cos(x);
  const sx = Math.sin(x);
  const pr = cx * iRe - sx * iIm;
  const pi = cx * iIm + sx * iRe;
  const a = 2 * Math.sqrt(x);
  return [-a * pi, a * pr];
}

const CUT = 1e-7;

// cot(eps) F(k L a) with a = 2 sin^2(n eps), eps the signed distance from the argument to the nearest multiple of pi.
function cotF(arg, n, kL) {
  const m = Math.round(arg / Math.PI);
  const eps = arg - Math.PI * m;
  if (Math.abs(eps) < CUT) {
    // limit as eps -> 0: n sqrt(2 pi k L) e^{j pi/4} sgn(eps); the sign follows the side the receiver is really on.
    const sg = eps < 0 ? -1 : 1;
    const v = n * Math.sqrt(2 * Math.PI * kL) * sg;
    return [v * Math.SQRT1_2, v * Math.SQRT1_2];
  }
  const a = 2 * Math.sin(n * eps) ** 2;
  const [fr, fi] = fresnelF(kL * a);
  const cot = Math.cos(eps) / Math.sin(eps);
  return [cot * fr, cot * fi];
}

/**
 * UTD diffraction coefficient of one rigid wedge edge, [re, im].
 * term = { n, beta, phi, phiP, L, R0, Rn }: n * pi is the exterior wedge angle, beta the angle between the ray and the edge,
 * phi / phiP the receiver / source angles measured from the 0-face, L = s s' / (s + s') sin^2 beta (spherical incidence),
 * R0 / Rn the pressure reflection coefficients of the two faces (1 rigid, 0 non reflecting).
 * The field at the receiver is (e^{-jks'} / s') D sqrt(s' / (s (s + s'))) e^{-jks}; D has units of sqrt(m).
 */
export function utdCoefficient(term, f, c) {
  const k = (2 * Math.PI * Math.max(f, 1)) / c;
  const { n, beta, phi, phiP, L, R0, Rn } = term;
  const kL = k * L;
  const dm = phi - phiP;
  const dp = phi + phiP;
  const t1 = cotF((Math.PI + dm) / (2 * n), n, kL);
  const t2 = cotF((Math.PI - dm) / (2 * n), n, kL);
  const t3 = cotF((Math.PI - dp) / (2 * n), n, kL);
  const t4 = cotF((Math.PI + dp) / (2 * n), n, kL);
  const sr = t1[0] + t2[0] + R0 * t3[0] + Rn * t4[0];
  const si = t1[1] + t2[1] + R0 * t3[1] + Rn * t4[1];
  // -e^{-j pi/4} / (2 n sqrt(2 pi k) sin beta)
  const pre = -1 / (2 * n * Math.sqrt(2 * Math.PI * k) * Math.sin(beta));
  const er = Math.SQRT1_2;
  const ei = -Math.SQRT1_2;
  return [pre * (er * sr - ei * si), pre * (er * si + ei * sr)];
}

/** Complex response of a whole diffraction chain (product of the edge coefficients) at one frequency. */
export function diffractionResponse(diff, f, c) {
  let re = 1;
  let im = 0;
  for (const term of diff.terms) {
    const [dr, di] = utdCoefficient(term, f, c);
    const nr = re * dr - im * di;
    im = re * di + im * dr;
    re = nr;
  }
  return [re, im];
}

const GRID_PER_OCTAVE = 12;
const GRID_FMIN = 10;

/** Log-spaced frequency grid (1/12 octave) up to and including the Nyquist frequency. */
export function diffractionGrid(fs) {
  const nyq = fs / 2;
  const count = Math.ceil(Math.log2(nyq / GRID_FMIN) * GRID_PER_OCTAVE) + 2;
  const freqs = new Float64Array(count);
  for (let i = 0; i < count; i++) freqs[i] = GRID_FMIN * 2 ** (i / GRID_PER_OCTAVE);
  return freqs;
}

/** Complex response on the log grid: { re, im } Float64Arrays. One evaluation per grid point, not per render bin. */
export function diffractionOnGrid(diff, freqs, c) {
  const re = new Float64Array(freqs.length);
  const im = new Float64Array(freqs.length);
  for (let i = 0; i < freqs.length; i++) [re[i], im[i]] = diffractionResponse(diff, freqs[i], c);
  return { re, im };
}

/** For each render bin, the grid cell and fraction used to interpolate in log frequency. Computed once per render. */
export function gridMap(bins, fs, n, freqs) {
  const idx = new Int32Array(bins);
  const frac = new Float64Array(bins);
  const last = freqs.length - 1;
  for (let k = 0; k < bins; k++) {
    const f = (k * fs) / n;
    if (f <= freqs[0]) {
      idx[k] = 0;
      frac[k] = 0;
      continue;
    }
    const x = Math.log2(f / GRID_FMIN) * GRID_PER_OCTAVE;
    const i = Math.min(Math.floor(x), last - 1);
    idx[k] = i;
    frac[k] = Math.min(1, x - i);
  }
  return { idx, frac };
}

export const WEDGE_DESCRIPTION =
  'UTD rigid wedge (Kouyoumjian-Pathak) with Fresnel transition function; complex, causal; smooth through the shadow boundary; facade scattering and ground effects at edges are not modelled';

/** Written into exports and the Info panel. */
export const diffractionConstants = () => ({
  model: 'wedge',
  method: 'uniform theory of diffraction, rigid (hard) wedge, spherical incidence, Fresnel transition function',
  wedge: 'rectangular building edges: exterior angle 3 pi / 2 (n = 3/2); 4 vertical corners and 4 roof edges per building',
  orders: 'order 1: one edge; order 2: edge to edge (different buildings), reflection then diffraction, diffraction then reflection',
  double_diffraction: 'product of the two coefficients with parallel-edge spreading 1/sqrt(s0 s1 s2 (s0+s1+s2)); slope and vertex terms omitted',
  roof_reflection: 'roofs do not reflect, so the roof face reflection coefficient is 0 in the wedge coefficient',
  not_modelled: ['facade scattering', 'ground effects at edges', 'slope diffraction', 'corner (vertex) diffraction'],
  placeholder: true,
  note: 'design tool, not validated against measurements; see docs/diffraction-validation.md',
  references: DIFFRACTION_REFERENCES
});
