// frontend-react/vite.config.js
//
// Migração gradual do Portal para React + Vite (strangler migration), por
// "ilhas": Cliente 360, Central de Gestão Full e (F3.2/F4.1) Visão e
// Financeiro. Cada ilha é uma tela isolada; o resto do Portal continua
// HTML/JS vanilla, no mesmo domínio, com a mesma sidebar/token/permissões.
//
// F3.1 — fonte ÚNICA de configuração (ver vite.entries.js para o porquê de
// isto continuar sendo N invocações do Rollup, uma por ilha, em vez de um
// único `input` multi-entrada: um build multi-entrada de verdade extrai um
// chunk compartilhado entre ilhas — comprovado numa sondagem — o que quebra
// o isolamento estrito por entrada). Este arquivo lê `mode` (via `--mode` no
// CLI) e monta a config de UMA ilha por vez a partir de `ENTRIES`; todo o
// resto (proxy, publicDir, base, outDir) é decidido uma única vez aqui.
//
// ── Decisões de integração, válidas para toda ilha, todas baseadas na
//    arquitetura encontrada ───────────────────────────────────────────────
//
//  - outDir = ../Portal, arquivo PLANO `<ilha>.html`
//    O Portal é uma pasta estática com todas as páginas na raiz. `layout.js`
//    resolve o link ativo por `location.pathname.split("/").pop()` e todas as
//    telas se linkam entre si por caminho relativo simples (`bases.html`).
//    Publicar numa subpasta (`Portal/react/<ilha>/`) quebraria as duas
//    coisas: o menu perderia o estado ativo e os links para as telas legadas
//    apontariam para dentro da subpasta.
//
//  - emptyOutDir = false, SEMPRE
//    NUNCA limpar o Portal. Só os assets da própria ilha são removidos antes
//    do build (scripts/clean-assets.mjs <ilha>).
//
//  - entrada `<ilha>.html`, nunca `index.html`
//    O Vite nomeia o HTML de saída pelo nome do arquivo de entrada. Um
//    `index.html` aqui sobrescreveria `Portal/index.html`, que é a tela de LOGIN.
//
//  - publicDir = ../Portal + copyPublicDir = false
//    `/style.css`, `/css/vf-tokens-v2.css`, `/css/vf-components-v2.css` e
//    `/layout.js` resolvem tanto no `vite dev` quanto no build, sem serem
//    empacotados nem copiados. A Fundação Global V2 e a sidebar legada são
//    reaproveitadas como estão — nenhuma linha de CSS global é duplicada.
//
//  - base = './'
//    URLs relativas: funciona em qualquer host estático, sem depender do
//    caminho de publicação. Nenhuma URL local fica hardcoded no bundle.
//
//  - assets isolados por ilha (assetsDir + entry/chunk/asset FileNames)
//    Cada ilha só referencia os próprios arquivos — nunca um asset de outra
//    ilha. Ver vite.entries.js para o motivo de isto exigir builds
//    separados, não um `input` combinado.
//
//  - proxy de desenvolvimento para o Express (porta 3333, lida de
//    server/index.js). Em dev o cliente HTTP usa caminhos relativos e o Vite
//    encaminha; assim não há CORS e o comportamento fica igual ao de
//    produção (mesma origem). Rotas por ilha (ex.: Full precisa de
//    `/base-vinculos`) ficam em vite.entries.js.
//
//  - React vem do bundle (npm). Sem CDN, sem Next.js, sem CRA, sem iframe.

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { resolveEntry } from "./vite.entries.js";

const portalDir = fileURLToPath(new URL("../Portal", import.meta.url));
const BACKEND_DEV = process.env.VITE_BACKEND_ORIGIN || "http://localhost:3333";

