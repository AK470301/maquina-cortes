#!/usr/bin/env node
// Publica os cortes no YouTube Shorts, TikTok e Instagram Reels pelas APIs oficiais.
//
//   node publicar.mjs conectar <youtube|tiktok|instagram>   login pelo navegador (uma vez por conta)
//   node publicar.mjs status                                contas conectadas, variáveis e limites
//   node publicar.mjs enviar work/publicacao.json [--so id1,id2] [--plataforma yt,tt,ig] [--teste] [--forcar]
//   node publicar.mjs fila                                  publica o que já venceu na fila (rode a cada 15 min)
//   node publicar.mjs kit work/publicacao.json [--plataforma ig,tt]   kit para agendar à mão (modo "manual")
//   node publicar.mjs horarios <n> [--plataforma yt,ig,tt]  os próximos n horários livres (config.publicacao)
//
// Rode "enviar" da pasta do corte (a mesma do build): os caminhos em "arquivo" são relativos a ela.
// Credenciais dos apps: variáveis de ambiente ou arquivos em ~/.maquina-cortes-gta/contas/ (veja docs/publicacao.md);
// os tokens ficam em ~/.maquina-cortes-gta/contas/ com permissão só do dono.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {ALIAS, PLATAFORMAS, carregarCredenciais, contasConectadas, lerConta, lerJson, salvarConta} from './lib/contas.mjs';
import {REDIRECT, abrirNavegador, esperarCodigo, novoState, pkce} from './lib/oauth.mjs';
import {enfileirar, gravarFila, jaFeito, lerFila, lerRegistro, marcar, vencidos} from './lib/registro.mjs';
import {acaoPara, validar} from './lib/validar.mjs';
import {lerAgenda, ocupar, preferencias, proximosHorarios} from './lib/agenda.mjs';
import {gerarKit} from './lib/kit.mjs';
import {garantirHashtag, hashtagDoStreamer, streamerDoPub} from './lib/hashtag.mjs';
import * as youtube from './lib/youtube.mjs';
import * as tiktok from './lib/tiktok.mjs';
import * as instagram from './lib/instagram.mjs';

const MODS = {youtube, tiktok, instagram};
carregarCredenciais(); // contas/youtube-cliente.json e contas/apps.env, se existirem
const args = process.argv.slice(2);
const cmd = args[0];
const flag = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (n) => args.includes(n);
const saida = (o) => console.log(JSON.stringify(o, null, 2));
const falhar = (msg) => {
  console.error(msg);
  process.exit(1);
};

const envFaltando = (p) => MODS[p].env.filter((v) => !process.env[v]);

function plataforma(nomeOuAlias) {
  const p = ALIAS[nomeOuAlias] || nomeOuAlias;
  if (!PLATAFORMAS.includes(p)) falhar(`Plataforma desconhecida: "${nomeOuAlias}" (use youtube, tiktok ou instagram)`);
  return p;
}

async function contaPronta(p) {
  const conta = lerConta(p);
  if (!conta) throw new Error(`${MODS[p].nome} não conectado: rode "publicar.mjs conectar ${p}"`);
  const faltam = envFaltando(p);
  if (faltam.length) throw new Error(`${MODS[p].nome}: defina ${faltam.join(', ')} no ambiente`);
  const nova = await MODS[p].renovar(conta);
  if (nova) salvarConta(p, nova);
  return nova || conta;
}

// ---- conectar ----
async function conectar(p) {
  const mod = MODS[p];
  const faltam = envFaltando(p);
  if (faltam.length) falhar(`Para conectar o ${mod.nome}, defina no ambiente: ${faltam.join(', ')}. Veja ~/.maquina-cortes-gta/docs/publicacao.md.`);
  const {verifier, challenge} = mod.pkceCodificacao ? pkce(mod.pkceCodificacao) : {};
  const state = novoState();
  const url = mod.urlAutorizar({redirectUri: REDIRECT, state, challenge});
  console.log(`Abrindo o login do ${mod.nome} no navegador. Se não abrir, acesse:\n${url}\n`);
  console.log(`(a URI de retorno cadastrada no app precisa ser exatamente ${REDIRECT})`);
  abrirNavegador(url);
  const code = await esperarCodigo(state);
  const conta = await mod.trocarCodigo(code, {redirectUri: REDIRECT, verifier});
  salvarConta(p, {...conta, conectadoEm: new Date().toISOString()});
  saida({ok: true, plataforma: p, ...(conta.usuario ? {usuario: '@' + conta.usuario} : {})});
}

// ---- status ----
async function status() {
  const conectadas = contasConectadas();
  const r = {};
  for (const p of PLATAFORMAS) {
    r[p] = {conectada: conectadas[p], variaveisFaltando: envFaltando(p)};
    if (conectadas[p] && MODS[p].status && !r[p].variaveisFaltando.length) {
      try {
        r[p].limite = await MODS[p].status(await contaPronta(p));
      } catch (e) {
        r[p].erro = e.message;
      }
    }
  }
  r.fila = lerFila().map((i) => ({plataforma: i.plataforma, corte: i.clipId, quando: i.quando}));
  saida(r);
}

