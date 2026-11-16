#!/usr/bin/env node
// Monta e renderiza os cortes: tira as pausas, ajusta as legendas à nova linha do tempo, roda o Remotion
// e deixa o volume de cada corte em −14 LUFS.
// Uso: node scripts/build.mjs <pasta_de_trabalho> <pasta_de_saida> [--so id1,id2]
//   --so: renderiza só os cortes com esses ids (os outros do cuts.json ficam como estão)
// A pasta de trabalho precisa ter: source.mp4, captions.json, silences.json, meta.json, cuts.json
// (bottom.mp4 é opcional: fundo do B-roll no layout papo). cuts.json:
//   { "layout": "papo" | "gameplay" | "cheia",      (padrão "papo"; um corte pode trocar com "layout" próprio)
//     "streamer": "slug",                          (paleta em ~/.maquina-cortes-gta/streamers/<slug>.json)
//     "clips": [ { "id": "01-gancho", "start": 12.4, "end": 51.0,
//                  "keywords": ["100 mil", "exército"],          palavras sempre na cor de destaque
//                  "focus": {"x": 50, "y": 35}, "crop": {x,y,w,h},  enquadramento de quem fala / da webcam
//                  "broll": [{"file": "...mp4|jpg", "at": 14.0, "dur": 3}],   papo: apoio na metade de baixo
//                  "gameCrop": {x,y,w,h}, "semCamera": false,               gameplay: recorte do jogo
//                  "focusTrack": [{"at": 12.4, "x": 40, "y": 40}],          cheia: o foco segue a pessoa
//                  "captionY": 1250, "bottomStart": 0, "turns": [...], "images": [...],
//                  "titulo": "Frase curta no topo",                 título fixo no topo nos primeiros segundos (opcional)
//                  "tituloDur": 4, "tituloSfx": ["/abs/impacto.wav", "/abs/whoosh.wav"] } ] }   (sons tocam no 1º quadro)
// Render: ~/.maquina-cortes-gta/config.json → "render": {"concurrency": 12, "gl": "angle"} (opcional)
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {searchImages} from './buscar-imagens.mjs';
import {searchBroll} from './buscar-broll.mjs';
import {TRAVA_RENDER, travar} from './trava.mjs';

const args = process.argv.slice(2);
const soIdx = args.indexOf('--so');
const so = soIdx >= 0 ? new Set((args.splice(soIdx, 2)[1] || '').split(',').map((s) => s.trim()).filter(Boolean)) : null;
const [work, outDir] = args;
if (!work || !outDir || (so && !so.size)) {
  console.error('Uso: node scripts/build.mjs <pasta_de_trabalho> <pasta_de_saida> [--so id1,id2]');
  process.exit(1);
}
const FPS = 30;
const HOME = path.join(os.homedir(), '.maquina-cortes-gta');
const ENGINE = path.join(HOME, 'engine');
const cfg = JSON.parse(fs.readFileSync(path.join(HOME, 'config.json'), 'utf8'));
const read = (f) => JSON.parse(fs.readFileSync(path.join(work, f), 'utf8'));
const words = read('captions.json');
const silences = read('silences.json');
const cuts = read('cuts.json');
const meta = read('meta.json');
fs.mkdirSync(outDir, {recursive: true});

// marca d'água (opcional): só entra se o perfil tiver nome e logo configurados
let watermark = null;
if (cfg.profileName && cfg.logo && fs.existsSync(path.join(HOME, cfg.logo))) {
  const logoName = `wm-${cfg.logo}`;
  fs.copyFileSync(path.join(HOME, cfg.logo), path.join(work, logoName));
  watermark = {logo: logoName, name: cfg.profileName};
}

const probeDur = (f) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], {encoding: 'utf8'}).trim());
const hasBottom = fs.existsSync(path.join(work, 'bottom.mp4'));
const bottomTotal = hasBottom ? probeDur(path.join(work, 'bottom.mp4')) : 0;
const sourceTotal = probeDur(path.join(work, 'source.mp4'));

// paleta do streamer (cor base do texto e cor de destaque); sem streamer, branco e amarelo
let palette = {base: '#FFFFFF', destaque: '#FFD400'};
if (cuts.streamer) {
  const pf = path.join(HOME, 'streamers', `${cuts.streamer}.json`);
  if (fs.existsSync(pf)) {
    const p = JSON.parse(fs.readFileSync(pf, 'utf8'));
    palette = {base: p.corBase || palette.base, destaque: p.corDestaque || palette.destaque};
  } else console.warn(`Streamer "${cuts.streamer}" sem paleta salva; usando branco e amarelo.`);
}

