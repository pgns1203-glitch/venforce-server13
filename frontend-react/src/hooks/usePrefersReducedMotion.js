// @ts-check
// usePrefersReducedMotion — `true` quando o sistema pede menos movimento.
//
// O CSS da Fundação já desliga animação/transição por media query
// (vf-tokens-v2.css §17). Este hook cobre o que é animado em JS
// (requestAnimationFrame), que o CSS não alcança.
//
// Sem `matchMedia` (jsdom, SSR) devolve `true`: sem como perguntar, o seguro
// é não animar — e os testes enxergam o estado final direto.

import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function temMatchMedia() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

function ler() {
  return temMatchMedia() ? window.matchMedia(QUERY).matches : true;
}

/** @returns {boolean} */
export function usePrefersReducedMotion() {
  const [reduz, setReduz] = useState(ler);

  useEffect(() => {
    if (!temMatchMedia()) return undefined;
    const mql = window.matchMedia(QUERY);
    const onChange = () => setReduz(mql.matches);
    onChange();
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    // Safari < 14
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);

  return reduz;
}
