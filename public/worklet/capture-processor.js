// Captures raw mic samples into a fixed-size circular buffer and emits an
// overlapping window every `hopSamples` samples. No audio is stored beyond
// this rolling buffer.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { windowSamples, hopSamples } = options.processorOptions;
    this.windowSamples = windowSamples;
    this.hopSamples = hopSamples;
    this.buffer = new Float32Array(windowSamples);
    this.writeIndex = 0;
    this.filled = 0;
    this.samplesSinceHop = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.writeIndex] = channel[i];
      this.writeIndex = (this.writeIndex + 1) % this.windowSamples;
      this.filled = Math.min(this.filled + 1, this.windowSamples);
      this.samplesSinceHop++;

      if (this.samplesSinceHop >= this.hopSamples && this.filled >= this.windowSamples) {
        this.samplesSinceHop = 0;
        const ordered = new Float32Array(this.windowSamples);
        const tail = this.buffer.subarray(this.writeIndex);
        const head = this.buffer.subarray(0, this.writeIndex);
        ordered.set(tail, 0);
        ordered.set(head, tail.length);
        this.port.postMessage(ordered, [ordered.buffer]);
      }
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
