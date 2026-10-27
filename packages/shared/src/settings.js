// Section 4.2. Saved on the device and written into every export.
const KEY = 'echo-settings-v2.2';

export const DEFAULTS = Object.freeze({
  yamnet_enabled: true,
  clap_enabled: true,
  clap_window_s: 10,
  clap_hop_s: 2.5,
  yamnet_window_s: 0.975,
  yamnet_hop_s: 0.5,
  yamnet_min: 0.2,
  clap_min: 0.3,
  target_share_min: 0.25,
  target_share_corroboration_drop: 0.1,
  glass_max_alert_s: 6,
  glass_max_alert_impacts: 3,
  clap_logit_scale: 18.66,
  on_threshold_db: 8,
  off_threshold_db: 4,
  min_duration_s: 0.5,
  merge_gap_s: 1.5,
  impulse_rise_db: 12,
  sustained_min: 5,
  day_start: '07:00',
  evening_start: '19:00',
  night_start: '23:00',
  session_label: '',
  location_text: '',
  lat: null,
  lon: null,
  time_display: 'local',
  theme: 'system',
  graph_window_s: 60,
  graph_model: 'both',
  clap_y_axis: 'fixed'
});

// Field descriptors for the Settings screen, grouped as in section 4.2.
export const GROUPS = [
  {
    title: 'Models',
    fields: [
      { key: 'yamnet_enabled', type: 'bool', label: 'YAMNet', help: 'Fast general sound classifier (521 classes).' },
      { key: 'clap_enabled', type: 'bool', label: 'CLAP', help: 'Zero-shot model scored against our label prompts.' },
      { key: 'clap_window_s', type: 'select', label: 'CLAP window', options: [[10, '10 s'], [5, '5 s']], help: 'Audio per CLAP run. 5 s is tiled to fill the 10 s input and runs every 1.25 s; periods under 4 s use only 5 s readings.' },
      { key: 'clap_hop_s', type: 'number', label: 'CLAP hop (s)', min: 1, max: 10, step: 0.5, help: 'Time between CLAP runs (10 s window only; 5 s always uses 1.25 s). A run is skipped if the last is still going.' },
      { key: 'yamnet_window_s', type: 'number', label: 'YAMNet window (s)', min: 0.975, max: 0.975, step: 0.001, help: 'Fixed by the model.', readonly: true },
      { key: 'yamnet_hop_s', type: 'number', label: 'YAMNet hop (s)', min: 0.25, max: 2, step: 0.05, help: 'Time between YAMNet runs.' },
      { key: 'yamnet_min', type: 'number', label: 'YAMNet minimum', min: 0, max: 1, step: 0.05, help: 'Pooled family score needed to count as a YAMNet opinion.' },
      { key: 'clap_min', type: 'number', label: 'CLAP minimum', min: 0, max: 1, step: 0.05, help: 'Pooled family probability needed to count as a CLAP opinion.' },
      { key: 'clap_logit_scale', type: 'number', label: 'CLAP logit scale', min: 1, max: 200, step: 0.01, help: 'Multiplier on cosine before softmax. Higher gives more peaked scores. Tune on real clips.' },
      { key: 'target_share_min', type: 'number', label: 'Decoy target share', min: 0, max: 1, step: 0.05, help: 'When a decoy leads a group, the target members need at least this share of the group score to take the label and alert level.' },
      { key: 'target_share_corroboration_drop', type: 'number', label: 'YAMNet corroboration drop', min: 0, max: 1, step: 0.05, help: 'Subtracted from the target share threshold when YAMNet also hears the target (for example Screaming, Glass, Gunshot).' },
      { key: 'glass_max_alert_s', type: 'number', label: 'Glass alert max duration (s)', min: 1, max: 60, step: 0.5, help: 'A glass break lasting longer than this is capped at flag (likely a bottle bank).' },
      { key: 'glass_max_alert_impacts', type: 'number', label: 'Glass alert max impacts', min: 1, max: 20, step: 1, help: 'A glass break with this many separate impacts or more is capped at flag.' }
    ]
  },
  {
    title: 'Period detection',
    fields: [
      { key: 'on_threshold_db', type: 'number', label: 'On threshold (dB over floor)', min: 1, max: 40, step: 1, help: 'A period starts when the level stays this far above the noise floor.' },
      { key: 'off_threshold_db', type: 'number', label: 'Off threshold (dB over floor)', min: 0, max: 40, step: 1, help: 'A period ends when the level stays below this for 2 s.' },
      { key: 'min_duration_s', type: 'number', label: 'Minimum duration (s)', min: 0.1, max: 10, step: 0.1, help: 'Shorter non-impulse periods are dropped.' },
      { key: 'merge_gap_s', type: 'number', label: 'Merge gap (s)', min: 0, max: 10, step: 0.5, help: 'Periods closer than this are joined.' },
      { key: 'impulse_rise_db', type: 'number', label: 'Impulse rise (dB)', min: 3, max: 40, step: 1, help: 'Rise within 200 ms that marks an impulse (bang).' },
      { key: 'sustained_min', type: 'number', label: 'Sustained threshold (min)', min: 0.5, max: 60, step: 0.5, help: 'Time at 6 dB over the floor before a source is called sustained.' }
    ]
  },
  {
    title: 'Time of day (local)',
    fields: [
      { key: 'day_start', type: 'time', label: 'Day starts', help: '' },
      { key: 'evening_start', type: 'time', label: 'Evening starts', help: '' },
      { key: 'night_start', type: 'time', label: 'Night starts', help: 'Night runs until day starts.' }
    ]
  },
  {
    title: 'Session',
    fields: [
      { key: 'session_label', type: 'text', label: 'Session label', help: 'Optional.' },
      { key: 'location_text', type: 'text', label: 'Location', help: 'Optional free text.' },
      { key: 'lat', type: 'number', label: 'Latitude', min: -90, max: 90, step: 'any', nullable: true, help: 'Optional. Stored in the JSON only (for later flight matching).' },
      { key: 'lon', type: 'number', label: 'Longitude', min: -180, max: 180, step: 'any', nullable: true, help: '' }
    ]
  },
  {
    title: 'Display',
    fields: [
      { key: 'time_display', type: 'select', label: 'Times', options: [['local', 'Local time'], ['utc', 'UTC']], help: 'Exports are always UTC.' },
      { key: 'theme', type: 'select', label: 'Theme', options: [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], help: '' }
    ]
  }
];

// The 5 s window always hops 1.25 s; the 10 s window uses the clap_hop_s setting.
export const clapHopS = (s) => (s.clap_window_s === 5 ? 1.25 : s.clap_hop_s);

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    const out = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) if (k in saved) out[k] = saved[k];
    return out;
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  localStorage.setItem(KEY, JSON.stringify(s));
}