// `publicDir = portalDir` (decisão acima) e `build.outDir = portalDir`
// escrevem no MESMO lugar de onde `vite dev` serve estático — então depois
// do primeiro `npm run build:<ilha>`, `Portal/<ilha>.html` (a saída, com o
// bundle final já hasheado) e `frontend-react/<ilha>.html` (a fonte, que
// o dev deveria transformar) têm o MESMO nome. Vite regista o middleware de
// publicDir ANTES do de HTML (doc: "avoid duplicate filenames in publicDir
// and in your root index.html") — sem este plugin, todo `vite dev`/`--mode
// <ilha>` depois de um build serve pra sempre o bundle de produção
// congelado (inclusive `import.meta.env.DEV` já resolvido pra `false` nele),
// nunca a fonte. Sintoma exato que motivou este plugin: a Cliente 360 V3 em
// localhost:5185 chamando https://venforce-server.onrender.com em vez do
// proxy — não é bug de resolução de API base (`apiClient.js` já está
// correto), é o dev server nunca alcançando a fonte.
//
// Dev-only (`apply: "serve"`): registra o middleware DENTRO do corpo de
// `configureServer` (sem retornar função) para entrar na fila ANTES dos
// middlewares internos do Vite — inclusive o de publicDir — e devolve a
// MESMA página que a fonte serviria, via `server.transformIndexHtml` (API
// pública do Vite pra isso). Não toca `build.*`: a saída de produção
// continua idêntica, byte a byte, à de antes deste plugin.
//
// `previewHtml` (opcional, só a ilha cliente-360-v3 usa) — quando a MESMA
// URL (`/${entry.html}`) chega com `?preview=1`, serve esse outro arquivo em
// vez da fonte real. Existe só porque este middleware já intercepta ANTES
// do publicDir (ver acima); nenhum entry de build (vite.entries.js)
// referencia esse arquivo, então build de produção nunca o alcança —
// "impossível fora do dev server" por construção, não por checagem em
// runtime.
function forcarHtmlDaFonteSobrePublicDir(entry, { previewHtml } = {}) {
  const htmlPath = fileURLToPath(new URL(`./${entry.html}`, import.meta.url));
  const previewHtmlPath = previewHtml ? fileURLToPath(new URL(`./${previewHtml}`, import.meta.url)) : null;
  return {
    name: "vf-forcar-html-da-fonte-sobre-public-dir",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const [url, query] = req.url ? req.url.split("?") : [""];
        if (url !== `/${entry.html}`) return next();
        const isPreview = previewHtmlPath && new URLSearchParams(query || "").get("preview") === "1";
        try {
          const bruto = fs.readFileSync(isPreview ? previewHtmlPath : htmlPath, "utf-8");
          const html = await server.transformIndexHtml(req.url, bruto, req.originalUrl);
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/html");
          res.end(html);
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // `vitest` chama este config com mode="test" — não é uma ilha, é a suíte
  // de testes rodando sobre TODO `src/`, sem build de nenhuma ilha
  // específica. Devolve a config comum (alias, plugin, ambiente de teste) e
  // pula a resolução de ilha, que exigiria um `--mode <ilha>` explícito.
  if (mode === "test") {
    return {
      plugins: [react()],
      resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
      test: {
        environment: "jsdom",
        globals: true,
        setupFiles: "./src/test/setup.js",
        include: ["src/**/*.test.{js,jsx}"],
      },
    };
  }

  const entry = resolveEntry(mode);

  return {
    base: "./",
    plugins: [
      react(),
      forcarHtmlDaFonteSobrePublicDir(entry, {
        previewHtml: mode === "cliente-360-v3" ? "cliente-360-v3-preview.html" : undefined,
      }),
    ],
    publicDir: portalDir,
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: {
      port: entry.port,
      open: `/${entry.html}`,
      // Vite casa chave de proxy por `startsWith` a menos que ela comece com
      // `^` (aí vira RegExp) — sem o limite de borda abaixo, "/financeiro"
      // também intercepta "/financeiro-v3.html" e devolve o 401 do Express
      // no lugar do HTML da ilha.
      proxy: Object.fromEntries(
        entry.apiRoutes.map((rota) => [
          `^${rota}(?:/|\\?|$)`,
          { target: BACKEND_DEV, changeOrigin: true },
        ])
      ),
    },
    build: {
      outDir: portalDir,
      emptyOutDir: false,
      copyPublicDir: false,
      assetsDir: entry.assetsDir,
      rollupOptions: {
        input: fileURLToPath(new URL(`./${entry.html}`, import.meta.url)),
        output: {
          entryFileNames: `${entry.assetsDir}/[name]-[hash].js`,
          chunkFileNames: `${entry.assetsDir}/[name]-[hash].js`,
          assetFileNames: `${entry.assetsDir}/[name]-[hash][extname]`,
        },
      },
    },
  };
});
