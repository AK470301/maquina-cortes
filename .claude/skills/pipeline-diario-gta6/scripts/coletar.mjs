#!/usr/bin/env node
// Coletor diário: procura, nos canais do <projeto>/streamers.json, vídeos e VODs publicados nas últimas N horas que
// falem de GTA 6, e grava a fila do dia em <projeto>/fila/<AAAA-MM-DD>.json para o pipeline-diario-gta6.
// Uso: node coletar.mjs [--horas 24] [--teste] [--disparar]
//   --teste     mostra o que entraria na fila, sem gravar nada
//   --disparar  depois de gravar a fila, chama o Claude Code em modo headless (claude -p) com o pipeline, que roda até
//               a tabela de publicação e para (publicar continua exigindo OK). As permissões do modo headless são as do
//               settings.json do projeto.
// Só usa dados públicos via yt-dlp (sem login). VOD só para assinantes, privado ou ainda ao vivo é pulado.
// Filtro estrito: só transmissões gravadas (YouTube: aba /streams com live_status "was_live"; Twitch: só "archives",
// sem destaques) e com pelo menos 50 min. Vídeo editado e enviado por terceiros não entra (risco de Content ID).
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {RAIZ, lerJson} from './env.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const teste = args.includes('--teste');
const disparar = args.includes('--disparar');
const cfg = lerJson(path.join(RAIZ, 'streamers.json'), null);
if (!cfg) {
  console.error(`Falta ${path.join(RAIZ, 'streamers.json')}.`);
  process.exit(1);
}
const horas = Number(opt('--horas', cfg.janela_horas ?? 24));
const limite = Date.now() - horas * 3600e3;
const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const termos = (cfg.termos || ['gta 6', 'gta vi', 'gta6']).map(norm);
const porAba = cfg.itens_por_canal ?? 8;
const MIN_ABSOLUTO_MIN = 50; // piso fixo: VOD bruto de live; o streamers.json pode subir, nunca baixar
const durMin = Math.max(MIN_ABSOLUTO_MIN, cfg.duracao_minima_min ?? MIN_ABSOLUTO_MIN) * 60;
const maxPorStreamer = cfg.max_por_streamer ?? 2;
const durMax = (cfg.duracao_maxima_h ?? 14) * 3600;

const filaDir = path.join(RAIZ, 'fila');
const processadosFile = path.join(filaDir, 'processados.json');
const processados = lerJson(processadosFile, {});

const ytdlp = (a) => JSON.parse(execFileSync('yt-dlp', ['-J', '--no-warnings', '--ignore-no-formats-error', ...a], {encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000}));

// abas a varrer por plataforma
function abas(canal) {
  const u = canal.url.replace(/\/+$/, '');
  if (canal.plataforma === 'youtube') return [`${u}/streams`];
  if (canal.plataforma === 'twitch') return [`${u}/videos?filter=archives&sort=time`];
  return [u];
}
const quando = (i) => (i.release_timestamp || i.timestamp ? (i.release_timestamp || i.timestamp) * 1000 : i.upload_date ? Date.parse(`${i.upload_date.slice(0, 4)}-${i.upload_date.slice(4, 6)}-${i.upload_date.slice(6, 8)}T12:00:00Z`) : NaN);

