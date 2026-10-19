class AllsampleAudioGraph {
  constructor(audio) { this.audio = audio; this.tempo = 1; this.pitch = 0; this.ready = null; }
  async ensure(context) {
    if (!this.ready) {
      this.ready = (async () => {
        this.context = context;
        this.source ||= context.createMediaElementSource(this.audio);
        this.analyser = context.createAnalyser(); this.analyser.fftSize = 8192;
        this.gate = context.createGain(); this.gate.gain.value = 0;
        this.gate.connect(this.analyser); this.analyser.connect(context.destination);
        this.audio.preservesPitch = false;
        if (this.tempo !== 1 || this.pitch !== 0) await this.ensureEffects();
        this.reset();
      })();
      this.ready.catch(() => { this.ready = null; });
    }
    return this.ready;
  }
  async ensureEffects() {
    if (!this.effectsReady) {
      this.effectsReady = (async () => {
        const { SoundTouchNode } = await import('./soundtouch/SoundTouchNode.js');
        await SoundTouchNode.register(this.context, new URL('./soundtouch/soundtouch-processor.js', location.href).href);
        this.Node = SoundTouchNode;
      })();
      this.effectsReady.catch(() => { this.effectsReady = null; });
    }
    return this.effectsReady;
  }
  reset() {
    if (!this.source) return;
    this.source.disconnect();
    if (this.node) { this.node.disconnect(); this.node.port.close(); }
    this.node = null;
    if (this.tempo === 1 && this.pitch === 0) { this.source.connect(this.gate); this.audio.playbackRate = 1; return; }
    if (!this.Node) return;
    this.node = new this.Node({ context: this.context });
    this.source.connect(this.node); this.node.connect(this.gate);
    this.set(this.tempo, this.pitch);
  }
  set(tempo, pitch) {
    const needsRoute = (this.tempo === 1 && this.pitch === 0) !== (tempo === 1 && pitch === 0);
    this.tempo = tempo; this.pitch = pitch;
    this.audio.playbackRate = tempo;
    if (this.source && needsRoute) {
      if (tempo === 1 && pitch === 0) this.reset();
      else void this.ensureEffects().then(() => this.reset()).catch(() => { this.tempo = 1; this.pitch = 0; this.reset(); });
    }
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
