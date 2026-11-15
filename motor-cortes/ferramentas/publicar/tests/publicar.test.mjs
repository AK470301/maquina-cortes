// Testes offline (fetch simulado). Rode: node --test ferramentas/publicar/tests/
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, test} from 'node:test';
import {fileURLToPath} from 'node:url';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'publicar-teste-'));
process.env.MAQUINA_CORTES_HOME = path.join(TMP, 'home');
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(AQUI, '..', 'publicar.mjs');

const {validar, acaoPara} = await import('../lib/validar.mjs');
const reg = await import('../lib/registro.mjs');
const {pkce, esperarCodigo, REDIRECT} = await import('../lib/oauth.mjs');
const youtube = await import('../lib/youtube.mjs');
const tiktok = await import('../lib/tiktok.mjs');
const instagram = await import('../lib/instagram.mjs');

after(() => fs.rmSync(TMP, {recursive: true, force: true}));

const VIDEO = path.join(TMP, '01-a.mp4');
fs.writeFileSync(VIDEO, Buffer.alloc(1234, 7));
const AGORA = Date.parse('2026-11-14T12:00:00-03:00');
const FUTURO = '2026-11-20T18:00:00-03:00';

// fetch simulado: cada resposta é {status, json, headers}; guarda as chamadas
function simularFetch(respostas) {
  const chamadas = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    chamadas.push({url: String(url), ...opts});
    const r = respostas.shift();
    if (!r) throw new Error(`chamada inesperada: ${url}`);
    return new Response(r.json === undefined ? '' : JSON.stringify(r.json), {status: r.status || 200, headers: r.headers || {}});
  };
  return {chamadas, restaurar: () => (globalThis.fetch = original)};
}

const clipOk = () => ({
  id: '01-a',
  arquivo: VIDEO,
  capaSegundo: 1.5,
  youtube: {titulo: 'Título bom', descricao: 'desc #Shorts', tags: ['a', 'b'], quando: FUTURO},
  tiktok: {legenda: 'leg #fyp', modo: 'rascunho'},
  instagram: {legenda: 'leg #reels', quando: FUTURO},
});

test('validar: publicacao correta não tem erros', () => {
  assert.deepEqual(validar({clips: [clipOk()]}, {agora: AGORA}), []);
});

test('validar: pega título longo, < >, data sem fuso, data no passado, rascunho com horário e arquivo inexistente', () => {
  const c = clipOk();
  c.youtube.titulo = 'x'.repeat(101) + '<';
  c.youtube.quando = '2026-11-20T18:00:00';
  c.instagram.quando = '2026-11-14T12:05:00-03:00';
  c.tiktok.quando = FUTURO;
  const c2 = {...clipOk(), id: '02-b', arquivo: 'nao-existe.mp4'};
  const erros = validar({clips: [c, c2]}, {agora: AGORA}).join('\n');
  assert.match(erros, /titulo: 102 caracteres/);
  assert.match(erros, /não aceita < ou >/);
  assert.match(erros, /falta o fuso/);
  assert.match(erros, /15 min no futuro/);
  assert.match(erros, /rascunho não tem horário/);
  assert.match(erros, /arquivo não encontrado: nao-existe.mp4/);
});

test('validar: corte sem plataforma e id repetido', () => {
  const erros = validar({clips: [{id: 'x', arquivo: VIDEO}, {id: 'x', arquivo: VIDEO, youtube: {titulo: 't'}}]}, {agora: AGORA}).join('\n');
  assert.match(erros, /nenhuma plataforma/);
  assert.match(erros, /id repetido/);
});

test('acaoPara: YouTube agenda sozinho, TikTok rascunho, o resto vai para a fila', () => {
  assert.equal(acaoPara('youtube', {quando: FUTURO}), 'agendar');
  assert.equal(acaoPara('youtube', {}), 'publicar');
  assert.equal(acaoPara('tiktok', {}), 'rascunho');
  assert.equal(acaoPara('tiktok', {modo: 'direto', quando: FUTURO}), 'fila');
  assert.equal(acaoPara('instagram', {quando: FUTURO}), 'fila');
  assert.equal(acaoPara('instagram', {}), 'publicar');
});

