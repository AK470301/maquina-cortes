// Confere o work/publicacao.json antes de qualquer envio. Devolve a lista de erros (vazia = tudo certo).
import fs from 'node:fs';
import path from 'node:path';

export const LIMITES = {
  youtubeTitulo: 100,
  youtubeDescricao: 5000,
  youtubeTags: 500, // soma dos caracteres das tags
  legenda: 2200, // TikTok e Instagram
  instagramHashtags: 30,
  antecedenciaMin: 15, // agendamento precisa estar pelo menos 15 min no futuro
};

const temFuso = (s) => /([+-]\d{2}:\d{2}|Z)$/.test(s);

function conferirQuando(q, onde, erros, agora) {
  if (q == null) return;
  if (typeof q !== 'string' || Number.isNaN(Date.parse(q))) return erros.push(`${onde}.quando: data inválida ("${q}"); use ISO, ex. 2026-11-20T18:00:00-03:00`);
  if (!temFuso(q)) return erros.push(`${onde}.quando: falta o fuso horário no fim (ex. -03:00)`);
  if (Date.parse(q) < agora + LIMITES.antecedenciaMin * 60000) erros.push(`${onde}.quando: precisa ser pelo menos ${LIMITES.antecedenciaMin} min no futuro`);
}

export function validar(pub, {base = process.cwd(), agora = Date.now(), existe = fs.existsSync} = {}) {
  const erros = [];
  if (!pub || !Array.isArray(pub.clips) || !pub.clips.length) return ['publicacao.json precisa de "clips" com pelo menos um corte'];
  const ids = new Set();
  for (const [i, c] of pub.clips.entries()) {
    const onde = c?.id ? `[${c.id}]` : `clips[${i}]`;
    if (!c?.id || typeof c.id !== 'string') erros.push(`${onde}: falta "id"`);
    else if (ids.has(c.id)) erros.push(`${onde}: id repetido`);
    ids.add(c?.id);
    if (!c?.arquivo) erros.push(`${onde}: falta "arquivo"`);
    else if (!existe(path.resolve(base, c.arquivo))) erros.push(`${onde}: arquivo não encontrado: ${c.arquivo}`);
    if (c?.capaSegundo != null && !(typeof c.capaSegundo === 'number' && c.capaSegundo >= 0)) erros.push(`${onde}.capaSegundo: precisa ser um número ≥ 0`);
    if (!c?.youtube && !c?.tiktok && !c?.instagram) erros.push(`${onde}: nenhuma plataforma (youtube, tiktok ou instagram)`);

    const yt = c?.youtube;
    if (yt) {
      const t = yt.titulo;
      if (!t || typeof t !== 'string') erros.push(`${onde}.youtube.titulo: obrigatório`);
      else {
        if ([...t].length > LIMITES.youtubeTitulo) erros.push(`${onde}.youtube.titulo: ${[...t].length} caracteres (máx. ${LIMITES.youtubeTitulo})`);
        if (/[<>]/.test(t)) erros.push(`${onde}.youtube.titulo: o YouTube não aceita < ou >`);
      }
      if (yt.descricao && [...yt.descricao].length > LIMITES.youtubeDescricao) erros.push(`${onde}.youtube.descricao: passa de ${LIMITES.youtubeDescricao} caracteres`);
      if (yt.descricao && /[<>]/.test(yt.descricao)) erros.push(`${onde}.youtube.descricao: o YouTube não aceita < ou >`);
      if (yt.tags != null) {
        if (!Array.isArray(yt.tags) || yt.tags.some((x) => typeof x !== 'string')) erros.push(`${onde}.youtube.tags: precisa ser uma lista de textos`);
        else if (yt.tags.join(',').length > LIMITES.youtubeTags) erros.push(`${onde}.youtube.tags: passam de ${LIMITES.youtubeTags} caracteres no total`);
      }
      if (yt.privacidade && !['public', 'unlisted', 'private'].includes(yt.privacidade)) erros.push(`${onde}.youtube.privacidade: public, unlisted ou private`);
      conferirQuando(yt.quando, `${onde}.youtube`, erros, agora);
    }

    const tt = c?.tiktok;
    if (tt) {
      const modo = tt.modo || 'rascunho';
      if (!['rascunho', 'direto', 'manual'].includes(modo)) erros.push(`${onde}.tiktok.modo: "rascunho", "direto" ou "manual"`);
      if (tt.legenda && [...tt.legenda].length > LIMITES.legenda) erros.push(`${onde}.tiktok.legenda: passa de ${LIMITES.legenda} caracteres`);
      if (modo === 'rascunho' && tt.quando) erros.push(`${onde}.tiktok.quando: rascunho não tem horário (o post é feito no app); tire o "quando" ou use modo "direto"`);
      conferirQuando(tt.quando, `${onde}.tiktok`, erros, agora);
    }

    const ig = c?.instagram;
    if (ig) {
      if (ig.modo && !['api', 'manual'].includes(ig.modo)) erros.push(`${onde}.instagram.modo: "api" ou "manual"`);
      if (ig.legenda && [...ig.legenda].length > LIMITES.legenda) erros.push(`${onde}.instagram.legenda: passa de ${LIMITES.legenda} caracteres`);
      const tags = (ig.legenda || '').match(/#[\p{L}\p{N}_]+/gu) || [];
      if (tags.length > LIMITES.instagramHashtags) erros.push(`${onde}.instagram.legenda: ${tags.length} hashtags (máx. ${LIMITES.instagramHashtags})`);
      conferirQuando(ig.quando, `${onde}.instagram`, erros, agora);
    }
  }
  return erros;
}

// o que fazer com cada corte em cada plataforma
export function acaoPara(plataforma, dados) {
  if (dados.modo === 'manual') return 'manual'; // vai para o kit; o usuário agenda no navegador
  if (plataforma === 'youtube') return dados.quando ? 'agendar' : 'publicar'; // o YouTube agenda sozinho (publishAt)
  if (plataforma === 'tiktok' && (dados.modo || 'rascunho') === 'rascunho') return 'rascunho';
  return dados.quando ? 'fila' : 'publicar'; // TikTok direto e Instagram: agendamento pela fila local
}
