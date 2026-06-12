const express = require("express");
const { verifyMobileToken } = require("../../middleware/mobileAuth");
const { myServices, postService, updateService } = require("../../controllers/mobile/services.controller");

const router = express.Router();

router.get("/my-services", verifyMobileToken, myServices);
router.post("/post-service", verifyMobileToken, postService);
router.post("/update-service", verifyMobileToken, updateService);

module.exports = router;
