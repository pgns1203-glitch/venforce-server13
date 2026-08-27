// frontend-react/vite.entries.js
//
// F3.1 — fonte única de verdade das "ilhas" React do Portal (MASTER_SPEC
// §19.3/§F3.1). Antes desta unidade existiam DOIS arquivos de config
// paralelos (vite.config.js para Cliente 360, vite.full.config.js para a
// Central de Gestão Full) com a mesma estrutura copiada — o risco real que
// isso cria não é técnico, é humano: alguém ajusta uma decisão de build
// (proxy, publicDir, base) numa das duas e esquece a outra, e as ilhas
// divergem em silêncio.
//
// A consolidação NÃO virou "um Rollup input com várias entradas": um build
// multi-entrada de verdade faz o Rollup extrair código genuinamente
// compartilhado (React/ReactDOM, utils/dates.js etc.) num chunk à parte
// usado por mais de uma ilha — comprovado numa sondagem de build antes desta
// unidade (chunk _shared de ~147KB). Isso quebraria o isolamento estrito por
// entrada (cada ilha só depende dos seus próprios arquivos, nunca de um
// asset de outra) — propriedade que o time pediu para preservar
// explicitamente. Rollup não tem uma flag suportada para desligar essa
// extração automática mantendo tudo numa única invocação.
//
// A solução adotada: UMA fonte de configuração (este arquivo + vite.config.js),
// mas o Rollup roda uma vez POR ilha — exatamente como antes (2 invocações
// viram N invocações, uma por entrada aqui registrada), só que dirigido por
// um único `npm run build` e sem nenhuma decisão duplicada entre arquivos.
// Isolamento binário idêntico ao pré-F3.1 (bit a bit, mesmo hash de conteúdo
// para Cliente 360 e Full Gestão — validado nesta unidade).
//
// Para adicionar uma nova ilha (Visão — F3.2, Financeiro — F4.1): acrescentar
// uma entrada aqui, um script `build:<nome>`/`dev:<nome>` no package.json, e
// nada mais precisa mudar.

export const ENTRIES = {
  "cliente-360-react": {
    html: "cliente-360-react.html",
    assetsDir: "assets/cliente-360-react",
    port: 5181,
    // Prefixos do Express que esta ilha precisa em dev (server/index.js).
    apiRoutes: ["/operacao", "/auth", "/ads", "/fechamentos", "/clientes", "/health"],
  },
  "full-gestao": {
    html: "full-gestao.html",
    assetsDir: "assets/full-gestao",
    port: 5182,
    apiRoutes: ["/operacao", "/auth", "/ads", "/fechamentos", "/clientes", "/base-vinculos", "/health"],
  },
};

export function resolveEntry(mode) {
  const entry = ENTRIES[mode];
  if (!entry) {
    const validos = Object.keys(ENTRIES).join(", ");
    throw new Error(
      `vite.entries.js: modo "${mode}" não é uma ilha conhecida. Use --mode <${validos}> (ver package.json).`
    );
  }
  return entry;
}
