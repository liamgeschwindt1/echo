# Mic array library

Project Echo / Estate Acoustics. Draft, 2 Nov 2026.

One place for every microphone array the simulator can use. Each entry gives the exact mic coordinates, derived figures and where it came from, so the array model can load a layout by ID instead of having it hard-coded.

## Conventions

- Units: mm. Origin: array centre (ball centre for the node). z up.
- Azimuth: degrees anticlockwise from +x, seen from above. Latitude: degrees above the horizontal plane.
- Coordinates are the port mouth on the outer surface, as on the design sheet.
- "Geometry-only error" is the 1-sigma bearing error from one-sample timing noise (10.4 µs, one sample at 96 kHz), using the method in `designs/node_geometry_designs.py`. It ignores reflections, shell diffraction, mic mismatch and clock drift.
- Aliasing limit = c / (2 × nearest spacing), c = 343 m/s. It limits phase methods only; timing methods do not have it.

## Summary

| ID | Name | Mics | Nearest / longest spacing | Vertical baseline | Aliasing limit | Status |
|---|---|---|---|---|---|---|
| `flat4_100` | Flat 4-mic square, 100 mm | 4 | 100.0 / 141.4 mm | 0 mm | 1.72 kHz | Current simulator array. Layout assumed, confirm |
| `ball12_d180` | 12-mic icosahedral ball, Ø180 | 12 | 94.6 / 180.0 mm | 143.0 mm | 1.81 kHz | Baseline node, draft rev A (30 Oct 2026) |

---

## `flat4_100`: flat 4-mic array

**Status:** the array the simulator uses today.

**Needs confirming.** The project notes only describe it as "flat 4-mic, 10 cm". This entry assumes a square, 100 mm on a side, all mics at z = 0. If the simulator uses a different layout (for example a 100 mm cross or a 100 mm circle), replace the table below with the real coordinates from the simulator code.

**Known behaviour in the simulator (unvalidated):** gave biased, steep elevations and positions below ground.

| Mic | Latitude ° | Azimuth ° | r from axis | x | y | z |
|---|---|---|---|---|---|---|
| M1 | 0 | 45 | 70.7 | +50.0 | +50.0 | 0.0 |
| M2 | 0 | 135 | 70.7 | −50.0 | +50.0 | 0.0 |
| M3 | 0 | 225 | 70.7 | −50.0 | −50.0 | 0.0 |
| M4 | 0 | 315 | 70.7 | +50.0 | −50.0 | 0.0 |

**Derived**

- Spacings: 100.0 (4 pairs), 141.4 (2 pairs). Vertical baseline 0.
- Aliasing limit about 1.72 kHz.
- Geometry-only error: azimuth about 2.0°. Elevation is not observable at the horizon (no vertical baseline), and is poor above it: about 6.0° at 20°, 3.2° at 40°, 2.4° at 60°.
- Because elevation is only constrained for sources well above the plane, and the sign is ambiguous (above vs below), a flat array cannot tell up from down. This matches the steep elevations and below-ground positions seen so far.

---

## `ball12_d180`: 12-mic icosahedral ball, Ø180

**Source:** `node_design_sheet_d180.pdf`, rev A, 30 Oct 2026 (draft, untested). Hanging sealed Ø180 ball, face-up icosahedral array, PoE over one Ethernet cable. Decided as the baseline node on 28 Oct 2026.

**Layers:** A latitude +52.6°, B +10.8°, C −10.8°, D −52.6°. Azimuths: A and C at 0, 120, 240; B and D at 60, 180, 300. So there are 6 distinct azimuths, each used by two mics at different heights, and neighbouring layers are offset by 60°.

