// 大気圏突入チャレンジの PV（1920×1080 / 60fps）
// クリップのコマ番号は public/clips/*.json の印（press / launch / end / result）を見て決めている
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { Caption, Footage, playLength, Seg, Stamp, whenShown } from './parts';
import bounce from '../public/clips/bounce.json';
import burn from '../public/clips/burn.json';
import land from '../public/clips/land.json';

const T = 12; // 場面転換のフェードのコマ数
const BEAT = 40; // 画面で結末が起きてから判定の文字を出すまでの間。見た人が結末に気づく時間
const STAMP_HOLD = 75; // 判定の文字を見せておく長さ（転換のフェードを含む）

// 衝突音の余韻を聞かせるため 2.5 秒。結果パネル（272 コマ目）が出る前に切り替える
const HOOK_SEGS: Seg[] = [[262, 1]];
const HOOK = playLength(112, HOOK_SEGS);

// 狙う様子は等速で見せ、飛んでいる間は早送りする。結果パネルが出る前に止める
const BOUNCE_SEGS: Seg[] = [[bounce.launch, 1], [bounce.end + 30, 2.2]];
const BOUNCE_END = whenShown(55, BOUNCE_SEGS, bounce.end);
const BOUNCE = BOUNCE_END + BEAT + STAMP_HOLD;

const BURN_SEGS: Seg[] = [[burn.result - 11, 1]];
const BURN_END = whenShown(80, BURN_SEGS, burn.end);
const BURN = BURN_END + BEAT + STAMP_HOLD;

// ゲーム自身が着地から 1.3 秒おいて結果パネルを出すので、そのまま使う
const LAND_SEGS: Seg[] = [[450, 1.3]];
const LAND_END = whenShown(80, LAND_SEGS, land.end);
const LAND = playLength(80, LAND_SEGS);

const BIG_SEGS: Seg[] = [[440, 1]];
const BIG = playLength(262, BIG_SEGS);

export const PV_FRAMES = HOOK + BOUNCE + BURN + LAND + BIG - 4 * T;

const cut = <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: T })} />;

export const PV: React.FC = () => (
  <TransitionSeries>
    {/* 巨大隕石が突っ込んで画面が真っ白になるところから始める */}
    <TransitionSeries.Sequence durationInFrames={HOOK}>
      <Footage clip="big" from={112} segs={HOOK_SEGS} zoom={[1.06, 1]} origin="30% 70%" />
      <Caption from={6} to={HOOK} lines={['隕石を', [{ hl: '地表まで' }, '届けろ']]} size={110} />
    </TransitionSeries.Sequence>
    {cut}
    <TransitionSeries.Sequence durationInFrames={BOUNCE}>
      <Footage clip="bounce" from={55} segs={BOUNCE_SEGS} />
      <Caption from={4} to={62} lines={[['向きで', { hl: '角度' }], ['長さで', { hl: '速度' }]]} />
      <Caption from={66} to={BOUNCE_END} lines={['浅すぎると…']} />
      <Stamp text="宇宙へ弾かれる" color="#8fd3ff" at={BOUNCE_END + BEAT} size={160} />
    </TransitionSeries.Sequence>
    {cut}
    <TransitionSeries.Sequence durationInFrames={BURN}>
      <Footage clip="burn" from={80} segs={BURN_SEGS} />
      <Caption from={8} to={BURN_END} lines={['急すぎると…']} />
      <Stamp text="燃え尽きる" color="#ff7a3c" at={BURN_END + BEAT} />
    </TransitionSeries.Sequence>
    {cut}
    <TransitionSeries.Sequence durationInFrames={LAND}>
      <Footage clip="land" from={80} segs={LAND_SEGS} zoom={[1, 1.06]} origin="50% 80%" />
      <Caption from={10} to={LAND_END} lines={['ちょうどいい', [{ hl: '角度と速度' }, 'を探せ']]} />
    </TransitionSeries.Sequence>
    {cut}
    <TransitionSeries.Sequence durationInFrames={BIG}>
      <Footage clip="big" from={262} segs={BIG_SEGS} zoom={[1, 1.12]} origin="50% 62%" />
    </TransitionSeries.Sequence>
  </TransitionSeries>
);
