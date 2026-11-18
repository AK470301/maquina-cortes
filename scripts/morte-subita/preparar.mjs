#!/usr/bin/env node
// Modo Morte Súbita — prepara UM vídeo (VOD, vídeo longo ou Short) para a Fase 2: baixa e transcreve em
// fila-entrada/<slug>/ (source.mp4, info.json, captions.json, silences.json, energia.json, meta.json, audio16k.wav) e
// grava entrada.json com "pronto": true no fim. Não grava o id em logs/processados.txt (quem decide é a fase1.mjs ou o
// processar-link.ps1).
// Uso: node scripts/morte-subita/preparar.mjs <url> [--origem link|cron] [--rodada <id>] [--info <arquivo.json>]
//      node scripts/morte-subita/preparar.mjs --retomar     refaz as entradas de fila-entrada/ sem "pronto": true
// Saída (stdout): JSON {ok, slug, pasta, ...}. Código 1 se falhar.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {encoderH264} from '../../.claude/skills/pipeline-diario-gta6/scripts/encoder.mjs';
import {ENGINE, FILA_ENTRADA, RAIZ, duracaoDe, idiomaDoVideo, lerJson, log, rodar, rodarSync, slugify} from './comum.mjs';

export const ARGS_YT = ['--no-playlist', '--extractor-args', 'youtube:lang=pt'];

export async function infoDe(url) {
  const r = await rodar('yt-dlp', ['-J', '--skip-download', '--ignore-no-formats-error', ...ARGS_YT, url], {timeoutMs: 120e3});
  if (r.status !== 0) throw new Error(`yt-dlp -J falhou: ${r.err.trim().split('\n').pop()}`);
  return JSON.parse(r.out);
}

export const slugDe = (info) => {
  const data = /^(\d{4})(\d{2})(\d{2})$/.exec(info.upload_date || '');
  return [slugify(info.channel || info.uploader || 'canal').slice(0, 24), data ? `${data[1]}-${data[2]}-${data[3]}` : null, slugify(info.title).slice(0, 40), info.id]
    .filter(Boolean)
    .join('-')
    .replace(/-+/g, '-');
};

