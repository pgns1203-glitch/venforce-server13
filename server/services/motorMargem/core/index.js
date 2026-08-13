// server/services/motorMargem/core/index.js
// Ponto de entrada ÚNICO do núcleo de domínio do Motor de Margem.
//
// Tudo aqui é PURO: sem banco, sem HTTP, sem `require` de config. Qualquer
// interface (Portal, automações, extensão, futura Central) consome estes
// módulos e recebe o mesmo número pela mesma regra.

const sources = require("./marginSources");
const evidence = require("./marginEvidence");
const engine = require("./marginEngine");
const confidence = require("./marginConfidence");
const status = require("./marginStatus");
const item = require("./marginItem");

module.exports = {
  ...sources,
  ...evidence,
  ...engine,
  ...confidence,
  ...status,
  ...item,
  // Namespaces explícitos para quem preferir importar por área.
  sources,
  evidence,
  engine,
  confidence,
  status,
  item,
};
