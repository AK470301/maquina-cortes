#!/usr/bin/env node
// Monta o compilado 16:9 (8–12 min) com ffmpeg: o motor dos cortes só faz 9:16, então o longo é feito aqui.
// Sem narração: entre os clipes entram cartões visuais de 2 s (quadro congelado desfocado + nome do streamer +
// capítulo + uma linha de contexto) com um whoosh de transição.
// Uso: node compilado.mjs <compilado.json> <saida.mp4>
// compilado.json:
// { "titulo": "GTA 6 vs GTA 5: 7 mudanças que vão mudar seu jeito de jogar",
//   "abertura":   {"fonte": "/abs/live-a/work/source.mp4", "start": 5321.0, "end": 5329.0, "streamer": "Davy Jones"},
//   "segmentos": [ {"capitulo": "O prédio que ninguém achou", "streamer": "Davy Jones",
//                   "contexto": "Frase curta: o que está em jogo neste trecho",
//                   "fonte": "/abs/live-b/work/source.mp4", "start": 812.0, "end": 891.0} ],
//   "fechamento": {"fonte": "/abs/live-a/work/source.mp4", "quadro": 5340.0, "texto": "E você, qual mudança te preocupa mais?"} }
// Ordem: cartão do título → abertura (trecho curto) → [cartão do capítulo → trecho] × N → cartão de fechamento.
// Grava <saida>.capitulos.txt para a descrição do YouTube. Volume final −14 LUFS. Encoder: o mais rápido que funcionar
// (encoder.mjs: NVENC → VAAPI → libx264). Sai com código 1 fora de 8–12 min ou com capítulo < 10 s.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {RAIZ} from './env.mjs';
import {encoderH264} from './encoder.mjs';

const [planoFile, saida] = process.argv.slice(2);
if (!saida) {
  console.error('Uso: node compilado.mjs <compilado.json> <saida.mp4>');
  process.exit(1);
}
const plano = JSON.parse(fs.readFileSync(planoFile, 'utf8'));
const base = path.dirname(path.resolve(planoFile));
const abs = (f) => (path.isAbsolute(f) ? f : path.join(base, f));
const faltando = [plano.abertura, ...plano.segmentos, plano.fechamento].map((p) => p.fonte).filter((f) => !fs.existsSync(abs(f)));
if (faltando.length) {
  console.error(`Fontes que faltam:\n${[...new Set(faltando)].join('\n')}`);
  process.exit(1);
}
const enc = encoderH264();
const W = 1920, H = 1080, FPS = 30, CARTAO = 2;
const FONTES_WIN = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
const FONTE = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  path.join(FONTES_WIN, 'arialbd.ttf'),
  path.join(FONTES_WIN, 'segoeuib.ttf'),
  path.join(FONTES_WIN, 'arial.ttf'),
].find((f) => fs.existsSync(f));
// caminho dentro de um filtro do ffmpeg: no Windows o "C:" e as barras invertidas quebram a leitura das opções
const noFiltro = (f) => `'${f.replace(/\\/g, '/').replace(/:/g, '\\:')}'`;
const WHOOSH = path.join(RAIZ, 'assets', 'sfx', 'whoosh.wav');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'compilado-'));
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], {encoding: 'utf8'}).trim());
const ff = (args) => execFileSync(enc.ffmpeg, ['-y', '-v', 'error', ...enc.entrada, ...args]);
const vfFinal = (vf) => [vf, enc.filtro].filter(Boolean).join(',');
const audio = ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'];
let n = 0;
const pecas = [];
const capitulos = [];
let relogio = 0;

// quebra o texto em linhas de até `max` caracteres
const quebrar = (t, max) => {
  const linhas = [];
  let cur = '';
  for (const p of String(t || '').split(/\s+/).filter(Boolean)) {
    if (cur && (cur + ' ' + p).length > max) {
      linhas.push(cur);
      cur = p;
    } else cur = cur ? `${cur} ${p}` : p;
  }
  if (cur) linhas.push(cur);
  return linhas.join('\n');
};
// um drawtext por linha, cada uma centralizada (o drawtext com várias linhas centraliza só o bloco)
const texto = (t, y, size, cor = 'white') => {
  if (!FONTE || !t) return '';
  return String(t)
    .split('\n')
    .map((linha, i) => {
      const tf = path.join(tmp, `t${n}-${y}-${i}.txt`);
      fs.writeFileSync(tf, linha);
      return `,drawtext=fontfile=${noFiltro(FONTE)}:textfile=${noFiltro(tf)}:fontcolor=${cor}:fontsize=${size}:borderw=4:bordercolor=black:x=(w-text_w)/2:y=${y + i * Math.round(size * 1.25)}`;
    })
    .join('');
};

