const { createDashboardService } = require("../services/dashboardService");

const dashboardService = createDashboardService();

async function summary(req, res) {
  try {
    const result = await dashboardService.getSummary({
      user: req.user,
      period: req.query?.period,
      clientes: req.query?.clientes,
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      version: "dashboard-summary-v2",
      data_status: "unavailable",
      erro: "Não foi possível consolidar o Dashboard agora.",
    });
  }
}

module.exports = { summary };