export async function prepararVideo(url, {origem = 'link', rodada = null, info = null} = {}) {
  info ||= await infoDe(url);
  if (info.live_status === 'is_live' || info.live_status === 'is_upcoming') throw new Error(`a URL é uma live em andamento (${info.live_status}): use o radar`);
  const slug = slugDe(info);
  const pasta = path.join(FILA_ENTRADA, slug);
  fs.mkdirSync(pasta, {recursive: true});
  const fEntrada = path.join(pasta, 'entrada.json');
  const anterior = lerJson(fEntrada, {});
  if (anterior.pronto) return {ok: true, slug, pasta, ja_pronto: true};
  const lingua = idiomaDoVideo(info);
  const entrada = {
    id: info.id,
    url: info.webpage_url || url,
    titulo: info.title,
    canal: info.channel || info.uploader || null,
    canal_url: info.channel_url || info.uploader_url || null,
    views: info.view_count ?? null,
    duracao_s: info.duration ?? null,
    publicado: info.upload_date || null,
    idioma: lingua.idioma,
    idioma_evidencia: lingua.evidencia,
    origem,
    rodada: rodada || anterior.rodada || null,
    criado_em: anterior.criado_em || new Date().toISOString(),
    pronto: false,
  };
  fs.writeFileSync(fEntrada, JSON.stringify(entrada, null, 2));
  fs.writeFileSync(path.join(pasta, 'info.json'), JSON.stringify(info));
  log(`[preparar] ${slug}: baixando (${entrada.duracao_s ?? '?'} s, ${entrada.idioma})`);

  // vídeo até 1080p, H.264 de preferência; áudio: a faixa ORIGINAL quando o vídeo tem várias dublagens
  const source = path.join(pasta, 'source.mp4');
  if (!fs.existsSync(source)) {
    const d = await rodar('yt-dlp', ['-S', 'res:1080,vcodec:h264', '-f', 'bv*+ba[format_note*=original]/bv*+ba/b', '--merge-output-format', 'mp4', ...ARGS_YT, '-o', path.join(pasta, 'source.%(ext)s'), entrada.url], {timeoutMs: 4 * 3600e3});
    if (d.status !== 0 || !fs.existsSync(source)) throw new Error(`download falhou: ${d.err.trim().split('\n').pop()}`);
  }
  // o motor precisa de H.264: AV1/VP9 é convertido com o encoder mais rápido da máquina
  const codec = rodarSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', source]).out.trim();
  if (codec && codec !== 'h264') {
    log(`[preparar] ${slug}: convertendo ${codec} → H.264`);
    const e = encoderH264();
    const tmp = path.join(pasta, 'source-h264.mp4');
    const c = await rodar(e.ffmpeg, ['-y', '-v', 'error', ...e.entrada, '-i', source, ...(e.filtro ? ['-vf', e.filtro] : []), ...e.args, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', tmp], {timeoutMs: 4 * 3600e3});
    if (c.status !== 0) throw new Error(`conversão para H.264 falhou: ${c.err.trim().split('\n').pop()}`);
    fs.renameSync(tmp, source);
  }
  const dur = duracaoDe(source);
  const meta = lerJson(path.join(pasta, 'meta.json'), null);
  if (!fs.existsSync(path.join(pasta, 'captions.json')) || !meta || Math.abs(meta.duration - dur) > 1) {
    log(`[preparar] ${slug}: transcrevendo (whisper.cpp, pt)`);
    const t = await rodar(process.execPath, [path.join(ENGINE, 'transcribe.mjs'), source, pasta, 'pt'], {timeoutMs: 6 * 3600e3});
    if (t.status !== 0) throw new Error(`transcrição falhou: ${t.err.trim().split('\n').pop()}`);
  }
  entrada.pronto = true;
  entrada.preparado_em = new Date().toISOString();
  entrada.duracao_s = dur ?? entrada.duracao_s;
  fs.writeFileSync(fEntrada, JSON.stringify(entrada, null, 2));
  log(`[preparar] ${slug}: pronto para a Fase 2`);
  return {ok: true, slug, pasta: path.relative(RAIZ, pasta), id: entrada.id, titulo: entrada.titulo};
}

// entradas que ficaram pela metade (download ou transcrição interrompidos): tenta de novo
export async function retomarIncompletos() {
  const feitos = [];
  for (const d of fs.readdirSync(FILA_ENTRADA, {withFileTypes: true})) {
    if (!d.isDirectory()) continue;
    const e = lerJson(path.join(FILA_ENTRADA, d.name, 'entrada.json'), null);
    if (!e || e.pronto || !e.url) continue;
    try {
      feitos.push(await prepararVideo(e.url, {origem: e.origem, rodada: e.rodada}));
    } catch (err) {
      log(`[preparar] ${d.name}: retomada falhou: ${err.message}`);
      feitos.push({ok: false, slug: d.name, erro: err.message});
    }
  }
  return feitos;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (k, p = null) => (a.includes(k) ? a[a.indexOf(k) + 1] : p);
  try {
    if (a.includes('--retomar')) console.log(JSON.stringify({ok: true, retomados: await retomarIncompletos()}, null, 2));
    else {
      const url = a.find((x) => /^https?:\/\//.test(x));
      if (!url) throw new Error('Uso: node preparar.mjs <url> [--origem link|cron] [--rodada <id>] [--info <arquivo.json>]');
      // o Out-File do Windows PowerShell 5.1 grava com BOM: tira antes do JSON.parse
      const info = opt('--info') ? JSON.parse(fs.readFileSync(opt('--info'), 'utf8').replace(/^﻿/, '')) : null;
      console.log(JSON.stringify(await prepararVideo(url, {origem: opt('--origem', 'link'), rodada: opt('--rodada'), info}), null, 2));
    }
  } catch (e) {
    console.log(JSON.stringify({ok: false, erro: e.message}));
    process.exit(1);
  }
}
