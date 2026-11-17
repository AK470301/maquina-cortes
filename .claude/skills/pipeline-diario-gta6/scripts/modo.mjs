// Modo de produção do pipeline (pipeline.config.json → "modo"): define a duração dos cortes, se cada corte sai no TikTok
// e no YouTube ao mesmo tempo (publicação dupla), quanto tempo o título de topo fica na tela e a janela do radar ao vivo.
//   "crescimento"  (atual, desde 2026-11-16): cortes de 20–55 s com gancho nos primeiros 2–3 s, TODO corte sai nos dois
//                  (TikTok + YouTube Shorts), título de topo por 3 s, radar com 40 s (25 antes do pico + 15 depois).
//   "monetizacao"  (o de antes): TikTok 62–85 s (Creator Rewards exige > 60 s), Shorts 35–58 s, um corte por plataforma,
//                  título por 4 s, radar com 65 s (45 + 20). Volta para ele quando a conta passar de 10 mil seguidores e
//                  100 mil views: basta trocar "modo" para "monetizacao" no pipeline.config.json.
// "modos" no pipeline.config.json pode sobrescrever qualquer campo de um preset. Sem "modo", vale "monetizacao".
import {config} from './env.mjs';

export const PLATAFORMAS_DUPLA = ['tiktok', 'youtube_short'];

const PRESETS = {
  crescimento: {
    // final = depois de o build.mjs tirar as pausas; bruta = janela aceita na origem (live crua rende ~0,85 do bruto)
    faixas: {
      tiktok: {final: [20, 55], bruta: [21, 65]},
      youtube_short: {final: [20, 55], bruta: [21, 65]},
      dupla: {final: [20, 55], bruta: [21, 65]},
    },
    publicacao_dupla: true,
    titulo_dur: 3,
    gancho_max_s: 1, // a primeira palavra do gancho começa até 1 s depois do start
    radar: {duracao: 40, antes: 25},
  },
  monetizacao: {
    faixas: {
      tiktok: {final: [62, 85], bruta: [64, 100]},
      youtube_short: {final: [35, 58], bruta: [36, 68]},
      dupla: {final: [35, 58], bruta: [36, 68]},
    },
    publicacao_dupla: false,
    titulo_dur: 4,
    gancho_max_s: null,
    radar: {duracao: 65, antes: 45},
  },
};

export function modo() {
  const c = config();
  const nome = PRESETS[c.modo] ? c.modo : 'monetizacao';
  const extra = c.modos?.[nome] || {};
  const base = PRESETS[nome];
  return {nome, ...base, ...extra, faixas: {...base.faixas, ...(extra.faixas || {})}, radar: {...base.radar, ...(extra.radar || {})}};
}

// a plataforma de um corte do plano: "dupla" quando ele traz "plataformas" (sai no TikTok e no YouTube)
export const plataformaDoCorte = (c) => (Array.isArray(c.plataformas) ? 'dupla' : c.plataforma);
