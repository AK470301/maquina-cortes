#!/usr/bin/env node
// Instala (e confere) tudo que as skills de cortes precisam. Pode rodar quantas vezes quiser.
//
//   node setup.mjs                      instala o motor (Remotion) e o whisper.cpp se faltarem
//   node setup.mjs --check              só confere e imprime um JSON com o estado
//   node setup.mjs --profile "NOME" --logo "C:\caminho\logo.png"
//                                       grava o nome do perfil e a logo (primeira vez)
//   node setup.mjs --sem-marca          cortes sem marca d'água (apaga nome e logo da config)
//   node setup.mjs --streamer slug --cor-base "#FFFFFF" --cor-destaque "#FFD400" [--nome "Nome"] [--hashtag "#tag"]
//                                       grava a paleta da legenda de um streamer (e a hashtag fixa dele, opcional)
//
// As três skills (cortes-papo, cortes-gameplay, cortes-video) usam o mesmo motor. A instalação lê do repositório
// (motor/, docs/, ferramentas/) e só funciona a partir de instalador/setup.mjs. Este script também se copia para
// ~/.maquina-cortes-gta/setup.mjs, para as skills conferirem a instalação (--check, --profile, --streamer).
//
// Tudo fica em ~/.maquina-cortes-gta (motor, whisper, config, logo). Nada é instalado fora dessa pasta,
// a não ser o que você já tem (Node, ffmpeg, yt-dlp), que o script só confere.
import {execFileSync, execSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HOME = path.join(os.homedir(), '.maquina-cortes-gta');
const ENGINE = path.join(HOME, 'engine');
const WHISPER = path.join(HOME, 'whisper.cpp');
const CONFIG = path.join(HOME, 'config.json');
const SELF = fileURLToPath(import.meta.url);
const REPO = path.join(path.dirname(SELF), '..');
const TEMPLATE = path.join(REPO, 'motor');
const STREAMERS = path.join(HOME, 'streamers');
const WHISPER_VERSION = '1.5.5';

const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (n) => args.includes(n);

const readConfig = () => {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  } catch {
    return {};
  }
};
const writeConfig = (c) => {
  fs.mkdirSync(HOME, {recursive: true});
  fs.writeFileSync(CONFIG, JSON.stringify(c, null, 2));
};
const which = (bin) => {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], {encoding: 'utf8'});
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
};
const nodeMajor = Number(process.versions.node.split('.')[0]);
// yt-dlp velho deixa de funcionar com o YouTube (o YouTube muda com frequência). Versão = data "AAAA.MM.DD".
const ytdlpInfo = () => {
  if (!which('yt-dlp')) return {ytdlp: false, ytdlpVersao: null, ytdlpDesatualizado: false};
  const v = (spawnSync('yt-dlp', ['--version'], {encoding: 'utf8'}).stdout || '').trim();
  const m = v.match(/^(\d{4})\.(\d{2})\.(\d{2})/);
  const ageDays = m ? (Date.now() - Date.UTC(+m[1], +m[2] - 1, +m[3])) / 86400000 : 0;
  return {ytdlp: true, ytdlpVersao: v || null, ytdlpDesatualizado: ageDays > 120};
};

