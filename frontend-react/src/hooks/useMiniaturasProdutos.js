// frontend-react/src/hooks/useMiniaturasProdutos.js
//
// Foto dos produtos da lista do Financeiro (só Mercado Livre). Pede ao
// backend só os MLBs da PÁGINA visível que ainda não foram consultados —
// trocar de página ou filtro não repete pedido. Resposta guardada por conta:
// `mapa[id]` = URL, null = sem foto (fica a sigla), ausente = não consultado.
//
// Falha de rede não é erro na tela: os ids viram null e a lista segue com a
// sigla, como já era.

import { useEffect, useRef, useState } from "react";
import { obterMiniaturasProdutos } from "../services/financeiroApi.js";

const LOTE = 100;

export function useMiniaturasProdutos({ clienteSlug, clienteContaId, habilitado, itemIds }) {
  const contexto = habilitado && clienteSlug && clienteContaId ? `${clienteSlug}|${clienteContaId}` : null;
  const [estado, setEstado] = useState({ contexto, mapa: {} });
  const pedidosRef = useRef({ contexto, ids: new Set() });

  // Troca de cliente/conta: o que foi lido era da conta anterior.
  if (estado.contexto !== contexto) setEstado({ contexto, mapa: {} });
  if (pedidosRef.current.contexto !== contexto) pedidosRef.current = { contexto, ids: new Set() };

  const chave = (itemIds || []).filter(Boolean).join(",");

  useEffect(() => {
    if (!contexto || !chave) return undefined;
    const pedidos = pedidosRef.current;
    const faltam = [...new Set(chave.split(","))].filter((id) => !pedidos.ids.has(id));
    if (!faltam.length) return undefined;
    faltam.forEach((id) => pedidos.ids.add(id));

    // Sem cancelamento na troca de página: os ids já foram marcados como
    // pedidos, então a resposta TEM de ser registrada mesmo que a página
    // tenha mudado. Só uma troca de conta descarta (pedidosRef muda).
    for (let i = 0; i < faltam.length; i += LOTE) {
      const lote = faltam.slice(i, i + LOTE);
      const registrar = (miniaturas) => {
        if (pedidosRef.current !== pedidos) return;
        setEstado((e) => {
          const mapa = { ...e.mapa };
          for (const id of lote) mapa[id] = miniaturas?.[id] || null;
          return { ...e, mapa };
        });
      };
      obterMiniaturasProdutos(clienteSlug, { clienteContaId, itens: lote })
        .then((r) => registrar(r?.miniaturas || {}))
        .catch(() => registrar({}));
    }
    return undefined;
  }, [contexto, chave, clienteSlug, clienteContaId]);

  return estado.contexto === contexto ? estado.mapa : {};
}
