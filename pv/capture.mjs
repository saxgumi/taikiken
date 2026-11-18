// ゲームを台本どおりに操作し、1/60 秒ずつ時計を進めて 1 コマずつ撮る。
//   node capture.mjs [クリップ名...]
// 撮ったコマは capture-frames/<名前>/ に、動画は public/clips/<名前>.mp4 に、
// 効果音は public/clips/<名前>.wav に、各場面が何コマ目に起きたかは public/clips/<名前>.json に書き出す。
//
// 効果音は Web Audio でその場で合成されるので、画面と一緒には録れない。撮影中はゲームが鳴らした音と
// そのコマだけを記録し、あとで同じ audio.js をオフラインで鳴らして、コマに合わせた音声ファイルを作る。
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// 画面は 960×540 で組み、2 倍の解像度で撮る。スマホで見ても文字が読める大きさになる
const W = 960, H = 540, SCALE = 2, FPS = 60;
const GAME = pathToFileURL(path.resolve('../public/index.html')).href;
const AUDIO_JS = path.resolve('../public/audio.js');
const RATE = 48000;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

// main.js の resize() と同じ式で、狙いの起点とゲージの長さを出す
const MX = Math.max(64, W * 0.28);
const MY = Math.min(Math.max(200, H * 0.27), H * 0.5);
const LMAX = Math.min(Math.max(Math.min(W, H) * 0.5, 130), 340);
const DEAD = 16, V_MIN = 11.2, V_MAX = 72;

// lab: 実験室で使う質量（スライダーの値 = log10 kg）。省略時はお題1
const CLIPS = {
  bounce: { angle: 4, speed: 25 },
  burn: { angle: 60, speed: 60 },
  land: { angle: 50, speed: 12 },
  big: { angle: 60, speed: 40, lab: 15 },
};

// ページより先に読み込み、時計と乱数をこちらで握る
const INIT = `
(() => {
  let seed = 20261118;
  Math.random = () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let queue = [], now = 0, id = 0;
  window.requestAnimationFrame = (cb) => { queue.push(cb); return ++id; };
  window.__steps = 0;
  window.__step = (ms) => {
    now += ms;
    window.__steps++;
    window.__inStep = true;
    const cbs = queue; queue = [];
    for (const cb of cbs) cb(now);
    window.__inStep = false;
  };
})();
`;

// 押している指の位置を示す丸（実機で指が見えない代わり）
const TOUCH_CSS = `
#pvTouch { position: fixed; left: 0; top: 0; width: 30px; height: 30px; margin: -15px 0 0 -15px;
  border-radius: 50%; border: 2px solid rgba(255,255,255,0.9); background: rgba(255,255,255,0.18);
  box-shadow: 0 0 18px rgba(255,255,255,0.5); pointer-events: none; z-index: 99999; display: none; }
`;

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

