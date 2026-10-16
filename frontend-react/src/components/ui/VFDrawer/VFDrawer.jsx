// @ts-check
// VFDrawer — painel lateral da Fundação Global V2 sobre Radix Dialog.
//
// O visual é todo `.vf-drawer` / `.vf-drawer-backdrop` (Portal/css/
// vf-components-v2.css). O Radix entra só no comportamento que cada drawer
// artesanal fazia pela metade: foco preso dentro do painel, ESC, clique fora,
// rolagem da página travada, foco devolvido a quem abriu e aria de diálogo.
//
// Montar = abrir (mesmo contrato dos drawers que ele substitui). Fechar (×,
// ESC, clique fora) desliza o painel para fora pela transição da V2 e SÓ
// ENTÃO chama `onClose` — o pai desmonta depois da saída. Com movimento
// reduzido, `onClose` é chamado na hora.
//
// O painel é renderizado em <body> (portal): não fica preso ao z-index nem
// ao overflow de quem o abriu.

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import { cx } from "../../../utils/cx.js";
import { usePrefersReducedMotion } from "../../../hooks/usePrefersReducedMotion.js";

// Um pouco acima de --vf-duration-slow (0.28s): rede de segurança caso o
// transitionend não chegue.
const PRAZO_FECHAR = 400;

/**
 * @param {object} props
 * @param {import("react").ReactNode} props.title
 * @param {import("react").ReactNode} [props.subtitle]  Vira a descrição acessível do diálogo.
 * @param {() => void} props.onClose  Chamado depois da saída.
 * @param {"sm" | "md" | "lg"} [props.size="md"]
 * @param {import("react").ReactNode} [props.footer]
 * @param {import("react").ReactNode} [props.children]
 * @param {import("react").RefObject<HTMLElement>} [props.initialFocusRef] Padrão: o primeiro focável (o ×).
 * @param {string} [props.closeLabel="Fechar"]
 * @param {string} [props.className]        No painel.
 * @param {string} [props.headerClassName]  Classes extras da ilha (ex.: c360d-drawer__header).
 * @param {string} [props.titleClassName]
 * @param {string} [props.subtitleClassName]
 * @param {string} [props.bodyClassName]
 * @param {string} [props.footerClassName]
 */
export function VFDrawer({
  title,
  subtitle,
  onClose,
  size = "md",
  footer,
  children,
  initialFocusRef,
  closeLabel = "Fechar",
  className,
  headerClassName,
  titleClassName,
  subtitleClassName,
  bodyClassName,
  footerClassName,
  ...rest
}) {
  const reduzido = usePrefersReducedMotion();
  const [visivel, setVisivel] = useState(false);
  const [fechando, setFechando] = useState(false);
  const fechou = useRef(false);
  // Sem Dialog.Trigger (montar = abrir), o Radix não sabe a quem devolver o
  // foco: guardamos quem tinha o foco quando o drawer montou.
  const origemFoco = useRef(/** @type {Element | null} */ (typeof document !== "undefined" ? document.activeElement : null));
  const timer = useRef(/** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined));

  // `.vf-drawer` nasce fora da tela; `is-open` um frame depois faz a
  // transição de entrada rodar.
  useEffect(() => {
    if (typeof requestAnimationFrame !== "function") {
      setVisivel(true);
      return undefined;
    }
    const frame = requestAnimationFrame(() => setVisivel(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  function concluir() {
    if (fechou.current) return;
    fechou.current = true;
    clearTimeout(timer.current);
    onClose?.();
  }

  function pedirFechar() {
    if (fechando) return;
    if (reduzido) {
      concluir();
      return;
    }
    setFechando(true);
    setVisivel(false);
    timer.current = setTimeout(concluir, PRAZO_FECHAR);
  }

  return (
    <Dialog.Root open onOpenChange={(aberto) => !aberto && pedirFechar()}>
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <div className={cx("vf-drawer-backdrop", visivel && "is-open")} />
        </Dialog.Overlay>
        <Dialog.Content
          asChild
          // Sem subtítulo não há descrição: avisa o Radix explicitamente.
          {...(subtitle ? {} : { "aria-describedby": undefined })}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            const alvo = /** @type {HTMLElement | null} */ (origemFoco.current);
            if (alvo && alvo.isConnected) alvo.focus({ preventScroll: true });
          }}
          onOpenAutoFocus={(e) => {
            if (initialFocusRef?.current) {
              e.preventDefault();
              initialFocusRef.current.focus();
            }
          }}
        >
          <aside
            className={cx(
              "vf-drawer",
              size === "sm" && "vf-drawer--sm",
              size === "lg" && "vf-drawer--lg",
              visivel && "is-open",
              className,
            )}
            onTransitionEnd={(e) => {
              if (fechando && e.target === e.currentTarget) concluir();
            }}
            {...rest}
          >
            <header className={cx("vf-drawer__header", headerClassName)}>
              <div className="vf-drawer__heading">
                <Dialog.Title className={cx("vf-drawer__title", titleClassName)}>{title}</Dialog.Title>
                {subtitle && (
                  <Dialog.Description className={cx("vf-drawer__subtitle", subtitleClassName)}>
                    {subtitle}
                  </Dialog.Description>
                )}
              </div>
              <Dialog.Close asChild>
                <button type="button" className="vf-btn vf-btn--ghost vf-btn--icon vf-btn--sm" aria-label={closeLabel}>
                  ✕
                </button>
              </Dialog.Close>
            </header>
            <div className={cx("vf-drawer__body", bodyClassName)}>{children}</div>
            {footer && <footer className={cx("vf-drawer__footer", footerClassName)}>{footer}</footer>}
          </aside>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Fecha o VFDrawer que o contém pelo mesmo caminho do × (desliza e depois
 * chama `onClose`). Envolve um único botão: <VFDrawerClose><VFButton>Cancelar</VFButton></VFDrawerClose>
 * @param {{ children: import("react").ReactElement }} props
 */
export function VFDrawerClose({ children }) {
  return <Dialog.Close asChild>{children}</Dialog.Close>;
}
