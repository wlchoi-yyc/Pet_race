// 萌寵大賽跑：全部聲音以 Web Audio 即時合成（輕快背景音樂、觀眾歡呼、音效）

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// 每小節八個八分音符；null 表示休止
const MELODY_A = [
  76, 79, 84, 79, 81, 79, 76, null,
  74, 79, 83, 79, 86, 83, 79, null,
  84, 83, 81, 76, 81, 84, 88, null,
  77, 81, 84, 81, 79, 77, 76, 74,
];
const MELODY_B = [
  79, null, 76, 79, 84, null, 86, 88,
  86, null, 83, 79, 86, 84, 83, null,
  81, 84, 88, 84, 81, null, 76, 79,
  77, 81, 84, 89, 88, 86, 83, 79,
];
// C – G – Am – F
const ROOTS = [36, 43, 45, 41];
const CHORDS = [[60, 64, 67], [59, 62, 67], [57, 60, 64], [57, 60, 65]];

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicOn = false;
    this.crowdLevel = 0;
    this.seq = 0;
    this.nextTime = 0;
    this.bpm = 150;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.out = c.createGain();
    this.out.gain.value = this.muted ? 0 : 1;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    this.out.connect(comp);
    comp.connect(c.destination);

    this.music = c.createGain();
    this.music.gain.value = 0.38;
    this.music.connect(this.out);
    this.sfx = c.createGain();
    this.sfx.gain.value = 0.85;
    this.sfx.connect(this.out);
    this.crowd = c.createGain();
    this.crowd.gain.value = 0;
    this.crowd.connect(this.out);

    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this._startCrowdBed();
    this.timer = setInterval(() => this._tick(), 25);
  }

  setMuted(m) {
    this.muted = m;
    if (this.out) this.out.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
  }
  pause(p) {
    if (!this.ctx) return;
    if (p) this.ctx.suspend(); else this.ctx.resume();
  }

  startMusic() {
    if (!this.ctx) return;
    this.musicOn = true;
    this.seq = 0;
    this.nextTime = this.ctx.currentTime + 0.06;
    this.music.gain.cancelScheduledValues(this.ctx.currentTime);
    this.music.gain.setTargetAtTime(0.38, this.ctx.currentTime, 0.05);
  }
  stopMusic(fade = 0.4) {
    if (!this.ctx) return;
    this.musicOn = false;
    this.music.gain.setTargetAtTime(0.0001, this.ctx.currentTime, fade / 3);
  }
  // 0 = 安靜，1 = 全場沸騰
  setCrowd(level) {
    this.crowdLevel = Math.max(0, Math.min(1.2, level));
    if (this.crowd) this.crowd.gain.setTargetAtTime(0.06 + this.crowdLevel * 0.5, this.ctx.currentTime, 0.4);
  }

  // ---------- 基本音源 ----------
  _env(g, t, a, peak, dec) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }
  _osc(type, f, t, dur, peak, dest, f2, a = 0.008) {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    this._env(g, t, a, peak, dur);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + a + dur + 0.05);
    return o;
  }
  _noise(t, dur, peak, dest, type, freq, q = 1, f2) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (f2) f.frequency.exponentialRampToValueAtTime(f2, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    this._env(g, t, 0.004, peak, dur);
    s.connect(f);
    f.connect(g);
    g.connect(dest);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
  }

  // ---------- 背景音樂 ----------
  _tick() {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    if (this.musicOn) {
      const spb = 60 / this.bpm / 4;
      while (this.nextTime < c.currentTime + 0.12) {
        this._playStep(this.seq, this.nextTime);
        this.nextTime += spb;
        this.seq = (this.seq + 1) % 128;
      }
    }
    this._crowdEvents();
  }

  _playStep(s, t) {
    const bar = Math.floor(s / 16);
    const b16 = s % 16;
    const ci = bar % 4;
    const M = this.music;
    // 鼓
    if (b16 === 0 || b16 === 8 || (bar % 2 === 1 && b16 === 10)) this._kick(t);
    if (b16 === 4 || b16 === 12) this._snare(t);
    this._noise(t, b16 % 2 ? 0.025 : 0.04, b16 % 2 ? 0.035 : 0.07, M, 'highpass', 7000);
    // 低音
    if (b16 % 2 === 0) {
      const r = ROOTS[ci];
      const n = b16 % 4 === 0 ? r : r + (b16 % 8 === 2 ? 12 : 7);
      this._osc('triangle', mtof(n), t, 0.16, 0.32, M);
      this._osc('square', mtof(n + 12), t, 0.06, 0.025, M);
    }
    // 主旋律
    if (b16 % 2 === 0) {
      const mel = bar < 4 ? MELODY_A : MELODY_B;
      const n = mel[ci * 8 + b16 / 2];
      if (n) {
        this._osc('square', mtof(n), t, 0.17, 0.07, M);
        this._osc('triangle', mtof(n), t, 0.22, 0.12, M);
      }
    }
    // 閃亮琶音
    if (b16 % 2 === 1) {
      const ch = CHORDS[ci];
      const n = ch[(b16 >> 1) % 3] + 12;
      this._osc('sine', mtof(n), t, 0.18, 0.05, M);
    }
  }
  _kick(t) {
    this._osc('sine', 160, t, 0.22, 0.55, this.music, 42, 0.003);
  }
  _snare(t) {
    this._noise(t, 0.12, 0.18, this.music, 'bandpass', 1900, 0.8);
    this._osc('triangle', 220, t, 0.06, 0.12, this.music, 160);
  }

  // ---------- 觀眾 ----------
  _startCrowdBed() {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp1 = c.createBiquadFilter();
    bp1.type = 'bandpass';
    bp1.frequency.value = 850;
    bp1.Q.value = 0.8;
    const bp2 = c.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.frequency.value = 2100;
    bp2.Q.value = 1.4;
    const g1 = c.createGain();
    g1.gain.value = 0.35;
    const g2 = c.createGain();
    g2.gain.value = 0.12;
    // 人聲般的起伏
    for (const [f, depth, target] of [[3.3, 0.12, g1], [5.1, 0.08, g1], [4.4, 0.05, g2]]) {
      const l = c.createOscillator();
      l.frequency.value = f;
      const lg = c.createGain();
      lg.gain.value = depth;
      l.connect(lg);
      lg.connect(target.gain);
      l.start();
    }
    src.connect(bp1);
    bp1.connect(g1);
    g1.connect(this.crowd);
    src.connect(bp2);
    bp2.connect(g2);
    g2.connect(this.crowd);
    src.start();
  }

  _crowdEvents() {
    const L = this.crowdLevel;
    if (L <= 0.02) return;
    const t = this.ctx.currentTime + 0.02;
    // 掌聲：大量短促噪音
    const claps = Math.random() < L * 0.9 ? 1 + (Math.random() < L * 0.6 ? 1 : 0) : 0;
    for (let i = 0; i < claps; i++) {
      this._noise(t + Math.random() * 0.02, 0.03, 0.03 + Math.random() * 0.06 * L, this.crowd, 'bandpass', 1400 + Math.random() * 1600, 1.2);
    }
    // 歡呼浪潮
    if (Math.random() < L * 0.012) this.cheer(0.5 + L * 0.5);
    // 「嘩～」
    if (Math.random() < L * 0.012) this.woo(0.6 + Math.random() * 0.4);
    // 口哨
    if (Math.random() < L * 0.005) this.whistle();
  }

  cheer(power = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.9;
    f.frequency.setValueAtTime(700, t);
    f.frequency.linearRampToValueAtTime(1500, t + 0.5);
    f.frequency.linearRampToValueAtTime(1000, t + 2);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.35 * power, t + 0.35);
    g.gain.linearRampToValueAtTime(0.0001, t + 2.2);
    s.connect(f);
    f.connect(g);
    g.connect(this.crowd);
    s.start(t, Math.random());
    s.stop(t + 2.4);
    for (let i = 0; i < 2 + power * 3; i++) setTimeout(() => this.woo(power), Math.random() * 600);
  }

  woo(power = 1) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime + Math.random() * 0.1;
    const base = 230 + Math.random() * 260;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(base * 1.45, t + 0.25);
    o.frequency.exponentialRampToValueAtTime(base * 1.1, t + 0.8);
    const f1 = c.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 750 + Math.random() * 250;
    f1.Q.value = 4;
    const f2 = c.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 1150 + Math.random() * 300;
    f2.Q.value = 5;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.06 * power, t + 0.12);
    g.gain.linearRampToValueAtTime(0.0001, t + 0.85);
    o.connect(f1);
    o.connect(f2);
    f1.connect(g);
    f2.connect(g);
    g.connect(this.crowd);
    o.start(t);
    o.stop(t + 0.9);
  }

  whistle() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(1900, t);
    o.frequency.exponentialRampToValueAtTime(2800, t + 0.18);
    o.frequency.exponentialRampToValueAtTime(1700, t + 0.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.05);
    g.gain.linearRampToValueAtTime(0.0001, t + 0.55);
    o.connect(g);
    g.connect(this.crowd);
    o.start(t);
    o.stop(t + 0.6);
  }

  // ---------- 音效 ----------
  _ok() { return this.ctx && this.ctx.state === 'running'; }
  beep(high) {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    this._osc('square', high ? 1046 : 523, t, high ? 0.6 : 0.25, 0.15, this.sfx);
    this._osc('sine', high ? 2093 : 1046, t, high ? 0.6 : 0.25, 0.08, this.sfx);
  }
  eat() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    [880, 1109, 1319, 1760].forEach((f, i) => {
      this._osc('square', f, t + i * 0.05, 0.12, 0.06, this.sfx);
      this._osc('sine', f * 2, t + i * 0.05, 0.15, 0.05, this.sfx);
    });
  }
  boost() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.55, 0.25, this.sfx, 'bandpass', 400, 1.5, 3500);
    this._osc('sawtooth', 220, t, 0.45, 0.05, this.sfx, 880);
  }
  hit() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.2, 0.5, this.sfx, 'lowpass', 600);
    this._osc('sine', 180, t, 0.25, 0.5, this.sfx, 50, 0.002);
    // 「嘣～」
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const l = this.ctx.createOscillator();
    const lg = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(620, t + 0.05);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.6);
    l.frequency.value = 18;
    lg.gain.value = 40;
    l.connect(lg);
    lg.connect(o.frequency);
    this._env(g, t + 0.05, 0.01, 0.2, 0.55);
    o.connect(g);
    g.connect(this.sfx);
    o.start(t + 0.05);
    l.start(t + 0.05);
    o.stop(t + 0.7);
    l.stop(t + 0.7);
  }
  splash() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.35, 0.35, this.sfx, 'bandpass', 1200, 0.7, 300);
  }
  jump() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    this._osc('square', 320, t, 0.16, 0.06, this.sfx, 820);
    this._osc('sine', 640, t, 0.16, 0.06, this.sfx, 1400);
  }
  land() {
    if (!this._ok()) return;
    this._noise(this.ctx.currentTime, 0.08, 0.12, this.sfx, 'lowpass', 500);
  }
  bump() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    this._osc('sine', 300, t, 0.12, 0.25, this.sfx, 120);
  }
  step() {
    if (!this._ok()) return;
    this._noise(this.ctx.currentTime, 0.035, 0.05, this.sfx, 'bandpass', 900 + Math.random() * 400, 2);
  }
  pad() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1046, 1318].forEach((f, i) => this._osc('triangle', f, t + i * 0.035, 0.12, 0.08, this.sfx));
  }
  win() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    const seq = [72, 76, 79, 84, 79, 84];
    seq.forEach((n, i) => {
      this._osc('square', mtof(n), t + i * 0.12, 0.2, 0.08, this.sfx);
      this._osc('triangle', mtof(n), t + i * 0.12, 0.25, 0.15, this.sfx);
    });
    [72, 76, 79, 84, 88].forEach((n) => {
      this._osc('square', mtof(n), t + 0.75, 1.3, 0.05, this.sfx);
      this._osc('triangle', mtof(n - 12), t + 0.75, 1.5, 0.12, this.sfx);
    });
  }
  lose() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    [67, 66, 65].forEach((n, i) => this._osc('sawtooth', mtof(n - 12), t + i * 0.42, 0.38, 0.09, this.sfx));
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const l = this.ctx.createOscillator();
    const lg = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1200;
    o.type = 'sawtooth';
    o.frequency.value = mtof(52);
    l.frequency.value = 6;
    lg.gain.value = 6;
    l.connect(lg);
    lg.connect(o.frequency);
    this._env(g, t + 1.26, 0.02, 0.1, 1.2);
    o.connect(f);
    f.connect(g);
    g.connect(this.sfx);
    o.start(t + 1.26);
    l.start(t + 1.26);
    o.stop(t + 2.6);
    l.stop(t + 2.6);
  }
}
