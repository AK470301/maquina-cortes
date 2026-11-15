// Publicador Zernio (https://zernio.com/api/v1): sobe o .mp4 por URL pré-assinada e cria o post agendado.
// Ambiente (<projeto>/.env): ZERNIO_API_KEY (obrigatória); ZERNIO_TIKTOK_ACCOUNT_ID e ZERNIO_YOUTUBE_ACCOUNT_ID
// (opcionais: sem elas, usa a única conta ativa daquela plataforma na Zernio).
// Ajustes em pipeline.config.json → "zernio" (ver lá).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {config} from './env.mjs';

const BASE = 'https://zernio.com/api/v1';
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(metodo, rota, {corpo, chave, timeout = 60e3} = {}) {
  const r = await fetch(BASE + rota, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${process.env.ZERNIO_API_KEY}`,
      ...(corpo ? {'Content-Type': 'application/json'} : {}),
      ...(chave ? {'Idempotency-Key': chave} : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  const texto = await r.text();
  let json = texto.slice(0, 2000);
  try {
    json = JSON.parse(texto);
  } catch {}
  return {ok: r.ok, status: r.status, json};
}

// plataforma do pipeline → plataforma da Zernio
const ALVO = {tiktok: 'tiktok', youtube_short: 'youtube', youtube_longo: 'youtube'};

// {tiktok: id, youtube: id} a partir do .env ou da lista de contas; erros em texto
export async function contasZernio() {
  const erros = [];
  if (!process.env.ZERNIO_API_KEY) return {contas: {}, erros: ['ZERNIO_API_KEY não definida (ambiente ou .env)']};
  const r = await api('GET', '/accounts');
  if (!r.ok) return {contas: {}, erros: [`GET /accounts → ${r.status}: ${JSON.stringify(r.json).slice(0, 300)}`]};
  const ativas = (r.json.accounts || []).filter((a) => a.isActive !== false);
  const contas = {};
  for (const plat of ['tiktok', 'youtube']) {
    const env = process.env[`ZERNIO_${plat.toUpperCase()}_ACCOUNT_ID`];
    const daPlat = ativas.filter((a) => a.platform === plat);
    if (env) {
      if (!daPlat.some((a) => (a._id || a.id) === env)) erros.push(`ZERNIO_${plat.toUpperCase()}_ACCOUNT_ID=${env} não é uma conta ${plat} ativa na Zernio`);
      contas[plat] = env;
    } else if (daPlat.length === 1) contas[plat] = daPlat[0]._id || daPlat[0].id;
    else if (daPlat.length > 1) erros.push(`${daPlat.length} contas ${plat} na Zernio: defina ZERNIO_${plat.toUpperCase()}_ACCOUNT_ID no .env`);
    contas[`${plat}_nome`] = (daPlat.find((a) => (a._id || a.id) === contas[plat]) || {}).username || null;
  }
  return {contas, erros};
}

export function alvoZernio(plataforma) {
  return ALVO[plataforma];
}

// monta o corpo do POST /posts (sem a URL do vídeo); exportado para o --teste
export function corpoPost(item, contas, urlVideo = '<upload>') {
  const cfg = config().zernio || {};
  const alvo = ALVO[item.plataforma];
  const tags = (item.hashtags || []).join(' ');
  const juntar = (...partes) => partes.map((p) => (p || '').trim()).filter(Boolean).join('\n\n');
  const corpo = {
    mediaItems: [{type: 'video', url: urlVideo}],
    platforms: [{platform: alvo, accountId: contas[alvo]}],
    timezone: cfg.timezone || 'America/Sao_Paulo',
    metadata: {pipelineId: item.id},
  };
  if (item.agendado_para) corpo.scheduledFor = new Date(item.agendado_para).toISOString();
  else corpo.publishNow = true;

  if (alvo === 'tiktok') {
    const t = cfg.tiktok || {};
    corpo.content = juntar(item.titulo, item.descricao, tags).slice(0, 2200);
    corpo.tiktokSettings = {
      privacy_level: t.privacy_level || 'PUBLIC_TO_EVERYONE',
      allow_comment: t.allow_comment ?? true,
      allow_duet: t.allow_duet ?? true,
      allow_stitch: t.allow_stitch ?? true,
      commercial_content_type: t.commercial_content_type || 'none',
      // o OK item a item na tabela de publicação é a prévia e o consentimento exigidos pelo TikTok
      content_preview_confirmed: true,
      express_consent_given: true,
      media_type: 'video',
      auto_add_music: false,
      video_made_with_ai: false,
      ...(t.draft ? {draft: true} : {}),
    };
  } else {
    const y = cfg.youtube || {};
    corpo.content = juntar(item.descricao, tags).slice(0, 5000);
    // tags do YouTube (palavras-chave do vídeo) = hashtags sem o #
    corpo.tags = (item.hashtags || []).map((h) => h.replace(/^#/, '')).filter((h) => h.toLowerCase() !== 'shorts');
    corpo.platforms[0].platformSpecificData = {
      title: item.titulo.slice(0, 100),
      visibility: y.visibility || 'public',
      madeForKids: false,
      containsSyntheticMedia: false,
      categoryId: y.categoryId || '20',
      defaultLanguage: y.defaultLanguage || 'pt-BR',
      defaultAudioLanguage: y.defaultAudioLanguage || 'pt-BR',
      ...(y.notifySubscribers === false ? {notifySubscribers: false} : {}),
      ...(item.playlistId || y.playlistId ? {playlistId: item.playlistId || y.playlistId} : {}),
    };
  }
  return corpo;
}

async function subir(arquivo) {
  const p = await api('POST', '/media/presign', {corpo: {filename: path.basename(arquivo), contentType: 'video/mp4'}});
  if (!p.ok) throw Object.assign(new Error(`presign → ${p.status}: ${JSON.stringify(p.json).slice(0, 300)}`), {status: p.status});
  const put = await fetch(p.json.uploadUrl, {
    method: 'PUT',
    headers: {'Content-Type': 'video/mp4'},
    body: fs.readFileSync(arquivo),
    signal: AbortSignal.timeout(20 * 60e3),
  });
  if (!put.ok) throw Object.assign(new Error(`upload do vídeo → ${put.status}`), {status: put.status});
  return p.json.publicUrl;
}

// sobe e cria o post; até 3 tentativas em 429/5xx/rede. O Idempotency-Key (id:plataforma + hash dos metadados)
// evita post duplicado se a resposta se perder; se o item for corrigido, o hash muda e a chave também.
export async function enviarZernio({chave, arquivo, item}, contas) {
  let urlVideo = null;
  const hash = crypto.createHash('sha1').update(JSON.stringify(corpoPost(item, contas, ''))).digest('hex').slice(0, 12);
  chave = `${chave}:${hash}`;
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      urlVideo ||= await subir(arquivo);
      const r = await api('POST', '/posts', {corpo: corpoPost(item, contas, urlVideo), chave, timeout: 10 * 60e3});
      const post = r.json?.post || {};
      const resumo = {ok: r.ok, status: r.status, post_id: post._id || null, status_post: post.status || null,
        url: (post.platforms || []).map((p) => p.platformPostUrl).filter(Boolean)[0] || null};
      if (r.ok) return resumo;
      if (r.status !== 429 && r.status < 500) return {...resumo, resposta: r.json};
      if (tentativa === 3) return {...resumo, resposta: r.json};
    } catch (e) {
      if (e.status && e.status !== 429 && e.status < 500) return {ok: false, erro: e.message};
      if (tentativa === 3) return {ok: false, erro: e.message};
    }
    await esperar(5000 * tentativa);
  }
}

// posts já agendados na Zernio: [{plataforma: 'tiktok' | 'youtube', quando: ms, id}] (todas as páginas)
export async function postsAgendadosZernio() {
  if (!process.env.ZERNIO_API_KEY) return {posts: [], erro: 'ZERNIO_API_KEY não definida'};
  const posts = [];
  for (let page = 1; page <= 20; page++) {
    const r = await api('GET', `/posts?status=scheduled&limit=100&page=${page}`);
    if (!r.ok) return {posts, erro: `GET /posts → ${r.status}`};
    for (const p of r.json.posts || [])
      for (const pl of p.platforms || []) if (p.scheduledFor) posts.push({plataforma: pl.platform, quando: Date.parse(p.scheduledFor), id: p._id});
    if (!r.json.pagination || page >= (r.json.pagination.pages || 1)) break;
  }
  return {posts, erro: null};
}
