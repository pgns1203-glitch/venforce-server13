import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { VFNumber } from "./index.js";

let agora = 0;
let filas = [];

function movimentoNormal() {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("requestAnimationFrame", (cb) => {
    filas.push(cb);
    return filas.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    filas = [];
  });
  vi.spyOn(performance, "now").mockImplementation(() => agora);
}

function avancar(ms) {
  agora += ms;
  const pendentes = filas;
  filas = [];
  act(() => pendentes.forEach((cb) => cb(agora)));
}

beforeEach(() => {
  agora = 0;
  filas = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("VFNumber — formatação", () => {
  it("usa os formatadores de utils", () => {
    const { rerender } = render(<VFNumber value={1234.5} format="brl" data-testid="n" />);
    expect(screen.getByTestId("n")).toHaveTextContent("R$ 1.234,50");
    rerender(<VFNumber value={0.183} format="pct" data-testid="n" />);
    expect(screen.getByTestId("n")).toHaveTextContent("18,3%");
    rerender(<VFNumber value={1234} data-testid="n" />);
    expect(screen.getByTestId("n")).toHaveTextContent("1.234");
    rerender(<VFNumber value={3} format={(v) => `${v} un`} data-testid="n" />);
    expect(screen.getByTestId("n")).toHaveTextContent("3 un");
  });

  it("zero é zero real; null/NaN/lixo viram —", () => {
    const { rerender } = render(<VFNumber value={0} format="brl" data-testid="n" />);
    expect(screen.getByTestId("n")).toHaveTextContent("R$ 0,00");
    for (const v of [null, undefined, NaN, "abc"]) {
      rerender(<VFNumber value={v} format="brl" data-testid="n" />);
      expect(screen.getByTestId("n").textContent).toBe("—");
    }
  });

  it("string numérica da API vale", () => {
    render(<VFNumber value="12" data-testid="n" />);
    expect(screen.getByTestId("n")).toHaveTextContent("12");
  });

  it("currencyClassName separa o R$ (mantém o −)", () => {
    render(<VFNumber value={-50} format="brl" currencyClassName="cur" data-testid="n" />);
    const el = screen.getByTestId("n");
    expect(el.querySelector(".cur")).toHaveTextContent("−R$");
    expect(el).toHaveTextContent("−R$50,00");
  });
});

describe("VFNumber — movimento reduzido (jsdom)", () => {
  it("troca de valor vai direto ao final, sem destaque e sem nó duplicado", () => {
    const { rerender } = render(<VFNumber value={100} data-testid="n" />);
    rerender(<VFNumber value={200} data-testid="n" />);
    const el = screen.getByTestId("n");
    expect(el.textContent).toBe("200");
    expect(el).not.toHaveClass("vf-motion-flash");
  });
});

describe("VFNumber — movimento normal", () => {
  it("na montagem mostra o final, sem destaque", () => {
    movimentoNormal();
    render(<VFNumber value={100} data-testid="n" />);
    const el = screen.getByTestId("n");
    expect(el.textContent).toBe("100");
    expect(el).not.toHaveClass("vf-motion-flash");
  });

  it("ao mudar: intermediário é aria-hidden, final fica acessível, termina num nó só", () => {
    movimentoNormal();
    const { rerender } = render(<VFNumber value={100} data-testid="n" />);
    rerender(<VFNumber value={200} data-testid="n" />);
    avancar(100);
    const el = screen.getByTestId("n");
    const visivel = el.querySelector('[aria-hidden="true"]');
    const n = Number(visivel.textContent);
    expect(n).toBeGreaterThan(100);
    expect(n).toBeLessThan(200);
    expect(el.querySelector(".vf-visually-hidden")).toHaveTextContent("200");
    avancar(400);
    expect(screen.getByTestId("n").textContent).toBe("200");
  });

  it("destaque neutro por padrão; com goodDirection pinta pelo sentido", () => {
    movimentoNormal();
    const { rerender } = render(<VFNumber value={10} data-testid="n" />);
    rerender(<VFNumber value={20} data-testid="n" />);
    let el = screen.getByTestId("n");
    expect(el).toHaveClass("vf-motion-flash");
    expect(el).not.toHaveClass("is-success");
    expect(el).not.toHaveClass("is-danger");

    rerender(<VFNumber value={30} goodDirection="up" data-testid="n" />);
    expect(screen.getByTestId("n")).toHaveClass("vf-motion-flash", "is-success");

    // custo: subir é ruim
    rerender(<VFNumber value={40} goodDirection="down" data-testid="n" />);
    expect(screen.getByTestId("n")).toHaveClass("is-danger");
  });

  it("ausente → número não destaca nem anima", () => {
    movimentoNormal();
    const { rerender } = render(<VFNumber value={null} data-testid="n" />);
    rerender(<VFNumber value={5} data-testid="n" />);
    const el = screen.getByTestId("n");
    expect(el.textContent).toBe("5");
    expect(el).not.toHaveClass("vf-motion-flash");
    expect(filas).toHaveLength(0);
  });

  it("animate=false e highlight=false desligam cada efeito", () => {
    movimentoNormal();
    const { rerender } = render(<VFNumber value={1} animate={false} highlight={false} data-testid="n" />);
    rerender(<VFNumber value={2} animate={false} highlight={false} data-testid="n" />);
    const el = screen.getByTestId("n");
    expect(el.textContent).toBe("2");
    expect(el).not.toHaveClass("vf-motion-flash");
    expect(filas).toHaveLength(0);
  });
});
