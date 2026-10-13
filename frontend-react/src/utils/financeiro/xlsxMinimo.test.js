import { describe, it, expect } from "vitest";
import { gerarXlsx } from "./xlsxMinimo.js";

const dv = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

// Lê o diretório central do ZIP (entradas "stored") — suficiente para provar
// que o arquivo é um ZIP íntegro, sem depender de biblioteca.
function entradas(bytes) {
  const v = dv(bytes);
  let fim = bytes.length - 22;
  while (fim >= 0 && v.getUint32(fim, true) !== 0x06054b50) fim -= 1;
  expect(fim).toBeGreaterThanOrEqual(0);
  const total = v.getUint16(fim + 10, true);
  let pos = v.getUint32(fim + 16, true);
  const saida = [];
  for (let i = 0; i < total; i += 1) {
    expect(v.getUint32(pos, true)).toBe(0x02014b50);
    const tamanho = v.getUint32(pos + 24, true);
    const nomeLen = v.getUint16(pos + 28, true);
    const deslocamento = v.getUint32(pos + 42, true);
    const nome = new TextDecoder().decode(bytes.slice(pos + 46, pos + 46 + nomeLen));
    // cabeçalho local aponta para o mesmo nome e os dados vêm logo depois
    expect(v.getUint32(deslocamento, true)).toBe(0x04034b50);
    const ini = deslocamento + 30 + v.getUint16(deslocamento + 26, true);
    saida.push({ nome, dados: new TextDecoder().decode(bytes.slice(ini, ini + tamanho)), crc: v.getUint32(pos + 16, true), bytes: bytes.slice(ini, ini + tamanho) });
    pos += 46 + nomeLen;
  }
  return saida;
}

function crc32(b) {
  let c = 0xffffffff;
  for (const x of b) {
    c ^= x;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

describe("gerarXlsx", () => {
  const bytes = gerarXlsx([
    { nome: "Pendências de custo", linhas: [["Nome do produto", "ID", "Receita"], ["Calça & <Cia> \"x\"", "169417000000123", 150.5], ["Blusa", null, 0]] },
    { nome: "Contexto", linhas: [["Campo", "Valor"], ["Cliente", "Zenite"]] },
  ]);
  const por = Object.fromEntries(entradas(bytes).map((e) => [e.nome, e]));

  it("é um ZIP íntegro com as partes do pacote OOXML e CRC correto em cada parte", () => {
    expect(Object.keys(por)).toEqual([
      "[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml",
      "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml",
    ]);
    for (const e of Object.values(por)) expect(crc32(e.bytes)).toBe(e.crc);
  });

  it("cada aba é uma planilha do workbook, com o nome pedido", () => {
    expect(por["xl/workbook.xml"].dados).toContain('<sheet name="Pendências de custo" sheetId="1"');
    expect(por["xl/workbook.xml"].dados).toContain('<sheet name="Contexto" sheetId="2"');
  });

  it("texto fica texto (ID longo NÃO vira número), número fica número, null/vazio vira célula vazia", () => {
    const aba = por["xl/worksheets/sheet1.xml"].dados;
    expect(aba).toContain('<c r="B2" t="inlineStr"><is><t xml:space="preserve">169417000000123</t></is></c>');
    expect(aba).toContain('<c r="C2"><v>150.5</v></c>');
    expect(aba).toContain('<c r="C3"><v>0</v></c>'); // zero real continua zero
    expect(aba).not.toContain('r="B3"'); // null = ausente = sem célula
  });

  it("escapa XML e cabeçalho (linha 1) em negrito", () => {
    const aba = por["xl/worksheets/sheet1.xml"].dados;
    expect(aba).toContain("Calça &amp; &lt;Cia&gt; &quot;x&quot;");
    expect(aba).toContain('<c r="A1" s="1" t="inlineStr">');
  });

  it("nome de aba inválido é saneado; sem abas é erro", () => {
    const b = gerarXlsx([{ nome: "a/b:c[d]*?", linhas: [["x"]] }]);
    expect(entradas(b).find((e) => e.nome === "xl/workbook.xml").dados).toContain('name="a b c d"');
    expect(() => gerarXlsx([])).toThrow();
  });

  it("caractere de controle proibido em XML é removido", () => {
    const b = gerarXlsx([{ nome: "x", linhas: [["a\u0001b"]] }]);
    expect(entradas(b).find((e) => e.nome === "xl/worksheets/sheet1.xml").dados).toContain(">ab<");
  });
});
