// TikTok Content Posting API: rascunho (inbox do app) ou post direto, com upload do arquivo em pedaços.
// App: developers.tiktok.com → app de Desktop com Login Kit + Content Posting API (escopos video.upload, video.publish).
// Sem auditoria do TikTok, o post direto só sai como privado (SELF_ONLY); o rascunho não tem essa limitação.
import fs from 'node:fs';
import {esperar, pedir} from './http.mjs';

const API = 'https://open.tiktokapis.com/v2';

export const nome = 'TikTok';
export const env = ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'];
export const pkceCodificacao = 'hex';

export function urlAutorizar({redirectUri, state, challenge}) {
  const q = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY,
    response_type: 'code',
    scope: 'video.upload,video.publish',
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
}

async function token(form) {
  const {dados} = await pedir(`${API}/oauth/token/`, {
    method: 'POST',
    form: {client_key: process.env.TIKTOK_CLIENT_KEY, client_secret: process.env.TIKTOK_CLIENT_SECRET, ...form},
  });
  if (dados.error || !dados.access_token) throw new Error(`TikTok recusou o token: ${dados.error_description || dados.error || 'sem access_token'}`);
  return {
    accessToken: dados.access_token,
    expira: Date.now() + dados.expires_in * 1000,
    refreshToken: dados.refresh_token,
    refreshExpira: Date.now() + dados.refresh_expires_in * 1000,
    openId: dados.open_id,
  };
}

export const trocarCodigo = (code, {redirectUri, verifier}) =>
  token({code, grant_type: 'authorization_code', redirect_uri: redirectUri, code_verifier: verifier});

export async function renovar(conta) {
  if (conta.accessToken && conta.expira > Date.now() + 60000) return null;
  if (conta.refreshExpira && conta.refreshExpira < Date.now()) throw new Error('O login do TikTok expirou: rode "publicar.mjs conectar tiktok" de novo.');
  return {...conta, ...(await token({grant_type: 'refresh_token', refresh_token: conta.refreshToken}))};
}

// regras do TikTok: pedaços de 5 a 64 MB; o último leva o resto (até 128 MB); abaixo de 5 MB vai inteiro
export function calcularPedacos(tamanho, pedaco = 10 * 1024 * 1024) {
  const MIN = 5 * 1024 * 1024;
  if (tamanho <= Math.max(pedaco, MIN)) return {chunk_size: tamanho, total_chunk_count: 1};
  return {chunk_size: pedaco, total_chunk_count: Math.floor(tamanho / pedaco)};
}

const checar = (dados, etapa) => {
  const e = dados?.error;
  if (e && e.code && e.code !== 'ok') {
    const dica =
      e.code === 'unaudited_client_can_only_post_to_private_accounts'
        ? ' Sem a auditoria do TikTok, use o modo "rascunho" ou deixe a conta privada.'
        : e.code === 'spam_risk_too_many_pending_share'
          ? ' Há rascunhos demais esperando no app (máx. 5 por dia): poste ou apague alguns.'
          : '';
    throw new Error(`TikTok (${etapa}): ${e.code}: ${e.message || ''}${dica}`);
  }
  return dados.data || {};
};

// item: {arquivo, dados: {legenda, modo, privacidade}, capaSegundo}
export async function publicar(conta, {arquivo, dados, capaSegundo}) {
  const headers = {Authorization: `Bearer ${conta.accessToken}`};
  const video = fs.readFileSync(arquivo);
  const pedacos = calcularPedacos(video.length);
  const source_info = {source: 'FILE_UPLOAD', video_size: video.length, ...pedacos};
  const modo = dados.modo || 'rascunho';

  let init;
  if (modo === 'rascunho') {
    const r = await pedir(`${API}/post/publish/inbox/video/init/`, {method: 'POST', headers, json: {source_info}});
    init = checar(r.dados, 'iniciar rascunho');
  } else {
    const ci = checar((await pedir(`${API}/post/publish/creator_info/query/`, {method: 'POST', headers, json: {}})).dados, 'consultar a conta');
    const opcoes = ci.privacy_level_options || [];
    const privacy_level = dados.privacidade || (opcoes.includes('PUBLIC_TO_EVERYONE') ? 'PUBLIC_TO_EVERYONE' : 'SELF_ONLY');
    if (opcoes.length && !opcoes.includes(privacy_level)) throw new Error(`TikTok: privacidade ${privacy_level} não permitida nesta conta (opções: ${opcoes.join(', ')})`);
    const post_info = {title: dados.legenda || '', privacy_level, disable_comment: false, disable_duet: false, disable_stitch: false};
    if (capaSegundo != null) post_info.video_cover_timestamp_ms = Math.round(capaSegundo * 1000);
    const r = await pedir(`${API}/post/publish/video/init/`, {method: 'POST', headers, json: {post_info, source_info}});
    init = checar(r.dados, 'iniciar post');
  }

  // envia os pedaços; o último leva o que sobrar
  const {chunk_size, total_chunk_count} = pedacos;
  for (let i = 0; i < total_chunk_count; i++) {
    const ini = i * chunk_size;
    const fim = i === total_chunk_count - 1 ? video.length : ini + chunk_size;
    await pedir(init.upload_url, {
      method: 'PUT',
      headers: {'Content-Type': 'video/mp4', 'Content-Range': `bytes ${ini}-${fim - 1}/${video.length}`},
      body: video.subarray(ini, fim),
    });
  }

  // espera o TikTok processar (até ~3 min)
  let st = {};
  for (let t = 0; t < 36; t++) {
    st = checar((await pedir(`${API}/post/publish/status/fetch/`, {method: 'POST', headers, json: {publish_id: init.publish_id}})).dados, 'status');
    if (st.status === 'FAILED') throw new Error(`TikTok: o envio falhou (${st.fail_reason || 'sem motivo'})`);
    if (st.status === 'SEND_TO_USER_INBOX' || st.status === 'PUBLISH_COMPLETE') break;
    await esperar(5000);
  }
  const pronto = st.status === 'SEND_TO_USER_INBOX' || st.status === 'PUBLISH_COMPLETE';
  return {
    estado: modo === 'rascunho' ? 'rascunho' : 'publicado',
    id: init.publish_id,
    statusTikTok: st.status,
    avisos: pronto ? undefined : ['o TikTok ainda está processando; confira no app daqui a pouco'],
    proximoPasso: modo === 'rascunho' ? 'abra o TikTok: o vídeo está nas notificações/rascunhos para você postar (cole a legenda sugerida)' : undefined,
  };
}
