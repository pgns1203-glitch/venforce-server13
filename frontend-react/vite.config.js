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
import { fileURLToPath, URL } from "node:url";
import { resolveEntry } from "./vite.entries.js";

const portalDir = fileURLToPath(new URL("../Portal", import.meta.url));
const BACKEND_DEV = process.env.VITE_BACKEND_ORIGIN || "http://localhost:3333";

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
    plugins: [react()],
    publicDir: portalDir,
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: {
      port: entry.port,
      open: `/${entry.html}`,
      proxy: Object.fromEntries(
        entry.apiRoutes.map((rota) => [rota, { target: BACKEND_DEV, changeOrigin: true }])
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
