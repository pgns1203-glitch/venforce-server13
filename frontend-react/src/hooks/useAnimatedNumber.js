// @ts-check
// useAnimatedNumber — interpola um número do valor ANTERIOR para o novo.
//
// Regras (docs/specs/2026-10-16-ui-etapa1-componentes-plano.md §1):
//   - no primeiro render devolve o valor final: nunca conta a partir do zero;
//   - só anima quando o valor muda, e os dois lados são números finitos
//     (ausente/NaN/null passam direto, sem animação);
//   - `desativado` (ex.: prefers-reduced-motion) devolve o valor final;
//   - mudança no meio de uma animação parte do valor que está na tela,
//     não do anterior "oficial" — sem salto.
//
// Quem consome continua responsável por expor o valor FINAL a leitores de
// tela (aria-label); o número devolvido aqui é só a camada visual.

import { useEffect, useRef, useState } from "react";

export const DURACAO_PADRAO = 320; // ms — teto do plano é 400

/** @param {number} t 0..1 */
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/** @param {unknown} v */
function finito(v) {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * @template T
 * @param {T} valor
 * @param {{ duracao?: number, desativado?: boolean }} [opcoes]
 * @returns {T | number}
 */
export function useAnimatedNumber(valor, { duracao = DURACAO_PADRAO, desativado = false } = {}) {
  const [exibido, setExibido] = useState(/** @type {T | number} */ (valor));
  const exibidoRef = useRef(/** @type {T | number} */ (valor));
  const frameRef = useRef(0);

  useEffect(() => {
    const de = exibidoRef.current;
    const semRaf = typeof requestAnimationFrame !== "function";

    if (desativado || semRaf || !finito(de) || !finito(valor) || de === valor) {
      exibidoRef.current = valor;
      setExibido(valor);
      return undefined;
    }

    const inicio = typeof performance !== "undefined" ? performance.now() : Date.now();
    const origem = /** @type {number} */ (de);
    const destino = /** @type {number} */ (/** @type {unknown} */ (valor));

    /** @param {number} agora */
    const passo = (agora) => {
      const t = Math.min(1, (agora - inicio) / duracao);
      const atual = t >= 1 ? destino : origem + (destino - origem) * easeOutCubic(t);
      exibidoRef.current = atual;
      setExibido(atual);
      if (t < 1) frameRef.current = requestAnimationFrame(passo);
    };
    frameRef.current = requestAnimationFrame(passo);

    return () => cancelAnimationFrame(frameRef.current);
  }, [valor, duracao, desativado]);

  return exibido;
}