function status() {
  const c = readConfig();
  const model = c.whisperModel || 'small';
  return {
    node: process.versions.node,
    nodeOk: nodeMajor >= 18,
    ffmpeg: !!which('ffmpeg'),
    ffprobe: !!which('ffprobe'),
    ...ytdlpInfo(),
    // efeitos sonoros (opcional): Python + chave da ElevenLabs; imagens do Google (opcional): chave e id da API
    python: !!(which('python3') || which('python')),
    elevenlabsKey: !!process.env.ELEVENLABS_API_KEY,
    pexelsKey: !!process.env.PEXELS_API_KEY,
    streamers: fs.existsSync(STREAMERS) ? fs.readdirSync(STREAMERS).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : [],
    googleImagens: !!(process.env.GOOGLE_API_KEY && process.env.GOOGLE_CSE_ID),
    efeitosGerados: fs.existsSync(path.join(HOME, 'sfx')) ? fs.readdirSync(path.join(HOME, 'sfx')).filter((f) => /\.(mp3|wav)$/.test(f)).length : 0,
    engine: fs.existsSync(path.join(ENGINE, 'node_modules', 'remotion')),
    whisperModel: fs.existsSync(path.join(WHISPER, `ggml-${model}.bin`)),
    perfilConfigurado: !!(c.semMarca || (c.profileName && c.logo && fs.existsSync(path.join(HOME, c.logo)))),
    marcaDagua: !!(c.profileName && c.logo && fs.existsSync(path.join(HOME, c.logo))),
    // publicação (opcional): contas conectadas por ferramentas/publicar/publicar.mjs
    contas: Object.fromEntries(['youtube', 'tiktok', 'instagram'].map((p) => [p, fs.existsSync(path.join(HOME, 'contas', `${p}.json`))])),
    config: c,
    pasta: HOME,
  };
}

