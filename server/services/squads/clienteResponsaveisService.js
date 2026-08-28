// server/services/squads/clienteResponsaveisService.js
// P2.4 — Responsabilidades de Cliente (gestor / auxiliar / designer).
//
// ┌─────────────────────────────────────────────────────────────────────┐
// │ RESPONSABILIDADE NÃO É AUTORIZAÇÃO.                                   │
// │ Acesso a um Cliente vem EXCLUSIVAMENTE do Squad                      │
// │ (services/squads/authorizationService.js — que NÃO lê esta tabela). │
// │ Este módulo organiza QUEM cuida do quê; nunca decide QUEM pode ver. │
// └─────────────────────────────────────────────────────────────────────┘
//
// Regras (mission P2.4):
//   - Papéis: gestor, auxiliar, designer.
//   - Operação normal: todo Cliente tem 1 gestor. auxiliar/designer opcionais.
//   - "Último gestor obrigatório" (GESTOR_OBRIGATORIO) protege a REMOÇÃO
//     MANUAL. NÃO se aplica a transferência de Squad nem à migração — esses
//     fluxos encerram responsabilidades por decisão explícita (ver
//     squadService.transferirCliente / squadsMigracaoImportService).
//   - Coordenador de Squad NÃO é admin global: ele administra responsáveis
//     SOMENTE dos Clientes do próprio Squad (gate no controller). Pode ser
//     designado gestor excepcionalmente (é membro do Squad → passa na
//     checagem de acesso normalmente).
//   - Um responsável precisa ter acesso ao Squad ativo do Cliente. Designar
//     alguém de fora só com permitirSemAcesso:true E motivoMigracao — um
//     escape de migração controlado, nunca o caminho normal.

const pool = require("../../config/database");
const squadsRepo = require("./squadsRepository");

const PAPEIS = Object.freeze(["gestor", "auxiliar", "designer"]);
const ROLES_NAO_OPERACIONAIS = new Set(["seller", "shopee_reviewer"]);

function erro(status, code, mensagem) {
  const e = new Error(mensagem);
  e.statusCode = status;
  e.code = code;
  return e;
}

function normalizarPapel(valor) {
  const p = String(valor || "").trim().toLowerCase();
  if (!PAPEIS.includes(p)) {
    throw erro(400, "PAPEL_INVALIDO", `papel deve ser um de: ${PAPEIS.join(", ")}.`);
  }
  return p;
}

async function carregarCliente(clienteId, db = pool) {
  const id = Number(clienteId);
  if (!Number.isInteger(id) || id <= 0) {
    throw erro(404, "CLIENTE_NAO_ENCONTRADO", "Cliente não encontrado.");
  }
  const { rows } = await db.query(
    "SELECT id, slug, nome, ativo FROM clientes WHERE id = $1",
    [id]
  );
  if (!rows.length) throw erro(404, "CLIENTE_NAO_ENCONTRADO", "Cliente não encontrado.");
  return rows[0];
}

async function carregarUsuario(userId, db = pool) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    throw erro(400, "USUARIO_INVALIDO", "userId inválido.");
  }
  const { rows } = await db.query(
    "SELECT id, nome, email, role FROM users WHERE id = $1",
    [id]
  );
  if (!rows.length) throw erro(404, "USUARIO_NAO_ENCONTRADO", "Usuário não encontrado.");
  return rows[0];
}

// Garante que o usuário-alvo pode ser responsável pelo cliente. Um escape de
// migração (permitirSemAcesso + motivoMigracao) é o ÚNICO jeito de designar
// alguém sem acesso ao Squad ativo.
async function validarAcessoDoResponsavel(cliente, usuario, opcoes, db) {
  if (ROLES_NAO_OPERACIONAIS.has(String(usuario.role || "").toLowerCase())) {
    throw erro(422, "RESPONSAVEL_INVALIDO",
      `Usuário com papel '${usuario.role}' não pode ser responsável operacional.`);
  }
  if (String(usuario.role || "").toLowerCase() === "admin") return; // admin acessa qualquer cliente

  const acesso = await squadsRepo.usuarioTemAcessoAoSquadDoCliente(cliente.id, usuario.id, db);
  if (!acesso.temSquad) return; // cliente ainda sem Squad (pré-migração) — nada a validar
  if (acesso.membro) return;

  const escapeValido = opcoes.permitirSemAcesso === true
    && typeof opcoes.motivoMigracao === "string"
    && opcoes.motivoMigracao.trim().length > 0;
  if (!escapeValido) {
    throw erro(409, "RESPONSAVEL_SEM_ACESSO",
      "O usuário não é membro do Squad ativo do cliente. Use permitirSemAcesso:true com motivoMigracao para o caso de migração.");
  }
}

/* ─────────────────────────────── listar ─────────────────────────────── */

