# T2 rotor source model (opt-in)

Renderer hook: `packages/sim-core/src/ext/multisource/rotor-model.js`

Opt-in gate:

- `scenario.settings.ms_rotor_model_enabled === true`
- source carries `source.rotor_model` object

If enabled, render input clip is replaced by deterministic synthetic rotor waveform with placeholder parameters:

- `blades` (default 2)
- `rpm` (default 3600)
- `harmonics` (default 8)
- `am_depth` (default 0.2)
- `jitter_pct` (default 0.03)
- `duration_s` (default source clip duration)
- `seed` (default 1)

Blade-pass frequency is `blades * rpm / 60`, harmonics added with `1/h` decay and slow AM at 0.7 Hz. Default OFF preserves existing renders and goldens.