| Mic | Layer | Latitude ° | Azimuth ° | r from axis | x | y | z |
|---|---|---|---|---|---|---|---|
| A1 | A | +52.6 | 0 | 54.6 | +54.6 | 0.0 | +71.5 |
| A2 | A | +52.6 | 120 | 54.6 | −27.3 | +47.3 | +71.5 |
| A3 | A | +52.6 | 240 | 54.6 | −27.3 | −47.3 | +71.5 |
| B1 | B | +10.8 | 60 | 88.4 | +44.2 | +76.6 | +16.9 |
| B2 | B | +10.8 | 180 | 88.4 | −88.4 | 0.0 | +16.9 |
| B3 | B | +10.8 | 300 | 88.4 | +44.2 | −76.6 | +16.9 |
| C1 | C | −10.8 | 0 | 88.4 | +88.4 | 0.0 | −16.9 |
| C2 | C | −10.8 | 120 | 88.4 | −44.2 | +76.6 | −16.9 |
| C3 | C | −10.8 | 240 | 88.4 | −44.2 | −76.6 | −16.9 |
| D1 | D | −52.6 | 60 | 54.6 | +27.3 | +47.3 | −71.5 |
| D2 | D | −52.6 | 180 | 54.6 | −54.6 | 0.0 | −71.5 |
| D3 | D | −52.6 | 300 | 54.6 | +27.3 | −47.3 | −71.5 |

Exact generation: sphere radius 90, layer heights z = ±0.7946545 R (A, D) and ±0.1875925 R (B, C), r = √(R² − z²).

**Derived (match the design sheet)**

- Spacings: 94.6 (30 pairs), 153.1 (30 pairs), 180.0 (6 pairs).
- Vertical baseline 143.0. Aliasing limit about 1.81 kHz.
- Geometry-only error: about 1.14° in azimuth and 1.14° in elevation, the same in every direction (the layout is isotropic for bearing).
- Mic port: Ø8, ePTFE membrane, shell wall 5. Mic boards held by a rigid frame to ±0.3. Sampling 96 kHz, 24-bit, one clock across all 12 channels.
- Port ellipses and mic labels in the sheet are drawn for the front elevation only; they are not extra mics.

**Open items from the sheet (unsettled before a build)**

1. Ball diameter: sweep Ø240, Ø200, Ø180, Ø150, on tonal and impulsive sources separately.
2. Shape: compare against a downward-facing dome and a squat two-ring puck, same mic count.
3. Mic count: test 4-, 6-, 8- and 12-mic subsets on raw 12-channel recordings.
4. Shell: diffraction around the ball is not yet modelled; the simulator should treat mics as free-field points until it is.

---

## Machine-readable layouts

Drop-in data for the array model. Mic IDs are stable and match the tables above.

```json
{
  "flat4_100": {
    "name": "Flat 4-mic square, 100 mm",
    "units": "mm",
    "assumed": true,
    "mics": {
      "M1": [50.0, 50.0, 0.0],
      "M2": [-50.0, 50.0, 0.0],
      "M3": [-50.0, -50.0, 0.0],
      "M4": [50.0, -50.0, 0.0]
    }
  },
  "ball12_d180": {
    "name": "12-mic icosahedral ball, D180",
    "units": "mm",
    "assumed": false,
    "mics": {
      "A1": [54.6, 0.0, 71.5],
      "A2": [-27.3, 47.3, 71.5],
      "A3": [-27.3, -47.3, 71.5],
      "B1": [44.2, 76.6, 16.9],
      "B2": [-88.4, 0.0, 16.9],
      "B3": [44.2, -76.6, 16.9],
      "C1": [88.4, 0.0, -16.9],
      "C2": [-44.2, 76.6, -16.9],
      "C3": [-44.2, -76.6, -16.9],
      "D1": [27.3, 47.3, -71.5],
      "D2": [-54.6, 0.0, -71.5],
      "D3": [27.3, -47.3, -71.5]
    }
  }
}
```

## Adding an array

Each new entry needs: an ID, source (design sheet or simulator file), status, a full coordinate table in the conventions above, the derived figures (spacings, vertical baseline, aliasing limit, geometry-only error), and a note on how it behaved in the simulator. Candidates already designed in `designs/node_geometry_designs.py` but not yet entered here: the Ø230 dome (6 + 6 mics) and the Ø210 squat puck (3 rings of 4). Subsets of `ball12_d180` (4, 6, 8 mics) are the next useful entries, since open item 3 asks for exactly that test.