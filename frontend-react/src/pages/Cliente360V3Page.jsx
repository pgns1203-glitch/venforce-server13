// frontend-react/src/pages/Cliente360V3Page.jsx
//
// Cliente 360 V3 — Dossiê Operacional, sobre o Shell V3 (vf-context/vf-shell).
// Nasce de Cliente+Operação escolhidos no Shell; nunca tem seletor próprio de
// cliente ou de conta.
//
// Esta página é FINA de propósito: ela resolve contexto, dispara os hooks de
// rede e entrega dados prontos ao corpo do Dossiê
// (components/cliente360v3/dossie/DossieCorpo.jsx), que é o mesmo componente
// que o preview (?preview=1) renderiza com fixture. Antes do redesenho, a
// página e o preview montavam a mesma árvore de seções duas vezes, em dois
// arquivos — toda mudança visual precisava ser feita nos dois, e no dia em que
// não fosse o preview validaria uma tela que não existe.
//
// Contratos preservados desta versão para a anterior (nenhum foi afrouxado):
//   · sem seletor de cliente/conta — só competência;
//   · Motor de Margem continua LAZY (só depois que o usuário pede);
//   · Ads/Saúde/Histórico continuam lazy e só quando há Resultado;
//   · troca de contexto (contextKey) fecha qualquer drawer aberto;
//   · resultado indisponível e competência sem fechamento não derrubam a tela.

import { useEffect, useState } from "react";
import { useOperacaoAtual } from "../hooks/useVfContext.js";
import { useCliente360V3 } from "../hooks/useCliente360V3.js";
import { useProdutosMargem } from "../hooks/useProdutosMargem.js";
import { useSaudeAdsV3 } from "../hooks/useSaudeAdsV3.js";
import { useHistoricoV3 } from "../hooks/useHistoricoV3.js";
import { competenciasRecentes } from "../utils/dates.js";
import ErrorState from "../components/cliente360/ErrorState.jsx";
import DossieCorpo from "../components/cliente360v3/dossie/DossieCorpo.jsx";

const PERIODOS = competenciasRecentes(13);

// MLBs já visíveis nos blocos do bootstrap — nunca uma varredura de catálogo,
// nunca uma chamada HTTP por produto.
function mlbsVisiveis(produtos) {
  const set = new Set();
  for (const lista of [produtos?.ajudaram, produtos?.prejudicaram, produtos?.noVermelho, produtos?.abaixoDaMargem]) {
    for (const p of lista || []) set.add(p.mlb);
  }
  return [...set];
}

export default function Cliente360V3Page() {
  const { pronta, clienteId, clienteSlug, clienteContaId, marketplace } = useOperacaoAtual();
  const { periodo, setPeriodo, boot, carregando, erro } = useCliente360V3({
    clienteId, clienteSlug, clienteContaId, pronta,
  });

  // O Motor de Margem é caro e account-sensível: só roda quando o usuário
  // abre o modo Margem (na tabela de Produtos ou no painel de Margem).
  const [margemPedida, setMargemPedida] = useState(false);

  const resultado = boot?.resultado;
  const dados = resultado?.disponivel ? resultado.dados : null;
  const semFechamento = dados?.estado?.chave === "sem_fechamento";
  const mlbs = dados ? mlbsVisiveis(dados.produtos) : [];

  const margem = useProdutosMargem({
    clienteSlug,
    clienteContaId,
    periodo: dados?.periodo?.competencia,
    mlbs,
    habilitado: margemPedida && !semFechamento,
  });

  const saudeAds = useSaudeAdsV3({
    clienteSlug,
    clienteContaId,
    periodo: dados?.periodo?.competencia,
    habilitado: !!dados && !semFechamento,
  });

  const historico = useHistoricoV3({
    clienteSlug,
    clienteContaId,
    habilitado: !!dados && !semFechamento,
  });

  // Trocar de conta/competência invalida a consulta de margem anterior: ela é
  // de OUTRA operação. Recomeça fechada, como na primeira carga.
  useEffect(() => {
    setMargemPedida(false);
  }, [boot?.contexto?.contextKey]);

  // Contexto incompleto: o Shell (data-vf-scope="account") já esconde o main e
  // mostra o próprio painel de estado — não há nada a renderizar aqui.
  if (!pronta) return null;

  if (erro && !boot) return <ErrorState erro={erro} />;

  return (
    <DossieCorpo
      // `key` pelo contextKey: trocar de operação/competência remonta o corpo,
      // o que zera modo, ordenação e drawer aberto — nunca se vê um drawer de
      // produto da operação anterior sobre os números da nova.
      key={boot?.contexto?.contextKey || "sem-contexto"}
      dados={dados}
      // O Shell resolve cliente e marketplace antes de qualquer requisição: o
      // header identifica a operação mesmo quando o resultado falha.
      contexto={{ slug: clienteSlug, marketplace }}
      resultadoIndisponivel={resultado && !resultado.disponivel ? resultado.motivo : null}
      carregando={carregando}
      periodos={PERIODOS}
      periodoSelecionado={periodo}
      onTrocarPeriodo={setPeriodo}
      margem={margem}
      onPedirMargem={() => setMargemPedida(true)}
      saudeAds={saudeAds}
      historico={historico}
      clienteSlug={clienteSlug}
      clienteContaId={clienteContaId}
      slugParaConsulta={clienteSlug}
    />
  );
}
