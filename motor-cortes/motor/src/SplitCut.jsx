import React from 'react';
import {
  AbsoluteFill,
  Easing,
  Html5Audio,
  Img,
  Loop,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {loadFont} from '@remotion/google-fonts/Montserrat';

const {fontFamily} = loadFont('normal', {weights: ['800', '900'], subsets: ['latin']});

const W = 1080;
const H = 1920;
// Três layouts (props.layout.kind), todos em 1080x1920:
//   papo      quem fala em cima (50%), B-roll embaixo (50%), legenda na divisa
//   gameplay  webcam em cima (~38%), o jogo do mesmo momento embaixo (~62%), legenda na divisa
//             (sem webcam: topH = 0, o jogo ocupa a tela e a legenda vai para o terço inferior)
//   cheia     o vídeo ocupa a tela toda, recortado seguindo a pessoa; legenda no terço inferior
const DEFAULT_PALETTE = {base: '#FFFFFF', destaque: '#FFD400'};

// Zoom curto a cada corte: o 1º plano entra mais "apertado", os ímpares dão um leve punch-in.
const Punch = ({index, children}) => {
  const frame = useCurrentFrame();
  const from = index === 0 ? 1.12 : index % 2 === 1 ? 1.06 : 1.0;
  const s = interpolate(frame, [0, 9], [from, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  return <AbsoluteFill style={{transform: `scale(${s})`}}>{children}</AbsoluteFill>;
};

// Flash branco bem rápido, só nas viradas de seção (`turns`); o swoosh toca junto, via props.sfx.
const Flash = () => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 5], [0.38, 0], {extrapolateRight: 'clamp'});
  return <AbsoluteFill style={{background: '#fff', opacity: o}} />;
};

// Estilo de um vídeo dentro de uma caixa boxW x boxH.
// Sem `crop`: preenche a caixa (cover) e usa `focus` (x, y de 0 a 100) para escolher o que fica visível.
// Com `crop` ({x, y, w, h} em pixels do vídeo de origem): amplia só essa região até preencher a caixa
// (ex.: a webcam no canto de uma live, ou a área da mira num jogo).
const boxVideoStyle = (crop, srcW, srcH, focus, boxW, boxH) => {
  if (!crop) {
    return {width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${focus.x}% ${focus.y}%`};
  }
  const s = Math.max(boxW / crop.w, boxH / crop.h);
  return {
    position: 'absolute',
    width: srcW * s,
    height: srcH * s,
    left: -crop.x * s + (boxW - crop.w * s) / 2,
    top: -crop.y * s + (boxH - crop.h * s) / 2,
    objectFit: 'fill',
  };
};

// O vídeo de origem, plano a plano (sem as pausas), dentro de uma caixa. Usado na câmera (com zoom e flash),
// no jogo do layout gameplay (sem zoom) e no fundo desfocado do B-roll.
const SourceBox = ({segments, fps, sourceFile, crop, focus, srcW, srcH, top, height, punch, flash, muted, blur}) => {
  let offset = 0;
  return (
    <div style={{position: 'absolute', left: 0, top, width: W, height, overflow: 'hidden', background: '#000'}}>
      {segments.map((seg, i) => {
        const frames = Math.max(1, Math.round((seg.to - seg.from) * fps));
        const start = Math.round(seg.from * fps);
        const from = offset;
        offset += frames;
        const video = (
          <OffthreadVideo
            src={staticFile(sourceFile)}
            startFrom={start}
            endAt={start + frames}
            muted={muted}
            style={{
              ...boxVideoStyle(crop, srcW, srcH, seg.focus || focus, W, height),
              ...(blur ? {filter: 'blur(28px) brightness(0.7)', transform: 'scale(1.15)'} : {}),
            }}
          />
        );
        return (
          <Sequence key={i} from={from} durationInFrames={frames}>
            {punch ? <Punch index={i}>{video}</Punch> : video}
            {flash && seg.turn ? <Flash /> : null}
          </Sequence>
        );
      })}
    </div>
  );
};

// Um vídeo em loop (o bottom.mp4 de antes, ou um B-roll mais curto que o tempo dele na tela).
const LoopVideo = ({file, start, duration, fps, total}) => {
  const startFrame = Math.round((start || 0) * fps);
  const loopFrames = duration > 0 ? Math.max(30, Math.floor(duration * fps) - 2) : total;
  return (
    <Loop durationInFrames={loopFrames}>
      <OffthreadVideo
        src={staticFile(file)}
        startFrom={startFrame}
        endAt={startFrame + loopFrames}
        muted
        style={{width: '100%', height: '100%', objectFit: 'cover'}}
      />
    </Loop>
  );
};

// Imagem de B-roll: ocupa a caixa, com um zoom lento de 100% a 108%.
const KenBurns = ({file, durationInFrames}) => {
  const frame = useCurrentFrame();
  const s = interpolate(frame, [0, durationInFrames], [1, 1.08], {extrapolateRight: 'clamp'});
  return <Img src={staticFile(file)} style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${s})`}} />;
};

