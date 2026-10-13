// frontend-react/src/utils/financeiro/xlsxMinimo.js
//
// Escritor XLSX mínimo, sem dependência. O frontend-react não tem biblioteca de
// planilha e a planilha de pendências é pequena e plana (cabeçalho + linhas de
// texto/número), então um OOXML de strings inline dentro de um ZIP "stored"
// (sem compressão) basta — e abre no Excel, no LibreOffice e no leitor do
// servidor (`xlsx`), o mesmo que a atualização de Bases de Custo usa.
//
// Decisões que importam para quem preenche e reimporta:
//   · texto é SEMPRE texto (inlineStr): um ID de 12+ dígitos nunca vira
//     notação científica — a causa conhecida dos 0% de cobertura no Shopee;
//   · null/undefined/"" viram célula VAZIA, nunca 0;
//   · número é número (a receita continua somável no Excel).

const ENC = new TextEncoder();

// ── CRC-32 ─────────────────────────────────────────────────────────────────
let TABELA_CRC = null;
function crc32(bytes) {
  if (!TABELA_CRC) {
    TABELA_CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABELA_CRC[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = TABELA_CRC[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ── ZIP (método 0 = stored) ────────────────────────────────────────────────
function montarZip(arquivos) {
  const locais = [];
  const centrais = [];
  let deslocamento = 0;

  // Data/hora DOS fixa (1980-01-01): o conteúdo não depende do relógio.
  const DOS_HORA = 0;
  const DOS_DATA = 0x21;

  for (const { nome, dados } of arquivos) {
    const nomeBytes = ENC.encode(nome);
    const crc = crc32(dados);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // nomes em UTF-8
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, DOS_HORA, true);
    local.setUint16(12, DOS_DATA, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, dados.length, true);
    local.setUint32(22, dados.length, true);
    local.setUint16(26, nomeBytes.length, true);
    local.setUint16(28, 0, true);
    locais.push(new Uint8Array(local.buffer), nomeBytes, dados);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, DOS_HORA, true);
    central.setUint16(14, DOS_DATA, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, dados.length, true);
    central.setUint32(24, dados.length, true);
    central.setUint16(28, nomeBytes.length, true);
    central.setUint32(42, deslocamento, true);
    centrais.push(new Uint8Array(central.buffer), nomeBytes);

    deslocamento += 30 + nomeBytes.length + dados.length;
  }

  const tamanhoCentral = centrais.reduce((s, p) => s + p.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(8, arquivos.length, true);
  fim.setUint16(10, arquivos.length, true);
  fim.setUint32(12, tamanhoCentral, true);
  fim.setUint32(16, deslocamento, true);

  const partes = [...locais, ...centrais, new Uint8Array(fim.buffer)];
  const total = partes.reduce((s, p) => s + p.length, 0);
  const saida = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    saida.set(p, pos);
    pos += p.length;
  }
  return saida;
}

// ── OOXML ──────────────────────────────────────────────────────────────────
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function escapar(texto) {
  return String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // caracteres de controle proibidos em XML 1.0 (menos tab/LF/CR)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function letraDaColuna(indice) {
  let n = indice + 1;
  let letras = "";
  while (n > 0) {
    const resto = (n - 1) % 26;
    letras = String.fromCharCode(65 + resto) + letras;
    n = Math.floor((n - 1) / 26);
  }
  return letras;
}

function celulaXml(valor, referencia, estilo) {
  const s = estilo ? ` s="${estilo}"` : "";
  if (valor === null || valor === undefined || valor === "") return "";
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) return "";
    return `<c r="${referencia}"${s}><v>${valor}</v></c>`;
  }
  return `<c r="${referencia}"${s} t="inlineStr"><is><t xml:space="preserve">${escapar(valor)}</t></is></c>`;
}

function planilhaXml({ linhas, larguras = [] }) {
  const cols = larguras.length
    ? `<cols>${larguras.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const dados = linhas
    .map((linha, r) => {
      // A primeira linha é o cabeçalho (negrito, estilo 1).
      const celulas = linha.map((v, c) => celulaXml(v, `${letraDaColuna(c)}${r + 1}`, r === 0 ? 1 : 0)).join("");
      return `<row r="${r + 1}">${celulas}</row>`;
    })
    .join("");
  return (
    `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `${cols}<sheetData>${dados}</sheetData></worksheet>`
  );
}

const ESTILOS =
  `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
  `</styleSheet>`;

// Nome de aba válido no Excel: sem []:*?/\ , até 31 caracteres.
function nomeDeAba(nome, indice) {
  const limpo = String(nome || "").replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31);
  return limpo || `Planilha${indice + 1}`;
}

// abas: [{ nome, linhas: [[...cabeçalho], [...], ...], larguras?: [n, ...] }]
// Devolve os bytes do .xlsx.
export function gerarXlsx(abas) {
  const lista = (abas || []).filter((a) => a && Array.isArray(a.linhas));
  if (!lista.length) throw new Error("gerarXlsx: nenhuma aba para gravar.");

  const arquivos = [
    {
      nome: "[Content_Types].xml",
      dados: ENC.encode(
        `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
          `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
          lista.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
          `</Types>`
      ),
    },
    {
      nome: "_rels/.rels",
      dados: ENC.encode(
        `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
          `</Relationships>`
      ),
    },
    {
      nome: "xl/workbook.xml",
      dados: ENC.encode(
        `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
          lista.map((a, i) => `<sheet name="${escapar(nomeDeAba(a.nome, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
          `</sheets></workbook>`
      ),
    },
    {
      nome: "xl/_rels/workbook.xml.rels",
      dados: ENC.encode(
        `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          lista.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
          `<Relationship Id="rId${lista.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
          `</Relationships>`
      ),
    },
    { nome: "xl/styles.xml", dados: ENC.encode(ESTILOS) },
    ...lista.map((a, i) => ({ nome: `xl/worksheets/sheet${i + 1}.xml`, dados: ENC.encode(planilhaXml(a)) })),
  ];

  return montarZip(arquivos);
}
