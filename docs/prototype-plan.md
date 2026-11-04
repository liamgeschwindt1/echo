# Prototype measurement plan (not completed measurements)

**Decision now: no robust hardware winner.** Round-one endpoint sweeps changed
conditional array leaders with heading, microphone position, ambient noise,
ground reflectivity, noise correlation and source level. Scalar gain and
self-noise did not flip those small-population point leaders; that is not proof
of robustness. Timing and wind have not been ranked. All values below are
proposed sample sizes, not observations or derived hardware specifications.

## Minimum affordable rig

Three identical four-channel nodes with raw, uncompressed simultaneous ADC
channels; a shared recorder/clock where possible; surveyed tripods; a tape/laser
rangefinder; printed azimuth board; a reference sound-level meter borrowed or
rented with a 94 dB calibrator; one repeatable loudspeaker; a phone for notes,
weather and video. Record 48 kHz PCM24 or float32, disable AGC, denoising,
beamforming and compression. Record channel order, gain, clipping count,
firmware, clock identity, UTC start, node XYZ, nominal mic offsets and heading.
Do not treat independently started consumer recorders as synchronised.

## Placeholder measurements and imports

| Placeholder / why | Cheap method | Minimum planned samples | Import / calibration and acceptance |
|---|---|---|---|
| Heading; observed ranking flips | Survey a stationary speaker at 8 bearings with tape/azimuth board; repeat after remounting. Compare measured minus surveyed bearing, not phone compass alone. | 8 bearings x 3 mounts x 3 nodes; 10 s each; repeat another day | Geometry JSON stores nominal heading. Fit circular offset per node using known speaker coordinates; keep test bearings separate. Import residual RMS as heading sigma, not the fitted offset. Report magnetic bias separately. |
| Mic position; observed flips | Caliper each centre relative to a rigid reference frame; photograph labels. Survey frame orientation separately. | Every mic, 10 independent reseatings, two operators | Import `mic_offsets_m`/world mic positions in metres; RMS residual is position sigma. Preserve correlations (rigid rotation is heading, not independent mic displacement). |
| Ambient floor; observed flips | Calibrated quiet/site recordings, source absent; reference meter alongside node. Record actual A/Z weighting and spectrum. | Three sites x dawn/day/evening x three 5 min recordings | Convert PCM RMS to Pa using sensitivity/recorder gain or calibrator. Fit band PSD and level quantiles; do not identify dBFS with dB SPL. Import band-specific floor; retain time series for future coloured-noise fitting. |
| Ground reflectivity; observed flips | Same speaker at two heights, hard paving/grass; close reference mic and near/far node; direct/reflected impulse window. | 2 surfaces x 3 ranges (5/15/30 m) x 2 heights x 10 pulses | Estimate complex reflection by frequency with spreading/delay correction. Fit scalar only over the localisation band, export residual error and surface. The scalar is an approximation, not universal concrete truth. |
| Noise correlation; observed flips | Source-off multichannel recordings, same gain and no processing; estimate cross PSD/coherence, exclude coherent target events. | 10 x 60 s per site/weather condition, all channels simultaneously | Import correlation by band and node; phase and common-mode components retained. A single broadband scalar cannot represent directional urban noise. Fit on half, check held recordings. |
| Source level/directivity; observed flips | Reference meter/mic at 1 m or documented safe distance; measure around speaker/representative source without clipping. Do not approach live aircraft or unsafe vehicles. | 8 azimuths x 3 elevations x 5 repetitions per source surrogate, plus 3 distances | Convert calibrated Pa RMS/peak to the exact source-level convention; normalise clips separately from recorded loudness. Import per-label distributions, not one assumed level. Real drone/aircraft measurements require safe permission. |
| Mic self-noise; no flip demonstrated | Quiet enclosure plus electrically terminated/reference channel; document acoustic isolation and preamp noise. | 10 x 60 s per node and gain | Separate ADC/preamp from acoustic noise; fit PSD, not only total RMS. Record upper bounds if the room dominates. |
| Gain/frequency/phase mismatch; scalar gain cancels PHAT | Put mics close together with a swept sine/noise speaker; rotate positions to average field gradients. | 3 placements x 5 sweeps, every channel; 2 gains | Fit relative complex transfer functions vs frequency; reserve sweeps for residual checks. Scalar gain estimates calibrate levels, **not** PHAT delay robustness. Do not use gain-only sweeps as phase validation. |
| Inter-node timing and drift; placeholder resampling model | Feed the same electrical pulse to all ADCs, or a surveyed acoustic pulse with propagation removed; run for 30 min. | 3 cold starts x pulses every 10 s x 3 nodes, at 2 temperatures | Fit offset in ms and drift in ppm with residuals/dropouts. Store clock groups and UTC mapping; map residual distributions to `clock_offset_sigma_ms`/`clock_drift_sigma_ppm`. Enable inter-node TDOA only after independent synchronisation verification; that constraint is not implemented. Bearing-only still requires track-time alignment. |
| Wind/rain; placeholder coloured-noise models | Same source-off setup with/without foam windshield, cheap anemometer and weather log; protect electronics. | 3 wind bands x 3 directions x 5 one-minute recordings; 5 rain recordings if safe | Fit PSD, time variation and inter-mic cross PSD vs speed/direction. Map measured RMS to rain/urban SPL, shared-band coherence to wind correlation and temporal envelope to `noise_variation_db`; replace the assumed wind-speed law only from fit data. Keep rain/wind separate. No numeric requirement or ranking-flip claim before fitting/validation. |
| Housing scattering; unbuilt sphere/dome/puck models | Rotate array at fixed speaker radius in an open space; sweep frequency; compare with bare mic/reference and analytic sphere where applicable. | 24 azimuths x 3 elevations x 3 repeats per housing | Export complex response, compare phase/amplitude against analytic/approximate models with frequency-resolved error. Dome/puck are not rigid spheres. |

