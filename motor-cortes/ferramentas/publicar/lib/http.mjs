// fetch com JSON/formulário e erro legível. A mensagem de erro nunca leva a query string (pode ter segredo).

const resumo = (d) => {
  const e = d?.error;
  if (typeof e === 'string') return [e, d.error_description].filter(Boolean).join(': ');
  if (e && typeof e === 'object') return [e.code, e.message, e.error_user_msg].filter(Boolean).join(': ');
  if (d?.texto) return String(d.texto).slice(0, 300);
  return JSON.stringify(d).slice(0, 300);
};

export async function pedir(url, {method = 'GET', headers = {}, body, json, form} = {}) {
  const h = {...headers};
  let b = body;
  if (json !== undefined) {
    h['Content-Type'] = 'application/json; charset=UTF-8';
    b = JSON.stringify(json);
  }
  if (form) {
    h['Content-Type'] = 'application/x-www-form-urlencoded';
    b = new URLSearchParams(form).toString();
  }
  const r = await fetch(url, {method, headers: h, body: b});
  const txt = await r.text();
  let dados;
  try {
    dados = txt ? JSON.parse(txt) : {};
  } catch {
    dados = {texto: txt};
  }
  if (!r.ok) {
    const e = new Error(`${method} ${String(url).split('?')[0]} → HTTP ${r.status}: ${resumo(dados)}`);
    e.status = r.status;
    e.dados = dados;
    throw e;
  }
  return {dados, headers: r.headers, status: r.status};
}

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
