const express = require("express");
const { asyncRoute } = require("../utils/errors");
function dashboardRoutes({ dashboard }) {
  const r = express.Router();
  r.get(
    "/",
    asyncRoute(async (req, res) =>
      res.json({ status: "ok", data: await dashboard.get() }),
    ),
  );
  return r;
}
module.exports = { dashboardRoutes };