async function capture(name, spec) {
  const dir = path.resolve('capture-frames', name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const browser = await chromium.launch({ executablePath: EDGE });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE });
  await page.addInitScript(INIT);
  await page.goto(GAME);
  // 効果音は鳴らさずに、何コマ目に何を鳴らしたかだけを残す。
  // n コマ目の画像は n+1 回目の時計送りのあとに撮るので、時計送りの最中に鳴った音は n コマ目、
  // 時計送りの合間（指の操作）に鳴った音は次に撮る画像のコマに付ける
  await page.evaluate(() => {
    window.__sfx = [];
    for (const k of Object.keys(window.Sfx)) {
      if (k === 'getVolume' || k === 'setVolume') continue;
      window.Sfx[k] = (...args) => {
        window.__sfx.push({ f: window.__inStep ? window.__steps - 1 : window.__steps, k, args });
      };
    }
  });
  await page.addStyleTag({ content: TOUCH_CSS });
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.id = 'pvTouch';
    document.body.appendChild(d);
  });

  if (spec.lab !== undefined) {
    await page.evaluate((v) => {
      document.getElementById('listBtn').click();
      document.getElementById('labBtn').click();
      const m = document.getElementById('mass');
      m.value = String(v);
      m.dispatchEvent(new Event('input'));
    }, spec.lab);
  }

  let frame = 0;
  const marks = {};
  const shot = async () => {
    await page.evaluate((ms) => window.__step(ms), 1000 / FPS);
    await page.screenshot({ path: path.join(dir, String(frame).padStart(5, '0') + '.jpg'), type: 'jpeg', quality: 92 });
    frame++;
  };
  const touch = (x, y, show) => page.evaluate(([x, y, show]) => {
    const d = document.getElementById('pvTouch');
    d.style.display = show ? 'block' : 'none';
    d.style.transform = 'translate(' + x + 'px,' + y + 'px)';
  }, [x, y, show]);

  // 待機 → 狙いを引く → 少し止めて離す
  for (let i = 0; i < 40; i++) await shot();
  const a = (spec.angle * Math.PI) / 180;
  const len = DEAD + ((spec.speed - V_MIN) / (V_MAX - V_MIN)) * (LMAX - DEAD);
  const sx = MX, sy = MY;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await touch(sx, sy, true);
  marks.press = frame;
  const DRAG = 45;
  for (let i = 1; i <= DRAG; i++) {
    const t = easeInOut(i / DRAG);
    const x = sx + Math.cos(a) * len * t, y = sy + Math.sin(a) * len * t;
    await page.mouse.move(x, y);
    await touch(x, y, true);
    await shot();
  }
  for (let i = 0; i < 24; i++) await shot();
  await page.mouse.up();
  await touch(0, 0, false);
  marks.launch = frame;

  // 結末が出るまで回し、結果パネルが出てから少し余韻を撮る
  const state = () => page.evaluate(() => ({
    end: document.getElementById('hud').hidden,
    result: !document.getElementById('result').hidden,
  }));
  let after = -1;
  while (frame < marks.launch + FPS * 40) {
    await shot();
    const s = await state();
    if (s.end && marks.end === undefined) marks.end = frame;
    if (s.result && marks.result === undefined) { marks.result = frame; after = FPS * 3; }
    if (after >= 0 && after-- === 0) break;
  }
  marks.total = frame;
  const sfx = await page.evaluate(() => window.__sfx);
  const wav = await renderAudio(browser, sfx, frame / FPS + 5);
  await browser.close();

  const out = path.resolve('public/clips');
  fs.mkdirSync(out, { recursive: true });
  // Remotion に入っている ffmpeg で、ほぼ劣化なしの動画にまとめる
  execFileSync('npx', ['remotion', 'ffmpeg', '-y', '-loglevel', 'error', '-framerate', String(FPS),
    '-i', path.join(dir, '%05d.jpg'), '-c:v', 'libx264', '-crf', '12', '-preset', 'slow',
    '-pix_fmt', 'yuv420p', path.join(out, name + '.mp4')], { stdio: 'inherit', shell: true });
  fs.writeFileSync(path.join(out, name + '.wav'), wav);
  fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify(marks, null, 2));
  console.log(name, JSON.stringify(marks));
}

// 記録した効果音を、ゲームと同じ audio.js でオフラインに鳴らして WAV にする。
// audio.js は ctx.currentTime を起点に音を予約するので、その値を記録したコマの時刻に差し替えて呼ぶ
async function renderAudio(browser, events, seconds) {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.evaluate(({ seconds, rate }) => {
    const real = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
    window.__real = real;
    window.__t = 0;
    window.AudioContext = function () {
      return new Proxy(real, {
        get(target, p) {
          if (p === 'currentTime') return window.__t;
          if (p === 'state') return 'running';
          if (p === 'resume' || p === 'suspend') return () => Promise.resolve();
          const v = target[p];
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
    };
  }, { seconds, rate: RATE });
  await page.addScriptTag({ path: AUDIO_JS });
  const b64 = await page.evaluate(async ({ events, fps }) => {
    for (const e of events) {
      window.__t = e.f / fps;
      window.Sfx[e.k](...e.args);
    }
    const buf = await window.__real.startRendering();
    // 16bit ステレオの WAV にする
    const n = buf.length, ch = [buf.getChannelData(0), buf.getChannelData(1)];
    const view = new DataView(new ArrayBuffer(44 + n * 4));
    const str = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); view.setUint32(4, 36 + n * 4, true); str(8, 'WAVEfmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
    view.setUint32(24, buf.sampleRate, true); view.setUint32(28, buf.sampleRate * 4, true);
    view.setUint16(32, 4, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, n * 4, true);
    for (let i = 0, o = 44; i < n; i++) {
      for (const c of ch) {
        view.setInt16(o, Math.max(-1, Math.min(1, c[i])) * 0x7fff, true);
        o += 2;
      }
    }
    const bytes = new Uint8Array(view.buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }, { events, fps: FPS });
  await page.close();
  return Buffer.from(b64, 'base64');
}

const names = process.argv.slice(2);
for (const name of names.length ? names : Object.keys(CLIPS)) await capture(name, CLIPS[name]);