async function listar(clienteId, { incluirEncerrados = false } = {}) {
  await squadsRepo.ensureSquadsTables();
  const cliente = await carregarCliente(clienteId);
  const linhas = await squadsRepo.listarResponsaveisDoCliente(cliente.id, { incluirEncerrados });
  const responsaveis = linhas.map((r) => ({
    id: r.id,
    userId: r.user_id,
    nome: r.user_nome || null,
    email: r.user_email || null,
    role: r.user_role || null,
    papel: r.papel,
    ativo: r.ativo === true,
    criadoPor: r.criado_por || null,
    criadoEm: r.created_at,
    atualizadoEm: r.updated_at,
    encerradoEm: r.encerrado_em || null,
    encerradoPor: r.encerrado_por || null,
    motivo: r.motivo || null,
  }));
  const gestoresVigentes = responsaveis.filter((r) => r.ativo && r.papel === "gestor");
  return {
    cliente: { id: cliente.id, slug: cliente.slug, nome: cliente.nome },
    responsaveis,
    // Pendência de organização (NÃO de acesso). O frontend/Carteira pode
    // sinalizar "cliente sem gestor" sem que isso restrinja nada.
    gestorAusente: gestoresVigentes.length === 0,
  };
}

/* ────────────────────────────── atribuir ────────────────────────────── */

async function atribuir(clienteId, { userId, papel, permitirSemAcesso = false, motivoMigracao = null } = {}, actorId = null) {
  await squadsRepo.ensureSquadsTables();
  const papelFinal = normalizarPapel(papel);
  const cliente = await carregarCliente(clienteId);
  const usuario = await carregarUsuario(userId);
  await validarAcessoDoResponsavel(cliente, usuario, { permitirSemAcesso, motivoMigracao }, pool);

  const registro = await squadsRepo.upsertResponsavel({
    clienteId: cliente.id, userId: usuario.id, papel: papelFinal, criadoPor: actorId,
  });
  console.log(`[responsaveis] atribuir cliente=${cliente.id} user=${usuario.id} papel=${papelFinal} por user=${actorId}${motivoMigracao ? ` (migração: ${motivoMigracao})` : ""}`);
  return { atribuido: true, responsavel: registro };
}

/* ─────────────────────────────── trocar ─────────────────────────────── */

// Substitui o(s) titular(es) vigente(s) de um papel por um novo usuário, numa
// única transação. É o caminho SEGURO para trocar o gestor: nunca passa por
// um estado sem gestor, então não esbarra em GESTOR_OBRIGATORIO.
async function trocar(clienteId, papel, { novoUserId, permitirSemAcesso = false, motivoMigracao = null } = {}, actorId = null) {
  await squadsRepo.ensureSquadsTables();
  const papelFinal = normalizarPapel(papel);
  const cliente = await carregarCliente(clienteId);
  const usuario = await carregarUsuario(novoUserId);
  await validarAcessoDoResponsavel(cliente, usuario, { permitirSemAcesso, motivoMigracao }, pool);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const atuais = await squadsRepo.listarResponsaveisDoCliente(cliente.id, { incluirEncerrados: false }, client);
    const encerrados = [];
    for (const r of atuais) {
      if (r.papel !== papelFinal || r.user_id === usuario.id) continue;
      await squadsRepo.encerrarResponsavel({
        clienteId: cliente.id, userId: r.user_id, papel: papelFinal,
        encerradoPor: actorId, motivo: motivoMigracao || "troca_de_responsavel",
      }, client);
      encerrados.push(r.user_id);
    }
    const registro = await squadsRepo.upsertResponsavel({
      clienteId: cliente.id, userId: usuario.id, papel: papelFinal, criadoPor: actorId,
    }, client);
    await client.query("COMMIT");
    console.log(`[responsaveis] trocar cliente=${cliente.id} papel=${papelFinal} -> user=${usuario.id} (encerrados: ${encerrados.join(",") || "-"}) por user=${actorId}`);
    return { trocado: true, responsavel: registro, encerrados };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/* ────────────────────────────── remover ─────────────────────────────── */

async function remover(clienteId, { userId, papel, motivoMigracao = null } = {}, actorId = null) {
  await squadsRepo.ensureSquadsTables();
  const papelFinal = normalizarPapel(papel);
  const cliente = await carregarCliente(clienteId);
  const alvo = await squadsRepo.obterResponsavel(cliente.id, userId, papelFinal);
  if (!alvo || alvo.ativo !== true) {
    throw erro(404, "RESPONSAVEL_NAO_ENCONTRADO", "Responsável vigente não encontrado.");
  }

  // "Último gestor obrigatório" — SOMENTE na remoção manual. Um motivoMigracao
  // explícito destrava (estado de migração tratado). Para trocar de gestor sem
  // gap, use `trocar`.
  if (papelFinal === "gestor") {
    const gestoresVigentes = await squadsRepo.contarResponsaveisAtivos(cliente.id, "gestor");
    const migracao = typeof motivoMigracao === "string" && motivoMigracao.trim().length > 0;
    if (gestoresVigentes <= 1 && !migracao) {
      throw erro(409, "GESTOR_OBRIGATORIO",
        "Não é possível remover o último gestor sem substituição. Use a troca de gestor ou informe motivoMigracao.");
    }
  }

  const r = await squadsRepo.encerrarResponsavel({
    clienteId: cliente.id, userId: Number(userId), papel: papelFinal,
    encerradoPor: actorId, motivo: motivoMigracao || "remocao_manual",
  });
  console.log(`[responsaveis] remover cliente=${cliente.id} user=${userId} papel=${papelFinal} por user=${actorId}${motivoMigracao ? ` (migração: ${motivoMigracao})` : ""}`);
  return { removido: true, responsavel: r };
}

module.exports = {
  PAPEIS,
  listar,
  atribuir,
  trocar,
  remover,
};
