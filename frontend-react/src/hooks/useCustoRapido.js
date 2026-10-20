// frontend-react/src/hooks/useCustoRapido.js
//
// "+ Custo" na lista de produtos do Financeiro (como na lista de Anúncios ML):
// grava o custo de um produto sem custo direto na BASE VINCULADA da conta.
//
// Não cria regra nova de matching: quem pode ser gravado é decidido por
// `identidadeDaPendencia` (utils/financeiro/baseCustos.js) com os registros
// REAIS da base — a mesma regra do drawer de Pendências. Só a identidade
// "segura" grava daqui; "ambígua"/"insuficiente" mandam para as Pendências
// (ou explicam o motivo), nunca adivinham.
//
// Imposto: não é enviado — o servidor mantém o do registro existente ou,
// num registro novo, usa o padrão da base (POST /bases/:slug/custos/upsert).
//
// O fechamento só reflete o custo novo depois de REPROCESSAR — nunca
// automático; a lista avisa e oferece o botão.

import { useCallback, useEffect, useMemo, useState } from "react";
import { obterCustosDaBase, registrarCustoNaBase } from "../services/basesCustoApi.js";
import { identidadeDaPendencia, indexarPorProduto, itensDaBase } from "../utils/financeiro/baseCustos.js";

// A linha da lista no formato que `identidadeDaPendencia` lê.
function comoPendencia(l) {
  return { itemId: l.itemId, modelId: l.modelId, sku: l.sku, statusCusto: l.statusCusto, produto: l.titulo };
}

// Mesma chave para todas as linhas do MESMO registro da base (Shopee: Item + Model).
export function chaveDoRegistro(marketplace, identidade) {
  if (!identidade?.produtoId) return null;
  return marketplace === "shopee" ? `${identidade.produtoId}|${identidade.idModel || ""}` : identidade.produtoId;
}

export function useCustoRapido({ base, marketplace, habilitado }) {
  const slug = habilitado && base?.slug ? base.slug : null;
  const [leitura, setLeitura] = useState({ slug: null, status: "inativo", itens: [] });
  const [salvos, setSalvos] = useState({}); // chave → { custo }

  useEffect(() => {
    setSalvos({});
    if (!slug) {
      setLeitura({ slug: null, status: "inativo", itens: [] });
      return undefined;
    }
    setLeitura({ slug, status: "carregando", itens: [] });
    const controlador = new AbortController();
    obterCustosDaBase(slug, { signal: controlador.signal })
      .then((b) => setLeitura({ slug, status: "ok", itens: itensDaBase(b) }))
      .catch((e) => {
        if (e?.name === "AbortError") return;
        setLeitura({ slug, status: "erro", itens: [] });
      });
    return () => controlador.abort();
  }, [slug]);

  const pronto = leitura.status === "ok" && leitura.slug === slug;
  const indice = useMemo(() => indexarPorProduto(leitura.itens), [leitura.itens]);

  const identidade = useCallback(
    (l) => (pronto && l.statusCusto === "sem_custo" ? identidadeDaPendencia({ marketplace, pendencia: comoPendencia(l), indice }) : null),
    [pronto, marketplace, indice]
  );

  const salvar = useCallback(
    async (l, custo) => {
      const id = identidadeDaPendencia({ marketplace, pendencia: comoPendencia(l), indice });
      if (id.classe !== "segura") throw new Error(id.motivo || "Este produto não pode ser gravado daqui.");
      const idModel = marketplace === "shopee" ? id.idModel : null;
      await registrarCustoNaBase(slug, {
        produtoId: id.produtoId,
        custoProduto: custo,
        impostoFracao: null,
        idModel,
        produtoNome: l.titulo,
      });
      // A próxima linha do MESMO registro precisa enxergá-lo (vira "atualizar").
      setLeitura((atual) => ({
        ...atual,
        itens: [
          ...atual.itens.filter((i) => !(i.produtoId === id.produtoId && (marketplace !== "shopee" || (i.idModel || null) === (idModel || null)))),
          { produtoId: id.produtoId, idModel, sku: null, custo, imposto: id.registro?.imposto ?? null, nome: l.titulo || null },
        ],
      }));
      setSalvos((s) => ({ ...s, [chaveDoRegistro(marketplace, id)]: { custo } }));
    },
    [marketplace, indice, slug]
  );

  const salvoDe = useCallback(
    (l) => {
      if (!pronto || l.statusCusto !== "sem_custo") return null;
      const chave = chaveDoRegistro(marketplace, identidadeDaPendencia({ marketplace, pendencia: comoPendencia(l), indice }));
      return chave ? salvos[chave] || null : null;
    },
    [pronto, marketplace, indice, salvos]
  );

  return { ativo: pronto, identidade, salvar, salvoDe, quantidadeSalva: Object.keys(salvos).length };
}
