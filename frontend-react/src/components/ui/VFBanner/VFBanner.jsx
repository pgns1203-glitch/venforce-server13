// @ts-check
// VFBanner — aviso em faixa da Fundação Global V2.
//
// Wrapper fino sobre `.vf-banner` (Portal/css/vf-components-v2.css): nenhum
// CSS próprio, nenhum token novo.
//
// Movimento: o banner entra abrindo espaço (`.vf-motion-reveal`) e, ao
// fechar pelo ×, recolhe (`.vf-motion-collapse`) ANTES de chamar `onClose` —
// o conteúdo de baixo sobe deslizando em vez de saltar. Com movimento
// reduzido, `onClose` é chamado na hora.

import { useEffect, useRef, useState } from "react";
import { cx } from "../../../utils/cx.js";
import { usePrefersReducedMotion } from "../../../hooks/usePrefersReducedMotion.js";

const TONS = new Set(["info", "success", "warning", "danger"]);

// Um pouco acima de --vf-duration-slow (0.28s): rede de segurança caso o
// transitionend não chegue (aba em segundo plano, elemento sem layout).
const PRAZO_FECHAR = 400;

/**
 * @param {object} props
 * @param {"info" | "success" | "warning" | "danger"} [props.tone] Sem tom = neutro.
 * @param {import("react").ReactNode} [props.title]
 * @param {import("react").ReactNode} [props.children] Descrição.
 * @param {import("react").ReactNode} [props.actions]  Botões, abaixo do texto.
 * @param {import("react").ReactNode} [props.icon]     Opcional; nenhum ícone por padrão.
 * @param {() => void} [props.onClose] Mostra o × e é chamado depois de recolher.
 * @param {string} [props.closeLabel="Fechar aviso"]
 * @param {boolean} [props.compact]
 * @param {string} [props.role] Padrão: `alert` em danger, `status` no resto.
 * @param {string} [props.className]
 */
export function VFBanner({
  tone,
  title,
  children,
  actions,
  icon,
  onClose,
  closeLabel = "Fechar aviso",
  compact = false,
  role,
  className,
  ...rest
}) {
  const reduzido = usePrefersReducedMotion();
  const [fechando, setFechando] = useState(false);
  const fechou = useRef(false);
  const timer = useRef(/** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined));

  useEffect(() => () => clearTimeout(timer.current), []);

  function concluir() {
    if (fechou.current) return;
    fechou.current = true;
    clearTimeout(timer.current);
    onClose?.();
  }

  function fechar() {
    if (reduzido) {
      concluir();
      return;
    }
    setFechando(true);
    timer.current = setTimeout(concluir, PRAZO_FECHAR);
  }

  const tom = tone && TONS.has(tone) ? tone : null;

  return (
    <div
      className={fechando ? "vf-motion-collapse" : "vf-motion-collapse is-open vf-motion-reveal"}
      onTransitionEnd={(e) => {
        if (fechando && e.target === e.currentTarget) concluir();
      }}
    >
      <div>
        <div
          className={cx("vf-banner", tom && `is-${tom}`, compact && "vf-banner--compact", className)}
          role={role ?? (tom === "danger" ? "alert" : "status")}
          {...rest}
        >
          {icon && (
            <span className="vf-banner__icon" aria-hidden="true">
              {icon}
            </span>
          )}
          <div className="vf-banner__content">
            {title && <p className="vf-banner__title">{title}</p>}
            {children && <div className="vf-banner__description">{children}</div>}
            {actions && <div className="vf-banner__actions">{actions}</div>}
          </div>
          {onClose && (
            <button type="button" className="vf-banner__close" aria-label={closeLabel} onClick={fechar} disabled={fechando}>
              ×
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
