// frontend-react/src/utils/financeiro/arquivos.js
// Download de arquivos gerados no navegador. O XLSX processado NÃO é
// reconstruído aqui: é o `excelBase64` que o backend já devolve.

export function base64ParaBlob(base64, tipo) {
  const binario = atob(String(base64 || ""));
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: tipo });
}

export function baixarBlob(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Mesmo padrão de nome do legado (fechamento-<marketplace>-...), com a
// competência no lugar da data de hoje: o arquivo diz de que mês é.
export function nomeDaPlanilhaProcessada({ marketplace, periodo }) {
  return `fechamento-${marketplace || "marketplace"}-${periodo || "sem-competencia"}.xlsx`;
}
