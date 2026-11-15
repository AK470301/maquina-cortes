#!/usr/bin/env node
// Folhas de contato do vídeo: miniaturas a cada N segundos, em grades 4x4, para Claude ver o vídeo inteiro
// olhando poucas imagens (o que é papo, gameplay ou cena; onde está a pessoa; onde fica a webcam).
// Uso: node scripts/mapa-visual.mjs <video> <pasta_de_trabalho> [intervalo_s=120] [inicio_s=0] [fim_s] [--guias]
// --guias: linhas verticais a 25%, 50% e 75% da largura de cada miniatura (para estimar o foco x na tela cheia).
// Saída: <pasta>/mapa/mapa-01.jpg, mapa-02.jpg... e imprime o minuto de cada miniatura (da esquerda para a
// direita, de cima para baixo).
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const guias = process.argv.includes('--guias');
const [video, work, everyArg, startArg, endArg] = process.argv.slice(2).filter((a) => a !== '--guias');
if (!video || !work) {
  console.error('Uso: node scripts/mapa-visual.mjs <video> <pasta_de_trabalho> [intervalo_s=120] [inicio_s=0] [fim_s]');
  process.exit(1);
}
const every = Number(everyArg || 120);
const start = Number(startArg || 0);
const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video], {encoding: 'utf8'}).trim());
const end = Math.min(dur, endArg ? Number(endArg) : dur);
const dir = path.join(work, 'mapa');
fs.rmSync(dir, {recursive: true, force: true});
fs.mkdirSync(dir, {recursive: true});
const fmt = (s) => {
  const t = Math.floor(s);
  const h = Math.floor(t / 3600);
  const mm = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
  const ss = String(t % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};
const times = [];
for (let t = start + Math.min(every / 2, 2); t < end; t += every) times.push(t);
const sheets = [];
for (let s = 0; s * 16 < times.length; s++) {
  const chunk = times.slice(s * 16, s * 16 + 16);
  const thumbs = chunk.map((t, i) => {
    const f = path.join(dir, `_t${i}.jpg`);
    // -ss antes do -i: busca rápida, mesmo em live de horas
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', video, '-frames:v', '1', '-vf', 'scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2' + (guias ? ',drawbox=x=79:y=0:w=2:h=ih:color=yellow@0.8:t=fill,drawbox=x=159:y=0:w=2:h=ih:color=red@0.9:t=fill,drawbox=x=239:y=0:w=2:h=ih:color=yellow@0.8:t=fill' : ''), f]);
    return f;
  });
  const out = path.join(dir, `mapa-${String(s + 1).padStart(2, '0')}.jpg`);
  const inputs = thumbs.flatMap((f) => ['-i', f]);
  const n = thumbs.length;
  const layout = thumbs.map((_, i) => `${(i % 4) * 320}_${Math.floor(i / 4) * 180}`).join('|');
  if (n === 1) fs.copyFileSync(thumbs[0], out);
  else execFileSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', `${thumbs.map((_, i) => `[${i}:v]`).join('')}xstack=inputs=${n}:layout=${layout}:fill=black`, '-frames:v', '1', out]);
  thumbs.forEach((f) => fs.rmSync(f));
  sheets.push({arquivo: out, miniaturas: chunk.map(fmt)});
}
console.log(JSON.stringify({intervalo: every, folhas: sheets}, null, 2));