// quadro da capa (só o YouTube precisa da imagem; TikTok e Instagram recebem o segundo)
function extrairCapa(arquivo, segundo, destino) {
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(segundo), '-i', arquivo, '-frames:v', '1', '-q:v', '2', destino]);
    return destino;
  } catch {
    console.warn(`Não consegui extrair a capa de ${path.basename(arquivo)} no segundo ${segundo}; segue sem capa.`);
    return null;
  }
}

// ---- enviar ----
async function enviar(arquivoPub) {
  if (!arquivoPub) falhar('Uso: publicar.mjs enviar work/publicacao.json [--so id1,id2] [--plataforma yt,tt,ig] [--teste] [--forcar]');
  const pubAbs = path.resolve(arquivoPub);
  const pub = lerJson(pubAbs, null);
  if (!pub) falhar(`Não consegui ler ${arquivoPub}`);
  const tag = hashtagDoStreamer(streamerDoPub(pub, pubAbs));
  const {acrescentadas} = garantirHashtag(pub, tag);
  const erros = validar(pub, {base: process.cwd()});
  if (erros.length) falhar(`publicacao.json com problemas:\n- ${erros.join('\n- ')}`);

  const so = flag('--so') ? new Set(flag('--so').split(',').map((s) => s.trim())) : null;
  const plats = flag('--plataforma') ? new Set(flag('--plataforma').split(',').map((s) => plataforma(s.trim()))) : null;
  if (so) {
    const faltam = [...so].filter((id) => !pub.clips.some((c) => c.id === id));
    if (faltam.length) falhar(`--so: id não encontrado: ${faltam.join(', ')}`);
  }
  const registroArq = path.join(path.dirname(pubAbs), 'publicado.json');
  const registro = lerRegistro(registroArq);

  const plano = [];
  for (const c of pub.clips) {
    if (so && !so.has(c.id)) continue;
    for (const p of PLATAFORMAS) {
      if (!c[p] || (plats && !plats.has(p))) continue;
      const acao = jaFeito(registro, c.id, p) && !has('--forcar') ? 'pular' : acaoPara(p, c[p]);
      plano.push({corte: c.id, plataforma: p, acao, quando: c[p].quando || undefined, clip: c});
    }
  }
  const resumoPlano = plano.map(({clip, ...x}) => ({...x, ...(x.acao === 'pular' ? {motivo: `já está como "${registro[x.corte][x.plataforma].estado}" (use --forcar para mandar de novo)`} : {})}));

  if (has('--teste')) {
    const conectadas = contasConectadas();
    const precisa = [...new Set(plano.filter((x) => x.acao !== 'pular' && x.acao !== 'manual').map((x) => x.plataforma))];
    saida({teste: true, hashtag: tag, hashtagAcrescentadaEm: acrescentadas, plano: resumoPlano, contasFaltando: precisa.filter((p) => !conectadas[p]), variaveisFaltando: Object.fromEntries(precisa.map((p) => [p, envFaltando(p)]).filter(([, v]) => v.length))});
    return;
  }

  // confere as contas antes de começar, para não parar no meio
  const contas = {};
  for (const p of new Set(plano.filter((x) => x.acao !== 'pular' && x.acao !== 'manual').map((x) => x.plataforma))) {
    try {
      contas[p] = await contaPronta(p);
    } catch (e) {
      falhar(e.message);
    }
  }

  const resultados = [];
  for (const x of plano) {
    if (x.acao === 'pular') {
      resultados.push({corte: x.corte, plataforma: x.plataforma, estado: 'pulado'});
      continue;
    }
    if (x.acao === 'manual') {
      resultados.push({corte: x.corte, plataforma: x.plataforma, estado: 'manual', proximoPasso: 'rode "publicar.mjs kit" e agende pelo navegador'});
      continue;
    }
    const c = x.clip;
    const arquivo = path.resolve(c.arquivo);
    try {
      let r;
      if (x.acao === 'fila') {
        enfileirar({plataforma: x.plataforma, clipId: c.id, arquivo, dados: c[x.plataforma], capaSegundo: c.capaSegundo, quando: x.quando, registro: registroArq});
        r = {estado: 'na-fila', quando: x.quando};
      } else {
        const capa = x.plataforma === 'youtube' && c.capaSegundo != null ? extrairCapa(arquivo, c.capaSegundo, path.join(path.dirname(pubAbs), `capa-${c.id}.jpg`)) : null;
        r = await MODS[x.plataforma].publicar(contas[x.plataforma], {arquivo, dados: c[x.plataforma], quando: x.acao === 'agendar' ? x.quando : null, capa, capaSegundo: c.capaSegundo});
      }
      marcar(registroArq, c.id, x.plataforma, r);
      if (r.estado === 'agendado' || r.estado === 'na-fila') ocupar(x.plataforma, x.quando);
      resultados.push({corte: c.id, plataforma: x.plataforma, ...r});
    } catch (e) {
      marcar(registroArq, c.id, x.plataforma, {estado: 'erro', erro: e.message});
      resultados.push({corte: c.id, plataforma: x.plataforma, estado: 'erro', erro: e.message});
    }
  }
  saida({resultados});
  if (resultados.some((r) => r.estado === 'erro')) process.exitCode = 1;
}

