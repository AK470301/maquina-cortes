#!/usr/bin/env node
// Imprime a transcrição como linhas "[mm:ss] frase", para o Claude ler sem despejar o JSON.
// Marca as linhas com sinais extras, quando existirem na pasta de trabalho:
//   🔥  trecho entre os 10% mais reproduzidos do YouTube ("heatmap" do info.json, gerado com `yt-dlp -J`)
//   🔊  pico de empolgação na voz (energia.json, gerado pelo transcribe.mjs)
// Uso: node scripts/transcript-text.mjs <pasta_de_trabalho>
import fs from 'node:fs';
import path from 'node:path';

const work = process.argv[2];
if (!work) {
  console.error('Uso: node scripts/transcript-text.mjs <pasta_de_trabalho>');
  process.exit(1);
}
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(work, f), 'utf8'));
  } catch {
    return null;
  }
};
const words = readJson('captions.json');
if (!words) {
  console.error(`Não achei ${path.join(work, 'captions.json')}. Rode o transcribe.mjs antes.`);
  process.exit(1);
}
const mmss = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

// 🔊 picos de empolgação (segundos)
const energia = (readJson('energia.json') || []).map((e) => ({start: e.start, end: e.end}));

// 🔥 mais reproduzido: os 10% de maior valor do heatmap do YouTube
const info = readJson('info.json');
let replay = [];
let replayNote = null;
if (info) {
  const hm = Array.isArray(info.heatmap) ? info.heatmap : [];
  if (hm.length) {
    const vals = hm.map((h) => h.value).sort((a, b) => a - b);
    const cut = vals[Math.floor(vals.length * 0.9)];
    replay = hm.filter((h) => h.value >= cut).map((h) => ({start: h.start_time, end: h.end_time}));
  } else replayNote = 'Este vídeo não tem o gráfico "mais reproduzido" no YouTube; sem marcas 🔥.';
}

const overlaps = (ranges, a, b) => ranges.some((r) => r.start < b && r.end > a);
const merge = (ranges) =>
  [...ranges]
    .sort((x, y) => x.start - y.start)
    .reduce((acc, r) => {
      const last = acc[acc.length - 1];
      if (last && r.start - last.end <= 1) last.end = Math.max(last.end, r.end);
      else acc.push({...r});
      return acc;
    }, []);

// resumo dos picos no topo (no máximo 20, em ordem de tempo)
const peaks = [
  ...merge(replay).map((r) => ({...r, tag: '🔥'})),
  ...merge(energia).map((r) => ({...r, tag: '🔊'})),
].sort((a, b) => a.start - b.start);
if (replayNote) console.log(replayNote);
if (peaks.length) {
  const shown = peaks.slice(0, 20).map((p) => `${mmss(p.start * 1000)} ${p.tag}`);
  console.log(`Picos: ${shown.join(', ')}${peaks.length > 20 ? ` (+${peaks.length - 20})` : ''}`);
  console.log('');
}

let line = [];
let lineStart = 0;
let lineEnd = 0;
const flush = () => {
  if (line.length) {
    const a = lineStart / 1000;
    const b = lineEnd / 1000;
    const tags = (overlaps(replay, a, b) ? '🔥' : '') + (overlaps(energia, a, b) ? '🔊' : '');
    console.log(`[${mmss(lineStart)}]${tags ? ' ' + tags : ''} ${line.join(' ')}`);
  }
  line = [];
};
words.forEach((w, i) => {
  const prev = words[i - 1];
  if (!line.length) lineStart = w.startMs;
  else if (prev && w.startMs - prev.endMs > 900) {
    flush();
    lineStart = w.startMs;
  }
  line.push(w.text);
  lineEnd = w.endMs;
  if (/[.!?…]$/.test(w.text) || line.length >= 28) flush();
});
flush();
