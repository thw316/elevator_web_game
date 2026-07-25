/**
 * audio.js — Elevator Sound Effects (Web Audio API Synthesis)
 *
 * All sounds are generated programmatically using oscillators,
 * noise buffers, and filters. No external audio files required.
 */

class ElevatorAudio {
  constructor() {
    this.ctx = null;
    this.movingOsc = null;
    this.movingLfo = null;
    this.movingGain = null;
    this.noiseBuffer = null;
  }

  /** Initialize AudioContext (must be called from user gesture) */
  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._createNoiseBuffer();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /** Pre-generate a reusable white noise buffer */
  _createNoiseBuffer() {
    const sampleRate = this.ctx.sampleRate;
    const length = sampleRate * 2; // 2 seconds of noise
    this.noiseBuffer = this.ctx.createBuffer(1, length, sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  }

  /** Create a noise source node from the pre-generated buffer */
  _createNoise() {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    return source;
  }

  /**
   * Door closing sound: filtered noise swoosh + low thud at end
   * Duration: ~0.9s
   */
  playCloseSound() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Swoosh: noise with descending lowpass filter
    const noise = this._createNoise();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3000, now);
    filter.frequency.exponentialRampToValueAtTime(150, now + 0.8);
    filter.Q.setValueAtTime(1, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.linearRampToValueAtTime(0.06, now + 0.5);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    noise.start(now);
    noise.stop(now + 0.9);

    // Thud at the end (low sine burst)
    const thud = this.ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(120, now + 0.7);
    thud.frequency.exponentialRampToValueAtTime(60, now + 0.9);

    const thudGain = this.ctx.createGain();
    thudGain.gain.setValueAtTime(0, now);
    thudGain.gain.linearRampToValueAtTime(0.15, now + 0.72);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);

