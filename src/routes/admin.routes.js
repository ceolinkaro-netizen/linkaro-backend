const express = require("express");
const { requireAdminAuth } = require("../middleware/adminAuth");
const {
  checkExpiredSubscriptions,
  deleteUser,
  getJobs,
  getProviders,
  getSubscription,
  getSubscriptions,
  getUser,
  getUsers,
  updateSubscriptionStatus,
  updateUser,
} = require("../controllers/admin.controller");

const router = express.Router();

// Cron-secret authenticated route — not part of the cookie-based admin session
router.get("/check-expired-subscriptions", checkExpiredSubscriptions);

router.use(requireAdminAuth);

router.delete("/delete-user", deleteUser);
router.get("/get-jobs", getJobs);
router.get("/get-providers", getProviders);
router.get("/get-subscription", getSubscription);
router.get("/get-subscriptions", getSubscriptions);
router.get("/get-user", getUser);
router.get("/get-users", getUsers);
router.post("/update-subscription-status", updateSubscriptionStatus);
router.post("/update-user", updateUser);

module.exports = router;
