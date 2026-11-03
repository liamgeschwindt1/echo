# Prompt for codebot: echo-sim localisation upgrade (schema 0.3 -> 0.4)

## Context

You are upgrading **echo-sim**, the 3D acoustic simulator for Project Echo (nodes-only acoustic localisation of sound events). Read these project docs first, they define the design and you must not contradict them:

- `sound-disaggregation-model.md` (pipeline: localise -> beamform -> tag -> attribute)
- `event_labelling_upgrade.md` (section 4 overlap rules, section 7 simulator scope)
- `claude/11-localisation-methods.md`
- `claude/14-mic-array-library.md` and `mic_array_library.md`

**Scope rules (hard constraints)**

1. **Decision change (supersedes `event_labelling_upgrade.md` section 7):** the simulator now runs the SAME models and label logic as the echo app (YAMNet + CLAP, catalogue v2.3) to produce labels. Reuse the app's code, checkpoints, text embeddings and config. Do not reimplement or retrain. See package P9.
2. Pipeline order stays: localise first, then beamform, then tag. Do not make localisation depend on a classifier. Labels are produced after localisation and must not change bearings or fixes.
3. Raw audio and audio-derived data (including embeddings) never leave a node in the real system. In the sim, embeddings stay in-process and are never written to exports. Node output in exports is limited to bearings, levels, times, uncertainties, labels, scores and confidences.
4. Physical constants that are not measured stay marked `placeholder: true` in the export. Do not present sim results as validated.
5. Do not change the physics (diffraction, reflection, air absorption) in this task. Estimator, fix solver, flags and exports only.

**Before changing anything:** read the code and report, in one short message, which of the findings below are confirmed by the code, which are not, and anything that contradicts them. The findings come from reading exported JSON only, not the source. Treat each as a hypothesis to verify. Then proceed in the order given.

## Evidence base (from 6 exported runs, 2 to 5 nodes, 1 to 7 sources)

Key observations to reproduce before fixing:

- **Long windows pull bearings toward reflections.** n9 azimuth error grew from 1.6 deg to 5-7 deg as the progressive window stretched to ~3 s.
- **Nodes ~3 m from a wall** (n18 to b17:east, n20 to b14:west, n1 to b6:north, n7 to b4:south, n3 to b4:north) get large errors; the reflection is ~14 ms late and only 0.5-1 dB down. Examples: n18 77 deg, n20 up to 63 deg mid-window.
- **Window selected on silence.** s10 localised on a 6.51-6.55 s window with in-window SNR of -60 to -19 dB, still `reliable: true`, `uncertainty_deg: 90`.
- **Overlap gate discards good bearings.** `unresolved_overlap` forces `reliable: false` even when the bearing is good (s1 at n7: 0.65 deg; s1 at n2: 1.4 deg; s12 at n3: 1.7 deg).
- **Whole-window locking on the nearest source** when sources are continuous (s9 at n1 ended 177 deg off after being within 2-7 deg for the first ~2 s).
- **Picked-path matcher too loose.** n18 matched a -50 dB path at +54 deg elevation; n19 matched a -49 dB path.
- **Reported uncertainty ignores multipath bias** (0.05 deg quoted vs 4-5 deg real; but it does rise under inter-source contamination).
- **Flat-array elevation** was -17 deg (sign assumed) vs true -2 deg in older runs; latest run reports 0 with `elevation_confidence: low`. Fix z then sits far from truth (underground fixes of -10 to -30 m).
- **fix_suspect and poorly_conditioned miss obvious failures** (fix 10-30 m underground; range pair 19 m vs 211 m; conditioning computed from 3D angle that elevation error inflates).
- **Bad nodes not rejected.** `uncertainty_valid: false` and `fix_suspect: true` have no effect on the fix. A 5-node run gave 21 m error; dropping two bad nodes by hand gave ~2 m.
- **`heard_nodes` is 0 while four nodes have `heard: true`** (it seems to count only reliable nodes).
- **Moving sources:** only 3 track fixes for s8; nodes used different windows (n1 0.09-0.44 s, n3 0.01-0.58 s, n2 0.2-0.65 s) so rays come from different times.
- **Blocked nodes** localise on diffracted edges (picked-path error 0.2-4.9 deg) but the backtrace returns zero candidates because it only unfolds reflections.
- **In-band SNR is far below broadband SNR** (s9 at n2: 4 dB vs 27 dB), so nodes are marked "not heard" while broadband energy is clearly present.

