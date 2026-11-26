// AudioWorkletProcessor that downsamples microphone audio to 16 kHz mono
// PCM16 and posts ~50ms chunks back to the main thread.
//
// Loaded as a real static file (not an inline blob) so it passes the
// production CSP `script-src 'self'` directive without needing `blob:`.

class MicCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.targetRate = opts.targetRate || 16000;
    this.ratio = sampleRate / this.targetRate;
    this.acc = 0;
    this.buffer = [];
    this.frameSize = Math.round(this.targetRate * 0.05); // ~50ms
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += 1;
      if (this.acc >= this.ratio) {
        this.acc -= this.ratio;
        let s = ch[i];
        if (s > 1) s = 1;
        else if (s < -1) s = -1;
        this.buffer.push(s < 0 ? s * 0x8000 : s * 0x7fff);
      }
    }
    while (this.buffer.length >= this.frameSize) {
      const out = new Int16Array(this.frameSize);
      for (let i = 0; i < this.frameSize; i++) out[i] = this.buffer[i] | 0;
      this.buffer.splice(0, this.frameSize);
      this.port.postMessage(out.buffer, [out.buffer]);
    }
    return true;
  }
}

registerProcessor("mic-capture-processor", MicCaptureProcessor);