Use paired before/after recordings with fixed geometry, waveform, clock and
gain. Bootstrap independent sessions/sites, not overlapping FFT windows. Keep
raw WAV immutable with SHA-256; calibration JSON records fit population and
held-session error. Do not fit and grade on the same recordings.

## Three-node aircraft recording with external truth

1. Obtain site/recording permission; remain on public/permitted ground, away from
   runway restrictions. Do not fly, illuminate or interfere with an aircraft.
   Avoid speech collection; follow applicable privacy and retention rules.
2. Survey three noncollinear nodes over a 30–80 m triangle with unobstructed sky.
   Record XYZ and uncertainty, mic order/headings, UTC and clock provenance.
   Use verified shared time or record sync pulses before/after; do not assume GPS
   time in a CSV synchronises an audio recorder.
3. Record 10 separately identified overflights on at least two days, aiming for
   varied elevation/azimuth and 30 s before/after each. Log weather, competing
   aircraft/traffic, gain and clipping. A distant aircraft is outside the 50 m
   provisional design target; report range explicitly.
4. Obtain an authorised Flightradar/ADS-B export (or own permitted receiver),
   preserving its timestamp/altitude/reference convention and licence. Never
   scrape restricted data or call simulator truth a real reference. Document
   ADS-B latency, interpolation gaps, pressure vs geometric altitude, ground
   station origin and uncertainty. One-second position reports are not exact
   acoustic emission-time truth.
5. Convert lat/lon into local ENU using the surveyed origin; resolve altitude
   datum. Score at **emission time**, accounting for sound travel time using
   measured temperature. Align time only with independent sync/calibration, not
   by minimising localisation error on the graded tracks.
6. First three overflights are calibration, next three development, last four
   sealed real evaluation; freeze all settings before the last four. Report
   misses, wrong/unflagged fixes, coverage, bearing error and 90% radius coverage.
   The current horizontal measured pipeline cannot validate 3D aircraft
   localisation; score bearings/horizontal projections with that limitation.

## One-node phone/microphone site-noise protocol

Record a stationary phone plus node/reference mic at ear height at three safe,
documented points for 5 min each, at dawn/day/evening on two days (18 sessions).
Use WAV/manual fixed gain if the device allows; otherwise mark AGC/compression
unknown and do not infer absolute SPL. Speak no identifiers into the recording.
Note traffic, venue/HVAC activity, wind/rain and shielding without guessing
percentage contributions. Use a meter/calibrator to establish Pa/full-scale;
otherwise report dBFS and within-device temporal differences only. Export
unweighted and localisation-band PSD, RMS quantiles, clipping and correlated
noise. Separate calibration sessions from repeat-session checks.

These recordings can calibrate ambient noise and level response, not prove a
localiser or “road 60%, bar 25%” attribution. Absolute contribution requires
independently labelled source on/off or controlled level measurements; a phone
recording alone does not provide that truth.
