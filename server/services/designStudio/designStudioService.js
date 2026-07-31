const crypto = require("crypto");
const repository = require("./designStudioRepository");

const MAX_DOCUMENT_BYTES = 18 * 1024 * 1024;
const PALETTES = [
  { primary: "#5A2A8F", secondary: "#F2B84B", background: "#F7F4FA", text: "#21162C" },
  { primary: "#174C5B", secondary: "#E8A74B", background: "#F3F7F6", text: "#12292F" },
  { primary: "#902C4C", secondary: "#F0C36A", background: "#FFF8F6", text: "#321722" },
  { primary: "#2457A7", secondary: "#74C7B8", background: "#F4F7FC", text: "#152542" },
  { primary: "#2F5D3A", secondary: "#D7A94C", background: "#F6F8F1", text: "#1D2B20" },
  { primary: "#262A33", secondary: "#B7985A", background: "#F5F3EF", text: "#17191F" },
];
const COMPOSITIONS = [
  ["cover-split-v1", "benefits-three-cards-v1", "specifications-grid-v1", "package-list-v1", "dimensions-technical-v1"],
  ["cover-centered-v1", "benefits-orbit-v1", "specifications-cards-v1", "package-grid-v1", "dimensions-clean-v1"],
  ["cover-impact-v1", "benefits-side-list-v1", "specifications-table-v1", "package-focus-v1", "dimensions-panel-v1"],
  ["cover-split-v1", "benefits-orbit-v1", "specifications-table-v1", "package-grid-v1", "dimensions-clean-v1"],
];

