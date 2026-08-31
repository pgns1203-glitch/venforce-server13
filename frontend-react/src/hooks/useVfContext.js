// frontend-react/src/hooks/useVfContext.js
//
// Ponte React ↔ Shell V3 (Portal/vf-context.js). A Visão (F3.2) e o
// Financeiro (F4.1) são as primeiras ilhas React que precisam do contexto
// operacional — Cliente 360 React (2025) não tinha isso, escolhia cliente
// por um <select> próprio na URL (`?slug=`).
//
// NÃO usa `window.VF.context.subscribe()` diretamente. `window.VF` só passa
// a existir depois que vf-shell.js (script módulo, carregado DEPOIS do
// bundle React nesta página — ver visao.html) termina sua própria execução
// síncrona. Entre a execução do bundle React e a de vf-shell.js o motor JS
// processa a fila de microtasks — e é exatamente aí que o primeiro
// `useEffect` de um componente já montado dispara. Provado nesta unidade:
// num smoke test headless, a MESMA página, na MESMA sessão, ora tinha
// `window.VF.context` disponível a tempo do efeito (contexto chegava a
// READY normalmente), ora não (o efeito rodava com `window.VF` ainda
// `undefined`, nunca se inscrevia, e a Visão ficava travada em BOOT para
// sempre — nenhum erro de console, nenhuma pista visível). Depender da
// ordem de dois `<script type="module">` para isso não é seguro.
//
// A ponte real (MASTER_SPEC §6.5/§15.3, mesmo mecanismo que
// diagnostico-inicial.js e fechamentos-api.js já usam) é o evento DOM
// `vf:context`, que vf-context.js dispara a cada emit() — inclusive o
// primeiro, síncrono, dentro de init(). `document.addEventListener` não
// precisa que `window.VF.context` exista: só precisa que `document` exista,
// o que é sempre verdade. Registrando o listener no CARREGAMENTO do módulo
// (fora de qualquer componente/efeito — ver o `document.addEventListener`
// abaixo, fora de `useVfContext`), a inscrição acontece de forma síncrona,
// como parte da MESMA execução de script que monta o React — antes de
// vf-shell.js sequer começar a rodar. Nenhum emit é perdido.

import { useEffect, useState } from "react";

const BOOT_SNAPSHOT = { state: "BOOT", context: null, meta: null, integration: { grant: null, base: null }, error: null };

let ultimoSnapshot = BOOT_SNAPSHOT;
const assinantes = new Set();

if (typeof document !== "undefined") {
  document.addEventListener("vf:context", (event) => {
    ultimoSnapshot = event.detail;
    assinantes.forEach((fn) => fn(ultimoSnapshot));
  });
}

export function useVfContext() {
  const [snapshot, setSnapshot] = useState(() => ultimoSnapshot);

  useEffect(() => {
    // Captura qualquer emit que tenha chegado entre o module-load (acima) e
    // este efeito — o listener do módulo já está ativo desde antes de
    // vf-shell.js rodar, então `ultimoSnapshot` está sempre atualizado.
    setSnapshot(ultimoSnapshot);
    assinantes.add(setSnapshot);
    return () => assinantes.delete(setSnapshot);
  }, []);

  return snapshot;
}

// Açúcar para o caso comum: "estou pronto pra buscar dado desta conta?"
// clienteContaId null enquanto não READY — nunca um id de uma conta que já
// deixou de ser a atual (o snapshot inteiro troca atomicamente).
export function useOperacaoAtual() {
  const snapshot = useVfContext();
  const pronta = snapshot.state === "READY" && !!snapshot.context?.clienteContaId;
  return {
    snapshot,
    pronta,
    clienteId: snapshot.context?.clienteId ?? null,
    clienteSlug: snapshot.context?.clienteSlug ?? null,
    clienteNome: snapshot.context?.clienteNome ?? snapshot.meta?.clienteNome ?? null,
    clienteContaId: snapshot.context?.clienteContaId ?? null,
    marketplace: snapshot.meta?.marketplace ?? null,
  };
}
