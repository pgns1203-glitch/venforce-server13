// A mesa do fechamento (modelo B): o fluxo nativo de GERAR + SALVAR +
// PUBLICAR, com a BASE VINCULADA (MELI e Shopee) decidindo se a planilha de
// custos é pedida. Base, arquivos e ajustes moram no drawer "Preparar
// fechamento"; o painel de etapas leva ao próximo passo. Marketplace vem da
// operação (sem seletor na tela).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MesaFechamento } from "./MesaFechamento.jsx";
import { montarPayloadFechamento, parseMoedaBR, cardsDoSummary } from "../../utils/fechamentoPayload.js";
import { FechamentoApiError } from "../../services/financeiroFechamentoApi.js";
import { formatarValorCampo, origemDoAds } from "../../hooks/useAdsMercadoAds.js";

const api = vi.hoisted(() => ({ processar: vi.fn(), salvar: vi.fn() }));
vi.mock("../../services/financeiroFechamentoApi.js", async (orig) => ({
  ...(await orig()),
  processarFechamento: api.processar,
  salvarEntregaFechamento: api.salvar,
}));

// A verificação da base vinculada bate em GET /base-vinculos via
// apiClient.requisitar — controlada por teste. `ehAdmin` idem (controla o
// link "Abrir diagnóstico" do banner de incidente).
const rede = vi.hoisted(() => ({ requisitar: vi.fn(), ehAdmin: vi.fn(() => false) }));
vi.mock("../../services/apiClient.js", async (orig) => ({
  ...(await orig()),
  requisitar: rede.requisitar,
  ehAdmin: rede.ehAdmin,
}));

const SUMMARY = {
  marketplace: "meli",
  grossRevenueTotal: 100000,
  paidRevenueTotal: 92000,
  contributionProfitTotal: 18000,
  averageContributionMargin: 0.2,
  finalResult: 12000,
  tacos: 0.05,
};

function respostaOk(extra = {}) {
  return {
    ok: true,
    summary: SUMMARY,
    competencia: { periodoSolicitado: "2026-08", periodoDetectado: "2026-08", divergente: false },
    detailedRows: [{ id: "MLB1", mc: 0.2 }],
    unmatchedIds: [],
    ...extra,
  };
}

// GET /base-vinculos com um vínculo para (slug, marketplace, conta).
function vinculosCom({ slug = "zenite", marketplace = "meli", contaId = 42, nome = "Base Zenite" } = {}) {
  return {
    ok: true,
    bases: [
      {
        id: 900,
        slug: "base-zenite",
        nome: nome,
        ativo: true,
        vinculo: { cliente_slug: slug, marketplace, cliente_conta_id: contaId, conta_nome: "Conta " + contaId },
      },
    ],
  };
}
const semVinculos = { ok: true, bases: [] };

const props = {
  clienteSlug: "zenite",
  clienteNome: "Zenite Comercial",
  clienteContaId: 42,
  marketplace: "meli",
  contaNome: "Loja Principal",
  periodo: "2026-08",
  periodoLabel: "Agosto/2026",
  onSalvo: vi.fn(),
  entregas: { publicar: vi.fn(), despublicar: vi.fn(), acaoEmCurso: null, erroDeAcao: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  rede.requisitar.mockResolvedValue(semVinculos);
  rede.ehAdmin.mockReturnValue(false);
});

// O drawer de preparo abre pela etapa "Base de custos" do painel.
async function abrirPreparo(usuario) {
  await usuario.click(screen.getByRole("button", { name: /: Base de custos$/ }));
  return screen.getByRole("dialog", { name: "Preparar fechamento" });
}
async function subirVendas(usuario, nome = "vendas.xlsx") {
  const arquivo = new File(["a"], nome, { type: "application/vnd.ms-excel" });
  await usuario.upload(screen.getByLabelText(/Planilha de vendas/), arquivo);
}
async function subirCustos(usuario) {
  const arquivo = new File(["a"], "custos.xlsx", { type: "application/vnd.ms-excel" });
  await usuario.upload(screen.getByLabelText("Planilha de custos"), arquivo);
}
// Abre o preparo, sobe o que for preciso e processa pelo botão do drawer.
async function processarPeloPreparo(usuario, { custos = false, nome } = {}) {
  const drawer = await abrirPreparo(usuario);
  await subirVendas(usuario, nome);
  if (custos) await subirCustos(usuario);
  await usuario.click(within(drawer).getByRole("button", { name: "Processar fechamento" }));
}
const painel = () => screen.getByRole("complementary", { name: "Etapas do fechamento" });

