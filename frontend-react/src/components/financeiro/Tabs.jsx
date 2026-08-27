// frontend-react/src/components/financeiro/Tabs.jsx
// Abas simples sobre o padrão vf-tabs/vf-tab já usado em fechamentos-api.html
// — nenhum componente novo no design system, só a marcação React de um
// padrão que já existe.

export function Tabs({ abas, ativa, onChange }) {
  return (
    <nav className="vf-tabs" role="tablist" aria-label="Seções do Financeiro">
      {abas.map((aba) => (
        <button
          key={aba.id}
          type="button"
          className={`vf-tab${aba.id === ativa ? " is-active" : ""}`}
          role="tab"
          aria-selected={aba.id === ativa}
          tabIndex={aba.id === ativa ? 0 : -1}
          onClick={() => onChange(aba.id)}
        >
          {aba.label}
        </button>
      ))}
    </nav>
  );
}
