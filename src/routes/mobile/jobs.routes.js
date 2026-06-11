const express = require("express");
const { verifyMobileToken } = require("../../middleware/mobileAuth");
const { myJobs, postJob } = require("../../controllers/mobile/jobs.controller");

const router = express.Router();

router.get("/my-jobs", verifyMobileToken, myJobs);
router.post("/post-job", verifyMobileToken, postJob);

module.exports = router;
