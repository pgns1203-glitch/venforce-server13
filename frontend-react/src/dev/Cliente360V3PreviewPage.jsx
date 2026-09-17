// frontend-react/src/dev/Cliente360V3PreviewPage.jsx
//
// Superfície oficial de validação visual do Dossiê (?preview=1) — local/dev,
// SEM backend, SEM banco, SEM JWT, SEM vf-context.
//
// Duas mudanças importantes em relação à versão anterior:
//
// 1. Esta página NÃO reconstrói mais a árvore de seções. Ela monta o MESMO
//    `DossieCorpo` que a Cliente360V3Page real monta, alimentado por fixture.
//    O preview e a produção não podem mais divergir por esquecimento.
//
// 2. O preview desenha um TRILHO no lugar da sidebar global. O Shell V3 não é
//    carregado aqui (ele resolve carteira por rede), e sem esse trilho o
//    Dossiê apareceria com a largura inteira da janela — ou seja, seria
//    julgado num canvas que não existe em produção. Com ele, 1366×768 no
//    preview é a mesma área útil (~1078px) que o usuário real tem.
//
// Os dois componentes que buscam dado sozinhos (SimuladorResultado e o painel
// de Ações) recebem `slug` indefinido: aparecem com o dado da fixture, mas
// nenhuma interação chega à rede.

import { useMemo, useState } from "react";
import { criarFixturePreview, ESTADOS_PREVIEW, lerEstado } from "./cliente360V3PreviewFixtures.js";
import DossieCorpo from "../components/cliente360v3/dossie/DossieCorpo.jsx";

function escreverEstadoNaUrl(estado) {
  const url = new URL(window.location.href);
  url.searchParams.set("preview", "1");
  url.searchParams.set("state", estado);
  url.searchParams.delete("estado"); // parâmetro antigo — `state` é o oficial
  window.history.replaceState(null, "", url);
}

function BarraPreview({ estado, onEstadoChange }) {
  return (
    <div className="c360d-preview__barra">
      <strong>Preview visual</strong>
      <span>dados fictícios · nenhuma chamada de rede · simulador e placar inertes</span>
      <label>
        Estado
        <select
          className="vf-select vf-select--sm"
          aria-label="Estado"
          value={estado}
          onChange={(e) => onEstadoChange(e.target.value)}
        >
          {ESTADOS_PREVIEW.map((e) => (
            <option key={e.chave} value={e.chave}>{e.label}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

export default function Cliente360V3PreviewPage() {
  const [estado, setEstado] = useState(() => lerEstado(window.location.search));
  const fixture = useMemo(() => criarFixturePreview(estado), [estado]);

  function mudarEstado(novo) {
    setEstado(novo);
    escreverEstadoNaUrl(novo);
  }

  const { resultado, margem, saudeAds, historico, carregando, periodos, periodo, contexto } = fixture;
  const dados = resultado?.disponivel ? resultado.dados : null;

  return (
    <div className="c360d-preview">
      {/* Ocupa a largura da sidebar real; não é uma segunda navegação. */}
      <aside className="c360d-preview__rail" aria-hidden="true">
        <span className="c360d-preview__marca">
          <span className="c360d-preview__mark">V</span> VenForce
        </span>
        <p className="c360d-preview__nota">
          Espaço da sidebar global do Portal. No preview ela não é carregada — este trilho existe só
          para o Dossiê ser avaliado na largura real de conteúdo (1366 − 240 − paddings ≈ 1078px).
        </p>
      </aside>

      <main className="c360d-preview__main">
        <BarraPreview estado={estado} onEstadoChange={mudarEstado} />
        <DossieCorpo
          key={estado}
          dados={dados}
          contexto={contexto}
          resultadoIndisponivel={resultado && !resultado.disponivel ? resultado.motivo : null}
          carregando={carregando}
          periodos={periodos}
          periodoSelecionado={periodo}
          onTrocarPeriodo={undefined}
          margem={margem}
          onPedirMargem={fixture.pedirMargem}
          saudeAds={saudeAds}
          historico={historico}
          clienteSlug={dados?.cliente?.slug}
          clienteContaId={undefined}
          slugParaConsulta={undefined}
        />
      </main>
    </div>
  );
}