    thud.connect(thudGain);
    thudGain.connect(this.ctx.destination);
    thud.start(now + 0.7);
    thud.stop(now + 0.95);
  }

  /**
   * Door opening sound: filtered noise swoosh (ascending)
   * Duration: ~0.9s
   */
  playOpenSound() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const noise = this._createNoise();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(200, now);
    filter.frequency.exponentialRampToValueAtTime(2500, now + 0.7);
    filter.Q.setValueAtTime(0.7, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.03, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.3);
    gain.gain.linearRampToValueAtTime(0.06, now + 0.6);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    noise.start(now);
    noise.stop(now + 0.9);
  }

  /**
   * Start elevator moving hum (continuous sound)
   * Low-frequency oscillator with subtle vibrato.
   * Frequency and volume will be dynamically adjusted by setMovingIntensity().
   */
  startMovingSound() {
    if (!this.ctx) return;
    this.stopMovingSound(); // Clean up any previous

    const now = this.ctx.currentTime;

    // Main low hum
    this.movingOsc = this.ctx.createOscillator();
    this.movingOsc.type = 'sine';
    this.movingOsc.frequency.setValueAtTime(55, now); // start low, will be adjusted

    // Vibrato (LFO modulating frequency)
    this.movingLfo = this.ctx.createOscillator();
    this.movingLfo.type = 'sine';
    this.movingLfo.frequency.setValueAtTime(4.5, now);

    const lfoGain = this.ctx.createGain();
    lfoGain.gain.setValueAtTime(3, now);

    this.movingLfo.connect(lfoGain);
    lfoGain.connect(this.movingOsc.frequency);

    // Volume envelope: fade in
    this.movingGain = this.ctx.createGain();
    this.movingGain.gain.setValueAtTime(0, now);
    this.movingGain.gain.linearRampToValueAtTime(0.02, now + 0.3);

    this.movingOsc.connect(this.movingGain);
    this.movingGain.connect(this.ctx.destination);

    this.movingOsc.start(now);
    this.movingLfo.start(now);
  }

  /**
   * Dynamically adjust the moving sound based on current speed.
   * Maps normalizedSpeed [0..1] to:
   *   - Frequency: 55 Hz (idle) → 90 Hz (full speed)
   *   - Volume:    0.02 → 0.08
   *
   * @param {number} normalizedSpeed — 0.0 (stopped) to 1.0 (peak velocity)
   */
  setMovingIntensity(normalizedSpeed) {
    if (!this.movingOsc || !this.movingGain || !this.ctx) return;

    var speed = Math.max(0, Math.min(1, normalizedSpeed));
    var now = this.ctx.currentTime;

    // Frequency: 55 → 90 Hz  (linear interpolation)
    var freq = 55 + speed * 35;
    this.movingOsc.frequency.setTargetAtTime(freq, now, 0.05);

    // Volume: 0.02 → 0.08
    var vol = 0.02 + speed * 0.06;
    this.movingGain.gain.setTargetAtTime(vol, now, 0.05);
  }

  /** Stop elevator moving hum (fade out) */
  stopMovingSound() {
    if (!this.movingOsc || !this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.movingOsc;
    const lfo = this.movingLfo;
    const gainNode = this.movingGain;

    this.movingOsc = null;
    this.movingLfo = null;
    this.movingGain = null;

    try {
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(gainNode.gain.value, now);
      gainNode.gain.linearRampToValueAtTime(0, now + 0.3);
      osc.stop(now + 0.35);
      lfo.stop(now + 0.35);
    } catch (e) {
      // Oscillators may have already stopped
    }
  }

  /**
   * Floor passing beep: soft short sine tone
   * Duration: ~80ms
   */
  playFloorBeep() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  /**
   * Arrival ding-dong: two-tone bell
   * Ding (higher) then Dong (lower)
   * Duration: ~1s
   */
  playArrivalDing() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Ding (G5 ≈ 784 Hz)
    const ding = this.ctx.createOscillator();
    ding.type = 'sine';
    ding.frequency.setValueAtTime(784, now);

    const dingGain = this.ctx.createGain();
    dingGain.gain.setValueAtTime(0.25, now);
    dingGain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);

    ding.connect(dingGain);
    dingGain.connect(this.ctx.destination);
    ding.start(now);
    ding.stop(now + 0.7);

    // Dong (E5 ≈ 659 Hz), slightly delayed
    const dong = this.ctx.createOscillator();
    dong.type = 'sine';
    dong.frequency.setValueAtTime(659, now + 0.18);

    const dongGain = this.ctx.createGain();
    dongGain.gain.setValueAtTime(0, now);
    dongGain.gain.linearRampToValueAtTime(0.2, now + 0.19);
    dongGain.gain.exponentialRampToValueAtTime(0.01, now + 0.9);

    dong.connect(dongGain);
    dongGain.connect(this.ctx.destination);
    dong.start(now + 0.18);
    dong.stop(now + 1.0);
  }

  /**
   * Error beep: two short square-wave buzzes
   * Duration: ~0.3s total
   */
  playErrorBeep() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    for (let i = 0; i < 2; i++) {
      const t = now + i * 0.15;

      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(380, t);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.08, t);
      gain.gain.setValueAtTime(0.08, t + 0.08);
      gain.gain.linearRampToValueAtTime(0, t + 0.1);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.12);
    }
  }

  /**
   * Speak the floor number in English using Web Speech API.
   * e.g. floor 5 → "5, floor", B3 → "basement 3, floor"
   * Fails silently if speechSynthesis is unavailable.
   */
  speakFloor(floorNumber) {
    if (typeof speechSynthesis === 'undefined') return;

    var text;
    if (floorNumber < 0) {
      text = 'basement ' + Math.abs(floorNumber) + ', floor';
    } else {
      text = floorNumber + ', floor';
    }

    var utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    utterance.pitch = 1.1;
    utterance.volume = 0.8;
    speechSynthesis.speak(utterance);
  }
}
