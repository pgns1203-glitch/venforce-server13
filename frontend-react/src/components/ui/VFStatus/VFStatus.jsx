// @ts-check
// VFStatus · VFTag · VFBadge — marcadores da Fundação Global V2.
//
// Wrappers finos sobre `.vf-status`, `.vf-tag`, `.vf-badge`
// (Portal/css/vf-components-v2.css): nenhum CSS próprio, nenhum token novo.
//
//   Status → estado operacional (forma + texto, sem fundo): ● ok · ◇ alerta · ○ sem dado
//   Tag    → categoria/filtro (retangular)
//   Badge  → contagem (pill mínima)
//
// Movimento: troca de tom já faz transição de cor pela classe. O VFBadge dá
// um pulo curto (`.vf-motion-bump`) quando o número muda — ex.: o contador
// "sem custo" baixando enquanto a pessoa preenche custos. Não pula ao montar.

import { useEffect, useRef, useState } from "react";
import { cx } from "../../../utils/cx.js";

/**
 * @param {string | undefined} tone
 * @param {Set<string>} validos
 */
function classeTom(tone, validos) {
  return tone && validos.has(tone) ? `is-${tone}` : null;
}

const TONS_STATUS = new Set(["primary", "success", "warning", "danger", "info", "empty"]);
const TONS_TAG = new Set(["primary", "success", "warning", "danger", "info", "neutral"]);
const TONS_BADGE = new Set(["primary", "success", "warning", "danger", "info"]);

/**
 * @param {{ tone?: "primary" | "success" | "warning" | "danger" | "info" | "empty", className?: string, children?: import("react").ReactNode } & Record<string, any>} props
 */
export function VFStatus({ tone, className, children, ...rest }) {
  return (
    <span className={cx("vf-status", classeTom(tone, TONS_STATUS), className)} {...rest}>
      {children}
    </span>
  );
}

/**
 * @param {{ tone?: "primary" | "success" | "warning" | "danger" | "info" | "neutral", className?: string, children?: import("react").ReactNode } & Record<string, any>} props
 */
export function VFTag({ tone, className, children, ...rest }) {
  return (
    <span className={cx("vf-tag", classeTom(tone, TONS_TAG), className)} {...rest}>
      {children}
    </span>
  );
}

/**
 * @param {{ tone?: "primary" | "success" | "warning" | "danger" | "info", className?: string, children?: import("react").ReactNode } & Record<string, any>} props
 */
export function VFBadge({ tone, className, children, ...rest }) {
  const anterior = useRef(children);
  const [pulso, setPulso] = useState(0);

  useEffect(() => {
    const primitivo = typeof children === "number" || typeof children === "string";
    if (primitivo && anterior.current !== children) setPulso((p) => p + 1);
    anterior.current = children;
  }, [children]);

  // `key` muda a cada pulso: remontar é o único jeito de repetir um keyframe.
  return (
    <span
      key={pulso}
      className={cx("vf-badge", classeTom(tone, TONS_BADGE), pulso > 0 && "vf-motion-bump", className)}
      {...rest}
    >
      {children}
    </span>
  );
}
