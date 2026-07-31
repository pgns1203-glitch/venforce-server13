const service = require("../services/designStudio/designStudioService");

function sendError(res, error) {
  const status = error.statusCode || 500;
  if (status >= 500) console.error("[design-studio]", error);
  return res.status(status).json({ ok: false, erro: error.message || "Erro interno.", codigo: error.code });
}

async function listClients(req, res) {
  try { return res.json({ ok: true, clientes: await service.listClients() }); }
  catch (error) { return sendError(res, error); }
}

async function getWorkspace(req, res) {
  try {
    const data = await service.getWorkspace(req.params.clienteId, {
      archived: req.query.archived === "true",
      search: req.query.search,
    });
    return res.json({ ok: true, ...data });
  } catch (error) { return sendError(res, error); }
}

async function updateIdentity(req, res) {
  try {
    const profile = await service.updateIdentity(req.params.clienteId, req.body || {}, req.user?.id);
    return res.json({ ok: true, profile });
  } catch (error) { return sendError(res, error); }
}

async function createItem(req, res) {
  try {
    const item = await service.createItem(req.params.clienteId, req.params.type, req.body || {}, req.user?.id);
    return res.status(201).json({ ok: true, item });
  } catch (error) { return sendError(res, error); }
}

async function getItem(req, res) {
  try {
    return res.json({ ok: true, item: await service.getItem(req.params.clienteId, req.params.type, req.params.id) });
  } catch (error) { return sendError(res, error); }
}

async function updateItem(req, res) {
  try {
    const item = await service.updateItem(req.params.clienteId, req.params.type, req.params.id, req.body || {}, req.user?.id);
    return res.json({ ok: true, item });
  } catch (error) { return sendError(res, error); }
}

async function archiveItem(req, res) {
  try {
    const item = await service.archiveItem(req.params.clienteId, req.params.type, req.params.id, req.body?.archived !== false, req.user?.id);
    return res.json({ ok: true, item });
  } catch (error) { return sendError(res, error); }
}

async function duplicateItem(req, res) {
  try {
    const item = await service.duplicateItem(req.params.clienteId, req.params.type, req.params.id, req.user?.id);
    return res.status(201).json({ ok: true, item });
  } catch (error) { return sendError(res, error); }
}

async function listVersions(req, res) {
  try {
    const versions = await service.listVersions(req.params.clienteId, req.params.type, req.params.id);
    return res.json({ ok: true, versions });
  } catch (error) { return sendError(res, error); }
}

async function restoreVersion(req, res) {
  try {
    const item = await service.restoreVersion(
      req.params.clienteId, req.params.type, req.params.id, req.params.version, req.user?.id
    );
    return res.json({ ok: true, item });
  } catch (error) { return sendError(res, error); }
}

async function generateTemplates(req, res) {
  try {
    const items = await service.generateTemplates(req.params.clienteId, req.body?.quantity, req.user?.id);
    return res.status(201).json({ ok: true, items, total: items.length });
  } catch (error) { return sendError(res, error); }
}

module.exports = {
  listClients, getWorkspace, updateIdentity, createItem, getItem, updateItem,
  archiveItem, duplicateItem, listVersions, restoreVersion, generateTemplates,
};
