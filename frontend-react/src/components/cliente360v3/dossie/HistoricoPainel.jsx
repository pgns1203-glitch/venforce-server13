// frontend-react/src/components/cliente360v3/dossie/HistoricoPainel.jsx
//
// Histórico tabular compacto (Data · Tipo · Origem · Responsável · Evento).
// Vazio custa UMA linha, não uma dobra (§22) — a versão anterior gastava meia
// tela para dizer "nada aqui".
//
// Cada evento carrega o escopo REAL da linha: entregas criadas depois da
// Fundação de Contas nascem `account`; as anteriores continuam `client_legacy`
// e são rotuladas em vez de escondidas ou reclassificadas.

import { formatarDataHora, rotularCompetenciaCurta } from "../../../utils/dates.js";
import TabelaDensa from "./TabelaDensa.jsx";
import { Indisponivel, Esqueleto } from "./Primitivos.jsx";

const TIPO = {
  entrega: "Entrega",
  sincronizacao: "Sincronização",
  acao: "Ação",
  acao_consultor: "Ação",
};

// Responsável costuma ser um e-mail corporativo: o domínio é sempre o mesmo e
// só rouba largura. Mostra a parte local; o e-mail inteiro fica no `title`.
// Nem toda fonte resolve pra e-mail: entregas_cliente.created_by é o INTEGER
// (FK de users.id) cru, nunca um e-mail — só cliente_360_acoes.autor é TEXT.
// Sem o guard de tipo, um `ator` numérico quebrava `.includes` no render.
function curtoAtor(ator) {
  if (!ator) return "sistema";
  if (typeof ator !== "string") return String(ator);
  return ator.includes("@") ? ator.split("@")[0] : ator;
}

const COLUNAS = [
  { key: "data", header: "Quando", width: "19%", render: (e) => formatarDataHora(e.timestamp) },
  { key: "tipo", header: "Tipo", width: "16%", render: (e) => TIPO[e.tipo] || e.tipo },
  {
    key: "evento", header: "Evento", width: "43%", cabecalhoDeLinha: true,
    render: (e) => (
      <span className="c360d-hist__titulo" title={e.titulo}>
        {e.titulo}
        {e.competencia && <span className="c360d-hist__comp"> · {rotularCompetenciaCurta(e.competencia)}</span>}
      </span>
    ),
  },
  {
    // O escopo entra aqui, ao lado de quem fez — é informação de PROPRIEDADE do
    // registro. E só aparece quando FOGE do escopo da tela (registro do cliente
    // inteiro, anterior à separação por conta): uma coluna repetindo "conta" em
    // toda linha seria ruído.
    key: "ator", header: "Responsável", width: "22%",
    render: (e) => (
      <span className="c360d-fraco c360d-truncar" title={e.ator || "sistema"}>
        {curtoAtor(e.ator)}
        {e.escopo === "client_legacy" && (
          <span className="c360d-escopo is-legado" title="Registro do CLIENTE inteiro — anterior à separação por conta">
            {" "}· cliente
          </span>
        )}
      </span>
    ),
  },
];

export default function HistoricoPainel({ historico, carregando, erro, onAbrirEvento }) {
  if (carregando && !historico) return <Esqueleto linhas={3} />;
  if (erro && !historico) {
    return <Indisponivel compacto titulo="Não foi possível consultar o histórico" motivo={erro.mensagem || String(erro)} />;
  }
  if (!historico) {
    return <Indisponivel compacto titulo="Histórico ainda não consultado" motivo="Entregas, sincronizações e ações são buscadas depois que o Resultado resolve." />;
  }

  const eventos = historico.eventos || [];
  const indisponiveis = Object.entries(historico.fontes || {}).filter(([, f]) => !f.disponivel);

  if (eventos.length === 0) {
    return (
      <p className="c360d-hist__vazio">
        Nenhum evento registrado nesta operação ainda — entregas, sincronizações e ações aparecem aqui
        conforme acontecem.
      </p>
    );
  }

  return (
    <div className="c360d-hist">
      {indisponiveis.length > 0 && (
        <p className="c360d-hist__fonte-falha">
          <span aria-hidden="true">◆</span>{" "}
          {indisponiveis.length === 1
            ? `Fonte "${indisponiveis[0][0]}" indisponível: ${indisponiveis[0][1].motivo || "não respondeu"}.`
            : `${indisponiveis.length} fontes do histórico indisponíveis agora.`}{" "}
          As demais continuam listadas.
        </p>
      )}
      <TabelaDensa
        legenda="Eventos da operação"
        colunas={COLUNAS}
        linhas={eventos.slice(0, 6)}
        chave={(e, i) => `${e.tipo}-${e.timestamp}-${i}`}
        onSelecionar={onAbrirEvento}
      />
      {eventos.length > 6 && (
        <p className="c360d-fraco">Mostrando os 6 eventos mais recentes de {eventos.length}.</p>
      )}
    </div>
  );
}