test('pkce: base64url (Google) e hex (TikTok)', () => {
  const g = pkce('base64url');
  assert.equal(g.challenge, crypto.createHash('sha256').update(g.verifier).digest('base64url'));
  assert.ok(g.verifier.length >= 43 && g.verifier.length <= 128);
  const t = pkce('hex');
  assert.match(t.challenge, /^[0-9a-f]{64}$/);
});

test('registro: marca, reconhece o que já foi e a fila ordena e acha os vencidos', () => {
  const f = path.join(TMP, 'work', 'publicado.json');
  reg.marcar(f, '01-a', 'youtube', {estado: 'agendado', id: 'v1'});
  reg.marcar(f, '01-a', 'tiktok', {estado: 'erro', erro: 'x'});
  const r = reg.lerRegistro(f);
  assert.equal(reg.jaFeito(r, '01-a', 'youtube'), true);
  assert.equal(reg.jaFeito(r, '01-a', 'tiktok'), false); // erro pode tentar de novo
  reg.enfileirar({plataforma: 'instagram', clipId: 'b', registro: f, quando: '2026-11-22T10:00:00Z'});
  reg.enfileirar({plataforma: 'instagram', clipId: 'a', registro: f, quando: '2026-11-21T10:00:00Z'});
  reg.enfileirar({plataforma: 'instagram', clipId: 'a', registro: f, quando: '2026-11-21T11:00:00Z'}); // substitui
  const fila = reg.lerFila();
  assert.deepEqual(fila.map((i) => [i.clipId, i.quando]), [['a', '2026-11-21T11:00:00Z'], ['b', '2026-11-22T10:00:00Z']]);
  assert.deepEqual(reg.vencidos(fila, Date.parse('2026-11-21T12:00:00Z')).map((i) => i.clipId), ['a']);
  reg.gravarFila([]);
});

test('tiktok: pedaços seguem as regras (último leva o resto)', () => {
  const MB = 1024 * 1024;
  assert.deepEqual(tiktok.calcularPedacos(3 * MB), {chunk_size: 3 * MB, total_chunk_count: 1});
  assert.deepEqual(tiktok.calcularPedacos(10 * MB), {chunk_size: 10 * MB, total_chunk_count: 1});
  assert.deepEqual(tiktok.calcularPedacos(35 * MB), {chunk_size: 10 * MB, total_chunk_count: 3});
});

test('youtube: upload resumable agendado como privado com publishAt e capa', async () => {
  const capa = path.join(TMP, 'capa.jpg');
  fs.writeFileSync(capa, 'jpg');
  const f = simularFetch([
    {headers: {location: 'https://upload.example/sessao'}},
    {json: {id: 'abc123', status: {privacyStatus: 'private'}}},
    {json: {}},
  ]);
  try {
    const r = await youtube.publicar({accessToken: 'tok'}, {arquivo: VIDEO, dados: {titulo: 'T', tags: ['x']}, quando: FUTURO, capa});
    assert.equal(r.estado, 'agendado');
    assert.equal(r.url, 'https://www.youtube.com/shorts/abc123');
    const meta = JSON.parse(f.chamadas[0].body);
    assert.equal(meta.status.privacyStatus, 'private');
    assert.equal(meta.status.publishAt, new Date(FUTURO).toISOString());
    assert.equal(f.chamadas[0].headers['X-Upload-Content-Length'], '1234');
    assert.equal(f.chamadas[1].url, 'https://upload.example/sessao');
    assert.match(f.chamadas[2].url, /thumbnails\/set\?videoId=abc123/);
    assert.equal(r.avisos, undefined);
  } finally {
    f.restaurar();
  }
});

test('youtube: avisa quando o vídeo público volta travado em privado', async () => {
  const f = simularFetch([{headers: {location: 'https://upload.example/s'}}, {json: {id: 'v', status: {privacyStatus: 'private'}}}]);
  try {
    const r = await youtube.publicar({accessToken: 't'}, {arquivo: VIDEO, dados: {titulo: 'T'}, quando: null});
    assert.equal(r.estado, 'publicado');
    assert.match(r.avisos[0], /auditoria/);
  } finally {
    f.restaurar();
  }
});

