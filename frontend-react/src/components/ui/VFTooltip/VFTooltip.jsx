// @ts-check
// VFTooltip — dica da Fundação Global V2 sobre Radix Tooltip.
//
// Visual `.vf-tooltip` (Portal/css/vf-components-v2.css). No lugar do
// `title=` nativo onde a dica é a ÚNICA explicação de um indicador (⚠, ◐,
// ícones): aparece em 300 ms (o nativo leva ~1 s), abre também pelo foco do
// teclado, fica posicionada dentro da tela e entra com um fade curto.
//
// Não é para todo valor de tabela: cada VFTooltip monta um Radix Tooltip, e
// uma tabela com centenas de células com `title=` continua melhor com o
// nativo. Regra do DESIGN.md mantida: dica complementa, nunca é o único
// lugar de um dado essencial — o gatilho continua com seu `aria-label`.

import * as Tooltip from "@radix-ui/react-tooltip";

/**
 * @param {object} props
 * @param {import("react").ReactNode} props.content
 * @param {import("react").ReactElement} props.children  Um elemento só, que aceite ref. Se não for focável, dê `tabIndex={0}`.
 * @param {"top" | "right" | "bottom" | "left"} [props.side="top"]
 * @param {number} [props.delay=300]
 */
export function VFTooltip({ content, children, side = "top", delay = 300 }) {
  if (content == null || content === "") return children;
  return (
    <Tooltip.Provider delayDuration={delay} skipDelayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="vf-tooltip vf-tooltip--float" side={side} sideOffset={6} collisionPadding={8}>
            {content}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
