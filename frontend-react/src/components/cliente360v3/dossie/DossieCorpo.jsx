// frontend-react/src/components/cliente360v3/dossie/DossieCorpo.jsx
//
// O Dossiê inteiro, em função de DADOS — sem hooks de rede, sem contexto de
// Shell, sem saber se veio do bootstrap real ou de uma fixture.
//
// Por que isso importa: antes desta unidade, a página real
// (Cliente360V3Page.jsx) e o preview (dev/Cliente360V3PreviewPage.jsx)
// reconstruíam a MESMA árvore de seções, lado a lado, em dois arquivos — o
// próprio preview documentava esse risco em comentário. Qualquer mudança
// visual precisava ser feita duas vezes e, no dia em que não fosse, o preview
// passaria a validar uma tela que não existe. Agora existe UM corpo; a página
// real entrega os hooks, o preview entrega a fixture.
//
// Ordem das seções = a história que o brief pede (§7):
//   o que aconteceu → por que → quais produtos → onde está o dinheiro →
//   qual foi o papel de Ads e da margem → posso confiar → o que está travado.
// A Confiança resumida sobe para o lado de "Mudanças" porque é ali que ela
// muda uma decisão: saber se a explicação do mês é confiável enquanto se lê a
// explicação, não três dobras depois.

import { useMemo, useState } from "react";
import { formatarMoedaCurta } from "../../../utils/currency.js";
import {
  linhasProdutos, aplicarModo, tendenciaPorMlb, linhasOportunidades,
  resumoMargem, bloqueiosDeSaude,
} from "../../../utils/dossie.js";
import { useScrollSpy } from "../../../hooks/useScrollSpy.js";

import DossieHeader from "./DossieHeader.jsx";
import DossieSubnav from "./DossieSubnav.jsx";
import FaixaBloqueio from "./FaixaBloqueio.jsx";
import FaixaExecutiva from "./FaixaExecutiva.jsx";
import PonteWaterfall from "./PonteWaterfall.jsx";
import ConfiancaPainel from "./ConfiancaPainel.jsx";
import ProdutosCentral from "./ProdutosCentral.jsx";
import OportunidadesMesa from "./OportunidadesMesa.jsx";
import SimuladorDobra from "./SimuladorDobra.jsx";
import AdsPainel from "./AdsPainel.jsx";
import MargemPainel from "./MargemPainel.jsx";
import SaudePainel from "./SaudePainel.jsx";
import HistoricoPainel from "./HistoricoPainel.jsx";
import AcoesPainel from "./AcoesPainel.jsx";
import { Secao, Indisponivel, Esqueleto } from "./Primitivos.jsx";
import {
  DrawerProduto, DrawerFator, DrawerOportunidade, DrawerConfianca,
  DrawerComparacao, DrawerProdutosTodos, DrawerConfiguracao, DrawerEvento,
} from "./Drawers.jsx";

// Header (52) + subnav (41) + folga. É o quanto o scroll precisa descontar
// para uma seção parar ABAIXO das barras, não atrás delas.
const OFFSET_STICKY = 104;

// Esqueleto com a FORMA do que vai chegar (§25/§26): seis colunas na faixa
// executiva, duas colunas 8/4 nas duas faixas seguintes. Quando o dado entra,
// nada salta de lugar.
function DossieEsqueleto() {
  return (
    <div className="c360d-corpo" aria-busy="true">
      <div className="c360d-faixa">
        <div className="c360d-faixa__meta">
          <span className="vf-skeleton c360d-header__esqueleto" style={{ width: 260, height: 9 }} />
          <span className="vf-skeleton c360d-header__esqueleto" style={{ width: 120, height: 9 }} />
        </div>
        <div className="c360d-faixa__grade">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="c360d-ind">
              <span className="vf-skeleton c360d-header__esqueleto" style={{ width: "70%", height: 9, marginBottom: 6 }} />
              <span className="vf-skeleton c360d-header__esqueleto" style={{ width: "85%", height: 20 }} />
            </div>
          ))}
        </div>
      </div>
      <div className="c360d-linha c360d-linha--8-4">
        <div className="c360d-secao"><Esqueleto linhas={5} altura={22} /></div>
        <div className="c360d-secao"><Esqueleto linhas={5} altura={14} /></div>
      </div>
      <div className="c360d-linha c360d-linha--8-4">
        <div className="c360d-secao"><Esqueleto linhas={7} altura={18} /></div>
        <div className="c360d-secao"><Esqueleto linhas={4} altura={18} /></div>
      </div>
    </div>
  );
}

