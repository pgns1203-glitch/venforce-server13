// frontend-react/src/components/cliente360v3/dossie/OportunidadesMesa.jsx
//
// "Dinheiro na mesa", não uma pilha de cards de notificação (§15).
//
// O total recuperável abre o bloco porque é o número que justifica a leitura;
// abaixo dele, uma tabela de causas ordenada por valor. Alertas SEM valor
// estimável ficam num grupo separado, nunca somados ao total — misturar os
// dois transformaria um teto conservador numa promessa.

import { formatarMoeda } from "../../../utils/currency.js";
import { formatarNumero } from "../../../utils/numbers.js";
import { Indisponivel } from "./Primitivos.jsx";

export default function OportunidadesMesa({ oportunidades, linhas, onAbrir }) {
  const { contaveis, alertas } = linhas;
  const total = oportunidades?.totalRecuperavel;

  return (
    <div className="c360d-mesa">
      <div className="c360d-mesa__total">
        <p className="c360d-mesa__rotulo">Potencial recuperável</p>
        <p className="c360d-mesa__valor">{formatarMoeda(total, { casas: 0 })}</p>
        <p className="c360d-fonte">teto conservador · só causas operacionais comprováveis</p>
      </div>

      {contaveis.length === 0 ? (
        <Indisponivel
          compacto
          titulo="Nenhuma oportunidade operacional identificada"
          motivo="Nenhum custo, frete, preço, comissão ou imposto piorou o suficiente para virar valor recuperável neste período."
        />
      ) : (
        <>
        <div className="c360d-mesa__cabecalho" aria-hidden="true">
          <span>Causa</span>
          <span>Impacto</span>
          <span>Itens</span>
          <span>Prior.</span>
        </div>
        <ul className="c360d-mesa__lista">
          {contaveis.map((op) => (
            <li key={op.id}>
              <button type="button" className="c360d-mesa__linha" onClick={() => onAbrir(op)}>
                <span className="c360d-mesa__causa">
                  <span className="c360d-mesa__fator">{op.fator}</span>
                  <span className="c360d-mesa__titulo">{op.titulo}</span>
                </span>
                <span className="c360d-mesa__num">{formatarMoeda(op.recuperavelEstimado, { casas: 0 })}</span>
                <span className="c360d-mesa__itens" title="Produtos envolvidos">
                  {op.itens == null ? "—" : formatarNumero(op.itens)}
                </span>
                <span className={`vf-status is-${op.prioridade.tom}`}>{op.prioridade.label}</span>
              </button>
            </li>
          ))}
        </ul>
        </>
      )}

      {alertas.length > 0 && (
        <div className="c360d-mesa__alertas">
          <p className="c360d-mesa__subtitulo">Sem valor estimável</p>
          {alertas.map((op) => (
            <button key={op.id} type="button" className="c360d-mesa__alerta" onClick={() => onAbrir(op)}>
              <span aria-hidden="true">◆</span>
              <span>{op.titulo}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
