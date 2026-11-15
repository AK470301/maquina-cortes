#!/usr/bin/env node
// Transcreve o vídeo com whisper.cpp (palavra por palavra), mede os silêncios e marca os picos de empolgação.
// Uso: node scripts/transcribe.mjs <video> <pasta_de_trabalho> [idioma] [segundos_maximos]
// Saídas na pasta de trabalho: audio16k.wav, captions.json, silences.json, energia.json, meta.json
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {transcribe, toCaptions} from '@remotion/install-whisper-cpp';

const [video, work, langArg, maxArg] = process.argv.slice(2);
if (!video || !work) {
  console.error('Uso: node scripts/transcribe.mjs <video> <pasta_de_trabalho> [idioma] [segundos_maximos]');
  process.exit(1);
}
// Opcional: transcrever só os primeiros N segundos (útil para testar rápido em vídeo longo).
const maxSeconds = maxArg ? Number(maxArg) : null;
const HOME = path.join(os.homedir(), '.maquina-cortes-gta');
const cfg = JSON.parse(fs.readFileSync(path.join(HOME, 'config.json'), 'utf8'));
const model = cfg.whisperModel || 'small';
const language = langArg || cfg.language || 'pt';
fs.mkdirSync(work, {recursive: true});

// metadados
const probe = JSON.parse(
  execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate:format=duration', '-of', 'json', video], {encoding: 'utf8'}),
);
const meta = {duration: Number(probe.format.duration), width: probe.streams[0].width, height: probe.streams[0].height, fps: probe.streams[0].r_frame_rate};
fs.writeFileSync(path.join(work, 'meta.json'), JSON.stringify(meta, null, 2));

// áudio 16 kHz mono (formato que o whisper.cpp pede)
// caminho absoluto: o whisper.cpp roda com outra pasta atual e não acharia um caminho relativo como "work/..."
const wav = path.resolve(work, 'audio16k.wav');
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', video, ...(maxSeconds ? ['-t', String(maxSeconds)] : []), '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);

const audioEnd = maxSeconds ? Math.min(meta.duration, maxSeconds) : meta.duration;

// silêncios (para cortar as pausas depois). d=0.3: pausa entre frases a partir de 0,3 s vira 0,2 s no build.
const sd = spawnSync('ffmpeg', ['-hide_banner', '-i', wav, '-af', 'silencedetect=noise=-35dB:d=0.3', '-f', 'null', '-'], {encoding: 'utf8', maxBuffer: 256 * 1024 * 1024});
const silences = [];
let open = null;
for (const line of sd.stderr.split(/\r?\n/)) {
  const a = line.match(/silence_start: ([0-9.]+)/);
  const b = line.match(/silence_end: ([0-9.]+)/);
  if (a) open = Number(a[1]);
  if (b && open !== null) {
    silences.push({start: open, end: Number(b[1])});
    open = null;
  }
}
if (open !== null) silences.push({start: open, end: audioEnd});
fs.writeFileSync(path.join(work, 'silences.json'), JSON.stringify(silences, null, 2));

// picos de empolgação (🔊): segundos em que a voz fica bem mais alta que o normal DESTE vídeo (grito, risada,
// surpresa). Relativo à mediana do próprio vídeo, para funcionar também em live com música ou jogo por baixo.
// Nunca derruba a transcrição: se falhar, grava uma lista vazia.
let energia = [];
try {
  const eb = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', wav, '-af', 'ebur128=framelog=info', '-f', 'null', '-'], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  const perSec = new Map(); // segundo -> [loudness momentânea]
  for (const line of (eb.stderr || '').split(/\r?\n/)) {
    const m = line.match(/\bt:\s*([0-9.]+)\s.*?\bM:\s*(-?[0-9.]+|-inf)/);
    if (!m || m[2] === '-inf') continue;
    const sec = Math.floor(Number(m[1]));
    if (!perSec.has(sec)) perSec.set(sec, []);
    perSec.get(sec).push(Number(m[2]));
  }
  const secs = [...perSec.entries()].map(([s, v]) => ({s, lu: v.reduce((a, b) => a + b, 0) / v.length})).filter((x) => x.lu > -60);
  const sorted = secs.map((x) => x.lu).sort((a, b) => a - b);
  if (sorted.length >= 30) {
    const median = sorted[Math.floor(sorted.length / 2)];
    const hot = secs.filter((x) => x.lu >= median + 6).sort((a, b) => a.s - b.s);
    for (const h of hot) {
      const last = energia[energia.length - 1];
      if (last && h.s - last.end <= 1) {
        last.end = h.s + 1;
        last.lu = Math.max(last.lu, h.lu);
      } else energia.push({start: h.s, end: h.s + 1, lu: h.lu});
    }
    energia = energia.map((e) => ({...e, lu: Number(e.lu.toFixed(1)), acimaDaMediana: Number((e.lu - median).toFixed(1))}));
  }
} catch (e) {
  console.warn(`Não consegui medir a empolgação pelo áudio (${e.message}); seguindo sem as marcas 🔊.`);
}
fs.writeFileSync(path.join(work, 'energia.json'), JSON.stringify(energia, null, 2));

// transcrição com tempo por palavra
const out = await transcribe({
  inputPath: wav,
  whisperPath: path.join(HOME, 'whisper.cpp'),
  whisperCppVersion: '1.5.5',
  model,
  tokenLevelTimestamps: true,
  language,
  printOutput: false,
});
const {captions} = toCaptions({whisperCppOutput: out});

// junta os pedaços (tokens) em palavras: um token que começa com espaço abre uma palavra nova
const words = [];
for (const c of captions) {
  const raw = c.text;
  if (/^\s*\[.*\]\s*$/.test(raw)) continue; // [_BEG_], [MÚSICA] etc.
  const startsWord = /^\s/.test(raw) || words.length === 0;
  const t = raw.trim();
  if (!t) continue;
  if (startsWord) words.push({text: t, startMs: c.startMs, endMs: c.endMs});
  else {
    const w = words[words.length - 1];
    w.text += t;
    w.endMs = c.endMs;
  }
}
fs.writeFileSync(path.join(work, 'captions.json'), JSON.stringify(words, null, 2));
console.log(JSON.stringify({palavras: words.length, silencios: silences.length, picosDeEmpolgacao: energia.length, duracao: meta.duration, idioma: language, modelo: model}));