export default function DossieCorpo({
  dados,
  // Identidade da operação vinda do Shell — existe mesmo quando o resultado
  // não existe. Sem ela, um envelope indisponível deixaria o header órfão.
  contexto,
  resultadoIndisponivel,
  carregando = false,
  periodos,
  periodoSelecionado,
  onTrocarPeriodo,
  margem,
  onPedirMargem,
  saudeAds,
  historico,
  clienteSlug,
  clienteContaId,
  slugParaConsulta,
}) {
  const [modoProdutos, setModoProdutos] = useState("impacto");
  const [ordenacao, setOrdenacao] = useState(null);
  const [drawer, setDrawer] = useState(null);
  const [simuladorAberto, setSimuladorAberto] = useState(false);

  const semFechamento = dados?.estado?.chave === "sem_fechamento";
  const temDossie = !!dados && !semFechamento;

  const produtos = useMemo(() => (temDossie ? linhasProdutos(dados) : []), [dados, temDossie]);
  const produtosDoModo = useMemo(
    () => aplicarModo(produtos, modoProdutos, ordenacao),
    [produtos, modoProdutos, ordenacao]
  );
  const tendencias = useMemo(() => (temDossie ? tendenciaPorMlb(dados.ponte) : new Map()), [dados, temDossie]);
  const oportunidades = useMemo(
    () => (temDossie ? linhasOportunidades(dados.oportunidades) : { contaveis: [], alertas: [] }),
    [dados, temDossie]
  );
  const margemResumo = useMemo(() => resumoMargem(margem?.dados), [margem?.dados]);
  const bloqueios = useMemo(() => bloqueiosDeSaude(saudeAds?.saude), [saudeAds?.saude]);

  const problemas = produtos.filter((p) => p.status.chave === "vermelho" || p.status.chave === "abaixo").length;

  const secoes = useMemo(() => {
    if (!temDossie) return [];
    const lista = [
      { id: "resultado", label: "Resultado" },
      { id: "mudancas", label: "Mudanças" },
      {
        // Sem o percentual aqui: o header sticky já mostra "Confiança 98%" e as
        // duas barras aparecem sempre juntas — seria o mesmo número duas vezes
        // na mesma dobra. Só o marcador de alerta é novo.
        id: "confianca",
        label: "Confiança",
        contexto: dados.confianca?.nivel && dados.confianca.nivel !== "confiavel" ? "◆" : null,
        alerta: dados.confianca?.nivel && dados.confianca.nivel !== "confiavel",
      },
      {
        id: "produtos",
        label: "Produtos",
        contexto: produtos.length ? `${produtos.length}${problemas ? ` · ◆${problemas}` : ""}` : null,
        alerta: problemas > 0,
      },
      {
        id: "oportunidades",
        label: "Oportunidades",
        contexto: dados.oportunidades?.totalRecuperavel
          ? formatarMoedaCurta(dados.oportunidades.totalRecuperavel)
          : null,
      },
      { id: "ads", label: "Ads" },
      { id: "margem", label: "Margem" },
      { id: "saude", label: "Saúde" },
      { id: "historico", label: "Histórico" },
      { id: "acoes", label: "Ações" },
    ];
    return lista;
  }, [temDossie, dados, produtos.length, problemas]);

  const { ativa, irPara } = useScrollSpy(secoes.map((s) => s.id), { offset: OFFSET_STICKY });

  function ordenarPor(campo) {
    setOrdenacao((atual) => {
      if (atual?.campo === campo) return { campo, dir: atual.dir === "desc" ? "asc" : "desc" };
      return { campo, dir: "desc" };
    });
  }

  function trocarModo(modo) {
    setModoProdutos(modo);
    setOrdenacao(null); // cada modo tem a ordem que faz sentido para ele
    if (modo === "margem") onPedirMargem?.();
  }

  const abrir = (tipo, payload) => setDrawer({ tipo, payload });
  const fechar = () => setDrawer(null);

  const abrirProduto = (linha) => abrir("produto", linha);
  const margemPorMlb = margem?.dados?.aplicavel ? margem.dados.porMlb : null;

  return (
    <div className="c360d" data-vf-density="compact">
      <DossieHeader
        cliente={dados?.cliente}
        contexto={contexto}
        periodo={dados?.periodo}
        comparacao={dados?.comparacao}
        confianca={dados?.confianca}
        estado={dados?.estado}
        periodos={periodos}
        periodoSelecionado={periodoSelecionado}
        onTrocarPeriodo={onTrocarPeriodo}
        onConfigurar={() => abrir("configuracao")}
      />

      <DossieSubnav secoes={secoes} ativa={ativa} onIr={irPara} />

      <div className={`c360d-corpo${carregando && dados ? " is-atualizando" : ""}`}>
        <FaixaBloqueio estado={dados?.estado} bloqueios={bloqueios} clienteSlug={clienteSlug} />

        {carregando && !dados && !resultadoIndisponivel && <DossieEsqueleto />}

        {resultadoIndisponivel && (
          <Indisponivel
            moldura
            titulo="Resultado indisponível"
            motivo={resultadoIndisponivel}
          />
        )}

        {dados && semFechamento && (
          <Indisponivel
            moldura
            titulo="Nada apurado nesta competência"
            motivo="Sem fechamento sincronizado não há resultado, produtos nem oportunidades para mostrar — a tela prefere ficar vazia a exibir zero."
          />
        )}

        {temDossie && (
          <>
            <FaixaExecutiva
              fechamento={dados.fechamento}
              periodo={dados.periodo}
              comparacao={dados.comparacao}
              onAbrirComparacao={() => abrir("comparacao")}
            />

            <div className="c360d-linha c360d-linha--8-4">
              <Secao
                id="mudancas"
                titulo="Por que o resultado mudou"
                meta="Cada fator que moveu o resultado — clique numa barra para ver os produtos."
                acoes={
                  dados.ponte && !dados.ponte.fecha ? (
                    <span className="vf-status is-warning">Não fecha</span>
                  ) : null
                }
              >
                <PonteWaterfall
                  ponte={dados.ponte}
                  periodo={dados.periodo}
                  comparacao={dados.comparacao}
                  confianca={dados.confianca}
                  narrativa={dados.narrativa}
                  onAbrirFator={(fator) => abrir("fator", fator)}
                />
              </Secao>

              <Secao id="confianca" titulo="Posso confiar?">
                <ConfiancaPainel
                  confianca={dados.confianca}
                  onAbrirEvidencias={() => abrir("confianca")}
                />
              </Secao>
            </div>

            <div className="c360d-linha c360d-linha--8-4">
              <Secao
                id="produtos"
                titulo="Produtos"
                meta="Uma linha por produto — os modos reordenam e filtram a mesma tabela."
              >
                <ProdutosCentral
                  linhas={produtosDoModo}
                  linhasTotais={produtos}
                  modo={modoProdutos}
                  onTrocarModo={trocarModo}
                  ordenacao={ordenacao}
                  onOrdenar={ordenarPor}
                  onAbrirProduto={abrirProduto}
                  produtoAberto={drawer?.tipo === "produto" ? drawer.payload.mlb : null}
                  margem={margem}
                  totais={dados.produtos?.totais}
                  margemAlvo={dados.thresholds?.margemAlvo}
                  onVerTodos={() => abrir("produtosTodos")}
                />
              </Secao>

              <Secao id="oportunidades" titulo="Dinheiro na mesa">
                <OportunidadesMesa
                  oportunidades={dados.oportunidades}
                  linhas={oportunidades}
                  onAbrir={(op) => abrir("oportunidade", op)}
                />
              </Secao>
            </div>

            {dados.simulacao && (
              <SimuladorDobra
                simulacao={dados.simulacao}
                slug={slugParaConsulta}
                competencia={dados.periodo?.competencia}
                marketplace={dados.periodo?.marketplace}
                clienteContaId={clienteContaId}
                aberto={simuladorAberto}
                onAlternar={() => setSimuladorAberto((v) => !v)}
              />
            )}

            <div className="c360d-linha c360d-linha--6-6">
              <Secao id="ads" titulo="Ads" meta="Mídia desta conta — nunca somada a outra conta do mesmo cliente.">
                <AdsPainel
                  adsConta={saudeAds?.ads}
                  adsFechamento={dados.ads}
                  carregando={saudeAds?.carregando}
                  erro={saudeAds?.erro}
                  fechamento={dados.fechamento}
                />
              </Secao>

              <Secao id="margem" titulo="Margem" meta="Resumo por status. O item a item vive na tabela de Produtos.">
                <MargemPainel
                  margem={margem}
                  resumo={margemResumo}
                  margemOperacional={dados.fechamento?.atual?.margemOperacional}
                  onConsultar={() => { onPedirMargem?.(); trocarModo("margem"); }}
                  onVerNaTabela={() => { trocarModo("margem"); irPara("produtos"); }}
                />
              </Secao>
            </div>

            <div className="c360d-linha c360d-linha--4-8">
              <Secao id="saude" titulo="Saúde da operação">
                <SaudePainel
                  saude={saudeAds?.saude}
                  carregando={saudeAds?.carregando}
                  erro={saudeAds?.erro}
                />
              </Secao>

              <Secao id="historico" titulo="Histórico">
                <HistoricoPainel
                  historico={historico?.dados}
                  carregando={historico?.carregando}
                  erro={historico?.erro}
                  onAbrirEvento={(evento) => abrir("evento", evento)}
                />
              </Secao>
            </div>

            <Secao id="acoes" titulo="Ações e intervenções">
              <AcoesPainel slug={slugParaConsulta} marketplace={dados.periodo?.marketplace} />
            </Secao>
          </>
        )}
      </div>

      {drawer?.tipo === "produto" && (
        <DrawerProduto
          produto={drawer.payload}
          margemInfo={margemPorMlb?.[drawer.payload.mlb] || null}
          tendencia={tendencias.get(drawer.payload.mlb) || null}
          clienteSlug={clienteSlug}
          onFechar={fechar}
        />
      )}
      {drawer?.tipo === "fator" && <DrawerFator fator={drawer.payload} onFechar={fechar} />}
      {drawer?.tipo === "oportunidade" && <DrawerOportunidade oportunidade={drawer.payload} onFechar={fechar} />}
      {drawer?.tipo === "confianca" && (
        <DrawerConfianca confianca={dados?.confianca} fechamento={dados?.fechamento} onFechar={fechar} />
      )}
      {drawer?.tipo === "comparacao" && (
        <DrawerComparacao
          fechamento={dados?.fechamento}
          periodo={dados?.periodo}
          comparacao={dados?.comparacao}
          onFechar={fechar}
        />
      )}
      {drawer?.tipo === "produtosTodos" && (
        <DrawerProdutosTodos
          linhas={produtosDoModo}
          margemPorMlb={modoProdutos === "margem" ? margemPorMlb : null}
          onAbrirProduto={abrirProduto}
          totais={dados?.produtos?.totais}
          onFechar={fechar}
        />
      )}
      {drawer?.tipo === "configuracao" && (
        <DrawerConfiguracao
          clienteSlug={clienteSlug}
          grantBase={saudeAds?.saude?.grantBase}
          onFechar={fechar}
        />
      )}
      {drawer?.tipo === "evento" && <DrawerEvento evento={drawer.payload} onFechar={fechar} />}
    </div>
  );
}
