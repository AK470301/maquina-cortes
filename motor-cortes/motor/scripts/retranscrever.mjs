#!/usr/bin/env node
// Transcreve de novo só algumas janelas do vídeo e troca as palavras delas no captions.json.
// Serve para quando o whisper "trava" e repete a mesma frase dezenas de vezes (comum em live com som de jogo):
// janelas curtas e sem contexto entre trechos (--max-context 0) quase sempre corrigem.
// Uso: node scripts/retranscrever.mjs <pasta_de_trabalho> <inicio-fim>[,<inicio-fim>...] [idioma]
//   ex.: node scripts/retranscrever.mjs work 410-470,1880-1960 pt     (segundos do vídeo de origem)
//   ou:   node scripts/retranscrever.mjs <pasta_de_trabalho> limpar     (só a limpeza abaixo, sem whisper)
// Depois, limpa o captions.json inteiro: tira marcações como *risos*, [MÚSICA], (aplausos) e corta rajadas
// da mesma palavra em no máximo 4 ("não, não, não, não" × 100 vira 4).
// Guarda uma cópia do original em captions.orig.json (só na primeira vez).
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {transcribe, toCaptions} from '@remotion/install-whisper-cpp';

const [work, janelasArg, idiomaArg] = process.argv.slice(2);
if (!work || !janelasArg) {
  console.error('Uso: node scripts/retranscrever.mjs <pasta_de_trabalho> <inicio-fim>[,<inicio-fim>...] [idioma]');
  process.exit(1);
}
const HOME = path.join(os.homedir(), '.maquina-cortes-gta');
const cfg = JSON.parse(fs.readFileSync(path.join(HOME, 'config.json'), 'utf8'));
const language = idiomaArg || cfg.language || 'pt';
const model = cfg.whisperModel || 'small';
const soLimpar = janelasArg === 'limpar';
const janelas = (soLimpar ? '' : janelasArg).split(',').filter(Boolean).map((j) => {
  const [a, b] = j.split('-').map(Number);
  if (!(b > a)) throw new Error(`janela inválida: ${j}`);
  return {a, b};
});

const capFile = path.join(work, 'captions.json');
const orig = path.join(work, 'captions.orig.json');
if (!fs.existsSync(orig)) fs.copyFileSync(capFile, orig);
let words = JSON.parse(fs.readFileSync(capFile, 'utf8'));
const video = path.resolve(work, 'source.mp4');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'retranscrever-'));

// palavras repetidas em sequência longa = sinal de que o whisper travou
const travadas = (ws) => {
  let max = 0;
  for (let i = 0; i < ws.length; i++) {
    let n = 1;
    while (i + n < ws.length && ws[i + n].text.toLowerCase() === ws[i].text.toLowerCase()) n++;
    max = Math.max(max, n);
  }
  return max;
};

const relatorio = [];
for (const {a, b} of janelas) {
  const wav = path.join(tmp, `${a}-${b}.wav`);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(a), '-t', String(b - a), '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
  const out = await transcribe({
    inputPath: wav,
    whisperPath: path.join(HOME, 'whisper.cpp'),
    whisperCppVersion: '1.5.5',
    model,
    tokenLevelTimestamps: true,
    language,
    printOutput: false,
    additionalArgs: [['--max-context', '0']],
  });
  const {captions} = toCaptions({whisperCppOutput: out});
  const novas = [];
  for (const c of captions) {
    const raw = c.text;
    if (/^\s*\[.*\]\s*$/.test(raw)) continue;
    const t = raw.trim();
    if (!t) continue;
    const s = c.startMs + a * 1000;
    const e = c.endMs + a * 1000;
    if (/^\s/.test(raw) || novas.length === 0) novas.push({text: t, startMs: s, endMs: e});
    else {
      novas[novas.length - 1].text += t;
      novas[novas.length - 1].endMs = e;
    }
  }
  const antes = words.filter((w) => w.startMs >= a * 1000 && w.startMs < b * 1000);
  words = [...words.filter((w) => w.startMs < a * 1000 || w.startMs >= b * 1000), ...novas.filter((w) => w.startMs < b * 1000)].sort((x, y) => x.startMs - y.startMs);
  relatorio.push({janela: `${a}-${b}`, palavrasAntes: antes.length, palavrasDepois: novas.length, repeticaoMaxAntes: travadas(antes), repeticaoMaxDepois: travadas(novas)});
}
// limpeza: marcações entre * [ ( e rajadas da mesma palavra
const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const marcacao = (t) => /^[*\[(]/.test(t) || /[*\])]$/.test(t);
const antesLimpeza = words.length;
const limpas = [];
let rajada = 0;
for (const w of words) {
  if (marcacao(w.text) || !norm(w.text)) continue;
  const igual = limpas.length && norm(limpas[limpas.length - 1].text) === norm(w.text);
  rajada = igual ? rajada + 1 : 1;
  if (rajada <= 4) limpas.push(w);
}
words = limpas;
relatorio.push({limpeza: {palavrasAntes: antesLimpeza, palavrasDepois: words.length, repeticaoMax: travadas(words)}});
fs.writeFileSync(capFile, JSON.stringify(words, null, 2));
fs.rmSync(tmp, {recursive: true, force: true});
console.log(JSON.stringify(relatorio, null, 2));