test('youtube: renova o token vencido', async () => {
  const f = simularFetch([{json: {access_token: 'novo', expires_in: 3600}}]);
  try {
    const c = await youtube.renovar({refreshToken: 'r', accessToken: 'velho', expira: Date.now() - 1});
    assert.equal(c.accessToken, 'novo');
    assert.match(f.chamadas[0].body, /grant_type=refresh_token/);
    assert.equal(await youtube.renovar({accessToken: 'ok', expira: Date.now() + 3600e3}), null);
  } finally {
    f.restaurar();
  }
});

test('tiktok: rascunho vai para o inbox, envia o arquivo e espera o status', async () => {
  const ok = {error: {code: 'ok'}};
  const f = simularFetch([
    {json: {...ok, data: {publish_id: 'p1', upload_url: 'https://up.tiktok/x'}}},
    {status: 201, json: {}},
    {json: {...ok, data: {status: 'SEND_TO_USER_INBOX'}}},
  ]);
  try {
    const r = await tiktok.publicar({accessToken: 't'}, {arquivo: VIDEO, dados: {legenda: 'l'}});
    assert.equal(r.estado, 'rascunho');
    assert.match(f.chamadas[0].url, /inbox\/video\/init/);
    assert.equal(JSON.parse(f.chamadas[0].body).source_info.video_size, 1234);
    assert.equal(f.chamadas[1].headers['Content-Range'], 'bytes 0-1233/1234');
  } finally {
    f.restaurar();
  }
});

test('tiktok: post direto sem auditoria explica o erro', async () => {
  const f = simularFetch([
    {json: {error: {code: 'ok'}, data: {privacy_level_options: ['SELF_ONLY']}}},
    {json: {error: {code: 'unaudited_client_can_only_post_to_private_accounts', message: 'x'}}},
  ]);
  try {
    await assert.rejects(
      tiktok.publicar({accessToken: 't'}, {arquivo: VIDEO, dados: {legenda: 'l', modo: 'direto', privacidade: 'SELF_ONLY'}, capaSegundo: 2}),
      /modo "rascunho"/,
    );
    assert.equal(JSON.parse(f.chamadas[1].body).post_info.video_cover_timestamp_ms, 2000);
  } finally {
    f.restaurar();
  }
});

test('instagram: cria o contêiner, envia pelo rupload, espera e publica', async () => {
  const f = simularFetch([
    {json: {id: 'c1', uri: 'https://rupload.facebook.com/ig-api-upload/v23.0/c1'}},
    {json: {success: true}},
    {json: {status_code: 'FINISHED'}},
    {json: {id: 'm1'}},
    {json: {permalink: 'https://www.instagram.com/reel/xyz/'}},
  ]);
  try {
    const r = await instagram.publicar({igUserId: '42', accessToken: 'tok'}, {arquivo: VIDEO, dados: {legenda: 'oi #reels'}, capaSegundo: 1.5});
    assert.equal(r.url, 'https://www.instagram.com/reel/xyz/');
    const u = new URL(f.chamadas[0].url);
    assert.equal(u.searchParams.get('media_type'), 'REELS');
    assert.equal(u.searchParams.get('thumb_offset'), '1500');
    assert.equal(f.chamadas[1].headers.file_size, '1234');
    assert.equal(f.chamadas[1].headers.Authorization, 'OAuth tok');
    assert.match(f.chamadas[3].url, /media_publish\?creation_id=c1/);
  } finally {
    f.restaurar();
  }
});

test('cli: enviar --teste mostra o plano e pula o que já foi', () => {
  const corte = path.join(TMP, 'corte');
  fs.mkdirSync(path.join(corte, 'work'), {recursive: true});
  fs.copyFileSync(VIDEO, path.join(corte, '01-a.mp4'));
  const c = {...clipOk(), arquivo: '01-a.mp4', youtube: {...clipOk().youtube, quando: new Date(Date.now() + 86400e3).toISOString()}};
  delete c.instagram.quando;
  fs.writeFileSync(path.join(corte, 'work', 'publicacao.json'), JSON.stringify({clips: [c]}));
  fs.writeFileSync(path.join(corte, 'work', 'publicado.json'), JSON.stringify({'01-a': {tiktok: {estado: 'rascunho'}}}));
  const r = spawnSync(process.execPath, [CLI, 'enviar', 'work/publicacao.json', '--teste'], {cwd: corte, encoding: 'utf8', env: {...process.env, YOUTUBE_CLIENT_ID: ''}});
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.deepEqual(o.plano.map((x) => [x.plataforma, x.acao]), [['youtube', 'agendar'], ['tiktok', 'pular'], ['instagram', 'publicar']]);
  assert.deepEqual(o.contasFaltando.sort(), ['instagram', 'youtube']);
});