function httpError(statusCode, message, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

function positiveId(value, field = "id") {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw httpError(400, `${field} inválido.`);
  return number;
}

function text(value, max = 120) {
  return String(value || "").trim().slice(0, max);
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function validateDocument(value) {
  const document = plainObject(value);
  const size = Buffer.byteLength(JSON.stringify(document));
  if (size > MAX_DOCUMENT_BYTES) {
    throw httpError(413, "O documento excede o limite de 18 MB.", "DOCUMENTO_GRANDE");
  }
  return document;
}

async function requireClient(clienteId) {
  const id = positiveId(clienteId, "cliente_id");
  const client = await repository.getClient(id);
  if (!client) throw httpError(404, "Cliente ativo não encontrado.");
  return client;
}

async function initialize() {
  await repository.ensureDesignStudioTables();
}

async function listClients() {
  await initialize();
  return repository.listClients();
}

async function getWorkspace(clienteId, options = {}) {
  await initialize();
  const client = await requireClient(clienteId);
  const query = { archived: options.archived === true, search: text(options.search, 80) };
  const [profile, accounts, templates, artworks] = await Promise.all([
    repository.getProfile(client.id),
    repository.listAccounts(client.id),
    repository.listItems("template", client.id, query),
    repository.listItems("artwork", client.id, query),
  ]);
  return { client, profile, accounts, templates, artworks };
}

async function updateIdentity(clienteId, body, userId) {
  await initialize();
  const client = await requireClient(clienteId);
  const identity = plainObject(body.identity);
  const normalized = {
    primary: text(identity.primary, 12),
    secondary: text(identity.secondary, 12),
    background: text(identity.background, 12),
    text: text(identity.text, 12),
    fontFamily: text(identity.fontFamily, 80),
    logo: validateDocument(identity.logo),
    notes: text(identity.notes, 1000),
  };
  return repository.saveProfile({
    clienteId: client.id,
    brandName: text(body.brandName, 100),
    identity: normalized,
    userId,
  });
}

function itemType(value) {
  if (value === "templates" || value === "template") return "template";
  if (value === "artworks" || value === "artwork" || value === "artes") return "artwork";
  throw httpError(400, "Tipo de item inválido.");
}

function itemPayload(body, userId) {
  const name = text(body.name, 120);
  if (!name) throw httpError(400, "Nome é obrigatório.");
  return {
    name,
    description: text(body.description, 600),
    document: validateDocument(body.document),
    preview: validateDocument(body.preview),
    accountRef: text(body.accountRef, 160) || null,
    origin: ["manual", "generated", "duplicated"].includes(body.origin) ? body.origin : "manual",
    userId,
  };
}

async function createItem(clienteId, typeValue, body, userId) {
  await initialize();
  const client = await requireClient(clienteId);
  const type = itemType(typeValue);
  const payload = itemPayload(body, userId);
  payload.clienteId = client.id;

  if (type === "artwork" && body.templateId) {
    const templateId = positiveId(body.templateId, "template_id");
    const template = await repository.getItem("template", templateId, client.id);
    if (!template) throw httpError(404, "Template não encontrado.");
    payload.templateId = template.id;
    if (!Object.keys(payload.document).length) payload.document = template.document_json;
    if (!Object.keys(payload.preview).length) payload.preview = template.preview_json;
  }
  return repository.createItem(type, payload);
}

async function updateItem(clienteId, typeValue, idValue, body, userId) {
  await initialize();
  const client = await requireClient(clienteId);
  const type = itemType(typeValue);
  const id = positiveId(idValue);
  const item = await repository.updateItem(type, id, client.id, itemPayload(body, userId));
  if (!item) throw httpError(404, "Item não encontrado.");
  return item;
}

async function getItem(clienteId, typeValue, idValue) {
  await initialize();
  const client = await requireClient(clienteId);
  const type = itemType(typeValue);
  const item = await repository.getItem(type, positiveId(idValue), client.id);
  if (!item) throw httpError(404, "Item não encontrado.");
  return item;
}

async function archiveItem(clienteId, typeValue, idValue, archived, userId) {
  await initialize();
  const client = await requireClient(clienteId);
  const type = itemType(typeValue);
  const item = await repository.archiveItem(type, positiveId(idValue), client.id, archived, userId);
  if (!item) throw httpError(404, "Item não encontrado.");
  return item;
}

async function duplicateItem(clienteId, typeValue, idValue, userId) {
  await initialize();
  const client = await requireClient(clienteId);
  const type = itemType(typeValue);
  const item = await repository.duplicateItem(type, positiveId(idValue), client.id, userId);
  if (!item) throw httpError(404, "Item não encontrado.");
  return item;
}

async function listVersions(clienteId, typeValue, idValue) {
  await initialize();
  const client = await requireClient(clienteId);
  const type = itemType(typeValue);
  const versions = await repository.listVersions(type, positiveId(idValue), client.id);
  if (!versions) throw httpError(404, "Item não encontrado.");
  return versions;
}

async function restoreVersion(clienteId, typeValue, idValue, versionValue, userId) {
  await initialize();
  const client = await requireClient(clienteId);
  const type = itemType(typeValue);
  const result = await repository.restoreVersion(
    type, positiveId(idValue), client.id, positiveId(versionValue, "versão"), userId
  );
  if (result === null) throw httpError(404, "Item não encontrado.");
  if (result === false) throw httpError(404, "Versão não encontrada.");
  return result;
}

function generatedDocument(index, client, profile) {
  const palette = PALETTES[index % PALETTES.length];
  const identity = plainObject(profile.identity);
  const pages = COMPOSITIONS[index % COMPOSITIONS.length].map((rendererId) => ({
    family: rendererId.split("-")[0], rendererId,
  }));
  return {
    version: 3,
    id: crypto.randomUUID(),
    name: `Direção visual ${String(index + 1).padStart(2, "0")}`,
    origin: "gerado",
    clienteId: client.id,
    clienteNome: client.nome,
    marcaNome: profile.brand_name || client.nome,
    segment: "Geral",
    style: `variation-${(index % COMPOSITIONS.length) + 1}`,
    palette: {
      ...palette,
      ...Object.fromEntries(["primary", "secondary", "background", "text"]
        .filter((key) => /^#[0-9a-f]{6}$/i.test(String(identity[key] || "")))
        .map((key) => [key, identity[key]])),
    },
    pages,
    logo: {},
    usesClientIdentity: true,
    product: { name: "", subtitle: "", originalImage: {}, editedImage: {}, placement: { scale: 100, x: 50, y: 50 } },
    content: {},
  };
}

async function generateTemplates(clienteId, quantityValue, userId) {
  await initialize();
  const client = await requireClient(clienteId);
  const profile = await repository.getProfile(client.id);
  const quantity = Math.min(Math.max(Number(quantityValue) || 12, 4), 24);
  const created = [];
  for (let index = 0; index < quantity; index += 1) {
    const document = generatedDocument(index, client, profile);
    // A geração cria estruturas visuais; conteúdo comercial permanece vazio.
    // eslint-disable-next-line no-await-in-loop
    created.push(await repository.createItem("template", {
      clienteId: client.id,
      name: document.name,
      description: "Composição gerada para personalização.",
      document,
      preview: { palette: document.palette, pages: document.pages },
      origin: "generated",
      userId,
    }));
  }
  return created;
}

module.exports = {
  initialize, listClients, getWorkspace, updateIdentity, createItem, updateItem, getItem,
  archiveItem, duplicateItem, listVersions, restoreVersion, generateTemplates,
  _private: { itemType, itemPayload, generatedDocument, validateDocument },
};
