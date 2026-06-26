const express = require("express");
const { verifyMobileToken } = require("../../middleware/mobileAuth");
const {
  myJobs,
  getJobById,
  postJob,
  nearbyJobs,
  assignProvider,
  cancelJob,
  completeJob,
} = require("../../controllers/mobile/jobs.controller");

const router = express.Router();

router.get("/my-jobs", verifyMobileToken, myJobs);
router.post("/post-job", verifyMobileToken, postJob);
router.get("/nearby-jobs", verifyMobileToken, nearbyJobs);
router.post("/:id/assign", verifyMobileToken, assignProvider);
router.post("/:id/cancel", verifyMobileToken, cancelJob);
router.post("/:id/complete", verifyMobileToken, completeJob);
router.get("/:id", verifyMobileToken, getJobById);

module.exports = router;