// 0) paleta de um streamer
if (flag('--streamer')) {
  const slug = flag('--streamer')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const hex = (v, n) => {
    if (v === undefined) return undefined;
    if (!/^#[0-9a-fA-F]{6}$/.test(v)) {
      console.error(`${n} precisa ser uma cor #RRGGBB (recebi "${v}")`);
      process.exit(1);
    }
    return v.toUpperCase();
  };
  const f = path.join(STREAMERS, `${slug}.json`);
  const cur = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  const p = {
    ...cur,
    nome: flag('--nome') || cur.nome || flag('--streamer'),
    corBase: hex(flag('--cor-base'), '--cor-base') || cur.corBase || '#FFFFFF',
    corDestaque: hex(flag('--cor-destaque'), '--cor-destaque') || cur.corDestaque || '#FFD400',
  };
  // hashtag que vai em toda descrição/legenda dos cortes dele (sem ela, usa #<slug>)
  if (flag('--hashtag')) p.hashtag = '#' + flag('--hashtag').replace(/^#/, '');
  fs.mkdirSync(STREAMERS, {recursive: true});
  fs.writeFileSync(f, JSON.stringify(p, null, 2));
  console.log(JSON.stringify({ok: true, streamer: slug, ...p}));
  process.exit(0);
}

// 1) perfil e logo (ou nenhuma marca d'água)
if (has('--sem-marca')) {
  const c = readConfig();
  delete c.profileName;
  delete c.logo;
  c.semMarca = true;
  writeConfig(c);
  console.log(JSON.stringify({ok: true, marcaDagua: false}));
  process.exit(0);
}
if (flag('--profile') || flag('--logo')) {
  const c = readConfig();
  delete c.semMarca;
  if (flag('--profile')) c.profileName = flag('--profile');
  if (flag('--logo')) {
    const src = flag('--logo');
    if (!fs.existsSync(src)) {
      console.error(`Logo não encontrada: ${src}`);
      process.exit(1);
    }
    const ext = path.extname(src).toLowerCase() || '.png';
    fs.mkdirSync(HOME, {recursive: true});
    fs.copyFileSync(src, path.join(HOME, `logo${ext}`));
    c.logo = `logo${ext}`;
  }
  writeConfig(c);
  console.log(JSON.stringify({ok: true, perfil: c.profileName, logo: c.logo}));
  process.exit(0);
}

// 2) só conferir
if (has('--check')) {
  console.log(JSON.stringify(status(), null, 2));
  process.exit(0);
}

// 3) instalar (só a partir do repositório, que tem o motor, os guias e as ferramentas)
if (!fs.existsSync(TEMPLATE)) {
  console.error('Para instalar ou atualizar o motor, rode instalador/setup.mjs (ou instalador/install.sh) do repositório.');
  process.exit(1);
}
const s0 = status();
if (!s0.nodeOk) {
  console.error('Precisa do Node 18 ou mais novo (recomendado 22+): https://nodejs.org');
  process.exit(1);
}
if (!s0.ffmpeg || !s0.ffprobe) {
  console.error('Precisa do FFmpeg (ffmpeg e ffprobe no PATH). Windows: winget install Gyan.FFmpeg · macOS: brew install ffmpeg · Linux: apt install ffmpeg');
  process.exit(1);
}
if (!s0.ytdlp) {
  console.warn('Aviso: yt-dlp não encontrado. Sem ele a skill só aceita arquivo de vídeo, não link. Windows: winget install yt-dlp · macOS: brew install yt-dlp · Linux: pipx install yt-dlp');
} else if (s0.ytdlpDesatualizado) {
  console.warn(`Aviso: o yt-dlp ${s0.ytdlpVersao} está desatualizado e pode não baixar do YouTube. Atualize: yt-dlp -U (ou winget upgrade yt-dlp · brew upgrade yt-dlp · pipx upgrade yt-dlp). No Linux, o yt-dlp do apt costuma ser antigo: prefira o do pipx.`);
}

fs.mkdirSync(HOME, {recursive: true});
fs.copyFileSync(SELF, path.join(HOME, 'setup.mjs'));
// guias comuns às três skills e o gerador de efeitos, num lugar fixo
fs.rmSync(path.join(HOME, 'docs'), {recursive: true, force: true});
fs.cpSync(path.join(REPO, 'docs'), path.join(HOME, 'docs'), {recursive: true});
fs.cpSync(path.join(REPO, 'ferramentas'), path.join(HOME, 'ferramentas'), {
  recursive: true,
  filter: (f) => !path.relative(REPO, f).includes('__pycache__'),
});
const cfg = readConfig();
cfg.whisperModel = cfg.whisperModel || 'small';
cfg.language = cfg.language || 'pt';
writeConfig(cfg);

// motor (Remotion): copia o template e instala as dependências
if (!s0.engine) {
  console.log('> Copiando o motor para', ENGINE);
  fs.cpSync(TEMPLATE, ENGINE, {recursive: true});
  console.log('> npm install (Remotion e dependências; leva alguns minutos)');
  execSync('npm install --no-audit --no-fund', {cwd: ENGINE, stdio: 'inherit'});
  console.log('> Baixando o Chrome headless do Remotion');
  try {
    execSync('npx remotion browser ensure', {cwd: ENGINE, stdio: 'inherit'});
  } catch {
    console.warn('Não consegui pré-baixar o Chrome; o Remotion tenta de novo no primeiro render.');
  }
} else {
  // mantém scripts e componentes atualizados sem mexer em node_modules
  for (const d of ['src', 'scripts']) {
    fs.cpSync(path.join(TEMPLATE, d), path.join(ENGINE, d), {recursive: true});
  }
}

// whisper.cpp + modelo
if (!status().whisperModel) {
  console.log(`> Instalando whisper.cpp ${WHISPER_VERSION} e o modelo "${cfg.whisperModel}" (download grande)`);
  const code = `
    import {installWhisperCpp, downloadWhisperModel} from '@remotion/install-whisper-cpp';
    await installWhisperCpp({to: ${JSON.stringify(WHISPER)}, version: ${JSON.stringify(WHISPER_VERSION)}});
    await downloadWhisperModel({model: ${JSON.stringify(cfg.whisperModel)}, folder: ${JSON.stringify(WHISPER)}});
  `;
  fs.writeFileSync(path.join(ENGINE, 'scripts', '_install-whisper.mjs'), code);
  execFileSync(process.execPath, [path.join(ENGINE, 'scripts', '_install-whisper.mjs')], {cwd: ENGINE, stdio: 'inherit'});
}

console.log(JSON.stringify(status(), null, 2));
console.log('\nPronto. Falta só o perfil (nome + logo) se ainda não foi configurado.');
