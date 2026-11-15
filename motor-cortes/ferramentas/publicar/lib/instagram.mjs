// Instagram Reels pela Graph API, com Facebook Login for Business e upload resumable do arquivo local
// (o login "Instagram Login" só aceita vídeo em URL pública, por isso não é usado aqui).
// Precisa: conta profissional do Instagram ligada a uma Página do Facebook; app na Meta com
// "Facebook Login for Business" e as permissões instagram_basic, instagram_content_publish,
// pages_show_list, pages_read_engagement, business_management.
import fs from 'node:fs';
import {esperar, pedir} from './http.mjs';

const V = 'v23.0';
const G = `https://graph.facebook.com/${V}`;
const ESCOPOS = 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,business_management';

export const nome = 'Instagram';
export const env = ['META_APP_ID', 'META_APP_SECRET'];
export const pkceCodificacao = null;

// Facebook Login for Business usa uma "configuração" criada no painel do app (META_CONFIG_ID), que substitui
// a lista de permissões; sem ela, cai no "scope" antigo
export function urlAutorizar({redirectUri, state}) {
  const q = new URLSearchParams({client_id: process.env.META_APP_ID, redirect_uri: redirectUri, state, response_type: 'code'});
  if (process.env.META_CONFIG_ID) q.set('config_id', process.env.META_CONFIG_ID);
  else q.set('scope', ESCOPOS);
  return `https://www.facebook.com/${V}/dialog/oauth?${q}`;
}

export async function trocarCodigo(code, {redirectUri}) {
  const app = {client_id: process.env.META_APP_ID, client_secret: process.env.META_APP_SECRET};
  const curto = (await pedir(`${G}/oauth/access_token?${new URLSearchParams({...app, redirect_uri: redirectUri, code})}`)).dados.access_token;
  const longo = (await pedir(`${G}/oauth/access_token?${new URLSearchParams({...app, grant_type: 'fb_exchange_token', fb_exchange_token: curto})}`)).dados
    .access_token;
  const {dados} = await pedir(`${G}/me/accounts?fields=name,access_token,instagram_business_account{id,username}&limit=100`, {
    headers: {Authorization: `Bearer ${longo}`},
  });
  const paginas = (dados.data || []).filter((p) => p.instagram_business_account);
  if (!paginas.length) throw new Error('Nenhuma Página com conta profissional do Instagram ligada. Ligue o Instagram à Página nas configurações e conecte de novo.');
  const quer = (process.env.INSTAGRAM_USUARIO || '').replace(/^@/, '').toLowerCase();
  const p = (quer && paginas.find((x) => x.instagram_business_account.username?.toLowerCase() === quer)) || paginas[0];
  if (paginas.length > 1 && !quer) {
    console.warn(`Várias contas encontradas (${paginas.map((x) => '@' + x.instagram_business_account.username).join(', ')}); usando @${p.instagram_business_account.username}. Para outra, defina INSTAGRAM_USUARIO e conecte de novo.`);
  }
  // o token da Página, derivado de um token de usuário longo, não expira
  return {igUserId: p.instagram_business_account.id, usuario: p.instagram_business_account.username, pagina: p.name, accessToken: p.access_token};
}

export const renovar = async () => null;

export async function status(conta) {
  const {dados} = await pedir(`${G}/${conta.igUserId}/content_publishing_limit?fields=quota_usage,config`, {
    headers: {Authorization: `Bearer ${conta.accessToken}`},
  });
  const d = dados.data?.[0] || {};
  return {usuario: '@' + conta.usuario, usadosEm24h: d.quota_usage, limite: d.config?.quota_total};
}

// item: {arquivo, dados: {legenda}, capaSegundo}
export async function publicar(conta, {arquivo, dados, capaSegundo}) {
  const bearer = {Authorization: `Bearer ${conta.accessToken}`};
  const oauth = {Authorization: `OAuth ${conta.accessToken}`};
  const video = fs.readFileSync(arquivo);

  const params = new URLSearchParams({upload_type: 'resumable', media_type: 'REELS', caption: dados.legenda || ''});
  if (capaSegundo != null) params.set('thumb_offset', String(Math.round(capaSegundo * 1000)));
  const cont = (await pedir(`${G}/${conta.igUserId}/media?${params}`, {method: 'POST', headers: bearer})).dados;
  const destino = cont.uri || `https://rupload.facebook.com/ig-api-upload/${V}/${cont.id}`;
  await pedir(destino, {method: 'POST', headers: {...oauth, offset: '0', file_size: String(video.length)}, body: video});

  // espera o processamento (até ~5 min)
  let st = {};
  for (let t = 0; t < 60; t++) {
    st = (await pedir(`${G}/${cont.id}?fields=status_code,status`, {headers: oauth})).dados;
    if (st.status_code === 'FINISHED') break;
    if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') throw new Error(`Instagram: o processamento falhou (${st.status || st.status_code})`);
    await esperar(5000);
  }
  if (st.status_code !== 'FINISHED') throw new Error('Instagram: o vídeo não terminou de processar em 5 min; tente de novo mais tarde.');

  const pub = (await pedir(`${G}/${conta.igUserId}/media_publish?creation_id=${cont.id}`, {method: 'POST', headers: oauth})).dados;
  let url;
  try {
    url = (await pedir(`${G}/${pub.id}?fields=permalink`, {headers: oauth})).dados.permalink;
  } catch {}
  return {estado: 'publicado', id: pub.id, url};
}
