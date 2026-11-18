import { Composition } from 'remotion';
import { PV, PV_FRAMES } from './PV';

export const Root: React.FC = () => (
  <Composition id="PV" component={PV} durationInFrames={PV_FRAMES} fps={60} width={1920} height={1080} />
);
