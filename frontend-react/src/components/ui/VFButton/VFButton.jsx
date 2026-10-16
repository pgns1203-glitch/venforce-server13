// @ts-check
// VFButton — botão da Fundação Global V2.
//
// Wrapper fino sobre `.vf-btn` (Portal/css/vf-components-v2.css): nenhum CSS
// próprio, nenhum token novo. Toda a aparência vem da classe; este componente
// só traduz props em modificadores e cuida da acessibilidade.
//
// Movimento (todo no CSS compartilhado, então vale também para o vanilla):
//   - pressionar encolhe 2% (`:active`);
//   - `loading` troca o rótulo por spinner sem mudar a largura;
//   - `feedback="ok"` troca o rótulo por um ✓ — confirmação de que a ação
//     terminou, sem precisar de toast. Use com `useFeedbackOk()`, que volta
//     ao normal sozinho.

import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { cx } from "../../../utils/cx.js";

const VARIANTES = new Set(["primary", "secondary", "ghost", "danger"]);

/**
 * @typedef {object} VFButtonProps
 * @property {"primary" | "secondary" | "ghost" | "danger"} [variant="secondary"]
 * @property {"sm" | "md" | "lg"} [size="md"]
 * @property {boolean} [icon]      Só ícone, quadrado. Exige `aria-label`.
 * @property {boolean} [full]      Ocupa a largura do contêiner.
 * @property {boolean} [loading]   Spinner no lugar do rótulo; bloqueia clique.
 * @property {boolean} [active]    Estado selecionado (grupo de botões).
 * @property {"ok" | null} [feedback] Mostra ✓ no lugar do rótulo.
 * @property {string} [feedbackLabel="Concluído"] Anunciado a leitores de tela.
 * @property {string} [href]       Renderiza `<a>` em vez de `<button>`.
 */

/** @type {import("react").ForwardRefExoticComponent<VFButtonProps & Record<string, any>>} */
export const VFButton = forwardRef(function VFButton(
  {
    variant = "secondary",
    size = "md",
    icon = false,
    full = false,
    loading = false,
    active = false,
    feedback = null,
    feedbackLabel = "Concluído",
    href,
    type = "button",
    disabled = false,
    className,
    children,
    onClick,
    ...rest
  },
  ref,
) {
  const ok = feedback === "ok" && !loading;
  const classes = cx(
    "vf-btn",
    `vf-btn--${VARIANTES.has(variant) ? variant : "secondary"}`,
    size === "sm" && "vf-btn--sm",
    size === "lg" && "vf-btn--lg",
    icon && "vf-btn--icon",
    full && "vf-btn--full",
    loading && "is-loading",
    ok && "is-done",
    active && "is-active",
    href && disabled && "is-disabled",
    className,
  );

  // Região viva sempre montada: leitor de tela só anuncia mudança em região
  // que já existia antes da mudança.
  const anuncio = (
    <span className="vf-visually-hidden" aria-live="polite">
      {ok ? feedbackLabel : ""}
    </span>
  );

  if (href) {
    return (
      <a
        ref={ref}
        className={classes}
        href={disabled ? undefined : href}
        aria-disabled={disabled || undefined}
        aria-busy={loading || undefined}
        tabIndex={disabled ? -1 : undefined}
        onClick={disabled ? (e) => e.preventDefault() : onClick}
        {...rest}
      >
        {children}
        {anuncio}
      </a>
    );
  }

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled}
      aria-busy={loading || undefined}
      onClick={onClick}
      {...rest}
    >
      {children}
      {anuncio}
    </button>
  );
});

export const FEEDBACK_DURACAO = 1200; // ms

/**
 * Estado do `feedback` de um VFButton que volta ao normal sozinho.
 *
 *   const [feedback, confirmar] = useFeedbackOk();
 *   await salvar(); confirmar();
 *   <VFButton feedback={feedback}>Salvar</VFButton>
 *
 * @param {number} [duracao]
 * @returns {[("ok" | null), () => void]}
 */
export function useFeedbackOk(duracao = FEEDBACK_DURACAO) {
  const [feedback, setFeedback] = useState(/** @type {"ok" | null} */ (null));
  const timer = useRef(/** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined));

  useEffect(() => () => clearTimeout(timer.current), []);

  const confirmar = useCallback(() => {
    clearTimeout(timer.current);
    setFeedback("ok");
    timer.current = setTimeout(() => setFeedback(null), duracao);
  }, [duracao]);

  return [feedback, confirmar];
}
