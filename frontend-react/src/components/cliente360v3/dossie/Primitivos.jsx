// frontend-react/src/components/cliente360v3/dossie/Primitivos.jsx
//
// Peças pequenas e repetidas do Dossiê. Ficam juntas de propósito: são
// decisões de LEITURA (como um delta se anuncia, como uma seção se apresenta,
// como uma fonte de dado é declarada) e precisam ser idênticas em toda a
// página — separadas em seis arquivos elas divergem.

import { ehAusente, AUSENTE } from "../../../utils/numbers.js";

// ── Seção ───────────────────────────────────────────────────────────────────
// UM nível de container, nunca card dentro de card (§6). A hierarquia é
// tipografia + régua de 1px + alinhamento. `id` + tabIndex=-1 porque a subnav
// move o foco para cá ao navegar por teclado.
export function Secao({ id, titulo, meta, acoes, densa = false, children, className = "" }) {
  return (
    <section
      id={id}
      tabIndex={-1}
      className={`c360d-secao${densa ? " c360d-secao--densa" : ""} ${className}`.trim()}
      aria-labelledby={id ? `${id}-titulo` : undefined}
    >
      <div className="c360d-secao__topo">
        <h2 className="c360d-secao__titulo" id={id ? `${id}-titulo` : undefined}>
          {titulo}
        </h2>
        {meta && <p className="c360d-secao__meta">{meta}</p>}
        {acoes && <div className="c360d-secao__acoes">{acoes}</div>}
      </div>
      {children}
    </section>
  );
}

// ── Delta ───────────────────────────────────────────────────────────────────
// Direção NUNCA depende só de cor (§28): símbolo (▲ ▼ =) + sinal no número +
// cor, nessa ordem de importância. `inverso` cobre métricas em que subir é
// ruim (cancelamentos, custo).
export function Delta({ valor, texto, inverso = false, neutro = false, titulo }) {
  if (ehAusente(valor) || texto === AUSENTE || texto == null) {
    return <span className="c360d-delta is-ausente" title={titulo}>{AUSENTE}</span>;
  }
  const n = Number(valor);
  const bom = inverso ? n < 0 : n > 0;
  // `neutro` para métricas em que subir não é bom nem ruim por si (gasto de
  // Ads, por exemplo): mostra direção e magnitude sem emitir julgamento que o
  // dado não sustenta.
  const tom = neutro ? "neutro" : n === 0 ? "neutro" : bom ? "positivo" : "negativo";
  const simbolo = n === 0 ? "=" : n > 0 ? "▲" : "▼";
  return (
    <span className={`c360d-delta is-${tom}`} title={titulo}>
      <span className="c360d-delta__simbolo" aria-hidden="true">{simbolo}</span>
      {texto}
    </span>
  );
}

// ── Indicador da faixa executiva ────────────────────────────────────────────
export function Indicador({ rotulo, valor, delta, nota, forte = false, ausente = false }) {
  return (
    <div className={`c360d-ind${forte ? " c360d-ind--forte" : ""}${ausente ? " c360d-ind--ausente" : ""}`}>
      <p className="c360d-ind__rotulo">{rotulo}</p>
      <p className="c360d-ind__valor">{valor}</p>
      <p className="c360d-ind__delta">{delta || (nota ? <span className="c360d-ind__nota">{nota}</span> : null)}</p>
    </div>
  );
}

// ── Fonte / escopo ──────────────────────────────────────────────────────────
// §20: a origem fica no CABEÇALHO do bloco homogêneo, não repetida embaixo de
// cada número. Só quando uma métrica foge da fonte do bloco é que ela se
// declara inline.
export function Fonte({ children }) {
  return <span className="c360d-fonte">{children}</span>;
}

// ── Estado indisponível ─────────────────────────────────────────────────────
// Ausência nunca é "—" mudo nem 0: diz o que falta, por quê e, quando existe,
// o que dá para fazer (§26).
export function Indisponivel({ titulo, motivo, acao, compacto = false, moldura = false, linha = false }) {
  return (
    <div className={`c360d-indisponivel${compacto ? " is-compacto" : ""}${moldura ? " is-moldura" : ""}${linha ? " is-linha" : ""}`}>
      <p className="c360d-indisponivel__titulo">
        <span className="c360d-indisponivel__marca" aria-hidden="true">○</span>
        {titulo}
      </p>
      {motivo && <p className="c360d-indisponivel__motivo">{motivo}</p>}
      {acao}
    </div>
  );
}

// ── Skeleton de bloco ───────────────────────────────────────────────────────
// Skeleton com a FORMA do conteúdo que vai chegar (§25) — não um spinner no
// meio do nada: a página não pula de layout quando o dado entra.
export function Esqueleto({ linhas = 3, altura = 14 }) {
  return (
    <div className="c360d-esqueleto" role="status" aria-live="polite">
      <span className="vf-visually-hidden">Carregando…</span>
      {Array.from({ length: linhas }, (_, i) => (
        <span key={i} className="vf-skeleton c360d-esqueleto__linha" style={{ height: altura }} />
      ))}
    </div>
  );
}

// ── Barra de proporção ──────────────────────────────────────────────────────
// Microvisualização de participação dentro da célula. Decorativa para leitor
// de tela (o número ao lado já é o dado) — daí o aria-hidden.
export function Proporcao({ fracao }) {
  if (ehAusente(fracao)) return null;
  const largura = Math.max(1, Math.min(100, fracao * 100));
  return (
    <span className="c360d-proporcao" aria-hidden="true">
      <span className="c360d-proporcao__preenchimento" style={{ width: `${largura}%` }} />
    </span>
  );
}
