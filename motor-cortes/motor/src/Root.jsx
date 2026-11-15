import React from 'react';
import {Composition} from 'remotion';
import {SplitCut} from './SplitCut.jsx';

export const FPS = 30;

// Valores de exemplo (o build.mjs sobrescreve tudo com --props).
const defaultProps = {
  totalSeconds: 5,
  layout: {kind: 'papo', topH: 960},
  segments: [{from: 0, to: 5}],
  sourceFile: 'source.mp4',
  bottom: {kind: 'nenhum'},
  focus: {x: 50, y: 35},
  crop: null,
  sourceWidth: 1280,
  sourceHeight: 720,
  pages: [],
  palette: {base: '#FFFFFF', destaque: '#FFD400'},
  watermark: null,
};

export const Root = () => (
  <Composition
    id="SplitCut"
    component={SplitCut}
    width={1080}
    height={1920}
    fps={FPS}
    durationInFrames={FPS * 5}
    defaultProps={defaultProps}
    calculateMetadata={({props}) => ({
      durationInFrames: Math.max(1, Math.round(props.totalSeconds * FPS)),
      fps: FPS,
    })}
  />
);