## Work packages (do in this order; one commit per package; keep existing outputs backward-compatible or bump schema to 0.4 with a changelog)

### P1. Window SNR gating and source-window containment (bug fix)

- Compute SNR on the window actually used for the bearing, and expose it as `window_snr_db`. Keep the existing `snr_db` as is.
- Require the localisation window to lie within the source's own emission interval plus the propagation delay to that node.
- If in-window SNR is below `min_snr_db`, set `localisation_status: "no_signal"` and `reliable: false`, and do not report a bearing as usable.
- **Acceptance:** s10 at n1/n2/n3 no longer produces `reliable: true` from a silent window. Add a regression test.

### P2. Consistency-based adaptive window selection

- Replace "full active window" with selection of the progressive step that maximises cross-mic consistency (e.g. lowest residual, or stable bearing across successive sub-windows). Stop growing the window when the bearing drifts or uncertainty rises.
- Choose the gating style from the trigger type, not from a classifier:
  - **Impulsive** (fast rise over the rolling floor): short onset-gated window (start 10-40 ms, configurable), stop before the first strong reflection delay where possible.
  - **Sustained or tonal:** do not rely on time gating (a steady tone has constant coherent interference). Use longer windows and, if implemented, harmonic-bin selection.
- Expose `window_policy` ("onset_gated" | "adaptive_long" | "fixed") in the export.
- **Acceptance:** report per-node azimuth error before/after on all six existing scenarios. s1 at n3 and n7, s9 at n1 and s13 at n2 should improve; report any that get worse.

### P3. Replace hard overlap exclusion with weighted, robust inclusion

- Keep the `overlapped` flag (per `event_labelling_upgrade.md` section 4) but stop using it to hard-exclude nodes from the fix.
- Weight each node by realistic error: combine in-window SNR, `level_diff_db`, direct-to-reflected ratio, delay spread, and the distance of the node to the nearest large reflector.
- Fix by robust estimation (e.g. weighted least squares with RANSAC or leave-one-out residual rejection), using the horizontal rays first.
- Report `fix.method`, `fix.inlier_nodes`, `fix.rejected_nodes` and a reason per rejected node.
- **Acceptance:** s12 (nodes n2+n3) and s11 (n1+n7) now produce fixes, with error reported against ground truth. The 5-node run (21 m) should drop to a few metres with bad nodes rejected. Do not tune on one scenario only; report all.

### P4. Fix solver sanity and flags

- Compute conditioning from the **horizontal** azimuth crossing angle; keep the 3D angle as a separate field.
- When `elevation_sign_assumed` is true or `elevation_confidence` is low, clamp z to the source's known or assumed height (ground-event prior, default 1.5 m, configurable) and report that z was clamped.
- Mark `fix_suspect: true` for: z below ground, any range negative, range ratio above a configurable limit, large leave-one-out residual, fix outside the scene bounds.
- Make flags consistent: no `fix_suspect: true` for a 3 m error with `false` for 40 m errors. Add a unit test with synthetic cases.
- Fix `heard_nodes` to count nodes with `heard: true`; add `usable_nodes` for those that passed reliability.
- **Acceptance:** earlier underground fixes are either clamped or flagged. Report before/after.

### P5. Tighten picked-path matching and uncertainty

