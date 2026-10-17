// Units: metres, seconds, Pascals. dB SPL only at the edges.
export const P_REF_PA = 20e-6;

// Assumed MEMS spec; editable via settings.spl_ref_db / dbfs_ref_db.
export const SPL_REF_DB = 94;
export const DBFS_REF_DB = -26;

export const speedOfSound = (tempC) => 331.3 + 0.606 * tempC;

export const dbToPa = (db) => P_REF_PA * 10 ** (db / 20);
export const paToDb = (pa) => 20 * Math.log10(Math.max(pa, 1e-12) / P_REF_PA);

// Pascals to digital float: 94 dB SPL (1 Pa rms) maps to -26 dBFS.
export function digitalPerPa(splRef = SPL_REF_DB, dbfsRef = DBFS_REF_DB) {
  return 10 ** (dbfsRef / 20) / dbToPa(splRef);
}

// ISO 9613-1 pure-tone absorption in dB/m. pressureKpa defaults to 101.325.
export function airAbsorptionDbPerM(f, tempC, humidityPct, pressureKpa = 101.325) {
  const T = tempC + 273.15;
  const T0 = 293.15;
  const T01 = 273.16;
  const pr = 101.325;
  const pRel = pressureKpa / pr;
  const psatRel = 10 ** (-6.8346 * (T01 / T) ** 1.261 + 4.6151);
  const h = humidityPct * (psatRel / pRel);
  const frO = pRel * (24 + (4.04e4 * h * (0.02 + h)) / (0.391 + h));
  const frN = pRel * (T / T0) ** -0.5 * (9 + 280 * h * Math.exp(-4.17 * ((T / T0) ** (-1 / 3) - 1)));
  const f2 = f * f;
  return (
    8.686 *
    f2 *
    (1.84e-11 * (1 / pRel) * (T / T0) ** 0.5 +
      (T / T0) ** -2.5 * (0.01275 * Math.exp(-2239.1 / T) / (frO + f2 / frO) + 0.1068 * Math.exp(-3352 / T) / (frN + f2 / frN)))
  );
}

export const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
