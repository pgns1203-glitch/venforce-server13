// frontend-react/src/hooks/useScrollSpy.js
//
// Scrollspy da subnavegação do Dossiê. IntersectionObserver de verdade (não
// `scroll` + getBoundingClientRect a cada pixel): a seção ativa é a mais ALTA
// entre as que cruzam a faixa de leitura, e a faixa começa exatamente onde o
// header + subnav sticky terminam — senão o item ativo troca antes de a seção
// aparecer de fato sob a barra.
//
// jsdom (Vitest) não implementa IntersectionObserver: sem o guard abaixo a
// página inteira quebraria em teste por causa de um detalhe de navegação.

import { useCallback, useEffect, useRef, useState } from "react";

export function useScrollSpy(ids, { offset = 0 } = {}) {
  const chave = ids.join("|");
  const [ativo, setAtivo] = useState(ids[0] ?? null);
  // Clique na subnav vence o observer por um instante: o smooth scroll passa
  // por todas as seções intermediárias e faria o item ativo "correr" até o
  // destino, o que parece um bug mesmo sendo o comportamento literal.
  const travaAte = useRef(0);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return undefined;

    const entradas = new Map();
    const observer = new IntersectionObserver(
      (lista) => {
        for (const entrada of lista) entradas.set(entrada.target.id, entrada);
        if (Date.now() < travaAte.current) return;

        const visiveis = [...entradas.values()]
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visiveis.length > 0) setAtivo(visiveis[0].target.id);
      },
      { rootMargin: `-${offset}px 0px -55% 0px`, threshold: [0, 0.01, 0.5] }
    );

    const nos = ids.map((id) => document.getElementById(id)).filter(Boolean);
    nos.forEach((no) => observer.observe(no));
    return () => observer.disconnect();
  }, [chave, offset]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fim da página: a última seção pode ser baixa demais para alcançar a faixa
  // de leitura e nunca ficaria ativa. Aqui ela fica.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    function aoRolar() {
      if (Date.now() < travaAte.current) return;
      const fim = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (fim && ids.length > 0) setAtivo(ids[ids.length - 1]);
    }
    window.addEventListener("scroll", aoRolar, { passive: true });
    return () => window.removeEventListener("scroll", aoRolar);
  }, [chave]); // eslint-disable-line react-hooks/exhaustive-deps

  const irPara = useCallback(
    (id) => {
      const alvo = document.getElementById(id);
      if (!alvo) return;
      travaAte.current = Date.now() + 700;
      setAtivo(id);
      const topo = alvo.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: Math.max(0, topo), behavior: "smooth" });
      // Foco na seção: quem navega por teclado precisa continuar de onde o
      // scroll parou, não do início do documento.
      alvo.focus({ preventScroll: true });
    },
    [offset]
  );

  return { ativo, irPara };
}