describe("fechamentoPayload", () => {
  it("parseMoedaBR entende pt-BR, vazio e número simples", () => {
    expect(parseMoedaBR("3.011,00")).toBe(3011);
    expect(parseMoedaBR("50")).toBe(50);
    expect(parseMoedaBR("")).toBeNull();
    expect(parseMoedaBR(null)).toBeNull();
  });

  it("montarPayloadFechamento congela a identidade e registra a origem dos custos", () => {
    const p = montarPayloadFechamento({
      processamento: respostaOk({ costsSource: "base", costsBase: { id: 900, slug: "base-zenite", nome: "Base Zenite" } }),
      clienteSlug: "zenite",
      clienteNome: "Zenite",
      periodo: "2026-08",
      marketplace: "meli",
      ajustes: { ads: "1.000,00" },
    });
    expect(p.cliente).toEqual({ slug: "zenite", nome: "Zenite" });
    expect(p.metadados.origem).toBe("financeiro-v3-nativo");
    expect(p.metadados.ads).toBe(1000);
    expect(p.metadados.costsSource).toBe("base");
    expect(p.metadados.costsBase).toEqual({ id: 900, slug: "base-zenite", nome: "Base Zenite" });
  });

  it("costsBase fica null quando os custos vieram de upload", () => {
    const p = montarPayloadFechamento({
      processamento: respostaOk({ costsSource: "upload", costsBase: null }),
      clienteSlug: "zenite",
      periodo: "2026-08",
      marketplace: "shopee",
      ajustes: {},
    });
    expect(p.metadados.costsSource).toBe("upload");
    expect(p.metadados.costsBase).toBeNull();
  });

  it("cardsDoSummary nunca inventa R$0 para campo ausente", () => {
    const cards = cardsDoSummary({ grossRevenueTotal: 100000 });
    const semReceita = cards.find((c) => c.titulo === "Receita Líquida");
    expect(semReceita.disponivel).toBe(false);
  });
});

