// お題の定義。ブラウザと tools/difficulty.js（難易度の算出）の両方から読む
//
// 判定に渡す結果 r:
//   status  'ground' | 'burn' | 'escape'
//   tnt     地表到達時のTNT換算 [kg]     speed  衝突（または離脱）速度 [m/s]
//   m       残った質量 [kg]              frac   残った質量の割合
//   v0      突入速度 [m/s]               angle  入射角 [度]
//   range   突入点から落下点までの地表距離 [km]
//   hMin    最低高度 [km]                bound  離脱後に地球を回る軌道か
//
// wants は目標とする結末（省略時は ground）。結果画面の見出しの出し分けに使う
//
// stars は難易度（1〜5）。tools/difficulty.js が出した値を書き写している
(function (root) {
  'use strict';

  const c01 = (x) => Math.min(1, Math.max(0, x));
  const ground = (r) => r.status === 'ground';

  const MISSIONS = [
    {
      id: 'first', title: 'はじめての隕石', mass: 1e4, stars: 1,
      goal: '燃え尽きず、弾かれず、地表まで届けろ',
      show: 'mass',
      ok: (r) => ground(r),
      quality: (r) => c01(r.frac / 0.4),
    },
    {
      id: 'fast-hit', title: '超音速で激突', mass: 1e10, stars: 1,
      goal: '衝突速度 30 km/s 以上で地表に激突させろ',
      show: 'speed',
      ok: (r) => ground(r) && r.speed >= 30e3,
      quality: (r) => c01((r.speed - 30e3) / 30e3),
    },
    {
      id: 'pebble', title: '石ころ配達', mass: 1, stars: 2,
      goal: '100 g 以上を残して地表に届けろ',
      show: 'mass',
      ok: (r) => ground(r) && r.m >= 0.1,
      quality: (r) => c01((r.m - 0.1) / 0.3),
    },
    {
      id: 'dino', title: '恐竜絶滅', mass: 1e15, stars: 3,
      goal: 'TNT換算 5億 Mt 以上の衝突を起こせ',
      show: 'tnt',
      ok: (r) => ground(r) && r.tnt >= 5e17,
      quality: (r) => c01((r.tnt - 5e17) / 1.1e17),
    },
    {
      id: 'max-power', title: '最大火力', mass: 1e9, stars: 3,
      goal: 'TNT換算 10 Mt 以上を地表に届けろ',
      show: 'tnt',
      ok: (r) => ground(r) && r.tnt >= 1e10,
      quality: (r) => c01((r.tnt - 1e10) / 0.6e10),
    },
    {
      id: 'fast-entry', title: 'ぎりぎりの高速突入', mass: 1e5, stars: 3,
      goal: '突入速度 50 km/s 以上で、地表まで届けろ',
      show: 'mass',
      ok: (r) => ground(r) && r.v0 >= 50e3,
      quality: (r) => c01((r.v0 - 50e3) / 4e3),
    },
    {
      id: 'desert', title: '砂漠に落とせ', mass: 1e7, stars: 4,
      goal: '突入点から 300〜350 km 先の砂漠に落とせ',
      show: 'range', target: { range: [300, 350], label: '砂漠' },
      ok: (r) => ground(r) && r.range >= 300 && r.range <= 350,
      quality: (r) => c01(1 - Math.abs(r.range - 325) / 25),
    },
    {
      id: 'hiroshima', title: '広島級を再現', mass: 1e9, stars: 4,
      goal: 'TNT換算 10〜20 kt ちょうどで着弾させろ',
      show: 'tnt',
      ok: (r) => ground(r) && r.tnt >= 1e7 && r.tnt <= 2e7,
      quality: (r) => c01(1 - Math.abs(Math.log10(r.tnt / 1.414e7)) / 0.15),
    },
    {
      id: 'graze', title: '大気をかすめろ', mass: 1e7, stars: 5,
      goal: '高度 60 km 以下まで潜ってから、宇宙へ抜けろ',
      show: 'hmin', wants: 'escape', target: { alt: 60, label: 'ここまで潜れ' },
      ok: (r) => r.status === 'escape' && r.hMin <= 60,
      quality: (r) => c01((60 - r.hMin) / 20),
    },
    {
      id: 'far', title: '遠くへ飛ばせ', mass: 1e4, stars: 5,
      goal: '突入点から 1000 km 以上先に落とせ',
      show: 'range', target: { range: [1000, Infinity], label: '1000 km' },
      ok: (r) => ground(r) && r.range >= 1000,
      quality: (r) => c01((r.range - 1000) / 600),
    },
    {
      id: 'orbit', title: '周回軌道に乗せろ', mass: 1e3, stars: 5,
      goal: '大気でブレーキをかけ、地球を回る軌道に乗せろ',
      show: 'hmin', wants: 'escape',
      ok: (r) => r.status === 'escape' && r.bound,
      quality: (r) => c01((r.speed - 7.6e3) / 3e3),
    },
  ];

  root.Missions = MISSIONS;
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.Missions;
