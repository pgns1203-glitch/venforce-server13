// frontend-react/src/components/cliente360v3/dossie/SaudePainel.jsx
//
// Saúde como quatro sinais INDEPENDENTES em quatro linhas — nunca um score
// sintético (a falha de um não pode apagar os outros três) e nunca um painel
// administrativo dentro do dossiê (§21).
//
// O que BLOQUEIA número relevante não fica aqui embaixo: sobe para a faixa de
// bloqueio do topo da página (ver utils/dossie.js :: bloqueiosDeSaude). Este
// painel é a leitura completa, não o alarme.
//
// "Tudo certo" NÃO ganha banner verde. Silêncio é melhor: o estado OK aparece
// como a própria linha, sem celebração.

import { formatarDataHora, rotularCompetenciaCurta } from "../../../utils/dates.js";
import { Indisponivel, Esqueleto } from "./Primitivos.jsx";

function Linha({ rotulo, tom, estado, detalhe, escopo }) {
  return (
    <li className="c360d-saude__linha">
      <span className="c360d-saude__rotulo">{rotulo}</span>
      <span className={`vf-status is-${tom}`}>{estado}</span>
      <span className="c360d-saude__detalhe">{detalhe}</span>
      {/* Escopo só aparece quando NÃO é o escopo do bloco (a conta atual) —
          repetir "account" em toda linha seria ruído. */}
      {escopo && escopo !== "account" && (
        <span className="c360d-saude__escopo" title="Escopo real desta linha">{escopo}</span>
      )}
    </li>
  );
}

function LinhaIndisponivel({ rotulo, envelope }) {
  return (
    <li className="c360d-saude__linha">
      <span className="c360d-saude__rotulo">{rotulo}</span>
      <span className="vf-status is-empty">Indisponível</span>
      <span className="c360d-saude__detalhe">{envelope?.motivo || "Fonte não respondeu."}</span>
    </li>
  );
}

export default function SaudePainel({ saude, carregando, erro }) {
  if (carregando && !saude) return <Esqueleto linhas={4} />;
  if (erro && !saude) {
    return <Indisponivel compacto titulo="Não foi possível consultar a saúde" motivo={erro.mensagem || String(erro)} />;
  }
  if (!saude) {
    return (
      <Indisponivel
        compacto
        titulo="Saúde ainda não consultada"
        motivo="Conexão, base, sincronização e fechamento são buscados depois que o Resultado resolve."
      />
    );
  }

  const grant = saude.grantBase;
  const gb = grant?.disponivel ? grant.dados : null;
  const sync = saude.sync;
  const ultimaExecucao = sync?.disponivel ? sync.dados?.ultimasExecucoes?.[0] : null;
  const entrega = saude.entrega;
  const ultimaEntrega = entrega?.disponivel ? entrega.dados?.ultimaEntrega : null;

  return (
    <ul className="c360d-saude">
      {gb ? (
        <>
          <Linha
            rotulo="Conexão"
            tom={gb.grantConectado ? "success" : "danger"}
            estado={gb.grantConectado ? "Conectada" : "Desconectada"}
            detalhe={gb.grantConectado ? "Grant do Mercado Livre válido" : `Grant: ${gb.grantStatus || "sem conexão"}`}
            escopo={grant.escopo}
          />
          <Linha
            rotulo="Base de custo"
            tom={gb.baseVinculada ? "success" : "warning"}
            estado={gb.baseVinculada ? "Vinculada" : "Sem base"}
            detalhe={gb.baseVinculada ? gb.baseSlug : "Custo e margem por produto não são apurados"}
            escopo={grant.escopo}
          />
        </>
      ) : (
        <LinhaIndisponivel rotulo="Conexão e base" envelope={grant} />
      )}

      {sync?.disponivel ? (
        <Linha
          rotulo="Sincronização"
          tom={!ultimaExecucao ? "empty" : ultimaExecucao.status === "ok" || ultimaExecucao.status === "completed" ? "success" : "warning"}
          estado={!ultimaExecucao ? "Sem execução" : ultimaExecucao.status === "ok" || ultimaExecucao.status === "completed" ? "Em dia" : "Atenção"}
          detalhe={
            ultimaExecucao
              ? `Última: ${formatarDataHora(ultimaExecucao.started_at || ultimaExecucao.created_at || ultimaExecucao.executadoEm)}`
              : "Nenhuma execução registrada para esta conta"
          }
          escopo={sync.escopo}
        />
      ) : (
        <LinhaIndisponivel rotulo="Sincronização" envelope={sync} />
      )}

      {entrega?.disponivel ? (
        <Linha
          rotulo="Fechamento"
          tom={ultimaEntrega ? "success" : "empty"}
          estado={ultimaEntrega ? "Publicado" : "Sem entrega"}
          detalhe={
            ultimaEntrega
              ? `Última entrega · ${rotularCompetenciaCurta(ultimaEntrega.periodo)}`
              : "Nenhuma entrega de fechamento registrada"
          }
          escopo={entrega.dados?.escopoEntrega || entrega.escopo}
        />
      ) : (
        <LinhaIndisponivel rotulo="Fechamento" envelope={entrega} />
      )}
    </ul>
  );
}
