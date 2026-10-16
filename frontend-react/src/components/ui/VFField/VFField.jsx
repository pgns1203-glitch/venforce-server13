// @ts-check
// VFField + VFInput / VFSelect / VFTextarea — formulário da Fundação Global V2.
//
// Wrappers finos sobre `.vf-field`, `.vf-input`, `.vf-select`, `.vf-textarea`
// (Portal/css/vf-components-v2.css): nenhum CSS próprio, nenhum token novo.
//
// O que eles resolvem é a fiação de acessibilidade que cada tela hoje faz na
// mão (`${idTitulo}-campo`, `${idTitulo}-campo-dica`…): dentro de um VFField,
// o controle herda por contexto o `id` (ligado ao <label>), o
// `aria-describedby` (dica + erro) e o `aria-invalid`. Fora de um VFField o
// controle funciona sozinho.
//
// Movimento: a mensagem de erro entra abrindo espaço (`.vf-motion-reveal`) —
// o formulário desliza em vez de pular. Sai sem animação: quem corrige o
// campo está digitando e não precisa de nada se mexendo.

import { createContext, forwardRef, useContext, useId, useMemo } from "react";
import { cx } from "../../../utils/cx.js";

/**
 * @typedef {{ id: string, describedBy?: string, invalid: boolean, valid: boolean, required: boolean }} CampoContexto
 */

const FieldContext = createContext(/** @type {CampoContexto | null} */ (null));

/**
 * @param {object} props
 * @param {import("react").ReactNode} [props.label]
 * @param {import("react").ReactNode} [props.hint]
 * @param {import("react").ReactNode | boolean} [props.error] Texto do erro, ou `true` para só marcar inválido.
 * @param {boolean} [props.success]
 * @param {boolean} [props.required] Mostra o `*` e marca `aria-required` no controle.
 * @param {boolean} [props.full]     Ocupa a linha inteira da grade de formulário.
 * @param {string} [props.id]        Id do controle (padrão: gerado).
 * @param {string} [props.className]
 * @param {import("react").ReactNode} [props.children]
 */
export function VFField({
  label,
  hint,
  error,
  success = false,
  required = false,
  full = false,
  id,
  className,
  children,
  ...rest
}) {
  const auto = useId();
  const controlId = id ?? `${auto}campo`;
  const temMensagem = error != null && error !== false && error !== true && error !== "";
  const invalido = temMensagem || error === true;
  const hintId = hint ? `${auto}dica` : undefined;
  const errorId = temMensagem ? `${auto}erro` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  const contexto = useMemo(
    () => ({ id: controlId, describedBy, invalid: invalido, valid: success && !invalido, required }),
    [controlId, describedBy, invalido, success, required],
  );

  return (
    <div
      className={cx(
        "vf-field",
        invalido && "is-error",
        success && !invalido && "is-success",
        full && "vf-field--full",
        className,
      )}
      {...rest}
    >
      {label != null && (
        <label className="vf-field__label" htmlFor={controlId}>
          {label}
          {required && (
            <span className="vf-field__required" aria-hidden="true">
              {" "}*
            </span>
          )}
        </label>
      )}
      <FieldContext.Provider value={contexto}>{children}</FieldContext.Provider>
      {hint && (
        <span id={hintId} className="vf-field__hint">
          {hint}
        </span>
      )}
      {temMensagem && (
        <div className="vf-motion-reveal">
          <div>
            <span id={errorId} className="vf-field__error" role="alert">
              {error}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** @param {unknown} v */
function ariaVerdadeiro(v) {
  return v === true || v === "true";
}

/**
 * Props comuns dos controles: herda do VFField e deixa a prop explícita vencer.
 * @param {string} base  Classe base (`vf-input`, `vf-select`, `vf-textarea`).
 * @param {Record<string, any>} props
 */
function useControle(base, props) {
  const {
    id,
    size,
    invalid,
    valid,
    className,
    "aria-describedby": descricaoPropria,
    "aria-invalid": ariaInvalid,
    "aria-required": ariaRequired,
    ...rest
  } = props;
  const campo = useContext(FieldContext);
  const inv = invalid ?? (ariaInvalid != null ? ariaVerdadeiro(ariaInvalid) : campo?.invalid ?? false);
  const ok = !inv && (valid ?? campo?.valid ?? false);

  return {
    ...rest,
    id: id ?? campo?.id,
    "aria-describedby": [descricaoPropria, campo?.describedBy].filter(Boolean).join(" ") || undefined,
    "aria-invalid": inv || undefined,
    "aria-required": ariaRequired ?? (campo?.required || undefined),
    className: cx(
      base,
      size === "sm" && `${base}--sm`,
      size === "lg" && `${base}--lg`,
      inv && "is-error",
      ok && "is-success",
      className,
    ),
  };
}

/**
 * Campo de texto. Props: `size` (`sm` | `lg`), `invalid`, `valid` + tudo do <input>.
 * @type {import("react").ForwardRefExoticComponent<Record<string, any>>}
 */
export const VFInput = forwardRef(function VFInput(props, ref) {
  return <input ref={ref} {...useControle("vf-input", props)} />;
});

/**
 * Lista de opções. `options=[{ value, label, disabled }]` ou `children`;
 * `placeholder` vira a primeira opção, vazia e não selecionável.
 * @type {import("react").ForwardRefExoticComponent<Record<string, any>>}
 */
export const VFSelect = forwardRef(function VFSelect({ options, placeholder, children, ...props }, ref) {
  return (
    <select ref={ref} {...useControle("vf-select", props)}>
      {placeholder != null && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options
        ? options.map((/** @type {{ value: string | number, label: import("react").ReactNode, disabled?: boolean }} */ o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))
        : children}
    </select>
  );
});

/**
 * Texto longo. Props: `invalid`, `valid` + tudo do <textarea>. Sem `size`.
 * @type {import("react").ForwardRefExoticComponent<Record<string, any>>}
 */
export const VFTextarea = forwardRef(function VFTextarea({ size: _ignorado, ...props }, ref) {
  return <textarea ref={ref} {...useControle("vf-textarea", props)} />;
});
