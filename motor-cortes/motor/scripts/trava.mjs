// Trava entre processos por arquivo (sem dependências): quem cria o arquivo com exclusividade ("wx") tem a vez.
// O arquivo guarda o PID de quem pegou; trava de processo que já morreu (ou mais velha que `velhaMs`) é descartada.
// Usos: a fila de render (uma renderização pesada por vez na máquina: build.mjs do motor e o radar ao vivo do
// projeto usam a mesma trava em ~/.maquina-cortes-gta/render.lock) e a gravação de JSON compartilhado.
//   const soltar = travar(arquivo, {esperaMs, velhaMs, aoEsperar});        // síncrono (bloqueia o processo)
//   const soltar = await travarAsync(arquivo, {esperaMs, velhaMs, aoEsperar}); // não bloqueia o laço de eventos
// Passou de `esperaMs` sem conseguir: devolve assim mesmo um soltar() que não faz nada, com soltar.semTrava = true
// (melhor seguir sem fila do que perder o trabalho); quem precisa de garantia confere esse campo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const TRAVA_RENDER = path.join(os.homedir(), '.maquina-cortes-gta', 'render.lock');

const vivo = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

// uma tentativa: devolve soltar() ou null (ocupada)
function tentar(arquivo, velhaMs) {
  try {
    const fd = fs.openSync(arquivo, 'wx');
    fs.writeSync(fd, JSON.stringify({pid: process.pid, desde: new Date().toISOString()}));
    fs.closeSync(fd);
    let solta = false;
    return () => {
      if (solta) return;
      solta = true;
      try {
        fs.rmSync(arquivo, {force: true});
      } catch {}
    };
  } catch (e) {
    if (e.code === 'ENOENT') {
      fs.mkdirSync(path.dirname(arquivo), {recursive: true});
      return null;
    }
    if (e.code !== 'EEXIST' && e.code !== 'EPERM' && e.code !== 'EBUSY') throw e;
  }
  // ocupada: de quem? processo morto ou trava velha demais é lixo
  try {
    const idade = Date.now() - fs.statSync(arquivo).mtimeMs;
    let pid = null;
    try {
      pid = JSON.parse(fs.readFileSync(arquivo, 'utf8')).pid;
    } catch {}
    // arquivo recém-criado ainda sem conteúdo: o dono está escrevendo
    if ((pid ? !vivo(pid) : idade > 5000) || idade > velhaMs) fs.rmSync(arquivo, {force: true});
  } catch {}
  return null;
}

const semTrava = () => Object.assign(() => {}, {semTrava: true});

export function travar(arquivo, {esperaMs = 15e3, velhaMs = 2 * 3600e3, aoEsperar} = {}) {
  const fim = Date.now() + esperaMs;
  let avisou = false;
  for (;;) {
    const soltar = tentar(arquivo, velhaMs);
    if (soltar) return soltar;
    if (Date.now() >= fim) return semTrava();
    if (!avisou) (avisou = true), aoEsperar?.();
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
  }
}

export async function travarAsync(arquivo, {esperaMs = 15e3, velhaMs = 2 * 3600e3, aoEsperar} = {}) {
  const fim = Date.now() + esperaMs;
  let avisou = false;
  for (;;) {
    const soltar = tentar(arquivo, velhaMs);
    if (soltar) return soltar;
    if (Date.now() >= fim) return semTrava();
    if (!avisou) (avisou = true), aoEsperar?.();
    await new Promise((r) => setTimeout(r, 500));
  }
}

// dono atual da trava ({pid, desde}) ou null
export function donoDaTrava(arquivo) {
  try {
    const d = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    return d.pid && vivo(d.pid) ? d : null;
  } catch {
    return null;
  }
}