describe("Mesa · base vinculada decide o upload de custos", () => {
  it("MELI com base vinculada: não pede planilha de custos e mostra a base", async () => {
    rede.requisitar.mockResolvedValue(vinculosCom({ marketplace: "meli", contaId: 42 }));
    const usuario = userEvent.setup();
    render(<MesaFechamento {...props} />);
    expect(await within(painel()).findByText("Base Zenite · vinculada")).toBeInTheDocument();
    await abrirPreparo(usuario);
    expect(screen.getByText("Base vinculada")).toBeInTheDocument();
    expect(screen.queryByLabelText("Planilha de custos")).not.toBeInTheDocument();
  });

  it("MELI sem base vinculada: planilha de custos vira obrigatória", async () => {
    rede.requisitar.mockResolvedValue(semVinculos);
    const usuario = userEvent.setup();
    render(<MesaFechamento {...props} />);
    expect(await within(painel()).findByText(/Sem base vinculada/)).toBeInTheDocument();
    await abrirPreparo(usuario);
    expect(screen.getByText(/Nenhuma base vinculada para esta operação/)).toBeInTheDocument();
    expect(screen.getByLabelText("Planilha de custos")).toBeInTheDocument();
  });

  it("Shopee com base vinculada: não pede custos; Order.all é recomendado", async () => {
    rede.requisitar.mockResolvedValue(vinculosCom({ marketplace: "shopee", contaId: 42 }));
    const usuario = userEvent.setup();
    render(<MesaFechamento {...props} marketplace="shopee" />);
    await within(painel()).findByText("Base Zenite · vinculada");
    await abrirPreparo(usuario);
    expect(screen.queryByLabelText("Planilha de custos")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Order.all (Shopee)")).toBeInTheDocument();
  });

  it("base de OUTRA conta não conta como base desta operação (pede upload)", async () => {
    rede.requisitar.mockResolvedValue(vinculosCom({ marketplace: "meli", contaId: 99 }));
    render(<MesaFechamento {...props} clienteContaId={42} />);
    expect(await within(painel()).findByText(/Sem base vinculada/)).toBeInTheDocument();
  });

  it("trocar de operação re-verifica a base", async () => {
    rede.requisitar.mockResolvedValue(vinculosCom({ contaId: 42 }));
    const { rerender } = render(<MesaFechamento {...props} clienteContaId={42} />);
    await within(painel()).findByText("Base Zenite · vinculada");
    rerender(<MesaFechamento {...props} clienteContaId={77} />);
    expect(await within(painel()).findByText(/Sem base vinculada/)).toBeInTheDocument();
  });

  it("override: 'Usar outra planilha de custos' reabre o card de upload", async () => {
    rede.requisitar.mockResolvedValue(vinculosCom({ marketplace: "meli", contaId: 42 }));
    const usuario = userEvent.setup();
    render(<MesaFechamento {...props} />);
    await within(painel()).findByText("Base Zenite · vinculada");
    await abrirPreparo(usuario);
    await usuario.click(screen.getByRole("button", { name: "Usar outra planilha de custos" }));
    expect(await screen.findByLabelText("Planilha de custos")).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Voltar a usar a base vinculada" }));
    await waitFor(() => expect(screen.queryByLabelText("Planilha de custos")).not.toBeInTheDocument());
  });
});

describe("Mesa · marketplace vem da operação", () => {
  it("não existe seletor de marketplace na tela", async () => {
    const usuario = userEvent.setup();
    render(<MesaFechamento {...props} />);
    await within(painel()).findByText(/Sem base vinculada/);
    await abrirPreparo(usuario);
    expect(screen.queryByLabelText(/Marketplace/)).not.toBeInTheDocument();
  });

  it("TikTok cai no legado, sem mesa", () => {
    render(<MesaFechamento {...props} marketplace="tiktok" />);
    expect(screen.getByText(/Financeiro \(legado\)/)).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Etapas do fechamento" })).not.toBeInTheDocument();
  });
});

describe("Mesa · antes de processar", () => {
  it("o mês ainda não foi fechado: sem destaque nem produtos; o painel aponta o próximo passo", async () => {
    rede.requisitar.mockResolvedValue(vinculosCom({ contaId: 42 }));
    render(<MesaFechamento {...props} />);
    await within(painel()).findByText("Base Zenite · vinculada");
    expect(screen.getByText("Agosto/2026 ainda não foi fechado")).toBeInTheDocument();
    expect(screen.getByText(/só falta a planilha de vendas do mês/)).toBeInTheDocument();
    expect(screen.queryByTestId("kpis-processamento")).not.toBeInTheDocument();
    expect(document.querySelector(".vf-fin-mesa-produtos")).toBeNull();
    expect(painel().querySelector('[data-etapa="arquivos"]')).toHaveAttribute("data-estado", "atual");
    expect(within(painel()).getByRole("button", { name: /Enviar planilha de vendas/ })).toBeInTheDocument();
  });

  it("o preparo diz o motivo do bloqueio e não deixa processar", async () => {
    rede.requisitar.mockResolvedValue(semVinculos);
    const usuario = userEvent.setup();
    render(<MesaFechamento {...props} />);
    await within(painel()).findByText(/Sem base vinculada/);
    expect(within(painel()).getByText(/Falta 2 itens obrigatórios para processar\./)).toBeInTheDocument();
    const drawer = await abrirPreparo(usuario);
    expect(within(drawer).getByText("Planilha de vendas necessária.", { selector: ".vf-fin-mesa-drawer__motivo" })).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Processar fechamento" })).toBeDisabled();
  });

  it("com base vinculada, só a planilha de vendas falta", async () => {
    rede.requisitar.mockResolvedValue(vinculosCom({ contaId: 42 }));
    render(<MesaFechamento {...props} />);
    await within(painel()).findByText("Base Zenite · vinculada");
    expect(within(painel()).getByText(/Falta 1 item obrigatório para processar\./)).toBeInTheDocument();
  });

  it("trocar e remover arquivo de vendas", async () => {
    rede.requisitar.mockResolvedValue(vinculosCom({ contaId: 42 }));
    const usuario = userEvent.setup();
    render(<MesaFechamento {...props} />);
    await within(painel()).findByText("Base Zenite · vinculada");
    const drawer = await abrirPreparo(usuario);
    await subirVendas(usuario, "Performance_Agosto.xlsx");
    expect(within(drawer).getByText("Performance_Agosto.xlsx")).toBeInTheDocument();
    await usuario.click(within(drawer).getByRole("button", { name: "Remover Planilha de vendas" }));
    await waitFor(() => expect(within(drawer).queryByText("Performance_Agosto.xlsx")).not.toBeInTheDocument());
    await usuario.click(within(drawer).getByRole("button", { name: "Cancelar" }));
    expect(await within(painel()).findByText("Falta a planilha de vendas")).toBeInTheDocument();
  });
});

describe("Mesa · processar", () => {
  it("envia multipart com periodo + clienteContaId + marketplace e mostra o resultado na mesa", async () => {
    rede.requisitar.mockResolvedValue(vinculosCom({ marketplace: "meli", contaId: 42 }));
    api.processar.mockResolvedValue(respostaOk({ costsSource: "base", costsBase: { id: 900, nome: "Base Zenite" } }));
    const usuario = userEvent.setup();
    render(<MesaFechamento {...props} />);
    await within(painel()).findByText("Base Zenite · vinculada");
    await processarPeloPreparo(usuario);

    await waitFor(() => expect(api.processar).toHaveBeenCalled());
    const form = api.processar.mock.calls[0][0];
    expect(form.get("periodo")).toBe("2026-08");
    expect(form.get("clienteContaId")).toBe("42");
    expect(form.get("marketplace")).toBe("meli");
    expect(form.get("costs")).toBeNull(); // base cobre — nada de upload
    expect(await within(painel()).findByText(/competência confere/)).toBeInTheDocument();
    expect(screen.getByTestId("kpis-processamento")).toHaveTextContent("custos: base Base Zenite");
    expect(screen.queryByRole("dialog", { name: "Preparar fechamento" })).not.toBeInTheDocument();
  });

  it("sem base: o upload de custos vai junto no multipart", async () => {
    rede.requisitar.mockResolvedValue(semVinculos);
    api.processar.mockResolvedValue(respostaOk());
    const usuario = userEvent.setup();
    render(<MesaFechamento {...props} marketplace="shopee" />);
    await within(painel()).findByText(/Sem base vinculada/);
    await processarPeloPreparo(usuario, { custos: true });
    await waitFor(() => expect(api.processar).toHaveBeenCalled());
    expect(api.processar.mock.calls[0][0].get("costs")).toBeInstanceOf(File);
  });

  it("Refazer chama o MESMO endpoint com os mesmos arquivos; o preparo mantém a planilha escolhida", async () => {
    rede.requisitar.mockResolvedValue(vinculosCom({ marketplace: "meli", contaId: 42 }));
    api.processar.mockResolvedValue(respostaOk({ costsSource: "base", costsBase: { id: 900, slug: "base-zenite", nome: "Base Zenite" } }));
    const usuario = userEvent.setup();
    render(<MesaFechamento {...props} />);
    await within(painel()).findByText("Base Zenite · vinculada");
    await processarPeloPreparo(usuario, { nome: "vendas-out.xlsx" });
    await screen.findByTestId("kpis-processamento");

    await usuario.click(within(painel()).getByRole("button", { name: "Refazer: Processar" }));
    await waitFor(() => expect(api.processar).toHaveBeenCalledTimes(2));
    expect(api.processar.mock.calls[1][0].get("sales").name).toBe("vendas-out.xlsx");

    await usuario.click(within(painel()).getByRole("button", { name: "Trocar: Arquivos" }));
    expect(within(screen.getByRole("dialog", { name: "Preparar fechamento" })).getByText("vendas-out.xlsx")).toBeInTheDocument();
  });

  it("reprocessamento que falha não deixa o resultado anterior na tela", async () => {
    api.processar.mockResolvedValueOnce(respostaOk()).mockRejectedValueOnce(new FechamentoApiError("Planilha inválida.", { status: 400 }));
    const usuario = userEvent.setup();
    render(<MesaFechamento {...props} />);
    await within(painel()).findByText(/Sem base vinculada/);
    await processarPeloPreparo(usuario, { custos: true });
    await screen.findByTestId("kpis-processamento");
    await usuario.click(within(painel()).getByRole("button", { name: "Refazer: Processar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Planilha inválida.");
    expect(screen.queryByTestId("kpis-processamento")).not.toBeInTheDocument();
  });

  it("Baixar planilha usa o excelBase64 do backend, com nome por marketplace e competência", async () => {
    rede.requisitar.mockResolvedValue(vinculosCom({ marketplace: "shopee", contaId: 42 }));
    api.processar.mockResolvedValue(respostaOk({ excelBase64: btoa("xlsx") }));
    const criar = vi.fn(() => "blob:x");
    globalThis.URL.createObjectURL = criar;
    globalThis.URL.revokeObjectURL = vi.fn();
    const clique = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const usuario = userEvent.setup();
    render(<MesaFechamento {...props} marketplace="shopee" />);
    await within(painel()).findByText("Base Zenite · vinculada");
    await processarPeloPreparo(usuario);
    await usuario.click(await screen.findByRole("button", { name: "Baixar planilha" }));
    expect(criar).toHaveBeenCalled();
    expect(clique.mock.instances[0].download).toBe("fechamento-shopee-2026-08.xlsx");
    clique.mockRestore();
  });
});

describe("Mesa · caixa-preta (incidente FIN-xxx) + base vinculada", () => {
  it("Shopee com base vinculada: se o backend devolve incidente, o aviso FIN-xxx aparece na mesa", async () => {
    rede.requisitar.mockResolvedValue(vinculosCom({ marketplace: "shopee", contaId: 42, nome: "Comprou_chegou_shopee1" }));
    api.processar.mockResolvedValue(
      respostaOk({
        summary: { ...SUMMARY, marketplace: "shopee" },
        costsSource: "base",
        costsBase: { id: 55, slug: "comprou_chegou_shopee1", nome: "Comprou_chegou_shopee1" },
        incidente: { codigo: "FIN-777", mensagem: "Ocorrência de suporte FIN-777 criada." },
      })
    );
    const usuario = userEvent.setup();
    render(<MesaFechamento {...props} marketplace="shopee" />);
    await within(painel()).findByText("Comprou_chegou_shopee1 · vinculada");
    await processarPeloPreparo(usuario);

    expect(await screen.findByText("FIN-777")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar código" })).toBeInTheDocument();
    expect(screen.getByTestId("kpis-processamento")).toHaveTextContent("custos: base Comprou_chegou_shopee1");
    expect(screen.queryByRole("link", { name: "Abrir diagnóstico" })).not.toBeInTheDocument();
  });

  it("admin vê o link 'Abrir diagnóstico' apontando para o código do incidente", async () => {
    rede.ehAdmin.mockReturnValue(true);
    rede.requisitar.mockResolvedValue(semVinculos);
    api.processar.mockResolvedValue(respostaOk({ incidente: { codigo: "FIN-42" } }));
    const usuario = userEvent.setup();
    render(<MesaFechamento {...props} />);
    await within(painel()).findByText(/Sem base vinculada/);
    await processarPeloPreparo(usuario, { custos: true });
    const link = await screen.findByRole("link", { name: "Abrir diagnóstico" });
    expect(link).toHaveAttribute("href", "financeiro-debug.html?incidente=FIN-42");
  });

  it("sem incidente na resposta, nenhum aviso FIN aparece", async () => {
    rede.requisitar.mockResolvedValue(vinculosCom({ contaId: 42 }));
    api.processar.mockResolvedValue(respostaOk());
    const usuario = userEvent.setup();
    render(<MesaFechamento {...props} />);
    await within(painel()).findByText("Base Zenite · vinculada");
    await processarPeloPreparo(usuario);
    await within(painel()).findByText(/competência confere/);
    expect(screen.queryByText(/Ocorrência de suporte/)).not.toBeInTheDocument();
  });
});

describe("Mesa · competência divergente", () => {
  it("não deixa salvar até confirmar a divergência", async () => {
    rede.requisitar.mockResolvedValue(vinculosCom({ contaId: 42 }));
    api.processar.mockResolvedValue(
      respostaOk({
        competencia: { periodoSolicitado: "2026-08", periodoDetectado: "2026-07", divergente: true, motivo: "Datas em julho/2026." },
      })
    );
    const usuario = userEvent.setup();
    render(<MesaFechamento {...props} />);
    await within(painel()).findByText("Base Zenite · vinculada");
    await processarPeloPreparo(usuario);

    expect(await screen.findByText(/não bate com o período em tela/)).toBeInTheDocument();
    const rascunho = within(painel()).getByRole("button", { name: "Salvar como rascunho" });
    const publicar = within(painel()).getByRole("button", { name: /Salvar e publicar/ });
    expect(rascunho).toBeDisabled();
    expect(publicar).toBeDisabled();
    await usuario.click(screen.getByRole("checkbox"));
    expect(rascunho).toBeEnabled();
    expect(publicar).toBeEnabled();
  });
});

// GET /financeiro/:cliente/ads responde o Mercado Ads; o resto da rede
// (base-vinculos) segue o vínculo de sempre.
function redeComAds(ads, vinculos = vinculosCom({ marketplace: "meli", contaId: 42 })) {
  rede.requisitar.mockImplementation(async (caminho, opcoes = {}) => {
    if (/\/financeiro\/[^/]+\/ads$/.test(caminho)) return typeof ads === "function" ? ads(opcoes) : ads;
    return vinculos;
  });
}
const ADS_OK = { ok: true, disponivel: true, fonte: "cache", investimentoAds: 4812.4, gmvAds: 38017.96, roas: 7.9, campanhas: 14, consultadoEm: "2026-09-04T03:12:00Z" };
const campoAds = () => screen.getByLabelText("ADS");
const chamadasAds = () => rede.requisitar.mock.calls.filter(([c]) => /\/ads$/.test(c));

describe("Mesa · ADS do Mercado Ads (modelo B)", () => {
  it("formatarValorCampo e origemDoAds", () => {
    expect(formatarValorCampo(4812.4)).toBe("4.812,40");
    expect(formatarValorCampo(0)).toBe("0,00");
    const ads = { status: "ok", valorCampo: "4.812,40" };
    expect(origemDoAds("4.812,40", ads)).toBe("mercado_ads");
    expect(origemDoAds("5.000,00", ads)).toBe("manual");
    expect(origemDoAds("", ads)).toBeNull();
    expect(origemDoAds("100,00", { status: "indisponivel" })).toBe("manual");
  });

  it("MELI: o campo já vem com o valor do Mercado Ads da conta e da competência", async () => {
    redeComAds(ADS_OK);
    const usuario = userEvent.setup();
    render(<MesaFechamento {...props} />);
    await within(painel()).findByText("Base Zenite · vinculada");
    await abrirPreparo(usuario);
    await waitFor(() => expect(campoAds()).toHaveValue("4.812,40"));
    expect(screen.getByText("Mercado Ads")).toBeInTheDocument();
    expect(screen.getByText(/ROAS 7,9 · 14 campanhas/)).toBeInTheDocument();
    const [caminho, opcoes] = chamadasAds()[0];
    expect(caminho).toBe("/financeiro/zenite/ads");
    expect(opcoes.params).toMatchObject({ conta: 42, periodo: "2026-08" });
  });

  it("editar vira Manual; 'Usar o da API' volta ao valor do Mercado Ads", async () => {
    redeComAds(ADS_OK);
    const usuario = userEvent.setup();
    render(<MesaFechamento {...props} />);
    await abrirPreparo(usuario);
    await waitFor(() => expect(campoAds()).toHaveValue("4.812,40"));
    await usuario.clear(campoAds());
    await usuario.type(campoAds(), "5.000,00");
    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.getByText(/Editado à mão · Mercado Ads: R\$ 4\.812,40/)).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Usar o da API" }));
    expect(campoAds()).toHaveValue("4.812,40");
    expect(screen.getByText("Mercado Ads")).toBeInTheDocument();
  });

  it("↻ consulta ao vivo e troca o valor que veio da API", async () => {
    redeComAds((opcoes) => (opcoes.params?.atualizar ? { ...ADS_OK, fonte: "ao_vivo", investimentoAds: 4907.15 } : ADS_OK));
    const usuario = userEvent.setup();
    render(<MesaFechamento {...props} />);
    await abrirPreparo(usuario);
    await waitFor(() => expect(campoAds()).toHaveValue("4.812,40"));
    await usuario.click(screen.getByRole("button", { name: "Atualizar do Mercado Ads agora" }));
    await waitFor(() => expect(campoAds()).toHaveValue("4.907,15"));
    expect(chamadasAds().at(-1)[1].params.atualizar).toBe(1);
    expect(screen.getByText(/consultado agora/)).toBeInTheDocument();
  });

  it("↻ não passa por cima de um valor digitado", async () => {
    redeComAds((opcoes) => (opcoes.params?.atualizar ? { ...ADS_OK, investimentoAds: 4907.15 } : ADS_OK));
    const usuario = userEvent.setup();
    render(<MesaFechamento {...props} />);
    await abrirPreparo(usuario);
    await waitFor(() => expect(campoAds()).toHaveValue("4.812,40"));
    await usuario.clear(campoAds());
    await usuario.type(campoAds(), "100,00");
    await usuario.click(screen.getByRole("button", { name: "Atualizar do Mercado Ads agora" }));
    await screen.findByText(/Editado à mão · Mercado Ads: R\$ 4\.907,15/);
    expect(campoAds()).toHaveValue("100,00");
  });

  it("sem permissão de Ads: campo vazio e manual, a legenda diz como resolver", async () => {
    redeComAds({ ok: true, disponivel: false, codigo: "NO_ADS_PERMISSION", motivo: "x" });
    const usuario = userEvent.setup();
    render(<MesaFechamento {...props} />);
    await abrirPreparo(usuario);
    expect(await screen.findByText(/não tem acesso ao Mercado Ads/)).toBeInTheDocument();
    expect(campoAds()).toHaveValue("");
    expect(screen.queryByText("Mercado Ads")).not.toBeInTheDocument();
  });

  it("Shopee: ADS segue manual e nem consulta o Mercado Ads", async () => {
    redeComAds(ADS_OK, vinculosCom({ marketplace: "shopee", contaId: 42 }));
    const usuario = userEvent.setup();
    render(<MesaFechamento {...props} marketplace="shopee" />);
    await within(painel()).findByText("Base Zenite · vinculada");
    await abrirPreparo(usuario);
    expect(screen.getByLabelText(/^ADS/)).toHaveValue("");
    expect(screen.queryByText("Mercado Ads")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Atualizar do Mercado Ads agora" })).not.toBeInTheDocument();
    expect(chamadasAds()).toHaveLength(0);
  });

  it("o fechamento salvo guarda a origem do ADS", async () => {
    redeComAds(ADS_OK);
    api.processar.mockResolvedValue(respostaOk());
    api.salvar.mockResolvedValue({ id: 5, publicado: false, token_publico: null });
    const usuario = userEvent.setup();
    render(<MesaFechamento {...props} />);
    await within(painel()).findByText("Base Zenite · vinculada");
    const drawer = await abrirPreparo(usuario);
    await waitFor(() => expect(campoAds()).toHaveValue("4.812,40"));
    await subirVendas(usuario);
    await usuario.click(within(drawer).getByRole("button", { name: "Processar fechamento" }));
    await waitFor(() => expect(api.processar).toHaveBeenCalled());
    expect(api.processar.mock.calls[0][0].get("ads")).toBe("4.812,40");
    await within(painel()).findByText(/competência confere/);
    await usuario.click(within(painel()).getByRole("button", { name: "Salvar como rascunho" }));
    await waitFor(() => expect(api.salvar).toHaveBeenCalledTimes(1));
    const meta = api.salvar.mock.calls[0][0].payload_json.metadados;
    expect(meta.ads).toBe(4812.4);
    expect(meta.adsOrigem).toEqual({ origem: "mercado_ads", consultadoEm: "2026-09-04T03:12:00Z" });
  });
});

describe("Mesa · salvar e publicar", () => {
  it("Salvar como rascunho grava cliente.nome com o nome real do contexto (e o slug à parte)", async () => {
    rede.requisitar.mockResolvedValue(vinculosCom({ marketplace: "meli", contaId: 42 }));
    api.processar.mockResolvedValue(respostaOk());
    api.salvar.mockResolvedValue({ id: 5, publicado: false, token_publico: null });
    const usuario = userEvent.setup();
    render(<MesaFechamento {...props} />);
    await within(painel()).findByText("Base Zenite · vinculada");
    await processarPeloPreparo(usuario);
    await within(painel()).findByText(/competência confere/);
    await usuario.click(within(painel()).getByRole("button", { name: "Salvar como rascunho" }));
    await waitFor(() => expect(api.salvar).toHaveBeenCalledTimes(1));
    expect(api.salvar.mock.calls[0][0].payload_json.cliente).toEqual({ slug: "zenite", nome: "Zenite Comercial" });
    expect(props.entregas.publicar).not.toHaveBeenCalled();
  });

  it("Salvar e publicar confirma nomeando a competência, salva e publica a entrega recém-gravada", async () => {
    rede.requisitar.mockResolvedValue(vinculosCom({ marketplace: "meli", contaId: 42 }));
    api.processar.mockResolvedValue(respostaOk());
    api.salvar.mockResolvedValue({ id: 91, publicado: false, token_publico: null });
    const usuario = userEvent.setup();
    render(<MesaFechamento {...props} />);
    await within(painel()).findByText("Base Zenite · vinculada");
    await processarPeloPreparo(usuario);
    await usuario.click(await within(painel()).findByRole("button", { name: /Salvar e publicar/ }));
    expect(within(painel()).getByText("Salvar e publicar Agosto/2026? Gera um link público sem senha.")).toBeInTheDocument();
    expect(api.salvar).not.toHaveBeenCalled();
    await usuario.click(within(painel()).getByRole("button", { name: "Salvar e publicar" }));
    await waitFor(() => expect(props.entregas.publicar).toHaveBeenCalledWith(91));
    expect(api.salvar).toHaveBeenCalledTimes(1);
  });

  it("sem nome no contexto, cliente.nome fica null — nunca o slug", () => {
    const p = montarPayloadFechamento({ processamento: respostaOk(), clienteSlug: "zenite", clienteNome: null, periodo: "2026-08", marketplace: "meli" });
    expect(p.cliente).toEqual({ slug: "zenite", nome: null });
  });
});

describe("Mesa · duplicidade 409", () => {
  it("409 ENTREGA_JA_EXISTE vira cancelar/substituir; substituir manda substituir:true + cliente_conta_id", async () => {
    rede.requisitar.mockResolvedValue(vinculosCom({ marketplace: "shopee", contaId: 42 }));
    api.processar.mockResolvedValue(respostaOk({ summary: { ...SUMMARY, marketplace: "shopee" } }));
    api.salvar
      .mockRejectedValueOnce(new FechamentoApiError("Já existe.", { status: 409, codigo: "ENTREGA_JA_EXISTE", entregaId: 78, publicado: true }))
      .mockResolvedValueOnce({ id: 78, token_publico: "tok-x", publicado: true });
    const usuario = userEvent.setup();
    render(<MesaFechamento {...props} marketplace="shopee" />);
    await within(painel()).findByText("Base Zenite · vinculada");
    await processarPeloPreparo(usuario);
    await usuario.click(await within(painel()).findByRole("button", { name: "Salvar como rascunho" }));

    expect(await screen.findByText(/já tem um fechamento PUBLICADO/)).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Substituir" }));
    await waitFor(() => expect(api.salvar).toHaveBeenCalledTimes(2));
    expect(api.salvar.mock.calls[1][0].substituir).toBe(true);
    expect(api.salvar.mock.calls[1][0].cliente_conta_id).toBe(42);
    expect(props.onSalvo).toHaveBeenCalled();
  });

  it("substituir leva destaques/prioridades da entrega existente para o novo payload (números novos)", async () => {
    const apresentacao = { destaques: ["Meta batida"], atencoes: [], prioridades: { alta: [{ titulo: "Repor", desc: "", data: "" }], media: [], baixa: [] } };
    rede.requisitar.mockImplementation(async (caminho) =>
      caminho === "/entregas-cliente/78"
        ? { ok: true, entrega: { id: 78, payload_json: { summary: { finalResult: 1 }, entrega: apresentacao } } }
        : semVinculos
    );
    api.processar.mockResolvedValue(respostaOk());
    api.salvar
      .mockRejectedValueOnce(new FechamentoApiError("Já existe.", { status: 409, codigo: "ENTREGA_JA_EXISTE", entregaId: 78, publicado: false }))
      .mockResolvedValueOnce({ id: 78 });
    const usuario = userEvent.setup();
    render(<MesaFechamento {...props} />);
    await within(painel()).findByText(/Sem base vinculada/);
    await processarPeloPreparo(usuario, { custos: true });
    await usuario.click(await within(painel()).findByRole("button", { name: "Salvar como rascunho" }));
    await usuario.click(await screen.findByRole("button", { name: "Substituir" }));
    await waitFor(() => expect(api.salvar).toHaveBeenCalledTimes(2));
    const body = api.salvar.mock.calls[1][0];
    expect(body.payload_json.entrega).toEqual(apresentacao);
    expect(body.payload_json.summary).toEqual(SUMMARY);
  });
});

describe("Mesa · disposição (modelo B)", () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ "# de anúncio": `MLB${i}`, "Título do anúncio": `Produto ${i}`, "Venda Total": 10, "Preço de custo": i === 0 ? null : 3, LC: i === 0 ? null : 2, MC: 20, "Cobertura de custo": i === 0 ? "sem custo" : "com custo" }));

  it("topo: destaque, aviso de pendências e cascata à esquerda; painel à direita; produtos depois, em largura total", async () => {
    api.processar.mockResolvedValue(respostaOk({ detailedRows: rows, summary: { ...SUMMARY, calculatedCoveragePercent: 98, revenueWithoutCost: 10 }, unmatchedIds: ["MLB0"] }));
    const usuario = userEvent.setup();
    const { container } = render(<MesaFechamento {...props} />);
    await within(painel()).findByText(/Sem base vinculada/);
    await processarPeloPreparo(usuario, { custos: true });
    await screen.findByTestId("kpis-processamento");

    const topo = container.querySelector(".vf-fin-mesa__topo");
    const principal = topo.querySelector(".vf-fin-mesa__principal");
    expect(principal.querySelector('[data-testid="kpis-processamento"]')).not.toBeNull();
    expect(principal.querySelector('[data-testid="aviso-pendencias"]')).toHaveTextContent("1 produto sem custo confiável · R$ 10,00 de receita fora da LC");
    expect(principal.querySelector(".vf-fin-mesa-cascata")).not.toBeNull();
    expect(topo.querySelector('aside[aria-label="Etapas do fechamento"]')).not.toBeNull();
    const produtos = container.querySelector(".vf-fin-mesa-produtos");
    expect(topo.contains(produtos)).toBe(false);
    expect(topo.compareDocumentPosition(produtos) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a lista de produtos é paginada (25 por vez), nunca as 60 linhas", async () => {
    api.processar.mockResolvedValue(respostaOk({ detailedRows: rows }));
    const usuario = userEvent.setup();
    const { container } = render(<MesaFechamento {...props} />);
    await within(painel()).findByText(/Sem base vinculada/);
    await processarPeloPreparo(usuario, { custos: true });
    await screen.findByTestId("kpis-processamento");
    expect(container.querySelectorAll(".vf-fin-mesa-lista__linha")).toHaveLength(25);
    expect(screen.getByText("Página 1 de 3")).toBeInTheDocument();
  });

  it("Ver e corrigir abre as pendências; corrigir um custo NÃO reprocessa (o reprocesso é explícito)", async () => {
    rede.requisitar.mockImplementation(async (url) => (String(url).includes("base-vinculos") ? vinculosCom({ marketplace: "meli", contaId: 42 }) : { ok: true, padrao: { imposto_percentual: 8, taxa_fixa: 0 } }));
    api.processar.mockResolvedValue(respostaOk({ detailedRows: rows, unmatchedIds: ["MLB0"], costsSource: "base", costsBase: { id: 900, slug: "base-zenite", nome: "Base Zenite" } }));
    const usuario = userEvent.setup();
    render(<MesaFechamento {...props} />);
    await within(painel()).findByText("Base Zenite · vinculada");
    await processarPeloPreparo(usuario);
    await usuario.click(await screen.findByRole("button", { name: "Ver e corrigir" }));
    const drawer = screen.getByRole("dialog", { name: "Pendências de custo" });
    expect(await within(drawer).findByRole("textbox", { name: "Novo custo unitário de MLB0" })).toBeInTheDocument();
    expect(api.processar).toHaveBeenCalledTimes(1);
  });

  it("Detalhes abre o detalhamento completo (composição, cobertura) num drawer", async () => {
    api.processar.mockResolvedValue(respostaOk());
    const usuario = userEvent.setup();
    render(<MesaFechamento {...props} />);
    await within(painel()).findByText(/Sem base vinculada/);
    await processarPeloPreparo(usuario, { custos: true });
    await usuario.click(await screen.findByRole("button", { name: "Detalhes" }));
    const drawer = screen.getByRole("dialog", { name: "Detalhes do fechamento" });
    expect(within(drawer).getByRole("region", { name: "Composição financeira" })).toBeInTheDocument();
  });
});

describe("Mesa · fechamento salvo (sem processar)", () => {
  it("lê o summary gravado na entrega e mostra o mesmo destaque, com a amostra de produtos", async () => {
    const salvoSummary = { ...SUMMARY, finalResult: 4321 };
    rede.requisitar.mockImplementation(async (caminho) =>
      caminho === "/entregas-cliente/7"
        ? { ok: true, entrega: { id: 7, payload_json: { summary: salvoSummary, detailedRows: [{ "# de anúncio": "MLB1", "Título do anúncio": "Calça", "Venda Total": 10, LC: 2, MC: 20, "Cobertura de custo": "com custo" }] } } }
        : semVinculos
    );
    const entrega = { id: 7, periodo: "2026-08", cliente_conta_id: 42, publicado: false, token_publico: null, created_at: "2026-08-20T10:00:00Z" };
    render(<MesaFechamento {...props} entrega={entrega} />);
    expect(await screen.findByTestId("kpis-processamento")).toHaveTextContent("R$ 4.321,00");
    expect(screen.getByText(/Fechamento salvo em/)).toBeInTheDocument();
    expect(screen.getByText(/Amostra de 1 linhas gravadas no fechamento salvo/)).toBeInTheDocument();
    expect(painel().querySelector('[data-etapa="publicar"]')).toHaveAttribute("data-estado", "atual");
    expect(within(painel()).getByRole("button", { name: /^Publicar/ })).toBeInTheDocument();
  });
});
