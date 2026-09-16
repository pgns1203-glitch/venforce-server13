// frontend-react/src/components/cliente360v3/dossie/Drawer.jsx
//
// Padrão de aprofundamento do Dossiê (§24 do brief): ENTENDER acontece no
// drawer, EDITAR continua no módulo dono. Um único primitivo para produto,
// fator da ponte, oportunidade, evidências de confiança, comparação completa
// e configuração — se cada um tivesse o seu, eles divergiriam em foco, ESC e
// rolagem, que é exatamente onde drawer artesanal costuma falhar.
//
// Compõe `.vf-drawer` da Fundação V2 (não redefine nada dela). O que o
// componente acrescenta é comportamento: ESC, clique fora, focus trap, devolver
// o foco a quem abriu e travar a rolagem da PÁGINA (nunca reposicionando o
// body — ao fechar, o leitor volta exatamente para a linha onde estava).

import { useCallback, useEffect, useRef, useState } from "react";

const FOCAVEIS =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let abertos = 0;

export default function Drawer({ titulo, subtitulo, largura = "md", onFechar, children, rodape }) {
  const painelRef = useRef(null);
  const fecharRef = useRef(null);
  const origemFocoRef = useRef(null);
  const [aberto, setAberto] = useState(false);

  const fechar = useCallback(() => onFechar?.(), [onFechar]);

  useEffect(() => {
    origemFocoRef.current = document.activeElement;
    const frame = requestAnimationFrame(() => {
      setAberto(true);
      fecharRef.current?.focus();
    });

    abertos += 1;
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function aoTeclar(evento) {
      if (evento.key === "Escape") {
        evento.stopPropagation();
        fechar();
        return;
      }
      if (evento.key !== "Tab" || !painelRef.current) return;

      const focaveis = [...painelRef.current.querySelectorAll(FOCAVEIS)].filter(
        (no) => no.offsetParent !== null || no === document.activeElement
      );
      if (focaveis.length === 0) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];

      if (evento.shiftKey && document.activeElement === primeiro) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && document.activeElement === ultimo) {
        evento.preventDefault();
        primeiro.focus();
      }
    }

    document.addEventListener("keydown", aoTeclar, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", aoTeclar, true);
      abertos = Math.max(0, abertos - 1);
      if (abertos === 0) document.body.style.overflow = overflowAnterior;
      origemFocoRef.current?.focus?.({ preventScroll: true });
    };
  }, [fechar]);

  return (
    <>
      <div
        className={`vf-drawer-backdrop${aberto ? " is-open" : ""}`}
        role="presentation"
        onClick={fechar}
      />
      <aside
        ref={painelRef}
        className={`vf-drawer c360d-drawer${largura === "lg" ? " vf-drawer--lg" : ""}${aberto ? " is-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
      >
        <header className="vf-drawer__header c360d-drawer__header">
          <div className="c360d-drawer__heading">
            <h2 className="vf-drawer__title c360d-drawer__titulo">{titulo}</h2>
            {subtitulo && <p className="c360d-drawer__subtitulo">{subtitulo}</p>}
          </div>
          <button
            type="button"
            className="vf-btn vf-btn--ghost vf-btn--icon vf-btn--sm"
            aria-label="Fechar"
            onClick={fechar}
            ref={fecharRef}
          >
            ✕
          </button>
        </header>

        <div className="vf-drawer__body c360d-drawer__body">{children}</div>

        {rodape && <footer className="vf-drawer__footer c360d-drawer__rodape">{rodape}</footer>}
      </aside>
    </>
  );
}