test('cli: publicacao inválida para antes de qualquer envio', () => {
  const corte = path.join(TMP, 'corte2');
  fs.mkdirSync(path.join(corte, 'work'), {recursive: true});
  fs.writeFileSync(path.join(corte, 'work', 'publicacao.json'), JSON.stringify({clips: [{id: 'x', arquivo: 'falta.mp4', youtube: {titulo: 't'}}]}));
  const r = spawnSync(process.execPath, [CLI, 'enviar', 'work/publicacao.json'], {cwd: corte, encoding: 'utf8'});
  assert.equal(r.status, 1);
  assert.match(r.stderr, /arquivo não encontrado/);
});

test('oauth: o servidor local recebe o código e confere o state', async () => {
  const espera = esperarCodigo('st1', 5000);
  await new Promise((r) => setTimeout(r, 100));
  const resp = await fetch(`${REDIRECT.replace('localhost', '127.0.0.1')}?code=abc&state=st1`);
  assert.match(await resp.text(), /Conta conectada/);
  assert.equal(await espera, 'abc');
  const ruim = esperarCodigo('st2', 5000);
  ruim.catch(() => {});
  await new Promise((r) => setTimeout(r, 100));
  await fetch(`${REDIRECT.replace('localhost', '127.0.0.1')}?code=abc&state=outro`);
  await assert.rejects(ruim, /state diferente/);
});

test('credenciais: lê o JSON baixado do Google e o apps.env, sem passar por cima do ambiente', async () => {
  const {carregarCredenciais, CONTAS} = await import('../lib/contas.mjs');
  fs.mkdirSync(CONTAS, {recursive: true});
  fs.writeFileSync(path.join(CONTAS, 'youtube-cliente.json'), JSON.stringify({installed: {client_id: 'id.apps', client_secret: 'seg'}}));
  fs.writeFileSync(path.join(CONTAS, 'apps.env'), '# comentário\nTIKTOK_CLIENT_KEY="abc"\nMETA_APP_ID=123\n');
  const env = carregarCredenciais({META_APP_ID: 'do-ambiente'});
  assert.equal(env.YOUTUBE_CLIENT_ID, 'id.apps');
  assert.equal(env.YOUTUBE_CLIENT_SECRET, 'seg');
  assert.equal(env.TIKTOK_CLIENT_KEY, 'abc');
  assert.equal(env.META_APP_ID, 'do-ambiente');
});

test('instagram: login usa config_id quando existe, senão scope', () => {
  process.env.META_APP_ID = '1';
  delete process.env.META_CONFIG_ID;
  assert.ok(new URL(instagram.urlAutorizar({redirectUri: 'http://localhost:8723/callback/', state: 's'})).searchParams.get('scope'));
  process.env.META_CONFIG_ID = '999';
  const u = new URL(instagram.urlAutorizar({redirectUri: 'http://localhost:8723/callback/', state: 's'}));
  assert.equal(u.searchParams.get('config_id'), '999');
  assert.equal(u.searchParams.get('scope'), null);
  delete process.env.META_CONFIG_ID;
});

test('horarios: próximos livres no fuso, pulando os ocupados e os muito próximos', async () => {
  const {proximosHorarios} = await import('../lib/agenda.mjs');
  const agora = Date.parse('2026-11-14T17:50:00-03:00'); // 18h está a menos de 15 min
  const ocupado = Date.parse('2026-11-15T12:00:00-03:00');
  const r = proximosHorarios(4, {horarios: ['18:00', '12:00', '21:00'], fuso: '-03:00', plataformas: ['youtube', 'instagram'], agenda: {instagram: [ocupado]}, agora});
  assert.deepEqual(r, ['2026-11-14T21:00:00-03:00', '2026-11-15T18:00:00-03:00', '2026-11-15T21:00:00-03:00', '2026-11-16T12:00:00-03:00']);
  // virada do dia no fuso: 23h30 de Brasília já é dia seguinte em UTC
  const r2 = proximosHorarios(1, {horarios: ['12:00'], fuso: '-03:00', plataformas: ['youtube'], agora: Date.parse('2026-11-14T23:30:00-03:00')});
  assert.deepEqual(r2, ['2026-11-15T12:00:00-03:00']);
});

