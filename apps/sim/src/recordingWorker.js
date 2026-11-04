import { decodeMultichannelWav, analyseRecording } from '@echo/sim-core/recording.js';

self.onmessage = async ({ data }) => {
  try {
    const geometry = JSON.parse(new TextDecoder().decode(data.geometryBytes));
    const report = analyseRecording(decodeMultichannelWav(data.wav), geometry);
    for (const [key, bytes] of [['wav_sha256', data.wav], ['geometry_sha256', data.geometryBytes]]) {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      report[key] = [...digest].map((x) => x.toString(16).padStart(2, '0')).join('');
    }
    self.postMessage({ report });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
