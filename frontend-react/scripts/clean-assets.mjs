// frontend-react/scripts/clean-assets.mjs
//
// Remove APENAS os assets de UMA ilha (Portal/assets/<ilha>) antes do build
// dessa ilha — nunca o Portal inteiro, nunca o assetsDir de outra ilha.
//
// O Vite roda com emptyOutDir=false porque o outDir é o Portal inteiro —
// apagá-lo destruiria todas as páginas legadas. Sem esta limpeza pontual, os
// arquivos com hash antigo se acumulariam no repositório a cada build.
//
// Uso: node scripts/clean-assets.mjs <ilha>   (ex.: cliente-360-react)
// `<ilha>` precisa existir em vite.entries.js — mesma fonte usada pelo build,
// para nunca divergir do assetsDir real daquela ilha.

import { rm } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { ENTRIES, resolveEntry } from "../vite.entries.js";

const nomeIlha = process.argv[2];
if (!nomeIlha) {
  console.error(`[clean-assets] uso: node scripts/clean-assets.mjs <ilha>. Ilhas conhecidas: ${Object.keys(ENTRIES).join(", ")}`);
  process.exit(1);
}

const entry = resolveEntry(nomeIlha); // lança se a ilha não existir — nunca limpa um caminho arbitrário
const alvo = fileURLToPath(new URL(`../../Portal/${entry.assetsDir}`, import.meta.url));

await rm(alvo, { recursive: true, force: true });
console.log(`[clean-assets] limpo: ${alvo}`);
