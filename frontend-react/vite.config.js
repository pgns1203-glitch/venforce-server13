// frontend-react/vite.config.js
//
// Primeira migração gradual do Portal para React + Vite (strangler migration).
// Escopo: SOMENTE a Cliente 360. As demais páginas continuam HTML/JS vanilla, no
// mesmo domínio, com a mesma sidebar, o mesmo token e as mesmas permissões.
//
// ── Decisões de integração, todas baseadas na arquitetura encontrada ────────
//
//  - outDir = ../Portal, arquivo PLANO `cliente-360-react.html`
//    O Portal é uma pasta estática com todas as páginas na raiz. `layout.js`
//    resolve o link ativo por `location.pathname.split("/").pop()` e todas as
//    telas se linkam entre si por caminho relativo simples (`bases.html`).
//    Publicar numa subpasta (`Portal/react/cliente-360/`) quebraria as duas
//    coisas: o menu perderia o estado ativo e os links para as telas legadas
//    apontariam para dentro da subpasta. Por isso o build é plano, como o resto
//    do Portal, com os assets isolados em `Portal/assets/cliente-360-react/`.
//
//  - emptyOutDir = false
//    NUNCA limpar o Portal. Só os assets da própria Cliente 360 são removidos
//    antes do build (scripts/clean-assets.mjs).
//
//  - entrada `cliente-360-react.html`, não `index.html`
//    O Vite nomeia o HTML de saída pelo nome do arquivo de entrada. Um
//    `index.html` aqui sobrescreveria `Portal/index.html`, que é a tela de LOGIN.
//
//  - publicDir = ../Portal + copyPublicDir = false
//    `/style.css`, `/css/vf-tokens-v2.css`, `/css/vf-components-v2.css` e
//    `/layout.js` resolvem tanto no `vite dev` quanto no build, sem serem
//    empacotados nem copiados. A Fundação Global V2 e a sidebar legada são
//    reaproveitadas como estão — nenhuma linha de CSS global foi duplicada.
//
//  - base = './'
//    URLs relativas: funciona em qualquer host estático, sem depender do caminho
//    de publicação. Nenhuma URL local fica hardcoded no bundle.
//
//  - proxy de desenvolvimento para o Express (porta 3333, lida de server/index.js)
//    Em dev o cliente HTTP usa caminhos relativos e o Vite encaminha; assim não há
//    CORS e o comportamento fica igual ao de produção (mesma origem).
//
//  - React vem do bundle (npm). Sem CDN, sem Next.js, sem CRA, sem iframe.

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const portalDir = fileURLToPath(new URL("../Portal", import.meta.url));

// Porta do Express (server/index.js: `process.env.PORT || 3333`).
const BACKEND_DEV = process.env.VITE_BACKEND_ORIGIN || "http://localhost:3333";

// Prefixos servidos pelo Express que o dev server precisa encaminhar.
const ROTAS_API = ["/operacao", "/auth", "/ads", "/fechamentos", "/clientes", "/health"];

export default defineConfig({
  base: "./",
  plugins: [react()],
  publicDir: portalDir,
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5181,
    open: "/cliente-360-react.html",
    proxy: Object.fromEntries(
      ROTAS_API.map((rota) => [rota, { target: BACKEND_DEV, changeOrigin: true }])
    ),
  },
  build: {
    outDir: portalDir,
    emptyOutDir: false,
    copyPublicDir: false,
    assetsDir: "assets/cliente-360-react",
    rollupOptions: {
      input: fileURLToPath(new URL("./cliente-360-react.html", import.meta.url)),
      output: {
        entryFileNames: "assets/cliente-360-react/[name]-[hash].js",
        chunkFileNames: "assets/cliente-360-react/[name]-[hash].js",
        assetFileNames: "assets/cliente-360-react/[name]-[hash][extname]",
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.js",
    include: ["src/**/*.test.{js,jsx}"],
  },
});
