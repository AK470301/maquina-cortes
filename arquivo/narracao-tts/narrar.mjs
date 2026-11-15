#!/usr/bin/env node
// Põe a narração TTS por cima de um corte já renderizado pelo build.mjs: abaixa a voz do streamer (ducking) enquanto
// a narração fala, queima a legenda da narração (amarela em caixa preta, distinta da legenda do streamer) e confere a
// duração final da plataforma.
// Uso: node narrar.mjs <corte.mp4> <work/props-<id>.json> <narracao.json> <saida.mp4>
// narracao.json (gerado por plano.mjs narracao):
//   {"faixa": [62, 85], "minNarracao": 12,
//    "itens": [{"arquivo": "work/tts/x-hook.mp3", "texto": "...", "atOut": 0.15},   segundo do corte renderizado
//              {"arquivo": "work/tts/x-c1.mp3",   "texto": "...", "at": 5345.0},     segundo do vídeo de ORIGEM
//              {"arquivo": "work/tts/x-cta.mp3",  "texto": "...", "noFim": true}]}   termina 0,3 s antes do fim
// Tempos de palavra da legenda: <fala>.json do tts.mjs; sem ele, o texto é distribuído pela duração do áudio.
// Sai com código 1 se a duração final sair da faixa, se a narração somar menos que minNarracao ou se falas se sobrepuserem.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {blocos, escreverAss, palavrasDaFala} from './legenda.mjs';

const [video, propsFile, narrFile, saida] = process.argv.slice(2);
if (!saida) {
  console.error('Uso: node narrar.mjs <corte.mp4> <props.json> <narracao.json> <saida.mp4>');
  process.exit(1);
}
const FPS = 30;
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], {encoding: 'utf8'}).trim());
const props = JSON.parse(fs.readFileSync(propsFile, 'utf8'));
const narr = JSON.parse(fs.readFileSync(narrFile, 'utf8'));

// mesma linha do tempo do build.mjs: quadros inteiros por plano
let acc = 0;
const mapped = props.segments.map((s) => {
  const m = {...s, outStart: acc / FPS};
  acc += Math.max(1, Math.round((s.to - s.from) * FPS));
  return m;
});
const toOut = (t) => {
  const m = mapped.find((x) => t >= x.from - 0.02 && t < x.to);
  if (m) return Math.max(0, m.outStart + (t - m.from));
  if (t < mapped[0].from) return 0;
  const next = mapped.find((x) => x.from > t);
  return next ? next.outStart : null;
};

const total = dur(video);
const erros = [];
const itens = [];
for (const it of narr.itens) {
  if (!fs.existsSync(it.arquivo)) {
    erros.push(`falta o áudio ${it.arquivo}`);
    continue;
  }
  const d = dur(it.arquivo);
  let at = it.noFim ? total - d - 0.3 : it.atOut ?? toOut(it.at);
  if (at === null || at === undefined) {
    erros.push(`${it.arquivo}: "at" ${it.at} cai depois da última fala do corte`);
    continue;
  }
  at = Math.max(0, at);
  if (at + d > total) erros.push(`${it.arquivo}: termina em ${(at + d).toFixed(1)} s, depois do fim do corte (${total.toFixed(1)} s)`);
  const palavras = palavrasDaFala(it.arquivo, it.texto, d);
  if (!palavras.length) erros.push(`${it.arquivo}: sem texto para a legenda (falta "texto" no item e o .json da fala)`);
  itens.push({arquivo: it.arquivo, at: +at.toFixed(2), dur: +d.toFixed(2), palavras});
}
itens.sort((a, b) => a.at - b.at);
for (let i = 1; i < itens.length; i++)
  if (itens[i].at < itens[i - 1].at + itens[i - 1].dur) erros.push(`falas sobrepostas: ${itens[i - 1].arquivo} e ${itens[i].arquivo}`);
const narrTotal = itens.reduce((s, x) => s + x.dur, 0);
const [min, max] = narr.faixa || [0, Infinity];
if (total < min || total > max) erros.push(`duração final ${total.toFixed(1)} s fora da faixa ${min}–${max} s: ajuste start/end no cuts.json e renderize de novo com --so`);
if (narrTotal < (narr.minNarracao || 0)) erros.push(`narração soma ${narrTotal.toFixed(1)} s (mínimo ${narr.minNarracao} s)`);
if (erros.length) {
  console.log(JSON.stringify({ok: false, duracao: +total.toFixed(1), narracao_s: +narrTotal.toFixed(1), erros}, null, 2));
  process.exit(1);
}

// legenda da narração: embaixo, acima da zona da interface do app; se a legenda do streamer foi movida para baixo
// (captionY alto), a da narração vai para cima
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narrar-'));
const assFile = path.join(tmp, 'narracao.ass');
const eventos = itens.flatMap((x) => blocos(x.palavras, x.at, x.at + x.dur + 0.4));
const W = 1080, H = 1920;
escreverAss(assFile, eventos, {largura: W, altura: H, tamanho: 64, posicao: (props.layout?.captionY ?? 0) > 1300 ? 'cima' : 'baixo'});

// áudio: cada fala atrasada para o seu tempo, somadas; a voz original é comprimida pela narração (≈ −14 dB)
const inputs = ['-i', video];
const parts = [];
itens.forEach((x, i) => {
  inputs.push('-i', x.arquivo);
  const ms = Math.round(x.at * 1000);
  parts.push(`[${i + 1}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[n${i}]`);
});
const fc = [
  `[0:v]ass=${assFile}[v]`,
  ...parts,
  `${itens.map((_, i) => `[n${i}]`).join('')}amix=inputs=${itens.length}:normalize=0:dropout_transition=0,apad,atrim=0:${total.toFixed(3)},volume=1.15,asplit=2[narr][sc]`,
  `[0:a]aresample=48000,aformat=channel_layouts=stereo[orig]`,
  `[orig][sc]sidechaincompress=threshold=0.015:ratio=8:attack=15:release=350:makeup=1[duck]`,
  `[duck][narr]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-14:TP=-1:LRA=11[a]`,
].join(';');
try {
  execFileSync('ffmpeg', ['-y', '-v', 'error', ...inputs, '-filter_complex', fc, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', saida]);
} finally {
  fs.rmSync(tmp, {recursive: true, force: true});
}
console.log(JSON.stringify({ok: true, saida, duracao: +total.toFixed(1), narracao_s: +narrTotal.toFixed(1), blocos_legenda: eventos.length, falas: itens.map(({palavras, ...x}) => x)}, null, 2));
