import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReconciliacaoShopee } from "./ReconciliacaoShopee.jsx";

const comOrderAll = {
  grossRevenueTotal: 50000,
  orderAllTotalCount: 120,
  orderAllTotalRevenue: 53000,
  orderAllCompletedCount: 80, orderAllCompletedRevenue: 36000,
  orderAllDeliveredCount: 20, orderAllDeliveredRevenue: 9000,
  orderAllShippedCount: 0, orderAllShippedRevenue: 0,
  orderAllIntermediateCount: 0, orderAllIntermediateRevenue: 0,
  orderAllCancelledConfirmedCount: 10, orderAllCancelledConfirmedRevenue: 4000,
  orderAllUnpaidCount: 5, orderAllUnpaidRevenue: 1500,
  orderAllReturnRefundCount: 5, orderAllReturnRefundRevenue: 2500,
  orderAllTopCancelledItems: [{ productName: "Kit 5", count: 4, revenue: 1600 }],
};

describe("ReconciliacaoShopee", () => {
  it("Performance → visão reconciliada com os estados do motor", () => {
    render(<ReconciliacaoShopee summary={comOrderAll} marketplace="shopee" />);
    expect(screen.getByText("R$ 50.000,00")).toBeInTheDocument();
    expect(screen.getByText("R$ 53.000,00")).toBeInTheDocument();
    expect(screen.getByText("Concluídos")).toBeInTheDocument();
    expect(screen.getByText("Cancelados confirmados")).toBeInTheDocument();
    expect(screen.getByText("Não pagos")).toBeInTheDocument();
    expect(screen.getByText("Devoluções / Reembolsos")).toBeInTheDocument();
    expect(screen.queryByText("Enviados")).not.toBeInTheDocument(); // 0 pedidos: não vira card
    expect(screen.getByText(/Kit 5/)).toBeInTheDocument();
  });

  it("sem Order.all: explica e não inventa '0 pedidos'", () => {
    render(<ReconciliacaoShopee summary={{ grossRevenueTotal: 1000, orderAllTotalCount: 0 }} marketplace="shopee" />);
    expect(screen.getByText(/Sem Order.all neste processamento/)).toBeInTheDocument();
    expect(screen.queryByText(/0 pedidos/)).not.toBeInTheDocument();
  });

  it("MELI não mostra reconciliação Shopee", () => {
    const { container } = render(<ReconciliacaoShopee summary={comOrderAll} marketplace="meli" />);
    expect(container).toBeEmptyDOMElement();
  });
});