// cartão de 2 s: quadro congelado do segundo `t`, desfocado e escurecido, com texto e whoosh
function cartao(fonte, t, {topo, titulo, contexto}) {
  const out = path.join(tmp, `p${n++}.mp4`);
  const quadro = path.join(tmp, `q${n}.png`);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(t), '-i', abs(fonte), '-frames:v', '1', quadro]);
  const vf =
    `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=18:2,eq=brightness=-0.28:saturation=0.7,` +
    `zoompan=z='1+0.0015*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${CARTAO * FPS}:s=${W}x${H}:fps=${FPS},setsar=1` +
    texto(topo, 300, 46, '#FF3EA5') +
    texto(quebrar(titulo, 30), 380, 92) +
    texto(quebrar(contexto, 56), 640, 48);
  const som = fs.existsSync(WHOOSH) ? ['-i', WHOOSH] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'];
  ff(['-loop', '1', '-i', quadro, ...som, '-filter_complex', `[0:v]${vfFinal(vf)}[v];[1:a]aresample=48000,aformat=channel_layouts=stereo,apad[a]`, '-map', '[v]', '-map', '[a]', '-t', String(CARTAO), '-r', String(FPS), ...enc.args, ...audio, out]);
  pecas.push(out);
  relogio += dur(out);
}

// trecho original da live, com crédito do streamer no canto
function trecho(fonte, start, end, credito) {
  const out = path.join(tmp, `p${n++}.mp4`);
  const vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS}${credito ? texto(credito, 40, 40).replace('x=(w-text_w)/2', 'x=w-text_w-50') : ''}`;
  ff(['-ss', String(start), '-to', String(end), '-i', abs(fonte), '-vf', vfFinal(vf), '-r', String(FPS), ...enc.args, ...audio, out]);
  pecas.push(out);
  relogio += dur(out);
}

const credito = (s) => (s ? `@ ${s}` : '');
const ab = plano.abertura;
capitulos.push({t: 0, titulo: 'Abertura'});
cartao(ab.fonte, ab.start, {topo: ab.streamer ? `com ${ab.streamer}` : '', titulo: plano.titulo, contexto: ''});
trecho(ab.fonte, ab.start, ab.end, credito(ab.streamer));
for (const s of plano.segmentos) {
  capitulos.push({t: relogio, titulo: s.capitulo});
  cartao(s.fonte, s.start, {topo: s.streamer, titulo: s.capitulo, contexto: s.contexto});
  trecho(s.fonte, s.start, s.end, credito(s.streamer));
}
const fe = plano.fechamento;
cartao(fe.fonte, fe.quadro, {topo: '', titulo: fe.texto || 'E você, o que achou?', contexto: 'Comenta aqui embaixo'});

const lista = path.join(tmp, 'lista.txt');
fs.writeFileSync(lista, pecas.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
const junto = path.join(tmp, 'junto.mp4');
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lista, '-c', 'copy', junto]);
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', junto, '-c:v', 'copy', '-af', 'loudnorm=I=-14:TP=-1:LRA=11', ...audio, '-movflags', '+faststart', saida]);
fs.rmSync(tmp, {recursive: true, force: true});

const total = dur(saida);
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
fs.writeFileSync(`${saida}.capitulos.txt`, capitulos.map((c) => `${mmss(c.t)} ${c.titulo}`).join('\n') + '\n');
const erros = [];
if (total < 480 || total > 720) erros.push(`duração ${mmss(total)} fora de 8–12 min: some, tire ou alongue segmentos`);
const curtos = capitulos.filter((c, i) => (capitulos[i + 1]?.t ?? total) - c.t < 10);
if (curtos.length) erros.push(`capítulos com menos de 10 s (o YouTube ignora): ${curtos.map((c) => c.titulo).join(', ')}`);
console.log(JSON.stringify({ok: !erros.length, saida, duracao: mmss(total), encoder: enc.nome, capitulos: `${saida}.capitulos.txt`, erros}, null, 2));
process.exit(erros.length ? 1 : 0);
