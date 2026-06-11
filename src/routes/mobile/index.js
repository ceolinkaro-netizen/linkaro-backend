const express = require("express");
const authRoutes = require("./auth.routes");
const jobsRoutes = require("./jobs.routes");
const userRoutes = require("./user.routes");
const { migrateRegistrationStatus } = require("../../controllers/mobile/migration.controller");

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/jobs", jobsRoutes);
router.use("/user", userRoutes);
router.post("/migrate-registration-status", migrateRegistrationStatus);

module.exports = router;
