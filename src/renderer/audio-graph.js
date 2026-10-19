class AllsampleAudioGraph {
  constructor(audio) { this.audio = audio; this.tempo = 1; this.pitch = 0; this.ready = null; }
  async ensure(context) {
    if (!this.ready) {
      this.ready = (async () => {
        this.context = context;
        const { SoundTouchNode } = await import('./soundtouch/SoundTouchNode.js');
        this.Node = SoundTouchNode;
        await SoundTouchNode.register(context, 'allsample://app/soundtouch/soundtouch-processor.js');
        this.source ||= context.createMediaElementSource(this.audio);
        this.analyser = context.createAnalyser(); this.analyser.fftSize = 8192;
        this.gate = context.createGain(); this.gate.gain.value = 0;
        this.gate.connect(this.analyser); this.analyser.connect(context.destination);
        this.audio.preservesPitch = false;
        this.reset();
      })();
      this.ready.catch(() => { this.ready = null; });
    }
    return this.ready;
  }
  reset() {
    if (!this.source) return;
    this.source.disconnect();
    if (this.node) { this.node.disconnect(); this.node.port.close(); }
    this.node = new this.Node({ context: this.context });
    this.source.connect(this.node); this.node.connect(this.gate);
    this.set(this.tempo, this.pitch);
  }
  set(tempo, pitch) {
    this.tempo = tempo; this.pitch = pitch;
    this.audio.playbackRate = tempo;
    if (this.node) { this.node.playbackRate.value = tempo; this.node.pitchSemitones.value = pitch; }
  }
  async resume(isCurrent = () => true) { clearTimeout(this.idleTimer); await this.context.resume(); if (isCurrent()) this.gate.gain.setValueAtTime(1, this.context.currentTime); }
  idle() {
    clearTimeout(this.idleTimer);
    // Let the output/analysis buffers drain, then avoid running the worklet on
    // silence indefinitely. A new audition cancels this pending suspension.
    this.idleTimer = setTimeout(() => { if (this.audio.paused && this.context?.state === 'running') void this.context.suspend().catch(() => {}); }, 300);
  }
  mute() { if (this.gate) this.gate.gain.setValueAtTime(0, this.context.currentTime); this.idle(); }
}
globalThis.AllsampleAudioGraph = AllsampleAudioGraph;