// Metade de baixo do papo: fundo (bottom.mp4 em loop, ou a câmera desfocada) e, por cima, os B-rolls nos tempos certos.
const BrollBox = ({bottom, fps, total, top, height, sourceProps}) => (
  <div style={{position: 'absolute', left: 0, top, width: W, height, overflow: 'hidden', background: '#000'}}>
    {bottom.fallback ? (
      <LoopVideo file={bottom.fallback.file} start={bottom.fallback.start} duration={bottom.fallback.duration} fps={fps} total={total} />
    ) : (
      <SourceBox {...sourceProps} top={0} height={height} muted blur />
    )}
    {(bottom.items || []).map((b, i) => {
      const frames = Math.max(6, Math.round(b.dur * fps));
      return (
        <Sequence key={`broll${i}`} from={Math.round(b.outStart * fps)} durationInFrames={frames}>
          <AbsoluteFill>
            {b.tipo === 'imagem' ? (
              <KenBurns file={b.file} durationInFrames={frames} />
            ) : (
              <LoopVideo file={b.file} start={b.start || 0} duration={b.fileDuration || 0} fps={fps} total={frames} />
            )}
          </AbsoluteFill>
        </Sequence>
      );
    })}
  </div>
);

// Imagem em destaque (popup): entra com escala 0,9 → 1 e fade, sai com fade. Fica centrada na área (top, height).
const PopImage = ({file, durationInFrames, top, height}) => {
  const frame = useCurrentFrame();
  const inn = interpolate(frame, [0, 8], [0, 1], {extrapolateRight: 'clamp', easing: Easing.out(Easing.back(1.6))});
  const out = interpolate(frame, [durationInFrames - 6, durationInFrames], [1, 0], {extrapolateLeft: 'clamp'});
  const scale = 0.9 + 0.1 * inn;
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        width: W,
        top: top + 70,
        height: height - 140,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: Math.min(inn, out),
        transform: `scale(${scale})`,
      }}
    >
      <Img
        src={staticFile(file)}
        style={{maxWidth: 800, maxHeight: Math.min(620, height - 180), objectFit: 'contain', borderRadius: 26, border: '5px solid #fff', boxShadow: '0 18px 48px rgba(0,0,0,0.55)'}}
      />
    </div>
  );
};

// Legenda palavra por palavra, em caixa alta, centrada verticalmente em `y`.
// Cor base no texto; a palavra falada acende na cor de destaque; palavras-chave (kw) ficam sempre na cor
// de destaque e um pouco maiores.
const Captions = ({pages, fps, y, palette}) => {
  const frame = useCurrentFrame();
  const ms = (frame / fps) * 1000;
  const page = pages.find((p) => ms >= p.startMs && ms < p.endMs);
  if (!page) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: 50,
        width: W - 100,
        top: y,
        transform: 'translateY(-50%)',
        textAlign: 'center',
        fontFamily,
        fontWeight: 900,
        fontSize: 96,
        lineHeight: 1.04,
        textTransform: 'uppercase',
        color: palette.base,
        WebkitTextStroke: '11px #000',
        paintOrder: 'stroke fill',
        textShadow: '0 7px 0 rgba(0,0,0,0.35)',
      }}
    >
      {page.words.map((w, i) => {
        const active = ms >= w.startMs && ms < w.endMs;
        return (
          <span
            key={i}
            style={{
              color: active || w.kw ? palette.destaque : palette.base,
              display: 'inline-block',
              margin: '0 12px',
              fontSize: w.kw ? '1.15em' : undefined, // maior de verdade (ocupa espaço), sem encostar na vizinha
            }}
          >
            {w.text}
          </span>
        );
      })}
    </div>
  );
};

// Marca d'água: logo circular à esquerda e o nome do perfil ao lado, no canto superior direito.
const Watermark = ({logo, name}) => (
  <div style={{position: 'absolute', top: 150, right: 40, display: 'flex', alignItems: 'center', gap: 14}}>
    <Img
      src={staticFile(logo)}
      style={{width: 104, height: 104, borderRadius: '50%', objectFit: 'cover', border: '4px solid #fff', boxShadow: '0 6px 18px rgba(0,0,0,0.45)'}}
    />
    <span
      style={{
        fontFamily,
        fontWeight: 900,
        fontSize: 40,
        textTransform: 'uppercase',
        color: '#fff',
        WebkitTextStroke: '7px #14002a',
        paintOrder: 'stroke fill',
        textShadow: '0 4px 0 rgba(60,0,90,0.6)',
      }}
    >
      {name}
    </span>
  </div>
);

