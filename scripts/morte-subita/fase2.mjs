#!/usr/bin/env node
// Modo Morte Súbita — apoio da FASE 2 (rodada pelo claude oficial com a skill morte-subita).
// Uso: node scripts/morte-subita/fase2.mjs listar                 entradas prontas em fila-entrada/ (JSON)
//      node scripts/morte-subita/fase2.mjs iniciar <slug>         move o vídeo e a transcrição para cortes/<slug>/work/
//      node scripts/morte-subita/fase2.mjs finalizar <slug> [--simular]
//
// finalizar = a REGRA DE LIMPEZA OBRIGATÓRIA de todos os fluxos de VOD (cron e processar-link.ps1):
//   1. confere cada corte do work/plano-cortes.json em render/<id>.mp4 (existe e o ffprobe lê a duração);
//      sem nenhum MP4 válido, para com código 1 e NÃO apaga nada;
//   2. grava a proposta de publicação cortes/<slug>/postagem.json (todos aprovado: false; arquivo = render/<id>.mp4)
//      e o resumo cortes/<slug>/cortes.json; acrescenta a linha em logs/clipes-gerados.jsonl;
//   3. apaga o vídeo bruto e TODA a pasta work/ do vídeo e a pasta dele em fila-entrada/;
//   4. dispara o e-mail "Alerta de Clipe Gerado" (alerta-email.mjs) com títulos e caminhos dos cortes em render/.
import fs from 'node:fs';
import path from 'node:path';
import {emailClipes} from './alerta-email.mjs';
import {CLIPES_GERADOS, FILA_ENTRADA, RAIZ, duracaoDe, lerJson, log, rodarSync} from './comum.mjs';

const S = path.join(RAIZ, '.claude', 'skills', 'pipeline-diario-gta6', 'scripts');
const [cmd, slug] = process.argv.slice(2);
const saida = (o, c = 0) => (console.log(JSON.stringify(o, null, 2)), process.exit(c));

const tamanho = (p) => {
  if (!fs.existsSync(p)) return 0;
  const st = fs.statSync(p);
  if (!st.isDirectory()) return st.size;
  return fs.readdirSync(p).reduce((n, f) => n + tamanho(path.join(p, f)), 0);
};

function listar() {
  const itens = [];
  for (const d of fs.readdirSync(FILA_ENTRADA, {withFileTypes: true})) {
    if (!d.isDirectory()) continue;
    const e = lerJson(path.join(FILA_ENTRADA, d.name, 'entrada.json'), null);
    if (!e) continue;
    const emCortes = fs.existsSync(path.join(RAIZ, 'cortes', d.name, 'work', 'entrada.json'));
    itens.push({slug: d.name, pronto: !!e.pronto, iniciado: emCortes, titulo: e.titulo, canal: e.canal, duracao_s: e.duracao_s, origem: e.origem, rodada: e.rodada});
  }
  return itens;
}

function iniciar(s) {
  const de = path.join(FILA_ENTRADA, s);
  const e = lerJson(path.join(de, 'entrada.json'), null);
  if (!e?.pronto) throw new Error(`fila-entrada/${s} não está pronto (download/transcrição incompletos)`);
  const work = path.join(RAIZ, 'cortes', s, 'work');
  fs.mkdirSync(work, {recursive: true});
  for (const f of fs.readdirSync(de)) {
    if (f === 'entrada.json') fs.copyFileSync(path.join(de, f), path.join(work, f));
    else fs.renameSync(path.join(de, f), path.join(work, f));
  }
  return {ok: true, pasta: path.join(RAIZ, 'cortes', s), work, entrada: e};
}

