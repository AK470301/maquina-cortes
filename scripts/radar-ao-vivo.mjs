#!/usr/bin/env node
// Radar ao vivo da Twitch: grava a live com o streamlink, acompanha o chat por IRC e, quando o chat dispara (pico de
// mensagens), corta o trecho, transcreve, renderiza em 9:16 e deixa o vídeo em <projeto>/para-postar/ esperando o OK.
// Módulo independente: não mexe na fila do dia nem no agendamento das 09:00 e 19:00 (rodar-diario).
//
// Uso: node scripts/radar-ao-vivo.mjs --canais coringa,paulinholokobr,luquet4 [opções]
//      node scripts/radar-ao-vivo.mjs --testar-irc <canal> [--segundos 20]     só conecta no chat e conta as mensagens
//      node scripts/radar-ao-vivo.mjs --simular <video local> [--canal <canal>] [--pico <s>]
//                                     ensaio: testa o detector com um chat sintético e faz o corte completo do vídeo
//                                     (grava como lote de calibração, que nunca é publicado nem avisado por e-mail)
// Opções (padrão entre parênteses):
//   --duracao 65     duração do corte em segundos            --antes 45      quanto do corte vem ANTES do pico
//   --fator 3        pico = taxa dos últimos 10 s ≥ fator × média móvel dos 5 min anteriores
//   --piso 8         mínimo de mensagens em 10 s para valer como pico (chat parado não dispara)
//   --cooldown 90    segundos entre dois cortes do mesmo canal --max-hora 6   teto de cortes por canal por hora (0 = sem teto)
//   --qualidade best qualidade pedida ao streamlink         --plataforma tiktok   tiktok | youtube_short
//
// Por canal: um socket TCP em irc.chat.twitch.tv:6667 (NICK justinfan<n>, anônimo, só leitura) e um
// `streamlink twitch.tv/<canal> <qualidade> -o fila/live-<canal>.ts --retry-streams 30`. Quando a live acaba o
// streamlink termina, o .ts é apagado e o radar volta a esperar a próxima live. Ctrl+C encerra e apaga os .ts.
//
// Corte: ffmpeg tira o trecho do .ts em andamento → whisper.cpp (modelo e idioma de ~/.maquina-cortes-gta/config.json)
// → legenda .ass palavra a palavra nas cores do streamer (~/.maquina-cortes-gta/streamers/<slug>.json) → render
// 1080×1920 com o próprio vídeo desfocado ao fundo e a janela 16:9 no centro, pelo encoder do encoder.mjs (NVENC na
// máquina com NVIDIA; cai para libx264 se não houver GPU), volume em −14 LUFS.
// Saída: para-postar/LIVE--<canal>--<AAAAMMDD-HHMMSS>.mp4 e um item em cortes/ao-vivo-<canal>/postagem.json com
// "ao_vivo": true e "aprovado": false; em seguida chama o notificar-email.mjs.
//
// O radar NUNCA publica. O item só sai com o OK do usuário (publicar.mjs), e aí sai na hora por ser "ao_vivo".
// Autorização: canal de streamer "proibido" no autorizacoes.json é recusado; sem autorização registrada, o item nasce
// com "sem_autorizacao": true (pede o OK extra). Música licenciada audível no trecho ⇒ descarte o corte na revisão.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {RAIZ, carregarEnv, lerJson} from '../.claude/skills/pipeline-diario-gta6/scripts/env.mjs';
import {encoderH264} from '../.claude/skills/pipeline-diario-gta6/scripts/encoder.mjs';

carregarEnv();
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const num = (k, d) => {
  const v = Number(opt(k, d));
  if (!Number.isFinite(v) || v < 0) {
    console.error(`${k} precisa ser um número (recebi "${opt(k, d)}")`);
    process.exit(1);
  }
  return v;
};
const CFG = {
  duracao: num('--duracao', 65),
  antes: num('--antes', 45),
  fator: num('--fator', 3),
  piso: num('--piso', 8),
  cooldown: num('--cooldown', 90),
  maxHora: num('--max-hora', 6),
  qualidade: opt('--qualidade', 'best'),
  plataforma: opt('--plataforma', 'tiktok'),
  janela: 10, // segundos de cada medição
  media: 300, // segundos da média móvel
};
if (CFG.antes >= CFG.duracao) {
  console.error('--antes precisa ser menor que --duracao');
  process.exit(1);
}
if (!['tiktok', 'youtube_short'].includes(CFG.plataforma)) {
  console.error('--plataforma: tiktok | youtube_short');
  process.exit(1);
}

