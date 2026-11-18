// お題ごとの難易度と正解範囲を算出する:  node tools/difficulty.js
//
// プレイヤーが選べる入射角×速度の全域を総当たりし、
//   ・クリアできる割合から難易度の星を決める（public/missions.js の stars に書き写す）
//   ・クリアできる範囲を public/hints.js に書き出す（ゲージのヒント表示用）
'use strict';

const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const Sim = require('../public/sim.js');
const Missions = require('../public/missions.js');

// クリアできる割合（面積比）→ 星
function starsOf(rate) {
  if (rate >= 0.30) return 1;
  if (rate >= 0.12) return 2;
  if (rate >= 0.04) return 3;
  if (rate >= 0.012) return 4;
  return 5;
}

// 浅い角度は結果が急変するので細かく刻む。各マスの中心で1回ずつ試す
const ANGLE_BINS = [];
for (let a = 0; a < 15; a += 0.25) ANGLE_BINS.push([a, a + 0.25]);
for (let a = 15; a < 90; a += 1) ANGLE_BINS.push([a, a + 1]);
const SPEED_STEP = 0.8;
const SPEED_BINS = [];
for (let i = 0; i < 76; i++) SPEED_BINS.push([11.2 + SPEED_STEP * i, 11.2 + SPEED_STEP * (i + 1)]);

function simulate(mass, angle, speedKm) {
  const s = Sim.create(mass, angle, speedKm * 1000);
  let guard = 0;
  while (s.status === 'fly' && guard++ < 100000) Sim.advance(s, 5);
  return {
    status: s.status,
    tnt: (0.5 * s.m * s.speed * s.speed) / Sim.TNT_J_PER_KG,
    speed: s.speed, m: s.m, frac: s.m / s.m0, v0: s.v0, angle: s.angle,
    range: (Math.atan2(s.x, s.y) * Sim.R_EARTH) / 1000,
    hMin: s.hMin / 1000, bound: s.bound,
  };
}

// ワーカー：1つの質量について全マスを計算して返す
if (!isMainThread) {
  const grid = ANGLE_BINS.map(([a0, a1]) =>
    SPEED_BINS.map(([v0, v1]) => simulate(workerData.mass, (a0 + a1) / 2, (v0 + v1) / 2)));
  parentPort.postMessage(grid);
  return;
}

function gridFor(mass) {
  return new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { mass } });
    w.once('message', resolve);
    w.once('error', reject);
  });
}

const round = (x) => Math.round(x * 100) / 100;

// 隣り合うマスをつないで [始点, 終点] の並びにする
function runs(bins, flags) {
  const out = [];
  bins.forEach(([lo, hi], i) => {
    if (!flags[i]) return;
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - lo) < 1e-9) last[1] = hi;
    else out.push([lo, hi]);
  });
  return out.map(([lo, hi]) => [round(lo), round(hi)]);
}

// ヒント用：細い正解範囲がマスの間をすり抜けてできた小さな切れ目はつなぐ
function mergeGaps(list, maxGap) {
  const out = [];
  for (const [lo, hi] of list) {
    const last = out[out.length - 1];
    if (last && lo - last[1] <= maxGap) last[1] = hi;
    else out.push([lo, hi]);
  }
  return out;
}

async function main() {
  const masses = [...new Set(Missions.map((m) => m.mass))];
  const grids = new Map();
  await Promise.all(masses.map(async (mass) => grids.set(mass, await gridFor(mass))));

  const hints = {};
  for (const m of Missions) {
    const grid = grids.get(m.mass);
    let total = 0, clear = 0, best = 0;
    const angleHit = ANGLE_BINS.map(() => false);
    const speedHit = SPEED_BINS.map(() => false);
    const cells = [];
    ANGLE_BINS.forEach(([a0, a1], i) => {
      const flags = grid[i].map((r) => m.ok(r));
      flags.forEach((ok, j) => {
        total += a1 - a0;
        if (!ok) return;
        clear += a1 - a0;
        best = Math.max(best, m.quality(grid[i][j]));
        angleHit[i] = true;
        speedHit[j] = true;
      });
      const r = runs(SPEED_BINS, flags);
      if (r.length) cells.push([a0, a1, [].concat(...r)]);
    });
    hints[m.id] = {
      angle: mergeGaps(runs(ANGLE_BINS, angleHit), 2),
      speed: mergeGaps(runs(SPEED_BINS, speedHit), 2.5),
      cells,
    };

    const rate = clear / total;
    const stars = starsOf(rate);
    const note = stars === m.stars ? '' : '  <- missions.js は ' + m.stars;
    console.log(
      m.id.padEnd(11), (rate * 100).toFixed(2).padStart(6) + ' %',
      '★'.repeat(stars).padEnd(5), '最高評価 ' + best.toFixed(2) + note
    );
  }

  const out =
    '// tools/difficulty.js が生成したファイル。手で編集しない\n' +
    '// お題ごとの正解範囲: angle [度] と speed [km/s] は [始点, 終点] の並び、\n' +
    '// cells は [角度の始点, 終点, [速度の始点, 終点, ...]] の並び\n' +
    '(function (root) {\n  root.Hints = ' + JSON.stringify(hints) + ';\n' +
    "})(typeof window !== 'undefined' ? window : globalThis);\n";
  const file = path.join(__dirname, '..', 'public', 'hints.js');
  fs.writeFileSync(file, out);
  console.log('wrote ' + file + ' (' + out.length + ' bytes)');
}

main();
