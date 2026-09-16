// frontend-react/src/components/cliente360v3/dossie/AcoesPainel.jsx
//
// Placar do consultor recomposto: a LÓGICA é a mesma da V2 (mesmo endpoint,
// mesma regra de crédito — ação registrada num mês só vale quando aparece como
// melhora do MESMO fator na ponte do mês seguinte), a APRESENTAÇÃO é nova.
//
// Continua sob demanda: a apuração percorre a ponte de várias competências, e
// pagar isso em toda abertura do Dossiê seria caro para um bloco de apoio.
//
// O escopo é declarado, não escondido: `cliente_360_acoes` é do CLIENTE
// inteiro, não desta conta — rotulado aqui como "cliente", igual ao histórico.

import { useCallback, useEffect, useRef, useState } from "react";
import { formatarMoeda } from "../../../utils/currency.js";
import { rotularCompetencia } from "../../../utils/dates.js";
import { obterPlacar } from "../../../services/cliente360Api.js";
import TabelaDensa from "./TabelaDensa.jsx";
import { Indisponivel } from "./Primitivos.jsx";

const FATOR = {
  custo: "Correção de custo", frete: "Renegociação de frete", preco: "Reprecificação",
  comissao: "Correção de comissão", imposto: "Correção de imposto", mix: "Melhoria de mix",
  produto: "Pausa/retomada de produto", base: "Correção de base",
};

const COLUNAS = [
  { key: "acao", header: "Ação", width: "38%", cabecalhoDeLinha: true, render: (a) => FATOR[a.fator] || a.fator },
  { key: "competencia", header: "Registrada", width: "20%", render: (a) => rotularCompetencia(a.competencia) },
  { key: "medida", header: "Medida em", width: "20%", render: (a) => rotularCompetencia(a.competenciaMedida) },
  {
    key: "credito", header: "Crédito", width: "22%", align: "right",
    render: (a) => formatarMoeda(a.creditoApurado, { casas: 0 }),
    cellClassName: (a) => (a.creditoApurado > 0 ? "is-positivo" : ""),
  },
];

export default function AcoesPainel({ slug, marketplace }) {
  const [placar, setPlacar] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const abortRef = useRef(null);

  useEffect(() => {
    setPlacar(null);
    setErro(null);
  }, [slug, marketplace]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const apurar = useCallback(async () => {
    abortRef.current?.abort();
    const controlador = new AbortController();
    abortRef.current = controlador;
    setCarregando(true);
    setErro(null);
    try {
      const resposta = await obterPlacar(slug, { marketplace, signal: controlador.signal });
      if (!controlador.signal.aborted) setPlacar(resposta);
    } catch (err) {
      if (err?.name === "AbortError" || controlador.signal.aborted) return;
      setErro(err?.message || "Não foi possível carregar o placar.");
    } finally {
      if (!controlador.signal.aborted) setCarregando(false);
    }
  }, [slug, marketplace]);

  if (erro) {
    return (
      <Indisponivel
        compacto
        titulo="Não foi possível apurar o placar"
        motivo={erro}
        acao={
          <button type="button" className="vf-btn vf-btn--secondary vf-btn--sm" onClick={apurar}>
            Tentar de novo
          </button>
        }
      />
    );
  }

  if (!placar) {
    return (
      <Indisponivel
        linha
        titulo="Placar não apurado"
        motivo="A apuração percorre a ponte de várias competências — por isso só roda quando você pede. Escopo: cliente inteiro, não só esta conta."
        acao={
          <button type="button" className="vf-btn vf-btn--secondary vf-btn--sm" disabled={carregando} onClick={apurar}>
            {carregando ? "Apurando…" : "Apurar placar"}
          </button>
        }
      />
    );
  }

  return (
    <div className="c360d-acoes">
      <div className="c360d-acoes__numeros">
        <div className="c360d-metrica">
          <span className="c360d-metrica__rotulo">Recuperado por ação</span>
          <span className="c360d-metrica__valor">{formatarMoeda(placar.totalRecuperado, { casas: 0 })}</span>
        </div>
        <div className="c360d-metrica">
          <span className="c360d-metrica__rotulo">Ainda na mesa</span>
          <span className="c360d-metrica__valor">{formatarMoeda(placar.aindaNaMesa, { casas: 0 })}</span>
        </div>
        <button type="button" className="vf-btn vf-btn--ghost vf-btn--sm" disabled={carregando} onClick={apurar}>
          {carregando ? "Apurando…" : "Recalcular"}
        </button>
      </div>

      {placar.acoes?.length > 0 ? (
        <TabelaDensa
          legenda="Ações creditadas no placar"
          colunas={COLUNAS}
          linhas={placar.acoes.slice(0, 5)}
          chave={(a) => a.id}
        />
      ) : (
        <p className="c360d-fraco">
          Nenhuma ação operacional registrada — o placar mede correção de custo, frete, preço, comissão,
          imposto, mix ou base no mês seguinte ao registro.
        </p>
      )}

      {placar.legado?.length > 0 && (
        <p className="c360d-fraco">
          {placar.legado.length} registro(s) de mídia anteriores à separação Ads × operação continuam no banco,
          fora do placar operacional.
        </p>
      )}
    </div>
  );
}