async function finalizar(s) {
  const pasta = path.join(RAIZ, 'cortes', s);
  const work = path.join(pasta, 'work');
  const render = path.join(pasta, 'render');
  const fPlano = path.join(work, 'plano-cortes.json');
  if (!fs.existsSync(fPlano)) throw new Error(`falta ${fPlano}`);
  const plano = JSON.parse(fs.readFileSync(fPlano, 'utf8'));
  const video = lerJson(path.join(work, 'entrada.json'), null) || lerJson(path.join(FILA_ENTRADA, s, 'entrada.json'), {titulo: s});
  const cortes = [];
  const falhas = [];
  for (const c of plano.cortes || []) {
    const arq = path.join(render, `${c.id}.mp4`);
    const d = fs.existsSync(arq) ? duracaoDe(arq) : null;
    if (!d) falhas.push({id: c.id, motivo: fs.existsSync(arq) ? 'MP4 ilegível' : 'não renderizado'});
    else cortes.push({id: c.id, titulo_topo: c.titulo_topo_tela, titulo_seo: c.titulo_seo, legenda_tiktok: c.legenda_tiktok || c.titulo_seo, hashtags: c.hashtags, nota: c.nota_viralidade, duracao_s: +d.toFixed(1), arquivo: arq, _c: c});
  }
  if (!cortes.length) throw new Error(`nenhum MP4 válido em ${render}: work/ mantido para refazer o render`);

  // proposta de publicação só com os cortes que existem (o plano.mjs valida de novo)
  const planoOk = path.join(work, 'plano-renderizados.json');
  fs.writeFileSync(planoOk, JSON.stringify({...plano, cortes: cortes.map((c) => c._c)}, null, 2));
  const p = rodarSync(process.execPath, [path.join(S, 'plano.mjs'), 'postagem', 'postagem.json', path.relative(pasta, planoOk)], {cwd: pasta});
  const postagemOk = p.status === 0;
  if (!postagemOk) log(`[fase2] ${s}: postagem.json não gerado: ${(p.err || p.out).trim().split('\n').slice(-3).join(' | ')}`);
  else {
    // marca a origem nos itens propostos (fonte para a aprovação)
    const f = path.join(pasta, 'postagem.json');
    const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
    doc.morte_subita = true;
    doc.fonte = {url: video.url, titulo: video.titulo, canal: video.canal, canal_url: video.canal_url};
    for (const it of doc.itens || []) if (!it.descricao) it.descricao = `Corte de "${video.titulo}" — ${video.canal || ''} (${video.url || ''})`.trim();
    fs.writeFileSync(f, JSON.stringify(doc, null, 2));
  }

  // limpeza obrigatória: vídeo bruto + work/ inteiro + a pasta em fila-entrada/
  const liberado = tamanho(work) + tamanho(path.join(FILA_ENTRADA, s));
  fs.rmSync(work, {recursive: true, force: true, maxRetries: 10, retryDelay: 300});
  fs.rmSync(path.join(FILA_ENTRADA, s), {recursive: true, force: true, maxRetries: 10, retryDelay: 300});

  const resumo = {
    slug: s,
    rodada: video.rodada || process.env.MS_RODADA || null,
    origem: video.origem || null,
    finalizado_em: new Date().toISOString(),
    video: {id: video.id, url: video.url, titulo: video.titulo, canal: video.canal, views: video.views, idioma: video.idioma, origem: video.origem},
    pasta_render: render,
    postagem: postagemOk ? path.join(pasta, 'postagem.json') : null,
    cortes: cortes.map(({_c, ...c}) => c),
    falhas,
    liberado_mb: liberado / 2 ** 20,
  };
  fs.writeFileSync(path.join(pasta, 'cortes.json'), JSON.stringify(resumo, null, 2));
  fs.appendFileSync(CLIPES_GERADOS, JSON.stringify(resumo) + '\n');
  log(`[fase2] ${s}: ${cortes.length} corte(s) em render/, ${falhas.length} falha(s); work/ apagado (${resumo.liberado_mb.toFixed(0)} MB)`);
  let email;
  try {
    email = await emailClipes(resumo);
  } catch (e) {
    email = `falhou: ${e.message}`;
    log(`[fase2] ${s}: e-mail de clipes falhou: ${e.message}`);
  }
  return {ok: true, ...resumo, email};
}

try {
  if (cmd === 'listar') saida(listar());
  else if (cmd === 'iniciar' && slug) saida(iniciar(slug));
  else if (cmd === 'finalizar' && slug) saida(await finalizar(slug));
  else saida({ok: false, erro: 'Uso: fase2.mjs listar | iniciar <slug> | finalizar <slug> [--simular]'}, 1);
} catch (e) {
  saida({ok: false, erro: e.message}, 1);
}
