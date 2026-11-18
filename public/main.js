// 大気圏突入チャレンジ：画面・操作・結果表示
(function () {
  'use strict';

  const Sim = window.Sim;
  const Sfx = window.Sfx;
  const Missions = window.Missions;
  const Hints = window.Hints || {};
  const HINT_ANGLE_AT = 15;  // このミス回数で角度のヒントを出す
  const HINT_SPEED_AT = 30;  // このミス回数で速度のヒントも出す
  const R = Sim.R_EARTH;
  const H_ENTRY = Sim.H_ENTRY;
  const V_MIN = Sim.V_MIN, V_MAX = Sim.V_MAX;
  const TAU = Math.PI * 2;
  const BEST_KEY = 'taikiken.best.v1';
  const PROGRESS_KEY = 'taikiken.missions.v1';
  const DEAD_ZONE = 16; // これより短いドラッグは無視 [px]

  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

  // ---------- 表記 ----------
  function sig(x, n) { return String(Number(x.toPrecision(n || 3))); }

  function jpBig(x) {
    if (x < 1e4) return sig(x);
    if (x < 1e8) return sig(x / 1e4) + '万';
    if (x < 1e12) return sig(x / 1e8) + '億';
    if (x < 1e16) return sig(x / 1e12) + '兆';
    return sig(x / 1e16) + '京';
  }

  function fmtMass(kg) {
    if (kg < 1e-3) return sig(kg * 1e6) + ' mg';
    if (kg < 1) return sig(kg * 1e3) + ' g';
    if (kg < 1e3) return sig(kg) + ' kg';
    return jpBig(kg / 1e3) + ' t';
  }

  function fmtTnt(kg) {
    if (kg < 1e-9) return '1 μg 未満';
    if (kg < 1e-6) return sig(kg * 1e9) + ' μg';
    if (kg < 1e-3) return sig(kg * 1e6) + ' mg';
    if (kg < 1) return sig(kg * 1e3) + ' g';
    if (kg < 1e3) return sig(kg) + ' kg';
    if (kg < 1e6) return sig(kg / 1e3) + ' t';
    if (kg < 1e9) return sig(kg / 1e6) + ' kt';
    return jpBig(kg / 1e9) + ' Mt';
  }

  function fmtLen(m) {
    if (m < 1) return sig(m * 100) + ' cm';
    if (m < 1000) return sig(m) + ' m';
    return sig(m / 1000) + ' km';
  }

  function fmtSpeed(v) {
    if (v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 1 : 2) + ' km/s';
    return Math.round(v) + ' m/s';
  }

  function fmtPct(x) {
    const p = x * 100;
    if (p < 0.01) return '0.01 % 未満';
    return (p >= 10 ? p.toFixed(0) : sig(p, 2)) + ' %';
  }

  // エネルギーの目安 [J]
  const REFS = [
    { e: 126, name: 'プロ野球の速球（150 km/h）' },
    { e: 1.4e5, name: '時速60 kmで走る乗用車' },
    { e: 6.3e5, name: '手榴弾（TNT 約150 g）' },
    { e: 4.184e9, name: 'TNT 1トン爆弾' },
    { e: 6.3e13, name: '広島型原爆（15 kt）' },
    { e: 4.2e16, name: 'ツングースカ大爆発（約10 Mt）' },
    { e: 2.1e17, name: '史上最大の核実験ツァーリ・ボンバ（50 Mt）' },
    { e: 4.2e23, name: '恐竜を絶滅させたチクシュルーブ衝突（約1億 Mt）' },
  ];

  function compare(e) {
    let ref = REFS[0];
    for (const r of REFS) if (e >= r.e) ref = r;
    const ratio = e / ref.e;
    if (ratio >= 1) return ref.name + 'の約 ' + jpBig(ratio) + ' 倍';
    return ref.name + 'の約 ' + jpBig(1 / ratio) + ' 分の1';
  }

  function grade(tntKg) {
    if (tntKg < 1e-3) return 'コツン級';
    if (tntKg < 1) return '花火級';
    if (tntKg < 1e3) return '爆弾級';
    if (tntKg < 1e6) return '大型爆弾級';
    if (tntKg < 1e9) return '核兵器級';
    if (tntKg < 1e13) return '水爆級';
    if (tntKg < 1e16) return '文明崩壊級';
    return '大量絶滅級';
  }

  // ---------- 状態 ----------
  let W = 0, H = 0, dpr = 1;
  const view = { mx: 0, my: 0, groundY: 0, base: 1, lmax: 200 };
  const cam = { phi: 0, scale: 1 };

  let phase = 'aim';   // aim | fly | end
  let sim = null;
  let logMass = 4;
  let mission = null;  // 挑戦中のお題。null なら実験室（質量を自由に選ぶ）
  let drag = null;     // ドラッグ中の指の位置
  let aim = null;      // { angle[度], speed[km/s], len[px], valid }
  let lastTry = null;
  let trail = [];
  let sparks = [];
  let effects = [];
  let popup = null;
  let shake = 0;
  let endTimer = 0;
  let pendingResult = null;
  let clock = 0;
  let flyTime = 0;     // 突入してからの実時間 [s]
  let exitSounded = false;

  const stars = [];
  for (let i = 0; i < 150; i++) {
    stars.push({ x: Math.random(), y: Math.random(), r: 0.4 + Math.random() * 1.1, a: 0.25 + Math.random() * 0.7 });
  }

  function loadBest() {
    try { return JSON.parse(localStorage.getItem(BEST_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveBest(b) {
    try { localStorage.setItem(BEST_KEY, JSON.stringify(b)); } catch (e) { /* 保存できなくても遊べる */ }
  }
  const best = loadBest();

  // お題ごとの記録 { tries: 今回の挑戦回数, misses: 通算のミス回数, bestTries: 最少クリア回数, rating: 最高評価 }
  let progress = {};
  try { progress = JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; } catch (e) { /* 記録なしで始める */ }
  function saveProgress() {
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch (e) { /* 保存できなくても遊べる */ }
  }
  const starStr = (n, max) => '★'.repeat(n) + '☆'.repeat(max - n);

  // ゲージに出すヒントの段階: 0 なし / 1 角度 / 2 角度と速度 / 3 正解の範囲そのもの（星3達成後）
  function hintLevel() {
    if (!mission || !Hints[mission.id]) return 0;
    const p = progress[mission.id] || {};
    if (p.rating === 3) return 3;
    if ((p.misses || 0) >= HINT_SPEED_AT) return 2;
    if ((p.misses || 0) >= HINT_ANGLE_AT) return 1;
    return 0;
  }

  function hintText() {
    const level = hintLevel();
    if (!level) return '';
    if (level === 3) return '<span class="gold">★3達成：ゲージの金色が正解の範囲</span>';
    const h = Hints[mission.id];
    const join = (list) => list.map((r) => r[0] + '〜' + r[1]).join('、');
    let html = 'ヒント：入射角 ' + join(h.angle) + '°';
    if (level === 2) html += '　<span class="spd">速度 ' + join(h.speed) + ' km/s</span>';
    return html;
  }

  // ---------- レイアウト ----------
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    view.mx = Math.max(64, W * 0.28);
    view.my = Math.min(Math.max(200, H * 0.27), H * 0.5);
    view.groundY = H * 0.9;
    view.base = (view.groundY - view.my) / H_ENTRY;
    view.lmax = clamp(Math.min(W, H) * 0.5, 130, 340);
    if (!sim) cam.scale = view.base;
  }

  // 地心からの角度 phi と高度 h [m] を画面座標へ
  function project(phi, h) {
    const r = (R + h) * cam.scale;
    const a = phi - cam.phi;
    return {
      x: view.mx + r * Math.sin(a),
      y: view.groundY + R * cam.scale - r * Math.cos(a),
    };
  }

  function meteorPos() {
    if (!sim) return { x: view.mx, y: view.my };
    return project(Math.atan2(sim.x, sim.y), sim.alt);
  }

  // 発光の強さ 0〜1（空力加熱 ρv³ の対数）
  function glowOf(s) {
    const q = Sim.airDensity(s.alt) * Math.pow(s.speed, 3);
    return clamp((Math.log10(q + 1) - 6.2) / 4, 0, 1);
  }

  const sizeFactor = () => 1 + 0.11 * logMass;

  // ---------- 操作 ----------
  function updateAim() {
    const dx = drag.x - drag.sx, dy = drag.y - drag.sy;
    const len = Math.hypot(dx, dy);
    const ang = clamp(Math.atan2(dy, dx), 0, Math.PI / 2);
    const t = clamp((len - DEAD_ZONE) / (view.lmax - DEAD_ZONE), 0, 1);
    aim = {
      angle: Math.round(((ang * 180) / Math.PI) * 10) / 10,
      speed: Math.round(((V_MIN + t * (V_MAX - V_MIN)) / 1000) * 10) / 10,
      len: Math.min(len, view.lmax),
      valid: len >= DEAD_ZONE,
    };
    $('aimAngle').textContent = aim.angle.toFixed(1);
    $('aimSpeed').textContent = aim.speed.toFixed(1);
    $('aim').hidden = !aim.valid;
    Sfx.aim(aim.valid ? t : null);
    $('hint').hidden = aim.valid;
  }

  canvas.addEventListener('pointerdown', (e) => {
    Sfx.unlock();
    if (phase !== 'aim' || drag || isModal()) return;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 捕捉できなくても続行 */ }
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY };
    updateAim();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.x = e.clientX;
    drag.y = e.clientY;
    updateAim();
  });
  function endDrag(e, fire) {
    if (!drag || e.pointerId !== drag.id) return;
    const a = aim;
    drag = null;
    aim = null;
    $('aim').hidden = true;
    Sfx.aim(null);
    if (fire && a && a.valid) launch(a.angle, a.speed);
    else $('hint').hidden = false;
  }
  canvas.addEventListener('pointerup', (e) => endDrag(e, true));
  canvas.addEventListener('pointercancel', (e) => endDrag(e, false));

  $('mass').addEventListener('input', () => {
    logMass = Number($('mass').value);
    updateMassLabel();
    if (phase === 'end') reset();
  });
  $('retry').addEventListener('click', reset);

  // ---------- シェア ----------
  // スマホは端末の共有シートで好きなSNSを選べるようにし、PCは X の投稿画面を開く
  let shareText = '';
  const SHARE_URL = (document.querySelector('meta[property="og:url"]') || {}).content || location.href;
  const useShareSheet = () => !!navigator.share && matchMedia('(pointer: coarse)').matches;
  $('share').addEventListener('click', () => {
    if (!shareText) return;
    if (useShareSheet()) {
      navigator.share({ text: shareText, url: SHARE_URL }).catch(() => { /* 閉じられただけなら何もしない */ });
      return;
    }
    const q = new URLSearchParams({ text: shareText, url: SHARE_URL });
    window.open('https://twitter.com/intent/tweet?' + q, '_blank', 'noopener');
  });
  $('next').addEventListener('click', () => setMission(Missions.indexOf(mission) + 1));
  // ---------- 画面スタック ----------
  // 一番上の画面だけを表示・操作でき、閉じると下の画面とフォーカスが戻る。
  // 結果パネルは土台、お題一覧と計算モデルはその上に重なるモーダル。
  const stack = [];
  const isModal = () => stack.length > 0 && stack[stack.length - 1].el.id !== 'result';
  function defaultFocus(el) {
    if (el.id === 'result') return $('next').hidden ? $('retry') : $('next');
    if (el.id === 'list') return el.querySelector('#listItems .cur') || el.querySelector('#listItems button');
    return $('infoClose');
  }
  function showTop(focusEl) {
    const top = stack[stack.length - 1];
    for (const s of stack) s.el.hidden = s !== top;
    // モーダルの間は上部のボタンも止め、フォーカスが背後へ抜けないようにする
    $('top').inert = isModal();
    if (top) (focusEl || defaultFocus(top.el)).focus();
  }
  function openScreen(id) {
    if (stack.some((s) => s.el.id === id)) return;
    showVolume(false);
    stack.push({ el: $(id), back: document.activeElement });
    showTop();
  }
  function closeScreen() {
    const s = stack.pop();
    if (!s) return;
    s.el.hidden = true;
    const top = stack[stack.length - 1];
    const back = s.back && top && top.el.contains(s.back) ? s.back : null;
    showTop(back);
    if (!top) {
      $('top').inert = false;
      if (s.back && s.back.isConnected) s.back.focus();
    }
  }
  function clearScreens() {
    while (stack.length) stack.pop().el.hidden = true;
    $('top').inert = false;
  }
  function toggleScreen(id) {
    const top = stack[stack.length - 1];
    if (top && top.el.id === id) closeScreen();
    else openScreen(id);
  }

  $('listBtn').addEventListener('click', () => {
    if (phase === 'fly') return;
    renderList();
    toggleScreen('list');
  });
  $('listClose').addEventListener('click', closeScreen);
  $('labBtn').addEventListener('click', () => setMission(-1));
  $('listItems').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn) setMission(Number(btn.dataset.i));
  });
  function updateVolume() {
    const v = Sfx.getVolume();
    $('soundBtn').textContent = v === 0 ? '🔇' : v < 0.5 ? '🔉' : '🔊';
    $('volume').value = Math.round(v * 100);
    $('volLabel').textContent = Math.round(v * 100) + '%';
  }
  function showVolume(show) {
    $('volBox').hidden = !show;
    $('soundBtn').setAttribute('aria-expanded', String(show));
  }
  $('soundBtn').addEventListener('click', () => {
    Sfx.unlock();
    showVolume($('volBox').hidden);
  });
  $('volume').addEventListener('input', () => {
    Sfx.unlock();
    Sfx.setVolume(Number($('volume').value) / 100);
    updateVolume();
  });
  // 離したときに試し鳴らしで大きさを確かめられるようにする
  $('volume').addEventListener('change', () => Sfx.result(true));
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('#volBox, #soundBtn')) showVolume(false);
  });
  updateVolume();
  $('infoBtn').addEventListener('click', () => toggleScreen('info'));
  $('infoClose').addEventListener('click', closeScreen);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('volBox').hidden) {
        showVolume(false);
        $('soundBtn').focus();
      } else if (isModal()) {
        closeScreen();
      }
      return;
    }
    // ボタンにフォーカスがあるときはそのボタンの動作に任せる
    if (e.target.closest && e.target.closest('button, input')) return;
    if ((e.key === 'Enter' || e.key === ' ') && phase === 'end' && !$('result').hidden) reset();
  });

  function updateMassLabel() {
    const m = Math.pow(10, logMass);
    let html = '<b>' + fmtMass(m) + '</b>　直径 ' + fmtLen(2 * Sim.radiusOf(m)) + ' の石質隕石';
    const b = best[logMass];
    if (b) html += '　ベスト ' + fmtTnt(b.tnt);
    $('massLabel').innerHTML = html;
  }

  // 画面上部：お題（または実験室の質量スライダー）
  function updateHeader() {
    $('missionBox').hidden = !mission;
    $('massBox').hidden = !!mission;
    if (!mission) {
      updateMassLabel();
      return;
    }
    const p = progress[mission.id] || {};
    $('mNo').textContent = 'お題 ' + (Missions.indexOf(mission) + 1) + '/' + Missions.length;
    $('mTitle').textContent = mission.title;
    $('mStars').textContent = starStr(mission.stars, 5);
    $('mGoal').textContent = mission.goal;
    $('mInfo').innerHTML = '隕石 ' + fmtMass(mission.mass) + '（直径 ' + fmtLen(2 * Sim.radiusOf(mission.mass)) + '）　挑戦 ' +
      ((p.tries || 0) + 1) + ' 回目' + (p.rating ? '　クリア済 <span class="rate">' + starStr(p.rating, 3) + '</span>' : '');
  }

  function renderList() {
    $('listItems').innerHTML = Missions.map((m, i) => {
      const p = progress[m.id] || {};
      const state = p.rating
        ? '<span class="state">クリア <span class="rate">' + starStr(p.rating, 3) + '</span>　最少 ' + p.bestTries + ' 回</span>'
        : '';
      return '<button type="button" data-i="' + i + '"' + (m === mission ? ' class="cur"' : '') + '>' +
        '<span class="no">' + (i + 1) + '</span><span>' + m.title + '</span>' +
        '<span class="dstars">' + starStr(m.stars, 5) + '</span>' + state + '</button>';
    }).join('');
  }

  // i が範囲外なら実験室
  function setMission(i) {
    mission = Missions[i] || null;
    logMass = mission ? Math.log10(mission.mass) : Number($('mass').value);
    progress._last = mission ? mission.id : '_lab';
    saveProgress();
    lastTry = null;
    reset();
  }

  // ---------- 進行 ----------
  function launch(angle, speedKm) {
    if (mission) {
      const p = progress[mission.id] || (progress[mission.id] = {});
      p.tries = (p.tries || 0) + 1;
      saveProgress();
    }
    sim = Sim.create(Math.pow(10, logMass), angle, speedKm * 1000);
    phase = 'fly';
    flyTime = 0;
    exitSounded = false;
    Sfx.launch();
    Sfx.roarStart();
    trail = [];
    sparks = [];
    effects = [];
    popup = null;
    $('hint').hidden = true;
    $('hud').hidden = false;
    $('mass').disabled = true;
  }

  function reset() {
    phase = 'aim';
    Sfx.roarStop();
    sim = null;
    trail = [];
    sparks = [];
    effects = [];
    popup = null;
    pendingResult = null;
    cam.phi = 0;
    cam.scale = view.base;
    clearScreens();
    $('hud').hidden = true;
    $('hint').hidden = false;
    $('mass').disabled = false;
    $('lastTry').textContent = lastTry ? '前回：' + lastTry : '';
    $('hintLine').innerHTML = hintText();
    updateHeader();
  }

  function finish() {
    const s = sim;
    const phi = Math.atan2(s.x, s.y);
    const energy = 0.5 * s.m * s.speed * s.speed;
    const tnt = energy / Sim.TNT_J_PER_KG;
    const cond = s.angle.toFixed(1) + '° / ' + (s.v0 / 1000).toFixed(1) + ' km/s';
    const rows = [['突入条件', cond]];
    const fragRow = ['分裂', s.fragAlt === null ? 'なし' : '高度 ' + (s.fragAlt / 1000).toFixed(0) + ' km で開始'];
    Sfx.roarStop();
    // お題の判定に渡す結果（missions.js の説明を参照）
    const r = {
      status: s.status, tnt: tnt, speed: s.speed, m: s.m, frac: s.m / s.m0, v0: s.v0, angle: s.angle,
      range: (phi * R) / 1000, hMin: s.hMin / 1000, bound: s.bound,
    };
    const res = { ok: false, title: '', lead: '', tip: '', big: '', cmp: '', rows: rows, bestMsg: '', next: false, key: '' };
    let short;

    if (s.status === 'ground') {
      const mag = clamp((Math.log10(energy + 1) - 1) / 22, 0.02, 1);
      effects.push({ type: 'impact', phi: phi, h: 0, t: 0, dur: 0.9 + mag * 1.8, mag: mag });
      shake = 4 + mag * 22;
      Sfx.impact(mag);
      res.ok = true;
      res.title = '地表に到達！';
      res.lead = s.speed > 3000 ? '超音速のまま地面に激突しました。' : '減速しきって、隕石として落下しました。';
      res.cmp = compare(energy);
      rows.push(['TNT換算', fmtTnt(tnt) + '（' + grade(tnt) + '）', 'tnt']);
      rows.push(['衝突速度', fmtSpeed(s.speed), 'speed']);
      rows.push(['残った質量', fmtMass(s.m) + '（' + fmtPct(r.frac) + '）', 'mass']);
      rows.push(['飛距離', Math.round(r.range) + ' km', 'range']);
      rows.push(fragRow);
      short = '着地 ' + fmtTnt(tnt);
    } else if (s.status === 'burn') {
      effects.push({ type: 'burn', phi: phi, h: s.alt, t: 0, dur: 1.1 });
      Sfx.burn();
      res.title = '燃え尽きた…';
      res.lead = '高度 ' + (s.alt / 1000).toFixed(0) + ' km で燃え尽きました。';
      res.tip = '速度を落とすと燃え残りやすくなります。';
      rows.push(fragRow);
      rows.push(['大気中で放出', 'TNT換算 ' + fmtTnt(s.e0 / Sim.TNT_J_PER_KG)]);
      short = '燃え尽き';
    } else {
      res.title = '宇宙へ弾かれた…';
      res.lead = '最低高度 ' + r.hMin.toFixed(0) + ' km をかすめて大気圏を離脱しました。' +
        (s.bound ? '減速して、地球を回る軌道に入りました。' : '');
      res.tip = '入射角をもう少し深くしてみましょう。';
      rows.push(['最低高度', r.hMin.toFixed(1) + ' km', 'hmin']);
      rows.push(['離脱時の速度', fmtSpeed(s.speed)]);
      rows.push(['残った質量', fmtPct(r.frac)]);
      short = '弾かれた（最低高度 ' + r.hMin.toFixed(0) + ' km）';
    }

    if (mission) judge(res, r);
    else recordLab(res, s, tnt);
    lastTry = cond + ' → ' + short;

    phase = 'end';
    endTimer = s.status === 'ground' ? 1.3 : 0.9;
    pendingResult = res;
    $('hud').hidden = true;
  }

  // お題の達成判定と、評価・チャレンジ回数の記録
  function judge(res, r) {
    const p = progress[mission.id] || (progress[mission.id] = { tries: 1 });
    const wants = mission.wants || 'ground';
    res.key = mission.show;
    res.ok = mission.ok(r);
    if (res.ok) {
      const q = mission.quality(r);
      const rating = 1 + (q >= 0.4 ? 1 : 0) + (q >= 0.8 ? 1 : 0);
      res.title = 'お題クリア！';
      res.big = '評価<b class="rate">' + starStr(rating, 3) + '</b>';
      res.bestMsg = 'チャレンジ ' + p.tries + ' 回目でクリア！';
      if (p.bestTries) res.bestMsg += '（これまでの最少 ' + p.bestTries + ' 回）';
      p.bestTries = p.bestTries ? Math.min(p.bestTries, p.tries) : p.tries;
      if (rating === 3 && p.rating !== 3) res.bestMsg += '　★3達成：ゲージに正解の範囲が出ます';
      p.rating = Math.max(p.rating || 0, rating);
      res.share = '大気圏突入チャレンジ お題' + (Missions.indexOf(mission) + 1) + '「' + mission.title + '」をクリア！\n' +
        '評価 ' + starStr(rating, 3) + '（' + p.tries + ' 回目）\n#大気圏突入チャレンジ';
      p.tries = 0;
      res.next = Missions.indexOf(mission) < Missions.length - 1;
    } else {
      if (r.status === wants) res.title = 'お題未達成';
      else if (r.status === 'ground') res.title = '地表に落ちてしまった…';
      res.bestMsg = 'チャレンジ ' + p.tries + ' 回目';
      p.misses = (p.misses || 0) + 1;
      if (!p.rating || p.rating < 3) {
        if (p.misses === HINT_ANGLE_AT) res.bestMsg += '　ミス' + HINT_ANGLE_AT + '回：ゲージに入射角のヒントが出ます';
        if (p.misses === HINT_SPEED_AT) res.bestMsg += '　ミス' + HINT_SPEED_AT + '回：速度のヒントも出ます';
      }
    }
    saveProgress();
  }

  // 実験室：質量ごとの最大TNTを自己ベストとして残す
  function recordLab(res, s, tnt) {
    if (res.tip) res.lead += res.tip;
    if (s.status !== 'ground') return;
    res.big = 'TNT換算<b>' + fmtTnt(tnt) + '</b><span class="grade">' + grade(tnt) + '</span>';
    res.rows = res.rows.filter((row) => row[2] !== 'tnt');
    const prev = best[logMass];
    if (!prev || tnt > prev.tnt) {
      best[logMass] = { tnt: tnt, angle: s.angle, speed: s.v0 / 1000 };
      saveBest(best);
      res.bestMsg = prev ? '自己ベスト更新！（これまで ' + fmtTnt(prev.tnt) + '）' : 'この質量での初記録！';
    } else {
      res.bestMsg = 'この質量の自己ベスト：' + fmtTnt(prev.tnt) + '（' + prev.angle.toFixed(1) + '° / ' + prev.speed.toFixed(1) + ' km/s）';
    }
  }

  function showResult(res) {
    const el = $('result');
    el.className = res.ok ? 'ok' : 'ng';
    $('resTitle').textContent = res.title;
    $('resLead').textContent = res.lead;
    $('resBig').innerHTML = res.big;
    $('resBig').hidden = !res.big;
    $('resCmp').textContent = res.cmp;
    $('resCmp').hidden = !res.cmp;
    $('resRows').innerHTML = res.rows.map((r) => {
      const cls = r[2] && r[2] === res.key ? ' class="key"' : '';
      return '<dt' + cls + '>' + r[0] + '</dt><dd' + cls + '>' + r[1] + '</dd>';
    }).join('');
    $('resBest').textContent = res.bestMsg;
    $('resBest').hidden = !res.bestMsg;
    $('next').hidden = !res.next;
    $('retry').className = res.next ? 'sub' : '';
    shareText = res.share || '';
    $('share').hidden = !shareText;
    $('share').textContent = useShareSheet() ? '結果をシェア' : '結果を X でシェア';
    // モーダルが開いていれば、その下に置いて閉じたときに出す
    stack.unshift({ el: el, back: null });
    if (stack.length === 1) showTop();
    Sfx.result(res.ok);
    $('mass').disabled = false;
    updateHeader();
  }

  function update(dt) {
    clock += dt;
    shake *= Math.pow(0.02, dt);

    for (const e of effects) e.t += dt;
    effects = effects.filter((e) => e.t < e.dur);
    for (const p of sparks) p.life -= dt;
    sparks = sparks.filter((p) => p.life > 0);
    if (popup && (popup.t += dt) > 1.4) popup = null;

    if (phase === 'fly') {
      // 画面上の動きが遅すぎず速すぎないよう、再生速度を変える
      const want = (H / 800) * (70 + 330 * Math.sqrt(Math.min(sim.speed, V_MAX) / V_MAX));
      // カメラは水平方向に追従するので、上下の動きを主な基準にする。長引くほど早送り
      const vr = Math.abs(sim.x * sim.vx + sim.y * sim.vy) / Math.hypot(sim.x, sim.y);
      const seen = vr + 0.08 * Math.sqrt(Math.max(sim.speed * sim.speed - vr * vr, 0));
      flyTime += dt;
      const boost = 1 + Math.max(0, flyTime - 6) * 0.5;
      const warp = clamp((want / Math.max(seen * cam.scale, 1e-9)) * boost, 0.3, 3000);
      const wasFrag = sim.frag;
      Sim.advance(sim, dt * warp);

      const phi = Math.atan2(sim.x, sim.y);
      cam.phi = phi;
      cam.scale = (view.groundY - view.my) / Math.max(H_ENTRY, sim.alt);

      const b = glowOf(sim);
      trail.push({ phi: phi, h: sim.alt, b: b });
      Sfx.roar(b);
      if (sim.exiting && !exitSounded) {
        exitSounded = true;
        Sfx.escape();
      }
      if (trail.length > 900) trail.shift();
      const n = Math.floor(b * 3 + Math.random());
      for (let i = 0; i < n; i++) {
        const spread = ((6 + 20 * b) * sizeFactor()) / cam.scale;
        sparks.push({
          phi: phi + ((Math.random() - 0.5) * spread) / R,
          h: sim.alt + (Math.random() - 0.5) * spread,
          life: 0.3 + Math.random() * 0.5,
          max: 0.8,
        });
      }
      if (!wasFrag && sim.frag) {
        effects.push({ type: 'flash', phi: phi, h: sim.alt, t: 0, dur: 0.45 });
        popup = { text: '分裂！', phi: phi, h: sim.alt, t: 0 };
        Sfx.frag();
      }

      $('hudAlt').textContent = (sim.alt / 1000).toFixed(1) + ' km';
      $('hudSpeed').textContent = fmtSpeed(sim.speed);
      $('hudMass').textContent = fmtPct(sim.m / sim.m0);
      $('hudRange').textContent = Math.round((phi * R) / 1000) + ' km';
      $('hudWarp').textContent = '×' + (warp >= 10 ? warp.toFixed(0) : warp.toFixed(1));

      if (sim.status !== 'fly') finish();
    } else if (phase === 'end' && pendingResult) {
      endTimer -= dt;
      if (endTimer <= 0) {
        showResult(pendingResult);
        pendingResult = null;
      }
    }
  }

  // ---------- 描画 ----------
  function heat(b, a) {
    const g = Math.round(110 + 145 * b);
    const bl = Math.round(30 + 225 * b * b);
    return 'rgba(255,' + g + ',' + bl + ',' + a + ')';
  }

  // 整数から 0〜1 の疑似乱数（雲や陸地の配置用）
  function hash(k) {
    const x = Math.sin(k * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function drawBackground() {
    ctx.fillStyle = '#05060f';
    ctx.fillRect(-40, -40, W + 80, H + 80);
    const shift = cam.phi * R * view.base * 0.03;
    for (const s of stars) {
      const x = (((s.x * W - shift) % W) + W) % W;
      // 大気の濃い低空ほど星は見えなくなる
      ctx.globalAlpha = s.a * clamp((0.85 - s.y) * 4, 0, 1);
      ctx.fillStyle = '#fff';
      ctx.fillRect(x, s.y * view.groundY, s.r, s.r);
    }
    ctx.globalAlpha = 1;
  }

  function drawEarth() {
    const cx = view.mx;
    const cy = view.groundY + R * cam.scale;
    const r0 = R * cam.scale;
    const top = 130e3;
    const r1 = (R + top) * cam.scale;

    // 大気：高度とともに薄くなるグラデーション
    const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
    g.addColorStop(0, 'rgba(140,195,255,0.78)');
    g.addColorStop(11 / 130, 'rgba(90,150,245,0.52)');
    g.addColorStop(50 / 130, 'rgba(50,90,205,0.24)');
    g.addColorStop(85 / 130, 'rgba(40,60,165,0.09)');
    g.addColorStop(1, 'rgba(30,40,120,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r1, 0, TAU);
    ctx.fill();

    // 雲
    const zoom = cam.scale / view.base;
    const gap = 40e3;
    const k0 = Math.floor((cam.phi * R) / gap);
    const span = Math.ceil(W / (gap * cam.scale)) + 2;
    if (span < 200) {
      ctx.fillStyle = 'rgba(255,255,255,' + 0.2 * clamp(zoom * 1.5, 0, 1) + ')';
      for (let k = k0 - span; k <= k0 + span; k++) {
        if (hash(k) > 0.65) continue;
        const phi = ((k + hash(k + 0.5)) * gap) / R;
        const p = project(phi, 2e3 + hash(k + 0.2) * 9e3);
        const w = (12e3 + hash(k + 0.7) * 30e3) * cam.scale;
        const t = (1.2e3 + hash(k + 0.9) * 1.6e3) * cam.scale;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, w / 2, Math.max(t / 2, 1), phi - cam.phi, 0, TAU);
        ctx.fill();
      }
    }

    // 地球本体
    const eg = ctx.createLinearGradient(0, view.groundY, 0, view.groundY + H * 0.3);
    eg.addColorStop(0, '#1d5a8c');
    eg.addColorStop(1, '#071a2e');
    ctx.fillStyle = eg;
    ctx.beginPath();
    ctx.arc(cx, cy, r0, 0, TAU);
    ctx.fill();

    // 陸地（地表に沿った帯）
    const seg = 90e3;
    const s0 = Math.floor((cam.phi * R) / seg);
    const sspan = Math.ceil(W / (seg * cam.scale)) + 2;
    if (sspan < 200) {
      ctx.strokeStyle = '#3f7a4a';
      ctx.lineWidth = Math.max(2, 5 * zoom);
      ctx.lineCap = 'butt';
      for (let k = s0 - sspan; k <= s0 + sspan; k++) {
        if (hash(k * 3 + 0.3) < 0.55) continue;
        ctx.beginPath();
        for (let i = 0; i <= 4; i++) {
          const p = project(((k + i / 4) * seg) / R, 0);
          if (i === 0) ctx.moveTo(p.x, p.y + ctx.lineWidth / 2);
          else ctx.lineTo(p.x, p.y + ctx.lineWidth / 2);
        }
        ctx.stroke();
      }
    }

    // 大気の層の境界と名前
    const alpha = clamp((zoom - 0.45) * 2.5, 0, 1);
    if (alpha <= 0) return;
    const lines = [[11, ''], [50, ''], [85, ''], [100, 'カーマン・ライン']];
    const names = [[5, '対流圏'], [30, '成層圏'], [67, '中間圏'], [110, '熱圏']];
    const yAt = (km, x) => {
      const rr = (R + km * 1e3) * cam.scale;
      const dx = x - cx;
      return cy - Math.sqrt(Math.max(rr * rr - dx * dx, 0));
    };
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (const [km, label] of lines) {
      const rr = (R + km * 1e3) * cam.scale;
      const half = Math.min(Math.PI, (1.5 * W) / rr);
      ctx.strokeStyle = 'rgba(255,255,255,' + (km === 100 ? 0.35 : 0.14) * alpha + ')';
      ctx.lineWidth = 1;
      ctx.setLineDash(km === 100 ? [6, 6] : [2, 6]);
      ctx.beginPath();
      ctx.arc(cx, cy, rr, -Math.PI / 2 - half, -Math.PI / 2 + half);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,' + 0.55 * alpha + ')';
      ctx.textAlign = 'left';
      ctx.fillText(km + ' km' + (label ? '  ' + label : ''), 8, yAt(km, 8) - 8);
    }
    ctx.setLineDash([]);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,' + 0.4 * alpha + ')';
    for (const [km, name] of names) ctx.fillText(name, W - 8, yAt(km, W - 8));
  }

  // 地表の距離の目盛りと、お題の目標
  function drawMarks() {
    const zoom = cam.scale / view.base;
    const cx = view.mx;
    const cy = view.groundY + R * cam.scale;
    const camKm = (cam.phi * R) / 1000;
    const halfKm = W / cam.scale / 1000;
    const from = camKm - halfKm, to = camKm + halfKm;
    const thick = Math.max(2, 5 * zoom);

    if (zoom > 0.3) {
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      for (let km = Math.max(100, Math.ceil(from / 100) * 100); km <= to; km += 100) {
        const p = project((km * 1000) / R, 0);
        ctx.fillRect(p.x - 0.5, p.y + thick, 1, 6);
        ctx.fillText(km + ' km', p.x, p.y + thick + 15);
      }
    }

    const t = mission && mission.target;
    if (!t) return;
    ctx.font = 'bold 12px system-ui, sans-serif';
    if (t.range) {
      const a = Math.max(t.range[0], from), b = Math.min(t.range[1], to);
      ctx.strokeStyle = '#ffc93c';
      ctx.fillStyle = '#ffc93c';
      if (b > a) {
        ctx.lineWidth = thick + 2;
        ctx.lineCap = 'butt';
        ctx.beginPath();
        for (let i = 0; i <= 16; i++) {
          const p = project(((a + ((b - a) * i) / 16) * 1000) / R, 0);
          if (i === 0) ctx.moveTo(p.x, p.y + thick / 2);
          else ctx.lineTo(p.x, p.y + thick / 2);
        }
        ctx.stroke();
      }
      // 目標の両端に旗を立てる
      let labeled = false;
      for (const km of t.range) {
        if (km < from || km > to) continue;
        const p = project((km * 1000) / R, 0);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x, p.y - 26);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 26);
        ctx.lineTo(p.x + 11, p.y - 21);
        ctx.lineTo(p.x, p.y - 16);
        ctx.fill();
        if (!labeled) {
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(t.label, p.x + 4, p.y - 36);
          labeled = true;
        }
      }
    }
    if (t.alt) {
      const rr = (R + t.alt * 1e3) * cam.scale;
      const half = Math.min(Math.PI, (1.5 * W) / rr);
      ctx.strokeStyle = 'rgba(255,201,60,0.85)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([10, 6]);
      ctx.beginPath();
      ctx.arc(cx, cy, rr, -Math.PI / 2 - half, -Math.PI / 2 + half);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffc93c';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.alt + ' km  ' + t.label, W * 0.6, cy - Math.sqrt(Math.max(rr * rr - Math.pow(W * 0.6 - cx, 2), 0)) + 12);
    }
  }

  function drawTrail() {
    const n = trail.length;
    if (n < 2) return;
    const sf = sizeFactor();
    ctx.lineCap = 'round';
    let p0 = project(trail[0].phi, trail[0].h);
    for (let i = 1; i < n; i++) {
      const t = trail[i];
      const p1 = project(t.phi, t.h);
      if (p1.x > -60 || p0.x > -60) {
        const age = i / n;
        ctx.strokeStyle = heat(t.b, 0.06 + t.b * (0.15 + 0.85 * age * age));
        ctx.lineWidth = 1.2 + 7 * t.b * sf * (0.3 + 0.7 * age);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
      p0 = p1;
    }
  }

  function drawSparks() {
    for (const p of sparks) {
      const q = project(p.phi, p.h);
      ctx.fillStyle = heat(0.8, clamp(p.life / p.max, 0, 1));
      ctx.fillRect(q.x - 1, q.y - 1, 2, 2);
    }
  }

  function drawMeteor() {
    if (sim && sim.status !== 'fly') return;
    const p = meteorPos();
    const sf = sizeFactor();
    const b = sim ? glowOf(sim) : 0;
    if (b > 0.01) {
      const rg = (8 + 30 * b) * sf;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rg);
      g.addColorStop(0, 'rgba(255,255,255,' + (0.5 + 0.5 * b) + ')');
      g.addColorStop(0.25, heat(b, 0.85));
      g.addColorStop(1, heat(b * 0.5, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rg, 0, TAU);
      ctx.fill();
    }
    // 岩のかたまり
    const rr = (3 + 1.1 * logMass) * (sim ? Math.cbrt(Math.max(sim.m / sim.m0, 0.03)) : 1);
    ctx.fillStyle = b > 0.4 ? '#ffe9c4' : '#8a7f72';
    ctx.beginPath();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      const r = rr * (0.8 + 0.3 * hash(i + logMass * 7));
      if (i === 0) ctx.moveTo(p.x + r * Math.cos(a), p.y + r * Math.sin(a));
      else ctx.lineTo(p.x + r * Math.cos(a), p.y + r * Math.sin(a));
    }
    ctx.closePath();
    ctx.fill();
    if (b <= 0.4) {
      ctx.fillStyle = '#5d554c';
      ctx.beginPath();
      ctx.arc(p.x - rr * 0.25, p.y + rr * 0.15, rr * 0.28, 0, TAU);
      ctx.fill();
    }
  }

  function drawArrow(x0, y0, ang, len, color, width) {
    const x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
    const head = Math.min(16, len * 0.4);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1 - Math.cos(ang) * head * 0.6, y1 - Math.sin(ang) * head * 0.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - Math.cos(ang - 0.45) * head, y1 - Math.sin(ang - 0.45) * head);
    ctx.lineTo(x1 - Math.cos(ang + 0.45) * head, y1 - Math.sin(ang + 0.45) * head);
    ctx.closePath();
    ctx.fill();
  }

  // 速度 [km/s] をゲージ上の半径 [px] に
  function gaugeRadius(speedKm) {
    const t = (speedKm * 1000 - V_MIN) / (V_MAX - V_MIN);
    return DEAD_ZONE + clamp(t, 0, 1) * (view.lmax - DEAD_ZONE);
  }

  // ゲージの一部（角度 a0〜a1 度、半径 r0〜r1）を塗る
  function fillSector(x, y, a0, a1, r0, r1) {
    const k = Math.PI / 180;
    ctx.beginPath();
    ctx.arc(x, y, r1, a0 * k, a1 * k);
    ctx.arc(x, y, r0, a1 * k, a0 * k, true);
    ctx.closePath();
    ctx.fill();
  }

  // ミスが続いたときのヒントと、星3達成後の正解範囲
  function drawHints(x, y, level) {
    const h = Hints[mission.id];
    if (level === 3) {
      ctx.fillStyle = 'rgba(255,215,106,0.38)';
      for (const [a0, a1, v] of h.cells) {
        for (let i = 0; i < v.length; i += 2) fillSector(x, y, a0, a1, gaugeRadius(v[i]), gaugeRadius(v[i + 1]));
      }
      return;
    }
    ctx.fillStyle = 'rgba(120,255,160,0.2)';
    for (const [a0, a1] of h.angle) fillSector(x, y, a0, a1, DEAD_ZONE, view.lmax);
    if (level === 2) {
      ctx.fillStyle = 'rgba(110,190,255,0.22)';
      for (const [v0, v1] of h.speed) fillSector(x, y, 0, 90, gaugeRadius(v0), gaugeRadius(v1));
    }
  }

  function drawAim() {
    if (phase !== 'aim') return;
    const x = view.mx, y = view.my;
    const active = aim && aim.valid;
    const level = hintLevel();

    if (active || level) {
      // 水平線と、速度が最大になる範囲
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + view.lmax, y);
      ctx.arc(x, y, view.lmax, 0, Math.PI / 2);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (level) drawHints(x, y, level);

    if (!active) {
      // 待機中：ドラッグの向きを示す案内
      const t = (clock % 1.8) / 1.8;
      const len = 30 + 90 * (1 - Math.pow(1 - t, 3));
      ctx.globalAlpha = 0.55 * (1 - t * t);
      ctx.setLineDash([5, 7]);
      drawArrow(x, y, 0.6, len, '#ffffff', 2);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      return;
    }
    const ang = (aim.angle * Math.PI) / 180;
    const t = (aim.speed * 1000 - V_MIN) / (V_MAX - V_MIN);

    // 入射角の扇形
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, 44, 0, ang);
    ctx.closePath();
    ctx.fill();

    const color = 'hsl(' + Math.round(52 - 46 * t) + ',100%,62%)';
    drawArrow(x, y, ang, Math.max(aim.len, DEAD_ZONE + 8), color, 4);
  }

  function drawEffects() {
    for (const e of effects) {
      const p = project(e.phi, e.h);
      const t = e.t / e.dur;
      if (e.type === 'impact') {
        const maxR = 14 + e.mag * e.mag * 0.95 * Math.max(W, H);
        const r = maxR * (1 - Math.pow(1 - t, 3));
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, 'rgba(255,255,240,' + (1 - t) + ')');
        g.addColorStop(0.4, 'rgba(255,190,90,' + 0.85 * (1 - t) + ')');
        g.addColorStop(1, 'rgba(255,80,20,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,' + 0.7 * (1 - t) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 1.5, Math.PI, TAU);
        ctx.stroke();
        const white = e.mag * 1.1 * (1 - t * 2.2);
        if (white > 0) {
          ctx.fillStyle = 'rgba(255,255,255,' + Math.min(white, 1) + ')';
          ctx.fillRect(-40, -40, W + 80, H + 80);
        }
      } else if (e.type === 'burn') {
        const r = 10 + 46 * t;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, 'rgba(255,240,200,' + (1 - t) + ')');
        g.addColorStop(1, 'rgba(255,120,40,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, TAU);
        ctx.fill();
      } else {
        const r = 20 + 50 * t;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, 'rgba(255,255,255,' + 0.9 * (1 - t) + ')');
        g.addColorStop(1, 'rgba(255,220,150,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, TAU);
        ctx.fill();
      }
    }
    if (popup) {
      const p = project(popup.phi, popup.h);
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,240,200,' + clamp(1.4 - popup.t, 0, 1) + ')';
      ctx.fillText(popup.text, p.x + 22, p.y - 14 - popup.t * 14);
    }
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (shake > 0.3) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    drawBackground();
    drawEarth();
    drawMarks();
    drawTrail();
    drawSparks();
    drawMeteor();
    drawAim();
    drawEffects();
  }

  let prev = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - prev) / 1000 || 0);
    prev = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
  resize();
  // 狙い表示とHUDを上部の帯のすぐ下に置く。お題の長さや画面幅で帯の高さが変わるので測る
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--top-h', $('top').offsetHeight + 'px');
  }).observe($('top'));
  const lastIdx = Missions.findIndex((m) => m.id === progress._last);
  setMission(progress._last === '_lab' ? -1 : Math.max(lastIdx, 0));
  requestAnimationFrame(frame);
})();
