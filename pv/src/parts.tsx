// PV の部品：ゲーム映像、字幕、判定スタンプ
import {
  AbsoluteFill,
  Audio,
  Easing,
  Freeze,
  interpolate,
  OffthreadVideo,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { loadFont as loadNoto } from '@remotion/google-fonts/NotoSansJP';
import { loadFont as loadDela } from '@remotion/google-fonts/DelaGothicOne';

const noto = loadNoto('normal', { weights: ['700', '900'], ignoreTooManyRequestsWarning: true });
const dela = loadDela('normal', { ignoreTooManyRequestsWarning: true });
export const SANS = noto.fontFamily;
export const DISPLAY = dela.fontFamily;

// ゲームの配色に合わせる
export const ORANGE = '#ffb347';
export const INK = '#05060f';

// クリップの区切り。前の区切り（最初は from）から、このコマまでをこの倍速で流す
export type Seg = [to: number, rate: number];

const segLengths = (from: number, segs: Seg[]) =>
  segs.map(([to, rate], i) => Math.round((to - (i ? segs[i - 1][0] : from)) / rate));

// 再生にかかるコマ数
export const playLength = (from: number, segs: Seg[]) => segLengths(from, segs).reduce((a, b) => a + b, 0);

// クリップの src コマ目が、場面の何コマ目に映るか
export const whenShown = (from: number, segs: Seg[], src: number) => {
  const lens = segLengths(from, segs);
  let start = 0, prev = from;
  for (let i = 0; i < segs.length; i++) {
    const [to, rate] = segs[i];
    if (src <= to) return start + Math.round((src - prev) / rate);
    start += lens[i];
    prev = to;
  }
  return start;
};

// 撮影したクリップの一部を、区切りごとの倍速とゆっくりしたズームをかけて流す。
// 流し終えたら最後のコマで止めておく（結末を見せたまま字幕を出すため）。
// 効果音も同じ区切りで流し、映像を止めたあとは等速で鳴らし続ける（余韻や結果のジングルを切らない）
export const Footage: React.FC<{
  clip: string;
  from: number;
  segs: Seg[];
  zoom?: [number, number];
  origin?: string;
}> = ({ clip, from, segs, zoom = [1, 1], origin = '50% 50%' }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const scale = interpolate(frame, [0, durationInFrames], zoom, { easing: Easing.inOut(Easing.quad) });
  const lens = segLengths(from, segs);
  const total = lens.reduce((a, b) => a + b, 0);
  const starts = lens.map((_, i) => lens.slice(0, i).reduce((a, b) => a + b, 0));
  const trimBefore = (i: number) => (i ? segs[i - 1][0] : from);
  const video = segs.map(([to, rate], i) => (
    <Sequence key={i} from={starts[i]} durationInFrames={lens[i]}>
      <OffthreadVideo
        src={staticFile('clips/' + clip + '.mp4')}
        trimBefore={trimBefore(i)}
        trimAfter={to}
        playbackRate={rate}
        muted
        style={{ width: '100%', height: '100%' }}
      />
    </Sequence>
  ));
  // 音は止めた映像（Freeze）の外に置く
  const wav = staticFile('clips/' + clip + '.wav');
  return (
    <AbsoluteFill style={{ backgroundColor: INK, overflow: 'hidden' }}>
      <AbsoluteFill style={{ transform: `scale(${scale})`, transformOrigin: origin }}>
        {frame >= total ? <Freeze frame={total - 1}>{video}</Freeze> : video}
      </AbsoluteFill>
      {segs.map(([to, rate], i) => (
        <Sequence key={i} from={starts[i]} durationInFrames={lens[i]}>
          <Audio src={wav} trimBefore={trimBefore(i)} trimAfter={to} playbackRate={rate} />
        </Sequence>
      ))}
      <Sequence from={total}>
        <Audio src={wav} trimBefore={segs[segs.length - 1][0]} />
      </Sequence>
    </AbsoluteFill>
  );
};

// 文字の縁取り。背景が明るい場面でも読めるようにする
const outline = (w: number, color = INK) => ({
  WebkitTextStroke: `${w}px ${color}`,
  paintOrder: 'stroke fill' as const,
});

type Part = string | { hl: string };

// 画面右上に出す字幕。1 行は文字列か部品の並び。{ hl: '...' } の部分はオレンジにする
export const Caption: React.FC<{
  lines: (string | Part[])[];
  from: number;
  to: number;
  size?: number;
}> = ({ lines, from, to, size = 92 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < from || frame >= to) return null;
  const out = interpolate(frame, [to - 10, to], [1, 0], { extrapolateLeft: 'clamp' });
  return (
    <AbsoluteFill style={{ alignItems: 'flex-end', paddingTop: 330, paddingRight: 110 }}>
      {lines.map((line, i) => {
        const parts = typeof line === 'string' ? [line] : line;
        const s = spring({ frame: frame - from - i * 6, fps, config: { damping: 14, stiffness: 160 } });
        return (
          <div
            key={i}
            style={{
              fontFamily: SANS,
              fontWeight: 900,
              fontSize: size,
              lineHeight: 1.25,
              color: '#fff',
              ...outline(14),
              textShadow: '0 6px 30px rgba(0,0,0,0.6)',
              opacity: Math.min(s, out),
              transform: `translateX(${(1 - s) * 80}px)`,
            }}
          >
            {parts.map((p, j) =>
              typeof p === 'string' ? <span key={j}>{p}</span> : <span key={j} style={{ color: ORANGE }}>{p.hl}</span>,
            )}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

// 結末を叩きつけるように出す判定の文字
export const Stamp: React.FC<{ text: string; color: string; at: number; until?: number; size?: number }> = ({
  text,
  color,
  at,
  until = Infinity,
  size = 190,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at || frame >= until) return null;
  const s = spring({ frame: frame - at, fps, config: { damping: 11, stiffness: 220, mass: 0.8 } });
  const scale = interpolate(s, [0, 1], [2.4, 1]);
  const dim = interpolate(frame - at, [0, 8], [0, 0.45], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: `rgba(5,6,15,${dim})` }} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingLeft: 420 }}>
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: size,
            color,
            ...outline(20),
            textShadow: `0 0 60px ${color}88`,
            transform: `rotate(-6deg) scale(${scale})`,
            opacity: Math.min(1, s * 1.5),
            whiteSpace: 'nowrap',
          }}
        >
          {text}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
