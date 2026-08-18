// frontend-react/vite.full.config.js
//
// Build ISOLADO da Central de Gestão Full (PR5). Config separada de
// `vite.config.js` de propósito — o plano auditado marca alterar o config
// da Cliente 360 como [RISCO DE PRODUÇÃO] (poderia apagar/quebrar assets
// dela ou o Portal). Esta config nunca é importada por `vite.config.js` e
// vice-versa; rodam com `--config` explícito, em processos separados.
//
// Mesmas decisões estruturais da Cliente 360 (ver vite.config.js para o
// raciocínio completo: outDir=Portal, emptyOutDir=false, base='./',
// publicDir compartilhado sem cópia), só que:
//   - assetsDir = "assets/full-gestao" (nunca "assets/cliente-360-react")
//   - entrada = full-gestao.html (nunca index.html/cliente-360-react.html)
//   - clean-assets-full.mjs remove SOMENTE Portal/assets/full-gestao

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const portalDir = fileURLToPath(new URL("../Portal", import.meta.url));

const BACKEND_DEV = process.env.VITE_BACKEND_ORIGIN || "http://localhost:3333";
const ROTAS_API = ["/operacao", "/auth", "/ads", "/fechamentos", "/clientes", "/base-vinculos", "/health"];

export default defineConfig({
  base: "./",
  plugins: [react()],
  publicDir: portalDir,
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5182,
    open: "/full-gestao.html",
    proxy: Object.fromEntries(
      ROTAS_API.map((rota) => [rota, { target: BACKEND_DEV, changeOrigin: true }])
    ),
  },
  build: {
    outDir: portalDir,
    emptyOutDir: false,
    copyPublicDir: false,
    assetsDir: "assets/full-gestao",
    rollupOptions: {
      input: fileURLToPath(new URL("./full-gestao.html", import.meta.url)),
      output: {
        entryFileNames: "assets/full-gestao/[name]-[hash].js",
        chunkFileNames: "assets/full-gestao/[name]-[hash].js",
        assetFileNames: "assets/full-gestao/[name]-[hash][extname]",
      },
    },
  },
});
