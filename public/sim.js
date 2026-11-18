// 大気圏突入の物理シミュレーション（描画には関与しない）
(function (root) {
  'use strict';

  const R_EARTH = 6371e3;        // 地球の平均半径 [m]
  const GM = 3.986004e14;        // 地心重力定数 [m^3/s^2]
  const H_ENTRY = 120e3;         // 突入開始高度 [m]
  const H_EXIT = 400e3;          // ここまで上昇したら離脱と判定 [m]
  const V_MIN = 11.2e3;          // 地球に落ちてくる天体の最低速度（脱出速度）[m/s]
  const V_MAX = 72e3;            // 太陽系天体の最大衝突速度 [m/s]
  const TNT_J_PER_KG = 4.184e6;  // TNT 1 kg のエネルギー [J]

  // 米国標準大気 1976 の密度 [高度 km, 密度 kg/m^3]
  const ATMO = [
    [0, 1.2250], [5, 0.73643], [10, 0.41351], [15, 0.19476], [20, 0.088910],
    [25, 0.040084], [30, 0.018410], [35, 0.0084634], [40, 0.0039957],
    [45, 0.0019663], [50, 0.0010269], [55, 5.6810e-4], [60, 3.0968e-4],
    [65, 1.6321e-4], [70, 8.2829e-5], [75, 3.9921e-5], [80, 1.8458e-5],
    [85, 8.2196e-6], [90, 3.416e-6], [95, 1.393e-6], [100, 5.604e-7],
    [110, 9.708e-8], [120, 2.222e-8], [130, 8.152e-9], [140, 3.831e-9],
    [150, 2.076e-9],
  ];
  const ATMO_H = ATMO.map((a) => a[0] * 1e3);
  const ATMO_LN = ATMO.map((a) => Math.log(a[1]));

  // 石質隕石（普通コンドライト）の平均的な値
  const BODY = {
    density: 3300,   // 密度 [kg/m^3]
    cd: 1.0,         // 抗力係数
    ch: 0.1,         // 熱伝達係数
    q: 8e6,          // アブレーション熱 [J/kg]
    strength: 1e6,   // 破壊強度 [Pa]
    maxSpread: 7,    // 分裂後の広がりの上限（パンケーキモデル）
    minMass: 1e-3,   // これ未満になったら燃え尽きたとみなす [kg]
  };

  // 高度 h [m] の大気密度。表の間は対数補間する
  function airDensity(h) {
    if (h <= 0) return ATMO[0][1];
    const n = ATMO_H.length;
    let i = n - 2;
    if (h < ATMO_H[n - 1]) {
      i = 0;
      while (h >= ATMO_H[i + 1]) i++;
    }
    const t = (h - ATMO_H[i]) / (ATMO_H[i + 1] - ATMO_H[i]);
    return Math.exp(ATMO_LN[i] + (ATMO_LN[i + 1] - ATMO_LN[i]) * t);
  }

  function radiusOf(mass) {
    return Math.cbrt((3 * mass) / (4 * Math.PI * BODY.density));
  }

  // angleDeg: 水平から下向きの入射角 [度]、speed: 突入速度 [m/s]
  function create(mass, angleDeg, speed) {
    const g = (angleDeg * Math.PI) / 180;
    return {
      x: 0, y: R_EARTH + H_ENTRY,
      vx: speed * Math.cos(g), vy: -speed * Math.sin(g),
      m: mass, f: 1, df: 0, t: 0,
      m0: mass, v0: speed, angle: angleDeg,
      e0: 0.5 * mass * speed * speed,
      frag: false, fragAlt: null,
      status: 'fly',            // fly | ground | burn | escape
      alt: H_ENTRY, speed: speed, hMin: H_ENTRY,
      exiting: false, bound: false,
    };
  }

  const Y = new Float64Array(7), Yt = new Float64Array(7);
  const K1 = new Float64Array(7), K2 = new Float64Array(7);
  const K3 = new Float64Array(7), K4 = new Float64Array(7);

  function deriv(y, frag, out) {
    const x = y[0], yy = y[1], vx = y[2], vy = y[3];
    const m = Math.max(y[4], 1e-9), f = y[5];
    const r = Math.hypot(x, yy);
    const rho = airDensity(r - R_EARTH);
    const v = Math.hypot(vx, vy);
    const rm = radiusOf(m);
    const area = Math.PI * rm * rm * f * f;
    const k = (0.5 * BODY.cd * rho * area * v) / m;
    const g = GM / (r * r * r);
    out[0] = vx;
    out[1] = vy;
    out[2] = -g * x - k * vx;
    out[3] = -g * yy - k * vy;
    out[4] = (-0.5 * BODY.ch * rho * area * v * v * v) / BODY.q;
    if (frag && rho * v * v > BODY.strength) {
      // 動圧が強度を上回る間、破片の群れは横に広がる
      const spreading = f < BODY.maxSpread;
      out[5] = spreading ? y[6] : 0;
      out[6] = spreading ? (BODY.cd * rho * v * v) / (4 * BODY.density * rm * rm * f) : 0;
    } else if (frag) {
      // 減速して動圧が下がれば、破片は個別に落ちていく
      out[5] = -(f - 1) / 2;
      out[6] = -y[6] * 10;
    } else {
      out[5] = 0;
      out[6] = 0;
    }
  }

  // シミュレーション時間を dtTotal 秒だけ進める（決着がついたら止まる）
  function advance(s, dtTotal) {
    let remaining = dtTotal;
    let n = 0;
    while (remaining > 0 && s.status === 'fly' && n++ < 20000) {
      Y[0] = s.x; Y[1] = s.y; Y[2] = s.vx; Y[3] = s.vy;
      Y[4] = s.m; Y[5] = s.f; Y[6] = s.df;
      deriv(Y, s.frag, K1);

      // 抗力・質量損失・分裂の時定数より十分小さい刻みにする
      const v = Math.hypot(s.vx, s.vy);
      let dt = Math.min(remaining, 0.1, 100 / Math.max(v, 1));
      const kDrag = Math.hypot(K1[2], K1[3]) / Math.max(v, 1);
      if (kDrag > 0) dt = Math.min(dt, 0.05 / kDrag);
      if (K1[4] < 0) dt = Math.min(dt, (0.05 * s.m) / -K1[4]);
      if (K1[6] > 0) dt = Math.min(dt, 0.1 / Math.sqrt(K1[6]));
      dt = Math.max(dt, 1e-6);

      for (let i = 0; i < 7; i++) Yt[i] = Y[i] + 0.5 * dt * K1[i];
      deriv(Yt, s.frag, K2);
      for (let i = 0; i < 7; i++) Yt[i] = Y[i] + 0.5 * dt * K2[i];
      deriv(Yt, s.frag, K3);
      for (let i = 0; i < 7; i++) Yt[i] = Y[i] + dt * K3[i];
      deriv(Yt, s.frag, K4);
      for (let i = 0; i < 7; i++) {
        Y[i] += (dt / 6) * (K1[i] + 2 * K2[i] + 2 * K3[i] + K4[i]);
      }

      s.x = Y[0]; s.y = Y[1]; s.vx = Y[2]; s.vy = Y[3];
      s.m = Math.max(Y[4], 0); s.f = Y[5]; s.df = Y[6];
      if (s.f >= BODY.maxSpread) { s.f = BODY.maxSpread; s.df = 0; }
      s.t += dt;
      remaining -= dt;

      const r = Math.hypot(s.x, s.y);
      s.alt = r - R_EARTH;
      s.speed = Math.hypot(s.vx, s.vy);
      if (s.alt < s.hMin) s.hMin = s.alt;
      const vr = (s.x * s.vx + s.y * s.vy) / r;
      s.exiting = s.alt > H_ENTRY && vr > 0;

      // 動圧が強度を超えたら分裂が始まる
      if (!s.frag && airDensity(s.alt) * s.speed * s.speed > BODY.strength) {
        s.frag = true;
        s.fragAlt = s.alt;
      }

      if (s.alt <= 0) {
        s.alt = 0;
        s.status = s.m >= BODY.minMass ? 'ground' : 'burn';
      } else if (s.m < BODY.minMass) {
        s.status = 'burn';
      } else if (s.alt > H_EXIT && vr > 0) {
        s.status = 'escape';
        s.bound = 0.5 * s.speed * s.speed - GM / r < 0;
      }
    }
  }

  root.Sim = {
    R_EARTH, GM, H_ENTRY, H_EXIT, V_MIN, V_MAX, TNT_J_PER_KG, BODY, ATMO,
    airDensity, radiusOf, create, advance,
  };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.Sim;
