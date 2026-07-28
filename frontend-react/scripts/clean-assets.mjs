// frontend-react/scripts/clean-assets.mjs
// Remove APENAS os assets gerados pela Cliente 360 React
// (Portal/assets/cliente-360-react) antes de um novo build.
//
// O Vite roda com emptyOutDir=false porque o outDir é o Portal inteiro — apagá-lo
// destruiria todas as páginas legadas. Sem esta limpeza, os arquivos com hash
// antigo se acumulariam no repositório a cada build.

import { rm } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";

const alvo = fileURLToPath(new URL("../../Portal/assets/cliente-360-react", import.meta.url));

await rm(alvo, { recursive: true, force: true });
console.log(`[clean-assets] limpo: ${alvo}`);
