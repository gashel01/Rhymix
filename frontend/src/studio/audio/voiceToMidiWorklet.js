class VoiceToMidiProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options?.processorOptions || {};
    this.frameSize = opts.frameSize || 1024;
    this._buffer = new Float32Array(0);
  }

  _appendBuffer(input) {
    if (!input || input.length === 0) return;
    const merged = new Float32Array(this._buffer.length + input.length);
    merged.set(this._buffer);
    merged.set(input, this._buffer.length);
    this._buffer = merged;
  }

  _emitFrame() {
    if (this._buffer.length < this.frameSize) return;
    const slice = this._buffer.slice(0, this.frameSize);
    this._buffer = this._buffer.slice(this.frameSize);
    const out = new Int16Array(this.frameSize);
    for (let i = 0; i < slice.length; i += 1) {
      let sample = slice[i];
      if (sample > 1) sample = 1;
      if (sample < -1) sample = -1;
      out[i] = Math.round(sample * 32767);
    }
    this.port.postMessage(out.buffer, [out.buffer]);
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    this._appendBuffer(input[0]);
    while (this._buffer.length >= this.frameSize) {
      this._emitFrame();
    }
    return true;
  }
}

registerProcessor("voice-to-midi-processor", VoiceToMidiProcessor);
