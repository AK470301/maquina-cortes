#!/usr/bin/env node
// Copia os vídeos da proposta de um postagem.json para <projeto>/para-postar/ e aponta o "arquivo" de cada item para lá.
// Assim, para-postar/ tem só os vídeos que esperam o OK do usuário; o publicar.mjs move cada um para postados/ quando
// a Zernio (ou o webhook) confirma o envio.
// Uso: node para-postar.mjs <postagem.json> [--teste]
// - Nome no destino: <pasta-da-live-ou-compilado>--<id>.mp4 (ids se repetem entre lives).
// - Copia (não move): o render/ continua sendo a cópia de trabalho do motor. Se o corte for re-renderizado (build --so),
//   rode de novo: a cópia em para-postar/ é trocada quando o render/ é mais novo. O item guarda a origem em "arquivo_render".
// - Pula itens já enviados (postado.json), e postagem.json com "calibracao": true. Item "descartado": tira a cópia de
//   para-postar/ (o original continua em render/).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {RAIZ, lerJson, salvarItens} from './env.mjs';

export const PARA_POSTAR = path.join(RAIZ, 'para-postar');
export const POSTADOS = path.join(RAIZ, 'postados');

export function prepararParaPostar(arquivo, {gravar = true} = {}) {
  const base = path.dirname(path.resolve(arquivo));
  const doc = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const enviados = lerJson(path.join(base, 'postado.json'), {});
  const acoes = [];
  if (doc.calibracao) return {acoes: [{acao: 'pular', motivo: 'postagem de calibração'}]};
  fs.mkdirSync(PARA_POSTAR, {recursive: true});
  for (const it of doc.itens || []) {
    if (enviados[`${it.id}:${it.plataforma}`]?.ok) continue;
    const atual = path.resolve(base, it.arquivo || '');
    // corte do radar ao vivo ("ao_vivo": true): já nasce em para-postar/ (LIVE--<canal>--<data>.mp4) e não tem render/
    if (it.ao_vivo) {
      const irmaoVivoLive = (doc.itens || []).some((o) => o !== it && o.id === it.id && !o.descartado && !enviados[`${o.id}:${o.plataforma}`]?.ok);
      if (it.descartado && !irmaoVivoLive && fs.existsSync(atual) && path.dirname(atual) === PARA_POSTAR) {
        if (gravar) fs.rmSync(atual);
        acoes.push({id: it.id, acao: 'removido de para-postar (descartado)'});
      } else if (!it.descartado) acoes.push({id: it.id, acao: fs.existsSync(atual) ? 'já em para-postar (ao vivo)' : 'erro', ...(fs.existsSync(atual) ? {arquivo: path.relative(RAIZ, atual)} : {motivo: `arquivo não encontrado: ${it.arquivo}`})});
      continue;
    }
    const destino =path.join(PARA_POSTAR, `${path.basename(base)}--${it.id}${path.extname(atual) || '.mp4'}`);
    // publicação dupla: o vídeo é o mesmo nos dois itens do corte; só sai se nenhum outro item dele continua valendo
    const irmaoVivo = (doc.itens || []).some((o) => o !== it && o.id === it.id && !o.descartado && !enviados[`${o.id}:${o.plataforma}`]?.ok);
    if (it.descartado) {
      if (fs.existsSync(destino) && !irmaoVivo) {
        if (gravar) fs.rmSync(destino);
        acoes.push({id: it.id, acao: 'removido de para-postar (descartado)'});
      }
      continue;
    }
    // a origem é o render (guardado em arquivo_render na 1ª vez); se o item já aponta para para-postar, usa o arquivo_render
    const origem = it.arquivo_render ? path.resolve(base, it.arquivo_render) : atual;
    if (!fs.existsSync(origem)) {
      acoes.push({id: it.id, acao: 'erro', motivo: `origem não encontrada: ${path.relative(RAIZ, origem)}`});
      continue;
    }
    const precisaCopiar = !fs.existsSync(destino) || fs.statSync(origem).mtimeMs > fs.statSync(destino).mtimeMs;
    if (gravar) {
      if (precisaCopiar) fs.copyFileSync(origem, destino);
      it.arquivo_render ||= path.relative(base, origem);
      it.arquivo = path.relative(base, destino);
    }
    acoes.push({id: it.id, acao: precisaCopiar ? 'copiado' : 'já atualizado', arquivo: path.relative(RAIZ, destino)});
  }
  if (gravar) salvarItens(arquivo, doc.itens || []);
  return {acoes};
}

// move um arquivo de para-postar/ para postados/ (mesmo nome); devolve o novo caminho absoluto, ou null se não estava lá
export function moverParaPostados(absoluto) {
  if (path.dirname(path.resolve(absoluto)) !== PARA_POSTAR || !fs.existsSync(absoluto)) return null;
  fs.mkdirSync(POSTADOS, {recursive: true});
  const destino = path.join(POSTADOS, path.basename(absoluto));
  fs.renameSync(absoluto, destino);
  return destino;
}

// fileURLToPath: no Windows o pathname da URL vem como "/C:/..." e a comparação nunca batia (o script saía sem fazer nada)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arquivo = args.find((a) => !a.startsWith('--'));
  if (!arquivo) {
    console.error('Uso: node para-postar.mjs <postagem.json> [--teste]');
    process.exit(1);
  }
  const r = prepararParaPostar(arquivo, {gravar: !args.includes('--teste')});
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.acoes.some((a) => a.acao === 'erro') ? 1 : 0);
}