// Título fixo no topo (hook visual): entra com um "soco" de escala, fica `dur` segundos e sai rápido.
// Caixa na cor de destaque do streamer, texto branco; colada no alto (y 70) para não cobrir o rosto de quem fala.
const TopTitle = ({texto, durationInFrames, palette}) => {
  const frame = useCurrentFrame();
  const entra = interpolate(frame, [0, 5, 9], [0.55, 1.08, 1], {extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  const sai = interpolate(frame, [durationInFrames - 6, durationInFrames], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <div style={{position: 'absolute', top: 70, left: 0, width: W, display: 'flex', justifyContent: 'center', opacity: sai}}>
      <div
        style={{
          maxWidth: W - 80,
          padding: '12px 30px 16px',
          background: palette.destaque,
          borderRadius: 18,
          border: '6px solid #000',
          boxShadow: '0 10px 0 rgba(0,0,0,0.45)',
          transform: `scale(${entra}) rotate(-2deg)`,
          fontFamily,
          fontWeight: 900,
          fontSize: 62,
          lineHeight: 1.05,
          textAlign: 'center',
          textWrap: 'balance',
          textTransform: 'uppercase',
          color: '#fff',
          WebkitTextStroke: '8px #000',
          paintOrder: 'stroke fill',
        }}
      >
        {texto}
      </div>
    </div>
  );
};

export const SplitCut = (props) => {
  const {fps} = useVideoConfig();
  const total = Math.max(1, Math.round(props.totalSeconds * fps));
  const layout = props.layout || {kind: 'papo', topH: H / 2};
  const kind = layout.kind || 'papo';
  const topH = kind === 'cheia' ? H : layout.topH ?? H / 2;
  const bottomH = H - topH;
  const palette = {...DEFAULT_PALETTE, ...(props.palette || {})};
  // legenda: na divisa quando há duas partes; no terço inferior quando uma parte ocupa a tela toda
  const captionY = layout.captionY ?? (topH > 0 && bottomH > 0 ? topH : 1250);
  const bottom = props.bottom || {kind: 'nenhum'};
  const src = {
    segments: props.segments,
    fps,
    sourceFile: props.sourceFile,
    srcW: props.sourceWidth,
    srcH: props.sourceHeight,
  };
  // popups de imagem: na metade de baixo, ou no meio da tela quando não há divisão
  const popTop = bottomH > 0 && topH > 0 ? topH : 300;
  const popH = bottomH > 0 && topH > 0 ? bottomH : 900;
  return (
    <AbsoluteFill style={{background: '#000'}}>
      {topH > 0 ? <SourceBox {...src} crop={props.crop} focus={props.focus} top={0} height={topH} punch flash /> : null}
      {bottomH > 0 && bottom.kind === 'broll' ? (
        <BrollBox bottom={bottom} fps={fps} total={total} top={topH} height={bottomH} sourceProps={{...src, crop: props.crop, focus: props.focus}} />
      ) : null}
      {bottomH > 0 && bottom.kind === 'source' ? (
        // o jogo do mesmo momento; sem webcam (topH 0) ele ganha o zoom e o flash que seriam da câmera
        <SourceBox {...src} crop={bottom.crop} focus={bottom.focus || {x: 50, y: 50}} top={topH} height={bottomH} muted punch={topH === 0} flash={topH === 0} />
      ) : null}
      {(props.images || []).map((im, i) => {
        const frames = Math.max(12, Math.round(im.dur * fps));
        return (
          <Sequence key={`img${i}`} from={Math.round(im.at * fps)} durationInFrames={frames}>
            <PopImage file={im.file} durationInFrames={frames} top={popTop} height={popH} />
          </Sequence>
        );
      })}
      <div
        style={{
          position: 'absolute',
          left: 0,
          width: W,
          top: captionY - 170,
          height: 340,
          background: 'linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,0.62) 50%, rgba(0,0,0,0))',
        }}
      />
      <Captions pages={props.pages} fps={fps} y={captionY} palette={palette} />
      {props.watermark ? <Watermark logo={props.watermark.logo} name={props.watermark.name} /> : null}
      {props.titulo?.texto ? (
        <Sequence durationInFrames={Math.max(1, Math.round(props.titulo.dur * fps))}>
          <TopTitle texto={props.titulo.texto} durationInFrames={Math.max(1, Math.round(props.titulo.dur * fps))} palette={palette} />
        </Sequence>
      ) : null}
      {(props.sfx || []).map((s, i) => (
        <Sequence key={`sfx${i}`} from={Math.max(0, Math.round(s.at * fps))} durationInFrames={Math.round(3 * fps)}>
          <Html5Audio src={staticFile(s.file)} volume={s.volume} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
