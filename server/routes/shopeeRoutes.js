const express = require("express");
const {
  callbackShopeeController,
} = require("../controllers/shopeeController");

const router = express.Router();

router.get("/callback", callbackShopeeController);

module.exports = router;