test('kit: pasta por plataforma, vídeos na ordem de publicação e LEGENDAS.txt', async () => {
  const {gerarKit} = await import('../lib/kit.mjs');
  const destino = path.join(TMP, 'kit');
  const pub = {
    clips: [
      {id: '02-b', arquivo: VIDEO, capaSegundo: 2.4, instagram: {modo: 'manual', legenda: 'leg B #reels', quando: '2026-11-15T18:00:00-03:00'}},
      {id: '01-a', arquivo: VIDEO, instagram: {modo: 'manual', legenda: 'leg A', quando: '2026-11-15T12:00:00-03:00'}, tiktok: {modo: 'manual', legenda: 'tt A', quando: '2026-11-15T12:00:00-03:00'}},
      {id: '03-c', arquivo: VIDEO, instagram: {legenda: 'api, fora do kit'}},
    ],
  };
  const feitos = gerarKit(pub, {base: TMP, destino, plataformas: ['instagram', 'tiktok']});
  assert.deepEqual(feitos.map((f) => [f.plataforma, f.corte]), [['instagram', '01-a'], ['instagram', '02-b'], ['tiktok', '01-a']]);
  assert.deepEqual(fs.readdirSync(path.join(destino, 'instagram')).sort(), ['2026-11-15 12h00 - 01-a.mp4', '2026-11-15 18h00 - 02-b.mp4', 'LEGENDAS.txt']);
  const txt = fs.readFileSync(path.join(destino, 'instagram', 'LEGENDAS.txt'), 'utf8');
  assert.match(txt, /1\. 15\/11 \(dom\) às 12:00: 01-a/);
  assert.match(txt, /Capa: o quadro em 2,4 s/);
  assert.match(txt, /leg B #reels/);
  assert.doesNotMatch(txt, /03-c/);
});

test('validar/acaoPara: modo manual aceita horário e não vai para a API', () => {
  const c = {id: 'x', arquivo: VIDEO, tiktok: {modo: 'manual', legenda: 'l', quando: FUTURO}, instagram: {modo: 'manual', quando: FUTURO}};
  assert.deepEqual(validar({clips: [c]}, {agora: AGORA}), []);
  assert.equal(acaoPara('tiktok', c.tiktok), 'manual');
  assert.equal(acaoPara('instagram', c.instagram), 'manual');
  assert.match(validar({clips: [{...c, instagram: {modo: 'x'}}]}, {agora: AGORA}).join(), /"api" ou "manual"/);
});

test('hashtag do streamer: vem do slug ou do campo "hashtag" e é acrescentada só onde falta', async () => {
  const {hashtagDoStreamer, garantirHashtag} = await import('../lib/hashtag.mjs');
  const home = path.join(TMP, 'home-tag');
  fs.mkdirSync(path.join(home, 'streamers'), {recursive: true});
  fs.writeFileSync(path.join(home, 'streamers', 'coringa.json'), JSON.stringify({hashtag: '#LoudCoringa'}));
  assert.equal(hashtagDoStreamer('coringa', home), '#loudcoringa');
  assert.equal(hashtagDoStreamer('cazé-tv', home), '#cazetv');
  assert.equal(hashtagDoStreamer(null, home), null);
  const pub = {
    clips: [
      {id: 'a', youtube: {titulo: 'T #loudcoringa', descricao: 'd'}, tiktok: {legenda: 'x #LOUDCORINGA'}, instagram: {legenda: 'y #loudcoringafã'}},
      {id: 'b', youtube: {titulo: 'T', descricao: ''}, instagram: {}},
    ],
  };
  const {acrescentadas} = garantirHashtag(pub, '#loudcoringa');
  assert.deepEqual(acrescentadas, ['a/youtube', 'a/instagram', 'b/youtube', 'b/instagram']);
  assert.equal(pub.clips[0].youtube.descricao, 'd #loudcoringa'); // título não basta: vai na descrição
  assert.equal(pub.clips[0].instagram.legenda, 'y #loudcoringafã #loudcoringa'); // hashtag maior não conta
  assert.equal(pub.clips[1].youtube.descricao, '#loudcoringa');
});