- Picked path must lie within a level window of the strongest path (default 15 dB, configurable) and consistent elevation (default within 10 deg); take the strongest match, not the first on azimuth alone.
- Uncertainty = noise-limited term (existing) combined in quadrature with a multipath floor scaled by direct-to-reflected ratio and delay spread. Keep both terms in the export (`uncertainty_noise_deg`, `uncertainty_multipath_deg`, `uncertainty_deg`).
- 100 ms track observations: reject observations that disagree with the long-window bearing by more than a configurable gate (default 3 sigma of the combined uncertainty), and log the rejection count.
- **Acceptance:** report calibration: fraction of nodes whose true error falls inside 1 and 2 reported sigma, before/after.

### P6. Common-time, motion-compensated fixes for moving sources

- Use a common time window across nodes, shifted per node by propagation delay to the current estimate (iterate once or twice).
- Produce a track of fixes over time for moving sources (smoothing or a simple constant-velocity filter), and report fix time, not just window end.
- **Acceptance:** s8 gets more than 3 track fixes, with position error reported against the moving ground truth at each fix time.

### P7. Diffraction-aware backtrace (larger; do after P1-P6 are merged)

- Add edge-as-virtual-source hypotheses to the backtrace so nodes blocked from the source (direct path blocked, picked path is diffracted) can contribute candidates.
- Keep reflection unfolding as is. Report which hypothesis type (direct, reflection, edge) each candidate uses.
- **Acceptance:** s9 (n2, n3) and s11 (n2, n3) and s13 (n7) produce candidates; report whether the true source ranks in the top 3.

### P8. Detection gate split (small)

- Separate "detected" (broadband SNR) from "localisable" (in-band SNR). Export both. A node can be detected without being localisable; do not call that "not heard".
- Keep the 200-1600 Hz localisation band default; add a per-run setting to try a wider band, with a note about spatial aliasing at 9-10 cm spacing (about 1.7-1.9 kHz).

### P9. Labelling in the simulator using the echo app's model stack (after P1-P3)

Goal: for each localised event, produce labels with the same models and rules the echo app uses, so the sim can score labelling and localisation together.

Reuse, do not rebuild. First locate the echo app's shared labelling code and config and report where it lives (YAMNet mapping, CLAP checkpoint and logit scale, `clap-embed.mjs` text-embedding generation, `priorities.json`, group pooling, decoy floor, target-share rule, YAMNet corroboration). If it cannot be imported as a module, ask before copying it. Keep one source of truth so the sim and the app cannot drift.

Pipeline per node, following `sound-disaggregation-model.md`:
1. **Stage 1 trigger** (as in `event_labelling_upgrade.md` section 2): level over a rolling noise floor, plus the YAMNet watchlist (Screaming >= 0.2, Glass/Shatter/Breaking >= 0.4, Gunshot/gunfire >= 0.2). The trigger type also feeds the P2 window policy.
2. **Direction focus:** delay-and-sum beamform the node's mic array toward the P2/P3 bearing for that event. Also keep the omni (single reference mic) signal.
3. **Stage 2:** run CLAP once per triggered event on a window with pre-roll taken from the rendered node audio, evaluated on the peak reading, with the 5 s window / 1.25 s hop and 10 s ambient mode as already configured in the app. Apply group pooling, decoy floor, target share and YAMNet corroboration exactly as the app does.
4. **Multi-label output** (route 1 in section 4 of the labelling doc): export per-label cosine scores against their own thresholds as well as the winner, so overlapped sources can carry several labels.

