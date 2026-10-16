// Camada React de componentes primitivos globais.
//
// Todo componente aqui usa só tokens da Fundação Global V2
// (Portal/css/vf-tokens-v2.css) — nenhum token novo, nenhuma cor/raio/espaço
// inventado. A maioria (ex.: VFButton) é um wrapper fino sobre classes que já
// existem em Portal/css/vf-components-v2.css. Quando o padrão visual ainda
// não existe na Fundação (ex.: VFMonthYearSelector), o componente traz seu
// próprio CSS, sempre construído só com var(--vf-*).
//
// Movimento: regras em docs/specs/2026-10-16-ui-etapa1-componentes-plano.md §1.

export { VFBanner } from "./VFBanner/index.js";
export { VFButton, useFeedbackOk } from "./VFButton/index.js";
export { VFEmpty, VFError, VFLoading, VFSkeleton } from "./VFEstados/index.js";
export { VFField, VFInput, VFSelect, VFTextarea } from "./VFField/index.js";
export { VFMonthYearSelector } from "./VFMonthYearSelector/index.js";
export { VFStatus, VFTag, VFBadge } from "./VFStatus/index.js";
