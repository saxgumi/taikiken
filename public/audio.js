// 効果音：音声ファイルを使わず Web Audio でその場で合成する
(function (root) {
  'use strict';

  const VOLUME_KEY = 'taikiken.volume.v1';
  const MUTE_KEY = 'taikiken.muted.v1';  // 以前のオン・オフ設定。音量が未保存のときだけ読む
  let ctx = null, master = null, noiseBuf = null;
  let roarNode = null;   // 飛行中の轟音 { src, filter, gain }
  let aimNode = null;    // 狙い中の音 { osc, gain }
  let volume = 1;        // 0〜1
  try {
    const v = localStorage.getItem(VOLUME_KEY);
    if (v !== null && isFinite(Number(v))) volume = Math.min(1, Math.max(0, Number(v)));
    else if (localStorage.getItem(MUTE_KEY) === '1') volume = 0;
  } catch (e) { /* 既定は最大音量 */ }

  // スライダーの位置と聞こえる大きさが近くなるよう、二乗で効かせる
  const masterGain = () => 0.8 * volume * volume;

  function ensure() {
    if (ctx) return true;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = masterGain();
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  // ブラウザは操作があるまで音を出せないので、最初のタッチで呼ぶ
  function unlock() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
  }

  // スマホでは指を置いた瞬間（pointerdown）は「操作」と見なされず、resume が効かない。
  // 指を離した・タップした・キーを押したときにも解除を試し、鳴らせるようになったら外す。
  const UNLOCK_EVENTS = ['pointerup', 'touchend', 'click', 'keydown'];
  function unlockOnGesture() {
    unlock();
    if (ctx && ctx.state === 'running') {
      UNLOCK_EVENTS.forEach((t) => document.removeEventListener(t, unlockOnGesture, true));
    }
  }
  UNLOCK_EVENTS.forEach((t) => document.addEventListener(t, unlockOnGesture, true));

  const ready = () => ctx && ctx.state === 'running';

  function envelope(param, t0, peak, attack, dur) {
    param.setValueAtTime(0.0001, t0);
    param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + attack);
    param.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  // o: { type, f0, f1, q, gain, attack, dur, delay }
  function noise(o) {
    const t0 = ctx.currentTime + (o.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = o.type || 'lowpass';
    filter.Q.value = o.q || 0.7;
    filter.frequency.setValueAtTime(o.f0, t0);
    filter.frequency.exponentialRampToValueAtTime(o.f1 || o.f0, t0 + o.dur);
    const g = ctx.createGain();
    envelope(g.gain, t0, o.gain, o.attack || 0.01, o.dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t0, Math.random());
    src.stop(t0 + o.dur + 0.05);
  }

  // o: { wave, f0, f1, gain, attack, dur, delay }
  function tone(o) {
    const t0 = ctx.currentTime + (o.delay || 0);
    const osc = ctx.createOscillator();
    osc.type = o.wave || 'sine';
    osc.frequency.setValueAtTime(o.f0, t0);
    osc.frequency.exponentialRampToValueAtTime(o.f1 || o.f0, t0 + o.dur);
    const g = ctx.createGain();
    envelope(g.gain, t0, o.gain, o.attack || 0.01, o.dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.05);
  }

  // 狙い中：速度が上がるほど音が高くなる。t は 0〜1、null で止める
  function aim(t) {
    if (!ready()) return;
    const now = ctx.currentTime;
    if (t === null) {
      if (!aimNode) return;
      aimNode.gain.gain.setTargetAtTime(0.0001, now, 0.03);
      aimNode.osc.stop(now + 0.2);
      aimNode = null;
      return;
    }
    if (!aimNode) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      osc.connect(gain);
      gain.connect(master);
      osc.start();
      aimNode = { osc: osc, gain: gain };
    }
    aimNode.osc.frequency.setTargetAtTime(110 * Math.pow(2, t * 2.5), now, 0.03);
    aimNode.gain.gain.setTargetAtTime(0.05 + 0.04 * t, now, 0.05);
  }

  function launch() {
    if (!ready()) return;
    noise({ type: 'bandpass', f0: 300, f1: 2400, q: 1.2, gain: 0.35, attack: 0.05, dur: 0.45 });
  }

  // 解除が発射の直後に間に合ったときも轟音が鳴るよう、鳴らしたいかどうかを覚えておく
  let roarWanted = false;

  function roarStart() {
    roarWanted = true;
    if (!ready() || roarNode) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 150;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start();
    roarNode = { src: src, filter: filter, gain: gain };
  }

  // 飛行中：発光の強さ b（0〜1）に合わせて轟音を大きく、明るくする
  function roar(b) {
    if (roarWanted && !roarNode) roarStart();
    if (!ready() || !roarNode) return;
    const now = ctx.currentTime;
    roarNode.filter.frequency.setTargetAtTime(150 + 3200 * b * b, now, 0.08);
    roarNode.gain.gain.setTargetAtTime(0.02 + 0.75 * b * b, now, 0.08);
  }

  function roarStop() {
    roarWanted = false;
    if (!ctx || !roarNode) return;
    const now = ctx.currentTime;
    roarNode.gain.gain.setTargetAtTime(0.0001, now, 0.06);
    roarNode.src.stop(now + 0.5);
    roarNode = null;
  }

  function frag() {
    if (!ready()) return;
    noise({ type: 'bandpass', f0: 1800, f1: 500, q: 0.8, gain: 0.6, attack: 0.005, dur: 0.3 });
    tone({ wave: 'square', f0: 220, f1: 70, gain: 0.15, attack: 0.005, dur: 0.18 });
  }

  // 衝突：mag（0〜1）が大きいほど低く、長く、大きい
  function impact(mag) {
    if (!ready()) return;
    if (mag < 0.12) {
      // 小石が落ちた程度の「コツン」
      noise({ type: 'bandpass', f0: 1600, f1: 900, q: 3, gain: 0.5, attack: 0.002, dur: 0.07 });
      tone({ f0: 320, f1: 180, gain: 0.3, attack: 0.002, dur: 0.09 });
      return;
    }
    const dur = 0.5 + 3 * mag;
    tone({ f0: 130 - 70 * mag, f1: 28, gain: 0.5 + 0.5 * mag, attack: 0.005, dur: dur });
    noise({ f0: 2500 - 1200 * mag, f1: 90, gain: 0.4 + 0.6 * mag, attack: 0.005, dur: dur });
    if (mag > 0.5) {
      // 巨大衝突は遅れて地鳴りが続く
      noise({ f0: 220, f1: 50, gain: 0.7 * mag, attack: 0.6, dur: 2 + 3 * mag, delay: 0.25 });
    }
  }

  function burn() {
    if (!ready()) return;
    noise({ type: 'highpass', f0: 3000, f1: 900, gain: 0.35, attack: 0.01, dur: 0.7 });
    tone({ f0: 900, f1: 180, gain: 0.12, attack: 0.01, dur: 0.6 });
  }

  function escape() {
    if (!ready()) return;
    tone({ f0: 260, f1: 1100, gain: 0.12, attack: 0.2, dur: 1.4 });
    noise({ type: 'bandpass', f0: 500, f1: 3000, q: 2, gain: 0.12, attack: 0.3, dur: 1.4 });
  }

  function result(ok) {
    if (!ready()) return;
    const notes = ok ? [659, 880, 1319] : [247, 185];
    notes.forEach((f, i) => {
      tone({ wave: ok ? 'sine' : 'triangle', f0: f, gain: 0.16, attack: 0.01, dur: ok ? 0.5 : 0.6, delay: i * (ok ? 0.11 : 0.22) });
    });
  }

  function setVolume(v) {
    volume = Math.min(1, Math.max(0, v));
    try { localStorage.setItem(VOLUME_KEY, String(volume)); } catch (e) { /* 保存できなくても動く */ }
    if (ctx) master.gain.setTargetAtTime(masterGain(), ctx.currentTime, 0.02);
  }

  // 画面を離れている間は音を止める
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend();
    else ctx.resume();
  });

  root.Sfx = {
    unlock, aim, launch, roarStart, roar, roarStop, frag, impact, burn, escape, result,
    setVolume, getVolume: () => volume,
  };
})(window);