// ---- fila ----
async function processarFila() {
  const fila = lerFila();
  const prontos = vencidos(fila);
  const resultados = [];
  const ficam = fila.filter((i) => !prontos.includes(i));
  for (const item of prontos) {
    try {
      if (!fs.existsSync(item.arquivo)) throw new Error(`arquivo sumiu: ${item.arquivo}`);
      const conta = await contaPronta(item.plataforma);
      const r = await MODS[item.plataforma].publicar(conta, {arquivo: item.arquivo, dados: item.dados, quando: null, capaSegundo: item.capaSegundo});
      marcar(item.registro, item.clipId, item.plataforma, r);
      resultados.push({corte: item.clipId, plataforma: item.plataforma, ...r});
    } catch (e) {
      const tentativas = (item.tentativas || 0) + 1;
      if (tentativas < 3) ficam.push({...item, tentativas, ultimoErro: e.message});
      else marcar(item.registro, item.clipId, item.plataforma, {estado: 'erro', erro: `fila: ${e.message}`});
      resultados.push({corte: item.clipId, plataforma: item.plataforma, estado: 'erro', erro: e.message, tentativas});
    }
  }
  // um "enviar" pode ter posto itens na fila enquanto esta rodava: não perde esses
  const chave = (i) => `${i.registro}|${i.clipId}|${i.plataforma}`;
  const vistos = new Set(fila.map(chave));
  ficam.push(...lerFila().filter((i) => !vistos.has(chave(i))));
  ficam.sort((a, b) => Date.parse(a.quando) - Date.parse(b.quando));
  gravarFila(ficam);
  saida({publicados: resultados, restamNaFila: ficam.length});
}

// ---- kit (publicação manual) ----
function kit(arquivoPub) {
  if (!arquivoPub) falhar('Uso: publicar.mjs kit work/publicacao.json [--plataforma ig,tt]');
  const pubAbs = path.resolve(arquivoPub);
  const pub = lerJson(pubAbs, null);
  if (!pub) falhar(`Não consegui ler ${arquivoPub}`);
  const tag = hashtagDoStreamer(streamerDoPub(pub, pubAbs));
  const {acrescentadas} = garantirHashtag(pub, tag);
  const erros = validar(pub, {base: process.cwd()});
  if (erros.length) falhar(`publicacao.json com problemas:\n- ${erros.join('\n- ')}`);
  const plats = flag('--plataforma') ? flag('--plataforma').split(',').map((s) => plataforma(s.trim())) : PLATAFORMAS;
  const destino = path.resolve('kit-publicacao');
  const feitos = gerarKit(pub, {base: process.cwd(), destino, plataformas: plats});
  if (!feitos.length) falhar('Nenhum corte em modo "manual" para essas plataformas (use "modo": "manual" no bloco da plataforma).');
  const registroArq = path.join(path.dirname(pubAbs), 'publicado.json');
  for (const f of feitos) {
    marcar(registroArq, f.corte, f.plataforma, {estado: 'no-kit', quando: f.quando || undefined, arquivo: f.arquivo});
    ocupar(f.plataforma, f.quando);
  }
  saida({kit: destino, pastas: [...new Set(feitos.map((f) => path.join(destino, f.plataforma)))], itens: feitos.map(({arquivo, ...x}) => x)});
}

// ---- horarios ----
function horarios(n) {
  const qtd = Number(n);
  if (!Number.isInteger(qtd) || qtd < 1) falhar('Uso: publicar.mjs horarios <n> [--plataforma yt,ig,tt]');
  const pref = preferencias();
  const plats = flag('--plataforma') ? flag('--plataforma').split(',').map((s) => plataforma(s.trim())) : pref.plataformas || PLATAFORMAS;
  saida({horarios: proximosHorarios(qtd, {horarios: pref.horarios, fuso: pref.fuso, plataformas: plats, agenda: lerAgenda()}), preferencias: pref});
}

try {
  if (cmd === 'conectar') await conectar(plataforma(args[1]));
  else if (cmd === 'status') await status();
  else if (cmd === 'enviar') await enviar(args[1]);
  else if (cmd === 'fila') await processarFila();
  else if (cmd === 'kit') kit(args[1]);
  else if (cmd === 'horarios') horarios(args[1]);
  else falhar('Uso: publicar.mjs conectar <youtube|tiktok|instagram> | status | enviar work/publicacao.json [--so ids] [--plataforma yt,tt,ig] [--teste] [--forcar] | fila | kit work/publicacao.json | horarios <n>');
} catch (e) {
  falhar(e.message);
}
