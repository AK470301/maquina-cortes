// Login OAuth pelo navegador: abre a página da plataforma e recebe o código num servidor local.
// A mesma URI de retorno serve para as três plataformas; cadastre-a no app de cada uma:
//   http://localhost:8723/callback/
import crypto from 'node:crypto';
import http from 'node:http';
import {spawn} from 'node:child_process';

export const PORTA = Number(process.env.MAQUINA_CORTES_PORTA_OAUTH || 8723);
export const REDIRECT = `http://localhost:${PORTA}/callback/`;

// PKCE: o Google segue a RFC (base64url do SHA-256); o TikTok desktop pede o SHA-256 em hexadecimal
export function pkce(codificacao = 'base64url') {
  const verifier = crypto.randomBytes(48).toString('base64url'); // 64 caracteres A-Z a-z 0-9 - _
  const challenge = crypto.createHash('sha256').update(verifier).digest(codificacao === 'hex' ? 'hex' : 'base64url');
  return {verifier, challenge};
}

export const novoState = () => crypto.randomBytes(16).toString('hex');

export function abrirNavegador(url) {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, args, {stdio: 'ignore', detached: true}).unref();
  } catch {}
}

// "localhost" pode resolver para 127.0.0.1 ou ::1: escuta nos dois
export function esperarCodigo(state, ms = 5 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const servidores = [];
    let fim = false;
    const encerrar = () => {
      fim = true;
      clearTimeout(timer);
      for (const s of servidores) {
        s.close();
        // dá tempo de a página de resposta chegar ao navegador e depois derruba conexões keep-alive
        setTimeout(() => s.closeAllConnections?.(), 300).unref();
      }
    };
    const tratar = (req, res) => {
      const u = new URL(req.url, REDIRECT);
      if (!u.pathname.startsWith('/callback')) {
        res.writeHead(404).end();
        return;
      }
      const code = u.searchParams.get('code');
      const ok = !!code && u.searchParams.get('state') === state;
      res
        .writeHead(200, {'Content-Type': 'text/html; charset=utf-8', Connection: 'close'})
        .end(ok ? '<h2>Conta conectada. Pode fechar esta aba e voltar ao terminal.</h2>' : '<h2>Não deu certo. Volte ao terminal.</h2>');
      if (fim) return;
      encerrar();
      if (ok) resolve(code);
      else reject(new Error(u.searchParams.get('error_description') || u.searchParams.get('error') || 'retorno sem código ou com state diferente'));
    };
    const timer = setTimeout(() => {
      encerrar();
      reject(new Error('Tempo esgotado esperando o login (5 min).'));
    }, ms);
    let falhas = 0;
    for (const host of ['127.0.0.1', '::1']) {
      const s = http.createServer(tratar);
      s.on('error', (e) => {
        if (++falhas === 2) {
          encerrar();
          reject(new Error(`Não consegui abrir a porta ${PORTA} (${e.code}). Feche o que estiver usando ou defina MAQUINA_CORTES_PORTA_OAUTH.`));
        }
      });
      s.listen(PORTA, host);
      servidores.push(s);
    }
  });
}