const fila = [];
const avisos = [];
for (const s of cfg.streamers || []) {
  if (!s.ativo) continue;
  // streamer que proíbe cortes por escrito: nunca entra, nem com modo_revisao_manual
  if (lerJson(path.join(RAIZ, 'autorizacoes.json'), {})[s.slug]?.status === 'proibido') {
    avisos.push(`${s.slug}: status "proibido" no autorizacoes.json; pulado`);
    continue;
  }
  const doStreamer = [];
  for (const canal of s.canais || []) {
    if (/SUBSTITUA/i.test(canal.url)) {
      avisos.push(`${s.slug}: URL de exemplo em ${canal.plataforma}; troque no streamers.json`);
      continue;
    }
    for (const aba of abas(canal)) {
      let lista;
      try {
        lista = ytdlp(['--flat-playlist', '--playlist-end', String(porAba), aba]).entries || [];
      } catch (e) {
        avisos.push(`${s.slug}: não consegui listar ${aba} (${String(e.stderr || e.message).trim().split('\n').pop()})`);
        continue;
      }
      for (const ent of lista) {
        const url = ent.url || ent.webpage_url;
        const chave = `${canal.plataforma}:${ent.id}`;
        if (!url || processados[chave] || fila.some((f) => f.chave === chave)) continue;
        // a data aproximada da listagem, quando existe, evita abrir vídeo antigo (+12 h de folga)
        const aprox = quando(ent);
        if (!Number.isNaN(aprox) && aprox < limite - 12 * 3600e3) break; // a aba vem do mais novo para o mais velho
        let info;
        try {
          info = ytdlp(['--skip-download', '--no-playlist', url]);
        } catch (e) {
          avisos.push(`${s.slug}: pulei ${url} (${String(e.stderr || e.message).trim().split('\n').pop()})`);
          continue;
        }
        if (['is_live', 'is_upcoming', 'post_live'].includes(info.live_status)) continue; // VOD ainda não fechado
        if (canal.plataforma === 'youtube' && info.live_status !== 'was_live') continue; // só live gravada, nunca vídeo editado
        const t = quando(info);
        if (Number.isNaN(t) || t < limite) {
          if (!Number.isNaN(t)) break;
          continue;
        }
        if ((info.duration || 0) < durMin || (info.duration || 0) > durMax) continue;
        if (/^\s*(rerun|reprise)\b/i.test(info.title || '')) continue; // reprise de live antiga
        const texto = norm([info.title, info.description, ...(info.tags || []), ...(info.categories || [])].join(' \n '));
        let achados = termos.filter((k) => texto.includes(k));
        // streamer que só joga GTA 6 (título da VOD da Twitch quase nunca cita o jogo): aceita sem termo
        if (!achados.length && s.aceitar_sem_termo) achados = ['(aceitar_sem_termo)'];
        if (!achados.length) continue;
        doStreamer.push({
          chave,
          slug: s.slug,
          plataforma: canal.plataforma,
          url: info.webpage_url || url,
          titulo: info.title,
          publicado_em: new Date(t).toISOString(),
          duracao_s: Math.round(info.duration || 0),
          termos_encontrados: achados,
          autorizacao: lerJson(path.join(RAIZ, 'autorizacoes.json'), {})[s.slug]?.status || 'nao_verificado',
        });
      }
    }
  }
  // os mais recentes primeiro, até o limite por streamer
  fila.push(...doStreamer.sort((a, b) => b.publicado_em.localeCompare(a.publicado_em)).slice(0, maxPorStreamer));
}

const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); // data em Brasília
const saida = path.join(filaDir, `${hoje}.json`);
const resumo = {data: hoje, janela_horas: horas, itens: fila.map(({chave, ...x}) => x), avisos};
if (teste) {
  console.log(JSON.stringify({...resumo, gravado: false}, null, 2));
  process.exit(0);
}
fs.mkdirSync(filaDir, {recursive: true});
const anterior = lerJson(saida, {itens: []});
resumo.itens = [...anterior.itens, ...resumo.itens.filter((i) => !anterior.itens.some((a) => a.url === i.url))];
resumo.itens.forEach((i) => (i.status ??= 'pendente'));
fs.writeFileSync(saida, JSON.stringify(resumo, null, 2));
for (const f of fila) processados[f.chave] = {data: hoje, url: f.url};
fs.writeFileSync(processadosFile, JSON.stringify(processados, null, 2));
console.log(JSON.stringify({...resumo, gravado: saida}, null, 2));

if (disparar && fila.length) {
  const prompt = `Rode a skill pipeline-diario-gta6 com a fila ${saida} (itens com status "pendente"). Vá até a tabela de publicação e pare: não publique nada.`;
  // headless: o que não está liberado em .claude/headless-settings.json é recusado sem perguntar (dontAsk);
  // esse arquivo bloqueia os publicadores, então a rodada automática nunca publica
  const r = spawnSync(
    'claude',
    ['-p', prompt, '--permission-mode', 'dontAsk', '--settings', path.join(RAIZ, '.claude', 'headless-settings.json'), '--output-format', 'text'],
    {cwd: RAIZ, stdio: 'inherit'},
  );
  process.exit(r.status ?? 1);
}