// palavras-chave: comparação sem acento, sem caixa e sem pontuação
const norm = (t) =>
  t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
function markKeywords(list, keywords) {
  const kws = (keywords || []).map((k) => k.split(/\s+/).map(norm).filter(Boolean)).filter((k) => k.length);
  const n = list.map((w) => norm(w.text));
  for (const kw of kws) {
    for (let i = 0; i + kw.length <= n.length; i++) {
      if (kw.every((part, j) => n[i + j] === part)) for (let j = 0; j < kw.length; j++) list[i + j].kw = true;
    }
  }
  return list;
}

const isImage = (f) => /\.(jpe?g|png|webp)$/i.test(f);

// volume final em −14 LUFS (padrão do YouTube/TikTok), pico ≤ −1 dBTP: loudnorm em duas passadas, vídeo copiado.
// Devolve o volume medido antes (LUFS) ou null; se falhar, mantém o arquivo como saiu do render.
function normalizeLoudness(file) {
  const target = 'I=-14:TP=-1:LRA=11';
  const tmp = file.replace(/\.mp4$/i, '') + '.norm.mp4';
  try {
    const m = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-'], {encoding: 'utf8'});
    const err = m.stderr || '';
    const j = JSON.parse(err.slice(err.lastIndexOf('{'), err.lastIndexOf('}') + 1));
    if (!Number.isFinite(Number(j.input_i))) throw new Error('corte sem áudio mensurável');
    const af = `loudnorm=${target}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', file, '-af', af, '-ar', '48000', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', tmp]);
    fs.renameSync(tmp, file);
    return Number(j.input_i);
  } catch (e) {
    fs.rmSync(tmp, {force: true});
    console.warn(`Volume de ${path.basename(file)} não foi ajustado (${e.message}); o arquivo ficou como saiu do render.`);
    return null;
  }
}

// a pausa que começa no instante t (em segundos) fica entre duas frases? Sim se a última palavra antes dela
// termina em . ! ? … ou se há um "-" de diálogo (troca de quem fala) logo antes ou logo depois dela.
const isDash = (w) => /^[-–—]+$/.test(w.text);
const endsSentence = (t) => {
  let prev = null;
  for (const w of words) {
    const ws = w.startMs / 1000;
    if (isDash(w) && Math.abs(ws - t) < 0.6) return true;
    if (ws > t + 0.6) break;
    if (w.endMs / 1000 <= t + 0.05 && !isDash(w)) prev = w;
  }
  return !!prev && /[.!?…]$/.test(prev.text);
};

// tira as pausas: entre frases, pausa de 0,3 s ou mais vira ~0,2 s (`pad` de respiro em cada ponta);
// dentro da frase, só pausa de 0,5 s ou mais é encurtada (as curtas fazem parte da fala).
function segmentsFor(start, end, {minLong = 0.5, minShort = 0.3, pad = 0.1} = {}) {
  let cursor = start;
  const segs = [];
  for (const s of silences) {
    if (s.end <= start || s.start >= end) continue;
    const d = s.end - s.start;
    if (d < minShort || (d < minLong && !endsSentence(s.start))) continue;
    const cutFrom = Math.max(s.start + pad, start);
    const cutTo = Math.min(s.end - pad, end);
    if (cutTo - cutFrom < 0.1) continue;
    if (cutFrom - cursor > 0.3) segs.push({from: cursor, to: cutFrom});
    cursor = cutTo;
  }
  if (end - cursor > 0.3) segs.push({from: cursor, to: end});
  return segs.length ? segs : [{from: start, to: end}];
}

// cortes rápidos: quebra planos longos a cada ~`every` segundos, sempre no começo de uma palavra
// (não tira conteúdo; cada quebra é um jump cut com mudança de zoom, SEM flash nem swoosh; só as viradas de seção
// listadas em `turns` ganham flash e swoosh). every = 0 desliga.
function splitSegs(segs, every) {
  if (!every) return segs;
  const out = [];
  for (const s of segs) {
    const starts = words.map((w) => w.startMs / 1000).filter((t) => t > s.from + 1 && t < s.to - 1);
    let cursor = s.from;
    while (s.to - cursor > every * 1.5) {
      const target = cursor + every;
      const cand = starts
        .filter((t) => t > cursor + 1.2 && t < s.to - 1)
        .sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
      if (!cand) break;
      out.push({from: cursor, to: cand});
      cursor = cand;
    }
    out.push({from: cursor, to: s.to});
  }
  return out;
}

// agrupa as palavras em páginas de até 3 palavras
function makePages(list) {
  const pages = [];
  let cur = [];
  const flush = () => {
    if (cur.length) pages.push({words: cur, startMs: cur[0].startMs, endMs: cur[cur.length - 1].endMs});
    cur = [];
  };
  for (const w of list) {
    const gap = cur.length ? w.startMs - cur[cur.length - 1].endMs : 0;
    const chars = cur.reduce((n, x) => n + x.text.length, 0) + w.text.length;
    if (cur.length >= 3 || chars > 20 || gap > 600) flush();
    cur.push(w);
    if (/[.!?…]$/.test(w.text)) flush();
  }
  flush();
  pages.forEach((p, i) => {
    const next = pages[i + 1];
    p.endMs = Math.min(next ? next.startMs : Infinity, p.endMs + 250);
    p.words = p.words.map((w) => ({...w, text: w.text.replace(/[,;:]$/, '')}));
  });
  return pages;
}

const results = [];
if (so) {
  const faltam = [...so].filter((id) => !cuts.clips.some((c) => c.id === id));
  if (faltam.length) {
    console.error(`--so: id não encontrado no cuts.json: ${faltam.join(', ')}`);
    process.exit(1);
  }
}
for (const [idx, clip] of cuts.clips.entries()) {
  if (so && !so.has(clip.id)) continue;
  const start = Math.max(0, clip.start);
  const end = Math.min(sourceTotal, clip.end);
  // `ritmo`: padrão = jump cuts a cada ~2,8 s (zoom muda, corte seco, SEM swoosh); "normal" = só tira as pausas;
  // "rapido" = o estilo antigo (flash + swoosh em TODO corte); `cutEvery` em segundos muda o intervalo.
  // `turns`: lista de segundos (do vídeo de origem) das VIRADAS DE SEÇÃO (muda de assunto, entra b-roll, ex.: o
  // streamer cita PlayStation/PS5): só nelas entram flash e swoosh (3 a 5 por corte).
  const layoutKind = clip.layout || cuts.layout || 'papo';
  const legacy = clip.ritmo === 'rapido';
  const every = clip.ritmo === 'normal' ? 0 : clip.cutEvery ?? (legacy ? 3.2 : 2.8);
  let segs = splitSegs(segmentsFor(start, end), every);
  for (const t of clip.turns || []) {
    if (t < start || t > end) {
      console.warn(`[${clip.id}] virada em ${t}s está fora do corte (${start}–${end}s); ignorada.`);
      continue;
    }
    const k = segs.findIndex((x) => t > x.from + 0.3 && t < x.to - 0.3);
    if (k >= 0) {
      segs.splice(k, 1, {from: segs[k].from, to: t, forceTurn: segs[k].forceTurn}, {from: t, to: segs[k].to, forceTurn: true});
      continue;
    }
    // caiu numa pausa removida ou colada numa borda de plano: a virada vai para o próximo plano
    const n = segs.findIndex((x) => x.from >= t - 0.3);
    if (n > 0) segs[n].forceTurn = true;
    else if (n < 0) console.warn(`[${clip.id}] virada em ${t}s caiu depois da última fala do corte; ignorada.`);
  }
  segs.forEach((x, i) => {
    x.turn = i > 0 && (legacy || !!x.forceTurn);
  });
  // tela cheia: cada plano usa o ponto do focusTrack mais recente antes do início dele (a troca cai num jump cut)
  if (clip.focusTrack?.length) {
    const track = [...clip.focusTrack].sort((a, b) => a.at - b.at);
    for (const x of segs) {
      const p = track.filter((q) => q.at <= x.from + 0.05).pop() || track[0];
      x.focus = {x: p.x, y: p.y};
    }
  }

  // linha do tempo nova, em quadros inteiros (mesma conta do componente)
  let outFrames = 0;
  const mapped = segs.map((s) => {
    const frames = Math.max(1, Math.round((s.to - s.from) * FPS));
    const m = {...s, outStart: outFrames / FPS};
    outFrames += frames;
    return m;
  });
  const total = outFrames / FPS;

  const remapped = [];
  for (const w of words) {
    if (!/[\p{L}\p{N}]/u.test(w.text)) continue; // "-" de diálogo e outra pontuação solta não viram legenda
    const ws = w.startMs / 1000;
    const seg = mapped.find((s) => ws >= s.from - 0.02 && ws < s.to);
    if (!seg) continue;
    const o = seg.outStart + Math.max(0, ws - seg.from);
    const oe = Math.min(seg.outStart + (seg.to - seg.from), o + Math.max(0.12, (w.endMs - w.startMs) / 1000));
    remapped.push({text: w.text.toUpperCase(), startMs: Math.round(o * 1000), endMs: Math.round(oe * 1000)});
  }
  markKeywords(remapped, clip.keywords);

  // ---- efeitos sonoros e imagens ----
  // segundo do vídeo de origem -> segundo do corte. Se cair numa pausa removida, vai para o começo do próximo plano;
  // antes do corte vira 0; depois da última fala devolve null (o chamador pula).
  const toOut = (t) => {
    const m = mapped.find((x) => t >= x.from - 0.02 && t < x.to);
    if (m) return Math.max(0, m.outStart + (t - m.from));
    if (t < mapped[0].from) return 0;
    const next = mapped.find((x) => x.from > t);
    return next ? next.outStart : null;
  };
  const sfxDir = path.join(HOME, 'sfx');
  const gain = cfg.sfxGain ?? 0.6; // volume geral dos efeitos (os efeitos ficam bem abaixo da voz)
  const sfxFile = (name) => {
    const f = ['.mp3', '.wav'].map((e) => path.join(sfxDir, name + e)).find((p) => fs.existsSync(p));
    if (!f) return null;
    const dst = `sfx-${name}${path.extname(f)}`;
    fs.copyFileSync(f, path.join(work, dst));
    return dst;
  };
  const sfx = [];
  const impact = sfxFile('impacto');
  const whoosh = sfxFile('whoosh');
  const pop = sfxFile('pop');
  // título no topo: os sons próprios dele substituem o impacto padrão do começo
  const tituloSfx = clip.titulo ? (clip.tituloSfx || []).filter((f) => fs.existsSync(f)) : [];
  tituloSfx.forEach((f, k) => {
    const dst = `sfx-titulo-${k}${path.extname(f)}`;
    fs.copyFileSync(f, path.join(work, dst));
    sfx.push({file: dst, at: 0, volume: 0.55 * gain});
  });
  if (impact && !tituloSfx.length) sfx.push({file: impact, at: 0, volume: 0.5 * gain});
  if (whoosh) mapped.filter((m) => m.turn).forEach((m) => sfx.push({file: whoosh, at: Math.max(0, m.outStart - 0.08), volume: 0.45 * gain}));
  const images = [];
  for (const [k, im] of (clip.images || []).entries()) {
    const at = toOut(im.at);
    if (at === null || at > total - 0.5) {
      console.warn(`[${clip.id}] imagem em ${im.at}s cai depois do fim do corte; ignorada.`);
      continue;
    }
    let src = im.file && fs.existsSync(im.file) ? im.file : null;
    if (!src && im.query) {
      try {
        [src] = await searchImages(im.query, path.join(work, 'imgs'), 1, `${clip.id}-${k}`);
      } catch (e) {
        console.warn(`Imagem "${im.query}" ignorada: ${e.message}. Opções: configurar GOOGLE_API_KEY e GOOGLE_CSE_ID, mandar a imagem como arquivo ("file") ou seguir sem ela.`);
      }
    }
    if (!src) continue;
    const dst = `img-${clip.id}-${k}${path.extname(src)}`;
    fs.copyFileSync(src, path.join(work, dst));
    images.push({file: dst, at, dur: im.dur ?? 2.2});
    if (pop) sfx.push({file: pop, at: Math.max(0, at - 0.05), volume: 0.45 * gain});
  }

  // ---- layout e metade de baixo ----
  let layout;
  let bottom;
  if (layoutKind === 'cheia') {
    layout = {kind: 'cheia', topH: 1920};
    bottom = {kind: 'nenhum'};
  } else if (layoutKind === 'gameplay') {
    const semCamera = !!clip.semCamera || !clip.crop;
    if (!clip.crop && !clip.semCamera) console.warn(`[${clip.id}] gameplay sem "crop" da webcam: o jogo vai ocupar a tela toda (use "semCamera": true se for isso mesmo).`);
    if (!clip.gameCrop) console.warn(`[${clip.id}] gameplay sem "gameCrop": o jogo vai preencher a área pelo centro.`);
    layout = {kind: 'gameplay', topH: semCamera ? 0 : 730};
    bottom = {kind: 'source', crop: clip.gameCrop || null, focus: clip.gameFocus || {x: 50, y: 50}};
  } else {
    // papo: B-rolls por cima de um fundo (bottom.mp4 em loop ou, sem ele, a câmera desfocada)
    const items = [];
    for (const [k, b] of (clip.broll || []).entries()) {
      const at = toOut(b.at);
      if (at === null || at > total - 0.5) {
        console.warn(`[${clip.id}] B-roll em ${b.at}s cai depois do fim do corte; ignorado.`);
        continue;
      }
      let srcFile = b.file && fs.existsSync(b.file) ? b.file : null;
      if (!srcFile && b.query) {
        try {
          [srcFile] = await searchBroll(b.query, path.join(work, 'broll'), 1, `${clip.id}-${k}`);
        } catch (e) {
          console.warn(`B-roll "${b.query}" ignorado: ${e.message}`);
        }
      }
      if (!srcFile) continue;
      const dst = `broll-${clip.id}-${k}${path.extname(srcFile)}`;
      fs.copyFileSync(srcFile, path.join(work, dst));
      const tipo = isImage(srcFile) ? 'imagem' : 'video';
      const dur = Math.min(b.dur ?? 3, total - at);
      items.push({file: dst, tipo, outStart: at, dur, start: b.start || 0, fileDuration: tipo === 'video' ? probeDur(srcFile) - (b.start || 0) : 0});
    }
    let fallback = null;
    if (hasBottom) {
      const bottomStart = Math.min(clip.bottomStart ?? (8 + idx * 17) % Math.max(1, bottomTotal - 5), Math.max(0, bottomTotal - 5));
      fallback = {file: 'bottom.mp4', start: bottomStart, duration: bottomTotal - bottomStart};
    }
    layout = {kind: 'papo', topH: 960};
    bottom = {kind: 'broll', items, fallback};
  }

  if (clip.captionY) layout.captionY = clip.captionY; // centro vertical da legenda, em px (opcional)
  const props = {
    totalSeconds: total,
    layout,
    bottom,
    palette,
    segments: segs.map(({from, to, turn, focus}) => ({from, to, turn: !!turn, ...(focus ? {focus} : {})})),
    sourceFile: 'source.mp4',
    focus: clip.focus || {x: 50, y: 35},
    crop: layoutKind === 'cheia' ? null : clip.crop || null,
    sourceWidth: meta.width,
    sourceHeight: meta.height,
    pages: makePages(remapped),
    watermark,
    sfx,
    images,
    titulo: clip.titulo ? {texto: String(clip.titulo), dur: Math.min(clip.tituloDur ?? 4, total)} : null,
  };
  // caminho absoluto: o Remotion roda com a pasta do motor como pasta atual e não acharia "work/..."
  const propsFile = path.resolve(work, `props-${clip.id}.json`);
  fs.writeFileSync(propsFile, JSON.stringify(props));
  const out = path.resolve(outDir, `${clip.id}.mp4`);
  console.log(`> Renderizando ${clip.id} (${total.toFixed(1)} s)`);
  // chama o CLI do Remotion direto pelo Node (sem shell): funciona com espaços no caminho, no Windows e fora dele
  const cli = path.join(ENGINE, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');
  // fila de render da máquina: um render pesado por vez (o radar ao vivo do projeto usa a mesma trava). Pega e solta a
  // cada corte, para um clipe ao vivo poder entrar entre dois cortes de VOD; depois de 30 min de espera segue sem trava.
  const soltarRender = travar(TRAVA_RENDER, {esperaMs: 30 * 60e3, aoEsperar: () => console.log('  (render ocupado por outro processo: esperando a vez)')});
  const r = spawnSync(
    process.execPath,
    [
      cli, 'render', 'src/index.js', 'SplitCut', out, `--props=${propsFile}`, `--public-dir=${path.resolve(work)}`, '--codec=h264', '--crf=20', '--log=error',
      ...(cfg.render?.concurrency ? [`--concurrency=${cfg.render.concurrency}`] : []),
      ...(cfg.render?.gl ? [`--gl=${cfg.render.gl}`] : []),
    ],
    {cwd: ENGINE, stdio: 'inherit'},
  );
  soltarRender();
  const ok = r.status === 0;
  results.push({id: clip.id, layout: layoutKind, arquivo: out, segundos: Number(total.toFixed(1)), ok, lufsOriginal: ok ? normalizeLoudness(out) : null});
}
console.log(JSON.stringify(results, null, 2));
process.exit(results.every((r) => r.ok) ? 0 : 1);
