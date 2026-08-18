// frontend-react/scripts/clean-assets-full.mjs
// Remove APENAS os assets gerados pela Central de Gestão Full
// (Portal/assets/full-gestao) antes de um novo build.
//
// Espelha clean-assets.mjs (Cliente 360), mas isolado: nunca toca
// Portal/assets/cliente-360-react nem qualquer outro caminho do Portal.

import { rm } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";

const alvo = fileURLToPath(new URL("../../Portal/assets/full-gestao", import.meta.url));

await rm(alvo, { recursive: true, force: true });
console.log(`[clean-assets-full] limpo: ${alvo}`);
