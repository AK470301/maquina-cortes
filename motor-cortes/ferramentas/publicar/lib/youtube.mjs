// YouTube Data API v3: upload resumable, agendamento nativo (publishAt) e capa (thumbnails.set).
// App: Google Cloud → API "YouTube Data API v3" → credencial OAuth do tipo "App para computador".
import fs from 'node:fs';
import {pedir} from './http.mjs';

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3';

export const nome = 'YouTube';
export const env = ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET'];
export const pkceCodificacao = 'base64url';

export function urlAutorizar({redirectUri, state, challenge}) {
  const q = new URLSearchParams({
    client_id: process.env.YOUTUBE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/youtube.upload',
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH}?${q}`;
}

export async function trocarCodigo(code, {redirectUri, verifier}) {
  const {dados} = await pedir(TOKEN, {
    method: 'POST',
    form: {
      code,
      client_id: process.env.YOUTUBE_CLIENT_ID,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    },
  });
  if (!dados.refresh_token) throw new Error('O Google não devolveu refresh_token. Remova o acesso do app em myaccount.google.com/permissions e conecte de novo.');
  return {refreshToken: dados.refresh_token, accessToken: dados.access_token, expira: Date.now() + dados.expires_in * 1000};
}

// devolve a conta com token novo, ou null se o atual ainda vale
export async function renovar(conta) {
  if (conta.accessToken && conta.expira > Date.now() + 60000) return null;
  const {dados} = await pedir(TOKEN, {
    method: 'POST',
    form: {
      client_id: process.env.YOUTUBE_CLIENT_ID,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      refresh_token: conta.refreshToken,
      grant_type: 'refresh_token',
    },
  });
  return {...conta, accessToken: dados.access_token, expira: Date.now() + dados.expires_in * 1000};
}

// item: {arquivo, dados: {titulo, descricao, tags, privacidade, categoria}, quando, capa (jpg) }
export async function publicar(conta, {arquivo, dados, quando, capa}) {
  const auth = {Authorization: `Bearer ${conta.accessToken}`};
  const video = fs.readFileSync(arquivo);
  const status = quando
    ? {privacyStatus: 'private', publishAt: new Date(quando).toISOString(), selfDeclaredMadeForKids: false}
    : {privacyStatus: dados.privacidade || 'public', selfDeclaredMadeForKids: false};
  const meta = {
    snippet: {title: dados.titulo, description: dados.descricao || '', tags: dados.tags || [], categoryId: String(dados.categoria || '22')},
    status,
  };
  const ini = await pedir(`${UPLOAD}/videos?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    headers: {...auth, 'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(video.length)},
    json: meta,
  });
  const destino = ini.headers.get('location');
  if (!destino) throw new Error('O YouTube não devolveu o endereço de upload.');
  const {dados: v} = await pedir(destino, {method: 'PUT', headers: {...auth, 'Content-Type': 'video/mp4'}, body: video});

  const avisos = [];
  if (!quando && status.privacyStatus !== 'private' && v.status?.privacyStatus === 'private') {
    avisos.push('o YouTube deixou o vídeo privado: o projeto do Google Cloud precisa passar pela auditoria da API para publicar como público. Publique à mão no Studio.');
  }
  if (capa) {
    try {
      await pedir(`${UPLOAD}/thumbnails/set?videoId=${v.id}&uploadType=media`, {
        method: 'POST',
        headers: {...auth, 'Content-Type': 'image/jpeg'},
        body: fs.readFileSync(capa),
      });
    } catch (e) {
      avisos.push(`capa não aplicada (${e.message}). Capa personalizada exige canal verificado e pode não aparecer em Shorts.`);
    }
  }
  return {
    estado: quando ? 'agendado' : 'publicado',
    id: v.id,
    url: `https://www.youtube.com/shorts/${v.id}`,
    privacidade: v.status?.privacyStatus,
    quando: quando || undefined,
    avisos: avisos.length ? avisos : undefined,
  };
}
