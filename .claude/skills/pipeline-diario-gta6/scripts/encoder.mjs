#!/usr/bin/env node
// Escolhe o encoder H.264 mais rápido que FUNCIONA nesta máquina: NVENC (NVIDIA) → VAAPI (AMD/Intel) → libx264.
// Testa de verdade (codifica 1 s) e guarda o resultado em <projeto>/.cache/encoder.json; --testar refaz o teste.
// FFMPEG_HW (ambiente ou .env) aponta um ffmpeg alternativo para o teste de GPU, ex.: /usr/bin/ffmpeg do apt, quando o
// ffmpeg do PATH é um build estático que não acessa a libva do sistema.
// Uso como script: node encoder.mjs [--testar]   → imprime {ffmpeg, nome, args}
// Uso como módulo: import {encoderH264} from './encoder.mjs'; const e = encoderH264(); e.ffmpeg, e.entrada, e.args, e.filtro
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {RAIZ, carregarEnv} from './env.mjs';

const DEV = '/dev/dri/renderD128';
const cacheFile = path.join(RAIZ, '.cache', 'encoder.json');

function candidatos() {
  const bins = [...new Set([process.env.FFMPEG_HW, 'ffmpeg'].filter(Boolean))];
  const lista = [];
  for (const ffmpeg of bins) {
    lista.push({ffmpeg, nome: 'h264_nvenc', entrada: [], filtro: '', args: ['-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', '21', '-b:v', '0']});
    if (fs.existsSync(DEV))
      lista.push({ffmpeg, nome: 'h264_vaapi', entrada: ['-vaapi_device', DEV], filtro: 'format=nv12,hwupload', args: ['-c:v', 'h264_vaapi', '-qp', '21']});
  }
  lista.push({ffmpeg: 'ffmpeg', nome: 'libx264', entrada: [], filtro: '', args: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p']});
  return lista;
}

function funciona(e) {
  const vf = ['scale=640:360', e.filtro].filter(Boolean).join(',');
  const r = spawnSync(e.ffmpeg, ['-v', 'error', ...e.entrada, '-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=1', '-vf', vf, ...e.args, '-f', 'null', '-'], {encoding: 'utf8', timeout: 30000});
  return r.status === 0;
}

export function encoderH264({testar = false} = {}) {
  carregarEnv();
  if (!testar && fs.existsSync(cacheFile)) {
    const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (c.ffmpegHw === (process.env.FFMPEG_HW || '')) return c.encoder;
  }
  const encoder = candidatos().find(funciona);
  fs.mkdirSync(path.dirname(cacheFile), {recursive: true});
  fs.writeFileSync(cacheFile, JSON.stringify({ffmpegHw: process.env.FFMPEG_HW || '', testadoEm: new Date().toISOString(), encoder}, null, 2));
  return encoder;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(encoderH264({testar: process.argv.includes('--testar')}), null, 2));
}
