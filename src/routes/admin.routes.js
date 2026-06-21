const express = require("express");
const { requireAdminAuth } = require("../middleware/adminAuth");
const {
  checkExpiredSubscriptions,
  createManager,
  deleteJob,
  deleteManager,
  deleteUser,
  getJobs,
  getManagers,
  getProviders,
  getSubscription,
  getSubscriptions,
  getTickets,
  getUser,
  getUsers,
  sendNotification,
  updateManager,
  updateSubscriptionStatus,
  updateTicket,
  updateUser,
  uploadImage,
} = require("../controllers/admin.controller");

const router = express.Router();

// Cron-secret authenticated route — not part of the cookie-based admin session
router.get("/check-expired-subscriptions", checkExpiredSubscriptions);

router.use(requireAdminAuth);

router.delete("/delete-job", deleteJob);
router.delete("/delete-manager", deleteManager);
router.delete("/delete-user", deleteUser);
router.get("/get-jobs", getJobs);
router.get("/get-managers", getManagers);
router.get("/get-providers", getProviders);
router.get("/get-subscription", getSubscription);
router.get("/get-subscriptions", getSubscriptions);
router.get("/get-tickets", getTickets);
router.get("/get-user", getUser);
router.get("/get-users", getUsers);
router.post("/create-manager", createManager);
router.post("/send-notification", sendNotification);
router.post("/update-manager", updateManager);
router.post("/update-subscription-status", updateSubscriptionStatus);
router.post("/update-ticket", updateTicket);
router.post("/update-user", updateUser);
router.post("/upload-image", uploadImage);

module.exports = router;
