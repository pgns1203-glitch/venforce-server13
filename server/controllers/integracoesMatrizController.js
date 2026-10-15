const { getMatrizStatus } = require("../services/matrizApi/matrizStatusService");

function statusMatrizController(req, res) {
  return res.json(getMatrizStatus());
}

module.exports = { statusMatrizController };
