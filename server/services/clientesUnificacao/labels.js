// Renumera labels automáticos ("Mercado Livre 2") por marketplace após o merge.
// Identidade nunca depende do nome; só contas com label no padrão automático
// são renomeadas, nomes personalizados e contas inativas ficam intactos.
const AUTO_LABEL = /^(.*?[^\s\d])\s+(\d+)$/;
const BASES = [/^mercado livre$/i, /^shopee$/i, /^tik ?tok(?: shop)?$/i];

// Ordem determinística: principal final, canônico antes de legado, id.
function labelPatches({ accounts, accountPatches, selectedPrimary, target }) {
  const patches = new Map();
  const final = (a) => ({ ...a, ...(accountPatches.get(Number(a.id)) || {}) });
  for (const marketplace of new Set(accounts.map((a) => a.marketplace))) {
    const group = accounts
      .map(final)
      .filter((a) => a.marketplace === marketplace && a.ativo === true)
      .filter((a) => {
        const m = AUTO_LABEL.exec(String(a.nome || "").trim());
        return m && BASES.some((b) => b.test(m[1]));
      });
    const primaryId = selectedPrimary[marketplace];
    const isPrimary = (a) =>
      primaryId != null ? String(a.id) === String(primaryId) : a.is_primary === true;
    group.sort(
      (a, b) =>
        Number(isPrimary(b)) - Number(isPrimary(a)) ||
        Number(String(b.cliente_id) === String(target)) -
          Number(String(a.cliente_id) === String(target)) ||
        Number(a.id) - Number(b.id),
    );
    group.forEach((a, i) => {
      const base = AUTO_LABEL.exec(String(a.nome).trim())[1];
      const nome = `${base} ${i + 1}`;
      if (nome !== a.nome) patches.set(Number(a.id), { nome });
    });
  }
  return patches;
}
module.exports = { labelPatches };
