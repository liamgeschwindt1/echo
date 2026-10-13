// Captures raw mic samples at the device's native rate into rolling circular
// buffers and emits: (1) ~0.25s relative-level blocks, (2) overlapping YAMNet
// windows resampled to 16 kHz, and (3) a rolling CLAP buffer at native rate
// every `clapHopSamples`. No audio is stored beyond these in-memory buffers.
function resampleLinear(input, srcRate, dstRate, dstLength) {
  const output = new Float32Array(dstLength);
  const ratio = srcRate / dstRate;
  for (let i = 0; i < dstLength; i++) {
    const srcPos = i * ratio;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    const s0 = input[idx] || 0;
    const s1 = idx + 1 < input.length ? input[idx + 1] : s0;
    output[i] = s0 + (s1 - s0) * frac;
  }
  return output;
}

class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const {
      nativeRate,
      yamnetWindowSamples, // native-rate samples spanning the YAMNet window
      yamnetHopSamples, // native-rate samples between hops
      yamnetTargetRate,
      yamnetTargetLength, // output length at target rate (e.g. 15600 @ 16kHz)
      clapWindowSamples, // native-rate samples spanning the CLAP rolling buffer
      clapHopSamples,
      levelBlockSamples
    } = options.processorOptions;

    this.nativeRate = nativeRate;
    this.yamnetWindowSamples = yamnetWindowSamples;
    this.yamnetHopSamples = yamnetHopSamples;
    this.yamnetTargetRate = yamnetTargetRate;
    this.yamnetTargetLength = yamnetTargetLength;
    this.yamnetBuffer = new Float32Array(yamnetWindowSamples);
    this.yamnetWriteIndex = 0;
    this.yamnetFilled = 0;
    this.yamnetSinceHop = 0;

    this.clapWindowSamples = clapWindowSamples;
    this.clapHopSamples = clapHopSamples;
    this.clapBuffer = new Float32Array(clapWindowSamples);
    this.clapWriteIndex = 0;
    this.clapFilled = 0;
    this.clapSinceHop = 0;

    this.levelBlockSamples = levelBlockSamples;
    this.levelBlock = new Float32Array(levelBlockSamples);
    this.levelIndex = 0;
  }

  _emitYamnetWindow() {
    const ordered = new Float32Array(this.yamnetWindowSamples);
    const tail = this.yamnetBuffer.subarray(this.yamnetWriteIndex);
    const head = this.yamnetBuffer.subarray(0, this.yamnetWriteIndex);
    ordered.set(tail, 0);
    ordered.set(head, tail.length);
    const resampled =
      this.nativeRate === this.yamnetTargetRate
        ? ordered
        : resampleLinear(ordered, this.nativeRate, this.yamnetTargetRate, this.yamnetTargetLength);
    this.port.postMessage({ type: 'yamnet', samples: resampled }, [resampled.buffer]);
  }

  _emitClapWindow() {
    const ordered = new Float32Array(this.clapWindowSamples);
    const tail = this.clapBuffer.subarray(this.clapWriteIndex);
    const head = this.clapBuffer.subarray(0, this.clapWriteIndex);
    ordered.set(tail, 0);
    ordered.set(head, tail.length);
    this.port.postMessage({ type: 'clap', samples: ordered, nativeRate: this.nativeRate }, [ordered.buffer]);
  }

  _emitLevelBlock() {
    let sumSquares = 0;
    let peak = 0;
    for (let i = 0; i < this.levelBlockSamples; i++) {
      const v = this.levelBlock[i];
      sumSquares += v * v;
      const abs = Math.abs(v);
      if (abs > peak) peak = abs;
    }
    const rms = Math.sqrt(sumSquares / this.levelBlockSamples);
    const rmsDbfs = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
    const peakDbfs = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
    this.port.postMessage({ type: 'level', rmsDbfs, peakDbfs });
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      const sample = channel[i];

      this.yamnetBuffer[this.yamnetWriteIndex] = sample;
      this.yamnetWriteIndex = (this.yamnetWriteIndex + 1) % this.yamnetWindowSamples;
      this.yamnetFilled = Math.min(this.yamnetFilled + 1, this.yamnetWindowSamples);
      this.yamnetSinceHop++;
      if (this.yamnetSinceHop >= this.yamnetHopSamples && this.yamnetFilled >= this.yamnetWindowSamples) {
        this.yamnetSinceHop = 0;
        this._emitYamnetWindow();
      }

      this.clapBuffer[this.clapWriteIndex] = sample;
      this.clapWriteIndex = (this.clapWriteIndex + 1) % this.clapWindowSamples;
      this.clapFilled = Math.min(this.clapFilled + 1, this.clapWindowSamples);
      this.clapSinceHop++;
      if (this.clapSinceHop >= this.clapHopSamples) {
        this.clapSinceHop = 0;
        this._emitClapWindow();
      }

      this.levelBlock[this.levelIndex] = sample;
      this.levelIndex++;
      if (this.levelIndex >= this.levelBlockSamples) {
        this.levelIndex = 0;
        this._emitLevelBlock();
      }
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
