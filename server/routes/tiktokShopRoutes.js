const express = require("express");
const {
  callbackTikTokShopController,
} = require("../controllers/tiktokShopController");

const router = express.Router();

router.get("/tiktok/callback", callbackTikTokShopController);

module.exports = router;
