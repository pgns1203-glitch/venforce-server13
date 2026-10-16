// @ts-check
// VFEmpty · VFError · VFLoading · VFSkeleton — estados de tela da Fundação V2.
//
// Wrappers finos sobre `.vf-empty`, `.vf-loading-state`, `.vf-spinner` e
// `.vf-skeleton` (Portal/css/vf-components-v2.css): nenhum CSS próprio.
// Substituem as cópias que cada ilha tinha (Cliente 360 e Central Full).
// O TEXTO de cada erro continua sendo do domínio (quem chama sabe o que um
// 424 do Mercado Livre significa); aqui fica só a forma.
//
// Movimento: vazio e erro entram com `.vf-motion-enter` — aparecem depois de
// um carregamento, então a troca carregando → resultado fica contínua em vez
// de um corte seco.

import { cx } from "../../../utils/cx.js";
import { VFButton } from "../VFButton/index.js";

/**
 * Vazio honesto: diz o que falta em vez de fingir que o número é zero.
 * @param {object} props
 * @param {import("react").ReactNode} props.title
 * @param {import("react").ReactNode} [props.children] Descrição.
 * @param {import("react").ReactNode} [props.icon]
 * @param {"danger" | "primary"} [props.iconTone]
 * @param {import("react").ReactNode} [props.actions]
 * @param {boolean} [props.compact]  Dentro de card/seção.
 * @param {"h2" | "h3" | "h4" | "p"} [props.titleAs="h3"]
 * @param {string} [props.className]
 */
export function VFEmpty({ title, children, icon, iconTone, actions, compact = false, titleAs: Titulo = "h3", className, ...rest }) {
  return (
    <div className={cx("vf-empty", compact && "vf-empty--compact", "vf-motion-enter", className)} {...rest}>
      {icon && (
        <span className={cx("vf-empty__icon", iconTone && `is-${iconTone}`)} aria-hidden="true">
          {icon}
        </span>
      )}
      <Titulo className="vf-empty__title">{title}</Titulo>
      {children && <p className="vf-empty__description">{children}</p>}
      {actions && <div className="vf-empty__actions">{actions}</div>}
    </div>
  );
}

/**
 * Falha ao carregar. Nunca mostra "0" no lugar do erro: diz o que houve e o
 * que dá para fazer.
 * @param {object} props
 * @param {import("react").ReactNode} [props.title="Não foi possível carregar"]
 * @param {import("react").ReactNode} [props.children] Explicação.
 * @param {import("react").ReactNode} [props.detail]   Mensagem técnica crua, em mono.
 * @param {() => void} [props.onRetry]  Mostra o botão de tentar de novo.
 * @param {string} [props.retryLabel="Tentar novamente"]
 * @param {import("react").ReactNode} [props.actions]
 * @param {boolean} [props.compact]
 * @param {"h2" | "h3" | "h4" | "p"} [props.titleAs="h3"]
 * @param {string} [props.className]
 */
export function VFError({
  title = "Não foi possível carregar",
  children,
  detail,
  onRetry,
  retryLabel = "Tentar novamente",
  actions,
  compact = false,
  titleAs: Titulo = "h3",
  className,
  ...rest
}) {
  const temAcoes = onRetry || actions;
  return (
    <div className={cx("vf-empty", compact && "vf-empty--compact", "vf-motion-enter", className)} role="alert" {...rest}>
      <Titulo className="vf-empty__title">{title}</Titulo>
      {children && <p className="vf-empty__description">{children}</p>}
      {detail && <p className="vf-empty__detail">{detail}</p>}
      {temAcoes && (
        <div className="vf-empty__actions">
          {onRetry && <VFButton onClick={onRetry}>{retryLabel}</VFButton>}
          {actions}
        </div>
      )}
    </div>
  );
}

/**
 * Carregando. Spinner + rótulo anunciado; `children` para um detalhe extra.
 * @param {object} props
 * @param {import("react").ReactNode} [props.label="Carregando…"]
 * @param {"sm" | "md" | "lg"} [props.size="md"]
 * @param {import("react").ReactNode} [props.children]
 * @param {string} [props.className]
 */
export function VFLoading({ label = "Carregando…", size = "md", children, className, ...rest }) {
  return (
    <div className={cx("vf-loading-state", className)} role="status" aria-live="polite" {...rest}>
      <span
        className={cx("vf-spinner", size === "sm" && "vf-spinner--sm", size === "lg" && "vf-spinner--lg")}
        aria-hidden="true"
      />
      <span>{label}</span>
      {children}
    </div>
  );
}

/**
 * Esqueleto do conteúdo que vai chegar. Decorativo (aria-hidden): quem
 * anuncia o carregamento é um VFLoading ou o `aria-busy` do contêiner.
 * @param {object} props
 * @param {"row" | "title" | "circle"} [props.variant="row"]
 * @param {number} [props.count=1]
 * @param {string} [props.className]
 */
export function VFSkeleton({ variant = "row", count = 1, className, ...rest }) {
  return Array.from({ length: Math.max(1, count) }, (_, i) => (
    // <div>, não <span>: o .vf-skeleton depende de ser bloco para ter altura.
    <div key={i} className={cx("vf-skeleton", `vf-skeleton--${variant}`, className)} aria-hidden="true" {...rest} />
  ));
}
