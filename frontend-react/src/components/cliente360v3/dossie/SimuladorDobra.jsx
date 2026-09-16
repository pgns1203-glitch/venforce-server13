// frontend-react/src/components/cliente360v3/dossie/SimuladorDobra.jsx
//
// O Simulador é FERRAMENTA, não seção dominante (§16): fechado por padrão,
// ocupando uma linha — o que ele é, quais cenários existem, e um botão.
//
// Aberto, vira painel expansível de largura total, claramente secundário
// (fundo rebaixado, faixa própria), em vez de drawer: a tabela do simulador
// tem oito colunas com campos de entrada e não caberia em 560px sem virar
// scroll horizontal — o pior lugar para digitar número.
//
// O componente de dentro é o SimuladorResultado da V2, reaproveitado inteiro:
// a matemática roda no servidor (mesmo motor puro da ponte) e não há nada a
// redesenhar na lógica. O que muda aqui é o enquadramento.

import SimuladorResultado from "../../cliente360/SimuladorResultado.jsx";

export default function SimuladorDobra({ simulacao, slug, competencia, marketplace, clienteContaId, aberto, onAlternar }) {
  if (!simulacao) return null;

  const cenarios = (simulacao.cenariosRapidos || [])
    .filter((c) => c.chave !== "limpar")
    .map((c) => c.label)
    .join(" · ");

  return (
    <div className={`c360d-sim${aberto ? " is-aberto" : ""}`}>
      <div className="c360d-sim__chamada">
        <div className="c360d-sim__texto">
          <p className="c360d-sim__titulo">Simular recuperação</p>
          <p className="c360d-sim__cenarios">
            {cenarios || "Ajuste preço, custo e frete por produto"} — recalculado no servidor, sem alterar nada.
          </p>
        </div>
        <button
          type="button"
          className="vf-btn vf-btn--secondary vf-btn--sm"
          aria-expanded={aberto}
          aria-controls="c360d-sim-painel"
          onClick={onAlternar}
        >
          {aberto ? "Fechar simulador" : "Abrir simulador"}
        </button>
      </div>

      {aberto && (
        <div className="c360d-sim__painel" id="c360d-sim-painel">
          <SimuladorResultado
            simulacao={simulacao}
            slug={slug}
            competencia={competencia}
            marketplace={marketplace}
            clienteContaId={clienteContaId}
          />
        </div>
      )}
    </div>
  );
}
