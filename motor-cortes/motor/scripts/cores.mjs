#!/usr/bin/env node
// Sugere a paleta de um streamer: as cores mais presentes numa imagem (logo, banner) ou num quadro de vídeo.
// Uso: node scripts/cores.mjs <imagem|video> [segundo_do_video]
// Imprime um JSON [{hex, pct}] da cor mais presente para a menos presente. Claude olha a imagem e escolhe
// uma cor base (texto, em geral clara) e uma de destaque (forte, que contraste com o contorno preto).
import {execFileSync} from 'node:child_process';

const [file, sec] = process.argv.slice(2);
if (!file) {
  console.error('Uso: node scripts/cores.mjs <imagem|video> [segundo_do_video]');
  process.exit(1);
}
const isVideo = /\.(mp4|mkv|webm|mov)$/i.test(file);
// reduz para 64x64 e lê os pixels crus; quantiza em passos de 32 para agrupar tons parecidos
const raw = execFileSync(
  'ffmpeg',
  ['-v', 'error', ...(isVideo ? ['-ss', String(sec || 5)] : []), '-i', file, '-frames:v', '1', '-vf', 'scale=64:64:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
  {maxBuffer: 1024 * 1024},
);
const count = new Map();
for (let i = 0; i + 2 < raw.length; i += 3) {
  const q = [raw[i], raw[i + 1], raw[i + 2]].map((v) => Math.min(255, Math.round(v / 32) * 32));
  const k = q.join(',');
  count.set(k, (count.get(k) || 0) + 1);
}
const total = raw.length / 3;
const hex = (k) => '#' + k.split(',').map((v) => Number(v).toString(16).padStart(2, '0')).join('').toUpperCase();
const list = [...count.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 8)
  .map(([k, n]) => ({hex: hex(k), pct: Number(((n / total) * 100).toFixed(1))}));
console.log(JSON.stringify(list, null, 2));
