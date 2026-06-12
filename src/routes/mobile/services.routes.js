const express = require("express");
const { verifyMobileToken } = require("../../middleware/mobileAuth");
const { myServices, postService } = require("../../controllers/mobile/services.controller");

const router = express.Router();

router.get("/my-services", verifyMobileToken, myServices);
router.post("/post-service", verifyMobileToken, postService);

module.exports = router;
