import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAnimatedNumber } from "./useAnimatedNumber.js";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion.js";

// rAF controlado na mão: cada `avancar(ms)` roda um frame naquele instante.
let agora = 0;
let filas = [];

beforeEach(() => {
  agora = 0;
  filas = [];
  vi.stubGlobal("requestAnimationFrame", (cb) => {
    filas.push(cb);
    return filas.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    filas = [];
  });
  vi.spyOn(performance, "now").mockImplementation(() => agora);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function avancar(ms) {
  agora += ms;
  const pendentes = filas;
  filas = [];
  act(() => pendentes.forEach((cb) => cb(agora)));
}

describe("useAnimatedNumber", () => {
  it("primeiro render já devolve o valor final (não conta do zero)", () => {
    const { result } = renderHook(() => useAnimatedNumber(1500));
    expect(result.current).toBe(1500);
    expect(filas).toHaveLength(0);
  });

  it("ao mudar, interpola do anterior para o novo e termina exato", () => {
    const { result, rerender } = renderHook(({ v }) => useAnimatedNumber(v, { duracao: 300 }), {
      initialProps: { v: 100 },
    });
    rerender({ v: 200 });
    avancar(150);
    expect(result.current).toBeGreaterThan(100);
    expect(result.current).toBeLessThan(200);
    avancar(150);
    expect(result.current).toBe(200);
    expect(filas).toHaveLength(0);
  });

  it("mudança no meio parte do valor que está na tela", () => {
    const { result, rerender } = renderHook(({ v }) => useAnimatedNumber(v, { duracao: 300 }), {
      initialProps: { v: 0 },
    });
    rerender({ v: 100 });
    avancar(150);
    const meio = result.current;
    rerender({ v: 0 });
    avancar(1);
    expect(result.current).toBeLessThanOrEqual(meio);
    expect(result.current).toBeGreaterThan(0);
  });

  it("valor ausente ou não finito não anima", () => {
    const { result, rerender } = renderHook(({ v }) => useAnimatedNumber(v), {
      initialProps: { v: 10 },
    });
    rerender({ v: null });
    expect(result.current).toBeNull();
    rerender({ v: 20 });
    expect(result.current).toBe(20);
    expect(filas).toHaveLength(0);
  });

  it("desativado devolve o final sem agendar frame", () => {
    const { result, rerender } = renderHook(({ v }) => useAnimatedNumber(v, { desativado: true }), {
      initialProps: { v: 1 },
    });
    rerender({ v: 2 });
    expect(result.current).toBe(2);
    expect(filas).toHaveLength(0);
  });
});

describe("usePrefersReducedMotion", () => {
  it("sem matchMedia (jsdom) assume movimento reduzido", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
  });

  it("segue o media query e reage à mudança", () => {
    const ouvintes = new Set();
    const mql = {
      matches: false,
      addEventListener: (_e, fn) => ouvintes.add(fn),
      removeEventListener: (_e, fn) => ouvintes.delete(fn),
    };
    vi.stubGlobal("matchMedia", () => mql);
    const { result, unmount } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
    mql.matches = true;
    act(() => ouvintes.forEach((fn) => fn()));
    expect(result.current).toBe(true);
    unmount();
    expect(ouvintes.size).toBe(0);
  });
});
