#!/usr/bin/env node
// Monta o work/bottom.mp4 (fundo da metade de baixo no layout papo) sorteando trechos de uma pasta de clipes de
// gameplay. Cada trecho tem 4–7 s, sai sem áudio, recortado para 1080×960 a 30 fps, e os trechos são embaralhados.
// O build.mjs começa cada corte num ponto diferente do bottom.mp4, então cortes da mesma live não repetem o fundo.
// Uso: node montar-bottom.mjs <pasta-de-clipes> <pasta_de_trabalho> [--duracao 300] [--semente texto] [--refazer]
//   Pasta vazia ou inexistente: mantém o work/bottom.mp4 que já existir (código 0) ou avisa que não há fundo (código 2;
//   o corte usa a câmera desfocada). Sem --refazer, um bottom.mp4 já montado é mantido.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const [pasta, work] = args.filter((a, i) => !a.startsWith('--') && !['--duracao', '--semente'].includes(args[i - 1]));
if (!pasta || !work) {
  console.error('Uso: node montar-bottom.mjs <pasta-de-clipes> <pasta_de_trabalho> [--duracao 300] [--semente texto] [--refazer]');
  process.exit(1);
}
const saida = path.join(work, 'bottom.mp4');
const alvo = Number(opt('--duracao', 300));
const clipes = fs.existsSync(pasta)
  ? fs.readdirSync(pasta).filter((f) => /\.(mp4|mov|mkv|webm|m4v)$/i.test(f)).map((f) => path.join(pasta, f))
  : [];
if (!clipes.length) {
  if (fs.existsSync(saida)) {
    console.log(JSON.stringify({ok: true, bottom: saida, origem: 'bottom.mp4 já existente (pasta de clipes vazia)'}));
    process.exit(0);
  }
  console.log(JSON.stringify({ok: false, aviso: `sem clipes em ${pasta} e sem ${saida}: a metade de baixo fica com a câmera desfocada`}));
  process.exit(2);
}
if (fs.existsSync(saida) && !args.includes('--refazer')) {
  console.log(JSON.stringify({ok: true, bottom: saida, origem: 'mantido (use --refazer para sortear de novo)'}));
  process.exit(0);
}

// sorteio reprodutível: mesma semente → mesmo fundo
let h = 1779033703;
for (const c of opt('--semente', path.resolve(work))) h = Math.imul(h ^ c.charCodeAt(0), 3432918353);
const rnd = () => {
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^= h >>> 16) >>> 0) / 4294967296;
};
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], {encoding: 'utf8'}).trim());
const fontes = clipes.map((f) => ({f, d: dur(f)})).filter((x) => x.d >= 6);
if (!fontes.length) {
  console.error('Nenhum clipe com pelo menos 6 s.');
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bottom-'));
const pecas = [];
let soma = 0;
let anterior = null;
while (soma < alvo) {
  // evita repetir o mesmo arquivo em seguida quando há mais de um
  let x;
  do x = fontes[Math.floor(rnd() * fontes.length)];
  while (fontes.length > 1 && x === anterior);
  anterior = x;
  const d = Math.min(4 + rnd() * 3, x.d - 1);
  const ini = 0.5 + rnd() * Math.max(0, x.d - d - 1);
  const out = path.join(tmp, `p${pecas.length}.mp4`);
  execFileSync('ffmpeg', [
    '-y', '-v', 'error', '-ss', ini.toFixed(2), '-t', d.toFixed(2), '-i', x.f, '-an',
    '-vf', 'scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,setsar=1,fps=30',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', out,
  ]);
  pecas.push(out);
  soma += d;
}
const lista = path.join(tmp, 'lista.txt');
fs.writeFileSync(lista, pecas.map((p) => `file '${p}'`).join('\n'));
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lista, '-c', 'copy', '-movflags', '+faststart', saida]);
fs.rmSync(tmp, {recursive: true, force: true});
console.log(JSON.stringify({ok: true, bottom: saida, trechos: pecas.length, segundos: Math.round(soma), clipes: fontes.length}));
