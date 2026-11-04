# Real-recording tools (synthetic round-trip checked only)

No real recording has been used to validate this localiser. The existing
measured pipeline is horizontal, uses legacy two-node association and has
uncalibrated confidence. Importing a real WAV does not change those limitations.

```sh
node scripts/recording.mjs ingest --wav capture.wav --geometry nodes.json --out inference.json
node scripts/recording.mjs score --inference inference.json --truth track.csv --out score.json
node scripts/recording.mjs calibrate --wav calibration.wav --geometry nodes.json --spec calibration.json --out fit.json
```

The Testing tab's **Real recording** section accepts the same WAV and geometry
and runs inference in a worker. It downloads inference, not an invented truth
score. This is separate from simulator scene generation and never uses source
positions or rendered path diagnostics. CLI input files are SHA-256 identified.

## Geometry

Coordinates are world-space metres, X east, Y north, Z up. Microphone positions
are **not local offsets**. Channel indexes are zero-based in the interleaved WAV,
unique across nodes; node and microphone order are explicit. Sample rate must
match; channels are not downmixed or resampled.

```json
{
  "sample_rate": 48000,
  "start_time_utc": "2026-11-04T10:00:00Z",
  "origin": { "latitude_deg": 51.5, "longitude_deg": -0.1, "altitude_m": 0 },
  "truth_altitude_unit": "m",
  "settings": { "temperature_c": 15, "localisation_band_hz": [200, 1600] },
  "nodes": [{
    "id": "n1",
    "position": [0, 0, 1.5],
    "channels": [0, 1, 2, 3],
    "mic_positions": [[-0.05, -0.05, 1.5], [0.05, -0.05, 1.5], [0.05, 0.05, 1.5], [-0.05, 0.05, 1.5]]
  }]
}
```

Add a second or third node and its distinct channels to obtain a position fix;
one node can only provide tracks/bearings. PCM16/24/32 and float32 little-endian
RIFF WAV (including extensible PCM/float subtypes) are supported.
RF64/compressed WAV and long-recording streaming are not.
Process short externally synchronised clips rather than loading hours of audio.
Unrecognised formats, invalid geometry, truncation and nonfinite samples fail
explicitly. Sample-rate/temperature/band/gates are not fitted automatically.

## External truth

Local CSV: `t_s,x_m,y_m,z_m` (`time_s` is also accepted; omitted z is zero for
horizontal scoring). Absolute GPS CSV: `timestamp,latitude,longitude,altitude`.
Flightradar-style `Timestamp,UTC,Callsign,Position,Altitude` is supported with
quoted `"latitude,longitude"` positions; Unix timestamp seconds or ISO UTC
requires the independent audio `start_time_utc`. Geodetic truth requires explicit
altitude units (`m` or `ft`) and surveyed origin. WGS84 ECEF-to-ENU conversion
does not resolve pressure-altitude vs geometric-altitude datum errors.

Select one external truth source first; duplicate times (such as several
aircraft) fail. Truth is interpolated at inferred emission time, never used to
choose a fix. No extrapolation or interpolation across gaps greater than the
5-second placeholder is permitted. Missing truth gives `null`, not zero error.
Only horizontal final-fix error is scored; no real-data 3D accuracy is claimed.
The CLI score output keeps both truth and inference hashes.

## Calibration helper

Supply disjoint quiet and calibration-source intervals within the same recording
and a surveyed source position:

```json
{
  "quiet_s": [0, 1],
  "signal_s": [2, 6],
  "source_position": [0, 20, 1.5]
}
```

Noise is RMS dBFS by channel. Add a **measured** `pa_per_fullscale` to the geometry
to obtain noise dB SPL; without it SPL remains null. Signal excess power, corrected
for surveyed inverse-distance loss, fits relative scalar gains. Fit assumes
stationary common excitation, free-field spreading and stable electronics;
reflections/directivity bias it. Scalar gain cancels in ideal PHAT and is not a
microphone frequency/phase calibration.

Heading offset is circular median measured-minus-surveyed bearing during the
signal interval; apply its negative as the correction. If there are no accepted
windows the heading is explicitly unavailable. Verify fitted gains/headings on
independent sessions. These helpers do not change scenario settings silently.
