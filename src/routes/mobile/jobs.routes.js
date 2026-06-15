const express = require("express");
const { verifyMobileToken } = require("../../middleware/mobileAuth");
const {
  myJobs,
  postJob,
  nearbyJobs,
  assignProvider,
  cancelJob,
} = require("../../controllers/mobile/jobs.controller");

const router = express.Router();

router.get("/my-jobs", verifyMobileToken, myJobs);
router.post("/post-job", verifyMobileToken, postJob);
router.get("/nearby-jobs", verifyMobileToken, nearbyJobs);
router.post("/:id/assign", verifyMobileToken, assignProvider);
router.post("/:id/cancel", verifyMobileToken, cancelJob);

module.exports = router;
