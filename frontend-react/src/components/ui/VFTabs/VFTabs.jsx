// @ts-check
// VFTabs — lista de abas da Fundação Global V2 sobre Radix Tabs.
//
// Visual: `.vf-tabs` / `.vf-tab` (Portal/css/vf-components-v2.css). Radix:
// navegação por teclado (setas, Home, End — o foco anda e já seleciona),
// role/aria-selected e foco itinerante. Só a LISTA: o conteúdo de cada aba
// continua com quem chama (há telas que mantêm os painéis montados de
// propósito). Para ligar aba ↔ painel, passe `panelId` na aba.
//
// Movimento: um traço (`.vf-tabs__indicator`) desliza até a aba escolhida em
// vez do sublinhado pular de uma para outra. Na primeira pintura ele já
// nasce no lugar, sem animar.

import * as Tabs from "@radix-ui/react-tabs";
import { useLayoutEffect, useRef, useState } from "react";
import { cx } from "../../../utils/cx.js";

/**
 * @typedef {object} VFTab
 * @property {string | number | null} value  Qualquer valor; comparado como texto.
 * @property {import("react").ReactNode} label
 * @property {boolean} [disabled]
 * @property {string} [panelId]  Id do painel que esta aba controla (aria-controls).
 */

/**
 * @param {object} props
 * @param {VFTab[]} props.tabs
 * @param {VFTab["value"]} props.value
 * @param {(value: VFTab["value"]) => void} props.onValueChange
 * @param {string} props.ariaLabel  Nome da lista ("Seções do Financeiro").
 * @param {string} [props.className]
 */
export function VFTabs({ tabs, value, onValueChange, ariaLabel, className, ...rest }) {
  const listaRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [indicador, setIndicador] = useState(/** @type {{ x: number, w: number } | null} */ (null));
  const [animar, setAnimar] = useState(false);
  const atual = String(value);

  // Mede a aba ativa a cada troca e quando a lista muda de tamanho (fonte que
  // carregou depois, contagem que cresceu, janela redimensionada).
  useLayoutEffect(() => {
    const lista = listaRef.current;
    if (!lista) return undefined;
    const medir = () => {
      const ativa = /** @type {HTMLElement | null} */ (lista.querySelector('[role="tab"][data-state="active"]'));
      setIndicador(ativa ? { x: ativa.offsetLeft, w: ativa.offsetWidth } : null);
    };
    medir();
    /** @type {ResizeObserver | undefined} */
    let observador;
    if (typeof ResizeObserver !== "undefined") {
      observador = new ResizeObserver(medir);
      observador.observe(lista);
    }
    return () => observador?.disconnect();
  }, [atual, tabs.length]);

  // Liga a transição só depois da primeira posição pintada.
  useLayoutEffect(() => {
    if (animar || !indicador) return undefined;
    if (typeof requestAnimationFrame !== "function") return undefined;
    const frame = requestAnimationFrame(() => setAnimar(true));
    return () => cancelAnimationFrame(frame);
  }, [indicador, animar]);

  return (
    <Tabs.Root
      value={atual}
      onValueChange={(v) => {
        const aba = tabs.find((t) => String(t.value) === v);
        if (aba) onValueChange(aba.value);
      }}
      activationMode="automatic"
    >
      <Tabs.List ref={listaRef} className={cx("vf-tabs", "vf-tabs--indicator", className)} aria-label={ariaLabel} {...rest}>
        {tabs.map((aba) => {
          const v = String(aba.value);
          return (
            <Tabs.Trigger
              key={v}
              value={v}
              disabled={aba.disabled}
              className={cx("vf-tab", v === atual && "is-active")}
              // Sem <Tabs.Content> aqui: só aponta para um painel se ele existir.
              aria-controls={aba.panelId}
            >
              {aba.label}
            </Tabs.Trigger>
          );
        })}
        {indicador && (
          <span
            className={cx("vf-tabs__indicator", !animar && "is-instant")}
            style={{ width: `${indicador.w}px`, transform: `translateX(${indicador.x}px)` }}
            aria-hidden="true"
          />
        )}
      </Tabs.List>
    </Tabs.Root>
  );
}