const HOME = path.join(os.homedir(), '.maquina-cortes-gta');
const S = path.join(RAIZ, '.claude', 'skills', 'pipeline-diario-gta6', 'scripts');
const FILA = path.join(RAIZ, 'fila');
const PARA_POSTAR = path.join(RAIZ, 'para-postar');
const WIN = process.platform === 'win32';
fs.mkdirSync(FILA, {recursive: true});

const dois = (n) => String(n).padStart(2, '0');
const hora = (d = new Date()) => `${dois(d.getHours())}:${dois(d.getMinutes())}:${dois(d.getSeconds())}`;
const carimboDe = (d = new Date()) => `${d.getFullYear()}${dois(d.getMonth() + 1)}${dois(d.getDate())}-${dois(d.getHours())}${dois(d.getMinutes())}${dois(d.getSeconds())}`;
function log(canal, texto) {
  const linha = `${new Date().toISOString().slice(0, 10)} ${hora()} [${canal}] ${texto}`;
  console.log(linha);
  try {
    fs.appendFileSync(path.join(FILA, 'radar.log'), linha + '\n');
  } catch {}
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// roda um programa sem travar o laço de eventos (o chat continua sendo lido durante o corte)
function rodar(cmd, argumentos, {cwd, timeoutMs = 0} = {}) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let p;
    try {
      p = spawn(cmd, argumentos, {cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
    } catch (e) {
      resolve({status: -1, out, err: String(e.message || e)});
      return;
    }
    const t = timeoutMs ? setTimeout(() => p.kill(), timeoutMs) : null;
    p.stdout.on('data', (d) => (out = (out + d).slice(-200000)));
    p.stderr.on('data', (d) => (err = (err + d).slice(-20000)));
    p.on('error', (e) => {
      if (t) clearTimeout(t);
      resolve({status: -1, out, err: String(e.message || e)});
    });
    p.on('close', (c) => {
      if (t) clearTimeout(t);
      resolve({status: c, out, err});
    });
  });
}
const ultimaLinha = (t) => String(t || '').trim().split(/\r?\n/).pop() || '';
async function duracaoDe(f) {
  const r = await rodar('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], {timeoutMs: 60e3});
  const v = Number(r.out.trim());
  return r.status === 0 && Number.isFinite(v) ? v : NaN;
}

// ───────────────────────── detector de pico ─────────────────────────
// A cada medição compara as mensagens dos últimos `janela` segundos com a média, por janela, dos `media` segundos
// anteriores. Sem pelo menos 1 min de histórico não dispara (no começo toda mensagem pareceria um pico).
export class Detector {
  constructor({janela = 10, media = 300, fator = 3, piso = 8, cooldown = 90} = {}) {
    Object.assign(this, {janela, media, fator, piso, cooldown});
    this.tempos = [];
    this.inicio = null;
    this.ultimoPico = -Infinity;
  }
  registrar(ms) {
    this.inicio ??= ms;
    this.tempos.push(ms);
  }
  avaliar(agora) {
    this.inicio ??= agora;
    const j = this.janela * 1000;
    const corte = agora - j - this.media * 1000;
    while (this.tempos.length && this.tempos[0] <= corte) this.tempos.shift();
    let atual = 0;
    let antes = 0;
    for (const t of this.tempos) {
      if (t > agora - j) atual++;
      else antes++;
    }
    const janelas = Math.min(this.media / this.janela, Math.floor((agora - j - this.inicio) / j));
    const mediaMovel = janelas > 0 ? antes / janelas : 0;
    let motivo = null;
    if (janelas < 6) motivo = 'histórico curto';
    else if (atual < this.piso) motivo = 'abaixo do piso';
    else if (atual < this.fator * mediaMovel) motivo = 'abaixo do fator';
    else if (agora - this.ultimoPico < this.cooldown * 1000) motivo = 'cooldown';
    const pico = !motivo;
    if (pico) this.ultimoPico = agora;
    return {pico, atual, mediaMovel: Number(mediaMovel.toFixed(2)), motivo};
  }
}

// ───────────────────────── canal: slug, autorização, paleta ─────────────────────────
function dadosDoCanal(canal) {
  const st = lerJson(path.join(RAIZ, 'streamers.json'), {streamers: []});
  const dono = (st.streamers || []).find((s) => (s.canais || []).some((c) => c.plataforma === 'twitch' && c.url.replace(/\/+$/, '').split('/').pop().toLowerCase() === canal));
  const slug = dono?.slug || canal;
  const status = lerJson(path.join(RAIZ, 'autorizacoes.json'), {})[slug]?.status || 'nao_verificado';
  const p = lerJson(path.join(HOME, 'streamers', `${slug}.json`), {});
  const termos = (st.termos || ['gta 6', 'gta vi', 'gta6']).map((t) => t.toLowerCase());
  return {canal, slug, nome: dono?.nome || p.nome || canal, status, base: p.corBase || '#FFFFFF', destaque: p.corDestaque || '#FFD400', temPaleta: !!p.corDestaque, termos};
}

// ───────────────────────── IRC ─────────────────────────
// Conexão anônima e só de leitura. aoReceber({usuario, texto}) a cada mensagem do chat. Reconecta sozinho.
function conectarIrc(canal, aoReceber, {aoEntrar, aviso = () => {}} = {}) {
  let sock = null;
  let parado = false;
  let resto = '';
  const abrir = () => {
    if (parado) return;
    sock = net.connect(6667, 'irc.chat.twitch.tv');
    sock.setEncoding('utf8');
    sock.setTimeout(6 * 60e3); // a Twitch manda PING a cada ~5 min; silêncio maior que isso é conexão morta
    sock.on('connect', () => {
      sock.write(`NICK justinfan${10000 + Math.floor(Math.random() * 80000)}\r\n`);
      sock.write(`JOIN #${canal}\r\n`);
    });
    sock.on('data', (d) => {
      const linhas = (resto + d).split('\r\n');
      resto = linhas.pop();
      for (const l of linhas) {
        if (l.startsWith('PING')) sock.write(l.replace('PING', 'PONG') + '\r\n');
        else if (/ 366 /.test(l)) aoEntrar?.();
        else if (/^:tmi\.twitch\.tv RECONNECT/.test(l)) sock.destroy();
        else {
          const m = /^:(\w+)!\S+ PRIVMSG #\w+ :(.*)$/.exec(l);
          if (m) aoReceber({usuario: m[1], texto: m[2]});
        }
      }
    });
    sock.on('timeout', () => sock.destroy());
    sock.on('error', (e) => aviso(`chat: ${e.message}`));
    sock.on('close', () => {
      if (parado) return;
      aviso('chat desconectado; tento de novo em 5 s');
      setTimeout(abrir, 5000);
    });
  };
  abrir();
  return {fechar: () => ((parado = true), sock?.destroy())};
}

// ───────────────────────── legenda .ass ─────────────────────────
const corAss = (hex) => `&H00${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`.toUpperCase();
const tempoAss = (s) => {
  const c = Math.max(0, Math.round(s * 100));
  return `${Math.floor(c / 360000)}:${dois(Math.floor(c / 6000) % 60)}:${dois(Math.floor(c / 100) % 60)}.${dois(c % 100)}`;
};
const limpo = (t) => t.replace(/[{}\\]/g, '').toUpperCase();

// saída do whisper (-ml 1 -sow: um segmento por palavra) → [{texto, ini, fim}] em segundos
function palavrasDoWhisper(json) {
  const palavras = [];
  for (const seg of json.transcription || []) {
    const bruto = String(seg.text || '');
    const texto = bruto.trim();
    // fora: [MÚSICA], (risos) e sinais soltos (o "-" de troca de quem fala)
    if (!texto || /^[\[(].*[\])]$/.test(texto) || !/[\p{L}\p{N}]/u.test(texto)) continue;
    const ini = seg.offsets.from / 1000;
    const fim = seg.offsets.to / 1000;
    const ultima = palavras[palavras.length - 1];
    // pedaço sem espaço na frente continua a palavra anterior
    if (ultima && !/^\s/.test(bruto) && ini - ultima.fim < 0.05) {
      ultima.texto += texto;
      ultima.fim = fim;
    } else palavras.push({texto, ini, fim: Math.max(fim, ini + 0.08)});
  }
  return palavras;
}

// páginas de até 3 palavras; a palavra falada no momento fica na cor de destaque
function montarAss(palavras, d) {
  const fonte = WIN ? 'Arial Black' : 'DejaVu Sans';
  const negrito = WIN ? 0 : -1;
  const cab = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Legenda,${fonte},86,${corAss(d.base)},${corAss(d.base)},&H00000000,&H96000000,${negrito},0,0,0,100,100,0,0,1,7,3,8,50,50,0,1
Style: Credito,${fonte},38,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,${negrito},0,0,0,100,100,0,0,1,4,1,2,50,50,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const paginas = [];
  let pag = [];
  for (const w of palavras) {
    const ant = pag[pag.length - 1];
    const letras = pag.reduce((n, x) => n + x.texto.length + 1, 0) + w.texto.length;
    if (ant && (pag.length >= 3 || letras > 18 || w.ini - ant.fim > 0.6 || /[.!?…]$/.test(ant.texto))) {
      paginas.push(pag);
      pag = [];
    }
    pag.push(w);
  }
  if (pag.length) paginas.push(pag);
  const linhas = [`Dialogue: 0,${tempoAss(0)},${tempoAss(d.duracao + 1)},Credito,,0,0,0,,{\\pos(540,636)}twitch.tv/${d.canal}`];
  paginas.forEach((p, i) => {
    const limite = paginas[i + 1]?.[0].ini ?? Infinity;
    p.forEach((w, k) => {
      const fim = k < p.length - 1 ? p[k + 1].ini : Math.min(w.fim + 0.25, limite);
      if (fim <= w.ini) return;
      const texto = p.map((x, j) => (j === k ? `{\\c${corAss(d.destaque)}&}${limpo(x.texto)}{\\c${corAss(d.base)}&}` : limpo(x.texto))).join(' ');
      linhas.push(`Dialogue: 1,${tempoAss(w.ini)},${tempoAss(fim)},Legenda,,0,0,0,,{\\pos(540,1320)}${texto}`);
    });
  });
  return cab + linhas.join('\n') + '\n';
}

// ───────────────────────── corte + transcrição + render ─────────────────────────
let encoder = null;
async function gerarClipe({dados, fonte, inicio, duracao, quando, pico, chat = [], simulacao = false}) {
  const {canal} = dados;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-'));
  const falhou = (etapa, r) => {
    log(canal, `corte falhou em "${etapa}": ${ultimaLinha(r.err) || `código ${r.status}`}`);
    fs.rmSync(work, {recursive: true, force: true});
    return null;
  };
  try {
    // 1) trecho (cópia sem recodificar; o arquivo pode estar sendo gravado)
    let r = await rodar('ffmpeg', ['-y', '-v', 'error', '-ss', String(inicio.toFixed(2)), '-t', String(duracao), '-i', fonte, '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', 'trecho.mkv'], {cwd: work, timeoutMs: 5 * 60e3});
    if (r.status !== 0) return falhou('extrair o trecho', r);
    const real = await duracaoDe(path.join(work, 'trecho.mkv'));
    if (!(real >= 20)) return falhou('extrair o trecho', {err: `só ${Number.isFinite(real) ? real.toFixed(1) : '0'} s de vídeo disponíveis`});

    // 2) transcrição com o whisper.cpp do motor
    const cfgMotor = lerJson(path.join(HOME, 'config.json'), {});
    const whisper = path.join(HOME, 'whisper.cpp', WIN ? 'main.exe' : 'main');
    const modelo = path.join(HOME, 'whisper.cpp', `ggml-${cfgMotor.whisperModel || 'small'}.bin`);
    let palavras = [];
    if (!fs.existsSync(whisper) || !fs.existsSync(modelo)) log(canal, 'whisper.cpp ou modelo não encontrado em ~/.maquina-cortes-gta: o corte sai sem legenda');
    else {
      r = await rodar('ffmpeg', ['-y', '-v', 'error', '-i', 'trecho.mkv', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', 'audio.wav'], {cwd: work, timeoutMs: 2 * 60e3});
      if (r.status !== 0) return falhou('extrair o áudio', r);
      const threads = String(Math.max(2, Math.min(8, os.cpus().length - 2)));
      r = await rodar(whisper, ['-m', modelo, '-f', 'audio.wav', '-l', cfgMotor.language || 'pt', '-t', threads, '-ml', '1', '-sow', '-oj', '-of', 'legenda', '-np'], {cwd: work, timeoutMs: 10 * 60e3});
      if (r.status !== 0 || !fs.existsSync(path.join(work, 'legenda.json'))) return falhou('transcrever', r);
      palavras = palavrasDoWhisper(JSON.parse(fs.readFileSync(path.join(work, 'legenda.json'), 'utf8')));
    }
    fs.writeFileSync(path.join(work, 'legenda.ass'), montarAss(palavras, {...dados, duracao: real}));

    // 3) render 9:16: fundo = o próprio vídeo ampliado e desfocado; janela 16:9 no centro; legenda queimada
    encoder ||= encoderH264();
    const filtro =
      '[0:v]fps=30,split[a][b];' +
      '[a]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=8:2,scale=1080:1920,eq=brightness=-0.14:saturation=0.85[fundo];' +
      '[b]scale=1080:608:force_original_aspect_ratio=decrease[janela];' +
      `[fundo][janela]overlay=(W-w)/2:(H-h)/2,ass=legenda.ass,format=yuv420p${encoder.filtro ? ',' + encoder.filtro : ''}[v]`;
    r = await rodar(
      encoder.ffmpeg,
      ['-y', '-v', 'error', ...encoder.entrada, '-i', 'trecho.mkv', '-filter_complex', filtro, '-map', '[v]', '-map', '0:a:0', '-af', 'loudnorm=I=-14:TP=-1:LRA=11', '-r', '30', ...encoder.args, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', 'saida.mp4'],
      {cwd: work, timeoutMs: 20 * 60e3},
    );
    if (r.status !== 0) return falhou(`render (${encoder.nome})`, r);

    // 4) para-postar/ + postagem.json
    const carimbo = carimboDe(quando);
    fs.mkdirSync(PARA_POSTAR, {recursive: true});
    const destino = path.join(PARA_POSTAR, `LIVE--${canal}--${carimbo}.mp4`);
    fs.copyFileSync(path.join(work, 'saida.mp4'), destino);
    const final = await duracaoDe(destino);
    const pasta = path.join(RAIZ, 'cortes', `${simulacao ? 'ao-vivo-simulacao' : 'ao-vivo'}-${canal}`);
    fs.mkdirSync(pasta, {recursive: true});
    const arquivoPostagem = path.join(pasta, 'postagem.json');
    const doc = lerJson(arquivoPostagem, {origem: 'radar-ao-vivo', canal, streamer: dados.slug, ...(simulacao ? {calibracao: true} : {}), itens: []});
    const transcricao = palavras.map((w) => w.texto).join(' ');
    const perto = palavras.filter((w) => w.ini >= CFG.antes - 10 && w.ini <= CFG.antes + 6).map((w) => w.texto).join(' ');
    const ehGta = dados.termos.some((t) => `${dados.categoria || ''} ${dados.tituloLive || ''}`.toLowerCase().includes(t));
    const semAutorizacao = !['autorizado', 'politica_publica_de_clipes'].includes(dados.status);
    const item = {
      id: `live-${canal}-${carimbo}`,
      arquivo: path.relative(pasta, destino).split(path.sep).join('/'),
      plataforma: CFG.plataforma,
      // o título é só um rascunho tirado da fala: a skill modo-ao-vivo-gta6 escreve o definitivo antes da aprovação
      titulo: (perto || transcricao || `Momento ao vivo de ${dados.nome}`).slice(0, 80).trim(),
      titulo_provisorio: true,
      descricao: `Corte da live de ${dados.nome} na Twitch (twitch.tv/${canal}).`,
      hashtags: [...(ehGta ? ['#gta6', '#gtavi'] : []), `#${dados.slug.replace(/[^\p{L}\p{N}_]/gu, '')}`, '#twitch'],
      agendado_para: '',
      ao_vivo: true,
      aprovado: false,
      sem_autorizacao: semAutorizacao,
      aprovado_sem_autorizacao: false,
      autorizacao: dados.status,
      duracao_s: Number.isFinite(final) ? Number(final.toFixed(1)) : null,
      capturado_em: quando.toISOString(),
      categoria: dados.categoria || null,
      titulo_live: dados.tituloLive || null,
      pico: pico || null,
      chat_amostra: chat.slice(-12),
      transcricao,
    };
    doc.itens.push(item);
    fs.writeFileSync(arquivoPostagem, JSON.stringify(doc, null, 2));
    fs.rmSync(work, {recursive: true, force: true});
    const avisos = [];
    if (CFG.plataforma === 'tiktok' && final < 62) avisos.push(`${final.toFixed(0)} s: abaixo dos 62 s do TikTok Creator Rewards`);
    if (CFG.plataforma === 'youtube_short' && final > 58) avisos.push(`${final.toFixed(0)} s: acima dos 58 s do Short`);
    if (!ehGta && !simulacao) avisos.push(`a live não parece ser de GTA 6 (categoria: ${dados.categoria || 'desconhecida'})`);
    log(canal, `corte pronto: ${path.relative(RAIZ, destino)} (${final.toFixed(1)} s, ${palavras.length} palavras, ${encoder.nome})${semAutorizacao ? ' · SEM AUTORIZAÇÃO' : ''}${avisos.length ? ' · ' + avisos.join(' · ') : ''}`);

    // 5) e-mail (na simulação só mostra o que seria enviado)
    const n = await rodar(process.execPath, [path.join(S, 'notificar-email.mjs'), ...(simulacao ? ['--simular'] : [])], {cwd: RAIZ, timeoutMs: 60e3});
    log(canal, `e-mail: ${n.status === 0 ? (simulacao ? 'simulado' : ultimaLinha(n.out)) : `falhou (${ultimaLinha(n.err) || ultimaLinha(n.out)})`}`);
    return {item, arquivo: destino, postagem: arquivoPostagem, palavras: palavras.length, encoder: encoder.nome, duracao: final};
  } catch (e) {
    return falhou('erro inesperado', {err: e.message});
  }
}

// ───────────────────────── streamlink ─────────────────────────
async function acharStreamlink() {
  const candidatos = ['streamlink'];
  if (WIN) {
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]) {
      if (base) candidatos.push(path.join(base, 'Streamlink', 'bin', 'streamlink.exe'));
    }
  }
  for (const c of candidatos) {
    const r = await rodar(c, ['--version'], {timeoutMs: 20e3});
    if (r.status === 0) return {bin: c, versao: r.out.trim()};
  }
  return null;
}

// ───────────────────────── modos ─────────────────────────
async function testarIrc(canal, segundos) {
  let n = 0;
  let entrou = false;
  const amostra = [];
  const irc = conectarIrc(canal, (m) => (n++, amostra.length < 3 && amostra.push(m.texto.slice(0, 60))), {aoEntrar: () => (entrou = true), aviso: (t) => console.error(t)});
  await esperar(segundos * 1000);
  irc.fechar();
  console.log(JSON.stringify({ok: entrou, canal, entrou_no_canal: entrou, segundos, mensagens: n, por_10s: Number(((n / segundos) * 10).toFixed(1)), amostra}, null, 2));
  process.exit(entrou ? 0 : 1);
}

async function simular(video) {
  if (!fs.existsSync(video)) {
    console.error(`Vídeo não encontrado: ${video}`);
    process.exit(1);
  }
  const canal = String(opt('--canal', 'simulacao')).toLowerCase();
  const dados = dadosDoCanal(canal);
  if (dados.status === 'proibido') {
    console.error(`${canal}: streamer com status "proibido" no autorizacoes.json`);
    process.exit(1);
  }
  // 1) detector com relógio sintético: 6 min de chat calmo (3 msg/10 s), um chat parado que acorda pouco e uma rajada
  const det = new Detector(CFG);
  const T0 = 1e12;
  const disparos = [];
  let calmoDisparou = false;
  for (let s = 10; s <= 420; s += 10) {
    const qtd = s === 300 ? Math.max(1, CFG.piso - 1) : s === 400 ? Math.max(CFG.piso, 9 * CFG.fator) + 5 : 3;
    for (let i = 0; i < qtd; i++) det.registrar(T0 + (s - 10) * 1000 + ((i + 1) * 10000) / (qtd + 1));
    const r = det.avaliar(T0 + s * 1000);
    if (r.pico) disparos.push({segundo: s, ...r});
    if (r.pico && s !== 400) calmoDisparou = true;
  }
  const detectorOk = disparos.length === 1 && disparos[0].segundo === 400 && !calmoDisparou;
  console.log(JSON.stringify({detector: {ok: detectorOk, disparos}}, null, 2));

  // 2) corte completo, com o vídeo local no lugar do .ts da live
  const total = await duracaoDe(video);
  const pico = Math.min(num('--pico', CFG.antes + 5), Math.max(0, total - (CFG.duracao - CFG.antes)));
  const r = await gerarClipe({dados, fonte: path.resolve(video), inicio: Math.max(0, pico - CFG.antes), duracao: CFG.duracao, quando: new Date(), pico: disparos[0] ? {mensagens_10s: disparos[0].atual, media_10s: disparos[0].mediaMovel} : null, chat: ['KKKKKKKK', 'NÃO ACREDITO', 'clipa isso'], simulacao: true});
  console.log(JSON.stringify({corte: r ? {ok: true, arquivo: r.arquivo, postagem: r.postagem, duracao_s: r.duracao, palavras: r.palavras, encoder: r.encoder, paleta: {base: dados.base, destaque: dados.destaque}, id: r.item.id} : {ok: false}}, null, 2));
  process.exit(detectorOk && r ? 0 : 1);
}

async function monitorar(canais) {
  const sl = await acharStreamlink();
  if (!sl) {
    console.error('streamlink não encontrado. Windows: winget install -e --id Streamlink.Streamlink · Linux: pipx install streamlink');
    process.exit(1);
  }
  encoder = encoderH264();
  log('radar', `${sl.versao} · encoder ${encoder.nome} · corte de ${CFG.duracao} s (${CFG.antes} s antes do pico) · pico ≥ ${CFG.fator}× a média e ≥ ${CFG.piso} msg/10 s · cooldown ${CFG.cooldown} s · ${CFG.maxHora ? `até ${CFG.maxHora} cortes por canal por hora` : "sem teto de cortes por hora"}`);

  let parando = false;
  let fila = Promise.resolve(); // um corte por vez (whisper + GPU)
  const sessoes = [];

  for (const canal of canais) {
    const dados = dadosDoCanal(canal);
    if (dados.status === 'proibido') {
      log(canal, 'streamer com status "proibido" no autorizacoes.json: canal recusado');
      continue;
    }
    if (!dados.temPaleta) log(canal, `sem paleta em ~/.maquina-cortes-gta/streamers/${dados.slug}.json: legenda em branco e amarelo`);
    if (!['autorizado', 'politica_publica_de_clipes'].includes(dados.status)) log(canal, `autorização "${dados.status}": os cortes nascem marcados SEM AUTORIZAÇÃO`);
    const ts = path.join(FILA, `live-${canal}.ts`);
    const s = {canal, dados, ts, det: new Detector(CFG), chat: [], pendentes: 0, cortes: [], proc: null, gravandoDesde: null, irc: null};
    sessoes.push(s);

    // chat
    s.irc = conectarIrc(
      canal,
      (m) => {
        const agora = Date.now();
        s.det.registrar(agora);
        s.chat.push({t: agora, texto: m.texto.slice(0, 200)});
        while (s.chat.length && s.chat[0].t < agora - 15 * 60e3) s.chat.shift();
      },
      {aoEntrar: () => ((s.noChat = true), log(canal, 'chat conectado')), aviso: (t) => log(canal, t)},
    );
    // a Twitch não responde ao JOIN de um canal que não existe: sem resposta, o nome provavelmente está errado
    setTimeout(() => s.noChat || log(canal, 'o chat não confirmou a entrada em 20 s: confira se o nome do canal na Twitch está certo'), 20e3);

    // gravação: o streamlink espera a live começar (--retry-streams) e sai quando ela acaba
    const gravar = () => {
      if (parando) return;
      s.gravandoDesde = null;
      s.proc = spawn(sl.bin, [`twitch.tv/${canal}`, CFG.qualidade, '-o', ts, '--retry-streams', '30', '--force'], {stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
      const sair = async (motivo) => {
        s.proc = null;
        log(canal, `streamlink terminou (${motivo})`);
        // espera os cortes que ainda usam o .ts antes de apagar
        while (s.pendentes > 0) await esperar(2000);
        if (fs.existsSync(ts)) {
          const mb = (fs.statSync(ts).size / 1048576).toFixed(0);
          fs.rmSync(ts, {force: true});
          log(canal, `${path.basename(ts)} apagado (${mb} MB liberados)`);
        }
        if (!parando) setTimeout(gravar, 30e3);
      };
      let terminou = false;
      s.proc.stdout.on('data', (d) => {
        for (const l of String(d).split(/\r?\n/)) if (/Opening stream|Stream ended|error|Waiting for streams/i.test(l)) log(canal, `streamlink: ${l.replace(/^(\[[^\]]*\])+\s*/, '').slice(0, 160)}`);
      });
      s.proc.stderr.on('data', (d) => log(canal, `streamlink: ${ultimaLinha(d).slice(0, 160)}`));
      s.proc.on('error', (e) => !terminou && ((terminou = true), sair(e.message)));
      s.proc.on('close', (c) => !terminou && ((terminou = true), sair(`código ${c}`)));
    };
    gravar();
  }
  if (!sessoes.length) {
    console.error('Nenhum canal para monitorar.');
    process.exit(1);
  }

  // medição a cada 10 s
  let volta = 0;
  const relogio = setInterval(async () => {
    volta++;
    const agora = Date.now();
    for (const s of sessoes) {
      const tamanho = fs.existsSync(s.ts) ? fs.statSync(s.ts).size : 0;
      if (tamanho > 0 && !s.gravandoDesde) {
        s.gravandoDesde = agora;
        log(s.canal, 'gravação começou');
        // categoria e título da live (para saber se é GTA 6); falhar aqui não atrapalha
        rodar(sl.bin, ['--json', `twitch.tv/${s.canal}`], {timeoutMs: 30e3}).then((r) => {
          try {
            const m = JSON.parse(r.out).metadata || {};
            s.dados.categoria = m.category || null;
            s.dados.tituloLive = m.title || null;
            log(s.canal, `ao vivo: ${m.category || '?'} · ${String(m.title || '').slice(0, 80)}`);
          } catch {}
        });
      }
      const r = s.det.avaliar(agora);
      if (volta % 6 === 0) log(s.canal, `chat ${r.atual} msg/10 s (média ${r.mediaMovel}) · ${tamanho ? `gravando, ${(tamanho / 1048576).toFixed(0)} MB` : 'fora do ar'}`);
      if (!r.pico) continue;
      if (!s.gravandoDesde || !s.proc) {
        log(s.canal, `pico no chat (${r.atual} msg/10 s, média ${r.mediaMovel}) mas a live não está sendo gravada: ignorado`);
        continue;
      }
      s.cortes = s.cortes.filter((t) => t > agora - 3600e3);
      if (CFG.maxHora && s.cortes.length >= CFG.maxHora) {
        log(s.canal, `pico ignorado: teto de ${CFG.maxHora} cortes por hora`);
        continue;
      }
      s.cortes.push(agora);
      s.pendentes++;
      // posição do pico no arquivo: a duração gravada até agora (ou o relógio, se o ffprobe não souber dizer)
      const noArquivo = await duracaoDe(s.ts);
      const pos = Number.isFinite(noArquivo) && noArquivo > 0 ? noArquivo : (agora - s.gravandoDesde) / 1000;
      const inicio = Math.max(0, pos - CFG.antes);
      const quando = new Date(agora);
      const chat = s.chat.filter((m) => m.t > agora - 15e3).map((m) => m.texto);
      log(s.canal, `PICO: ${r.atual} msg/10 s contra média de ${r.mediaMovel} · corto ${CFG.duracao} s a partir de ${inicio.toFixed(0)} s do arquivo`);
      // espera o resto do trecho (depois do pico) ser gravado e entra na fila de cortes
      setTimeout(
        () => {
          fila = fila
            .then(() => gerarClipe({dados: s.dados, fonte: s.ts, inicio, duracao: CFG.duracao, quando, pico: {mensagens_10s: r.atual, media_10s: r.mediaMovel}, chat}))
            .catch((e) => log(s.canal, `corte falhou: ${e.message}`))
            .finally(() => s.pendentes--);
        },
        (CFG.duracao - CFG.antes + 10) * 1000,
      );
    }
  }, CFG.janela * 1000);

  // Ctrl+C: para de medir, termina o corte em andamento, encerra as gravações e apaga os .ts
  let sinais = 0;
  const encerrar = async () => {
    if (++sinais > 1) process.exit(1);
    parando = true;
    clearInterval(relogio);
    log('radar', 'encerrando (Ctrl+C de novo força a saída)');
    for (const s of sessoes) s.irc.fechar();
    await fila;
    for (const s of sessoes) s.proc?.kill();
    await esperar(3000);
    for (const s of sessoes) fs.rmSync(s.ts, {force: true});
    process.exit(0);
  };
  process.on('SIGINT', encerrar);
  process.on('SIGTERM', encerrar);
}

if (args.includes('--testar-irc')) await testarIrc(String(opt('--testar-irc', '')).toLowerCase().replace(/^#/, ''), num('--segundos', 20));
else if (args.includes('--simular')) await simular(opt('--simular', ''));
else {
  const canais = [...new Set(String(opt('--canais', '')).toLowerCase().split(',').map((c) => c.trim().replace(/^#|^https?:\/\/(www\.)?twitch\.tv\//, '')).filter(Boolean))];
  if (!canais.length || canais.some((c) => !/^\w{2,25}$/.test(c))) {
    console.error('Uso: node scripts/radar-ao-vivo.mjs --canais canal1,canal2 [--duracao 65] [--antes 45] [--fator 3] [--piso 8] [--cooldown 90]\n     node scripts/radar-ao-vivo.mjs --testar-irc <canal> | --simular <video> [--canal <canal>]');
    process.exit(1);
  }
  await monitorar(canais);
}
