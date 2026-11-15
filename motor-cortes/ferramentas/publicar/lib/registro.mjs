// work/publicado.json: o que já foi enviado de cada corte, por plataforma. Evita publicar duas vezes.
// ~/.maquina-cortes-gta/fila.json: posts do TikTok (modo direto) e do Instagram esperando o horário.
import {FILA, gravarJson, lerJson} from './contas.mjs';

// estados que contam como "já foi": não envia de novo sem --forcar
export const FEITO = new Set(['publicado', 'agendado', 'rascunho', 'na-fila']);

export const lerRegistro = (f) => lerJson(f, {});

export function jaFeito(registro, id, plataforma) {
  return FEITO.has(registro?.[id]?.[plataforma]?.estado);
}

export function marcar(arquivo, id, plataforma, info) {
  const r = lerRegistro(arquivo);
  r[id] = {...(r[id] || {}), [plataforma]: {...info, em: new Date().toISOString()}};
  gravarJson(arquivo, r);
}

export const lerFila = () => lerJson(FILA, []);
export const gravarFila = (fila) => gravarJson(FILA, fila);

export function enfileirar(item) {
  const fila = lerFila().filter((i) => !(i.registro === item.registro && i.clipId === item.clipId && i.plataforma === item.plataforma));
  fila.push(item);
  fila.sort((a, b) => Date.parse(a.quando) - Date.parse(b.quando));
  gravarFila(fila);
}

export function vencidos(fila, agora = Date.now()) {
  return fila.filter((i) => Date.parse(i.quando) <= agora);
}