Audio handling:
- Resample the rendered 48 kHz node audio to what each model expects (YAMNet 16 kHz mono; confirm the CLAP checkpoint's rate and window from the app config, do not assume).
- Run both the omni signal and the beamformed signal through the same stack, and export both results so the beamforming benefit can be measured.
- Use the full band for classification, not the 200-1600 Hz localisation band. Log which band was used.

Ground truth and scoring:
- Map each simulated source's clip name to a catalogue label and group in a manifest file (editable, not hard-coded). Export `true_label`, `true_group` per source.
- Associate detections to sources by onset time consistent with the propagation delay from the true position, and report the association rule used.
- Per event export: `label`, `group`, `confidence`, `target_share`, `group_shares`, `yamnet_corroboration`, `rule_flags`, `input` ("omni" | "beamformed"), `true_label`, `correct` (top-1), `correct_top3`.
- Summary metrics per group and per input type: alert recall, top-1 and top-3 accuracy, time to first detection, false alerts per scenario. Break each down by number of overlapping sources and by node SNR.

Cross-node and same-class sources:
- Associate detections across nodes by label plus onset time consistent with propagation delay to the candidate position.
- Same-class sources (the scenario has three engines and three horns) cannot be separated by label. Do not invent separation; report them as same-class and use bearing and track continuity for association. Flag cases where this fails.
- Per the labelling doc, overlapped windows report the dominant label and set the overlapped flag. Also export the multi-label scores.

Engineering:
- Behind a setting `labelling_enabled` (default off) so localisation-only runs stay fast.
- Models load once and are cached; document the download size and offline behaviour. Run inference outside the render loop, and keep results deterministic for a given seed (record model versions and the CLAP logit scale in the export).
- Export labels only. No audio, spectrograms or embeddings in the export.

Acceptance:
- On the existing six scenarios, report labelling metrics for omni vs beamformed input, and say plainly where labelling fails (overlap, low SNR, blocked nodes, near-wall nodes).
- Include a mode where true labels are substituted for model output (oracle labels), so a failure can be attributed to the classifier or to the localiser.
- Confirm the sim reproduces the app's result on a clean single-source clip played through a short, high-SNR path, as a sanity check that the stack is wired the same way. If it does not, stop and report.

Caveat to put in the export notes: sim audio is synthetic (clip plus modelled propagation and air absorption, with no wind, rain, housing scattering or coloured noise). Classifier accuracy measured here is not a prediction of real-world accuracy.

## Experiments to add as scripts (not part of the core build)

1. **Overlap sweep:** vary the time gap and level difference between two sources (per `event_labelling_upgrade.md` section 8), plot direction error.
2. **Node placement sweep:** distance of node to nearest reflector (0.5 m to 15 m) vs azimuth error, to find a minimum standoff rule. Treat any rule as a hypothesis until it is stable across scenes.
3. **Array control:** add a 12-mic planar array to compare against the ball array and the 4-mic flat square, so mic count and aperture are separated from shape.
4. **Range vs crossing angle:** hold one fixed while varying the other, to separate their effects on fix error.
5. **Realism toggles (off by default):** turn on `heading_error_sigma_deg`, `mic_gain_sigma_db`, `mic_position_sigma_mm`, `noise_correlation`, and re-run the main scenarios to show how much of the result survives node errors.

## Output and reporting requirements

- Add to the export: `window_snr_db`, `window_policy`, `usable_nodes`, `fix.method`, `fix.inlier_nodes`, `fix.rejected_nodes` (with reasons), `fix.z_clamped`, split uncertainty terms, per-node `weight`, `track.rejected_count`.
- Bump `schema` to `0.4` and keep a changelog of renamed or added fields.
- After each package, produce a table over all scenarios: horizontal and 3D error, per-node azimuth error, number of usable nodes, flags raised. Say plainly where results got worse.
- Add a regression suite using the six existing exports as fixtures (they are in the project; ask if you cannot find them).
- Do not tune thresholds against a single scenario. Put every threshold in settings with a documented default and mark it a placeholder.
- If a package would change the physics model or the node design, stop and ask.

## Do not do

- Do not create a second copy of the labelling logic, retrain or fine-tune models, or write embeddings, spectrograms or audio into exports.
- Do not claim accuracy for real deployments. These are sim results with unvalidated physics (no housing scattering, wind, rain, coloured noise or facade scattering; diffraction model unvalidated).
- Do not remove fields existing tools depend on without a deprecation note.