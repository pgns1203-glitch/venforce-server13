const STATUS_OPCOES = [
  ["RUPTURA", "Ruptura"],
  ["CRITICO", "Crítico"],
  ["REPOR", "Repor"],
  ["SAUDAVEL", "Saudável"],
  ["ALTO", "Alto"],
  ["EXCESSO", "Excesso"],
  ["SEM_GIRO", "Sem giro"],
  ["SEM_DADO", "Sem dado"],
];

// Filtros puramente locais: nunca disparam requisição, so recalculam a
// lista já carregada (ver utils/fullSummary.js).
export default function FullFilters({ filtros, onAtualizar }) {
  return (
    <div className="full-filters">
      <input
        type="search"
        className="vf-input"
        placeholder="Buscar por MLB, SKU ou título"
        value={filtros.search}
        onChange={(e) => onAtualizar({ search: e.target.value })}
        aria-label="Buscar inventário"
      />

      <select
        className="vf-select"
        value={filtros.status}
        onChange={(e) => onAtualizar({ status: e.target.value })}
        aria-label="Filtrar por status operacional"
      >
        <option value="">Todos os status</option>
        {STATUS_OPCOES.map(([valor, rotulo]) => (
          <option key={valor} value={valor}>
            {rotulo}
          </option>
        ))}
      </select>

      <label className="full-filters-checkbox">
        <input
          type="checkbox"
          checked={filtros.somenteComDemanda}
          onChange={(e) => onAtualizar({ somenteComDemanda: e.target.checked })}
        />
        Somente com demanda
      </label>
    </div>
  );
}
