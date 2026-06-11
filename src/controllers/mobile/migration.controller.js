const { getDb } = require("../../config/db");

async function migrateRegistrationStatus(req, res) {
  try {
    const db = await getDb();

    // Set registrationStatus: true on all existing providers that don't have the field yet
    const result = await db.collection("users").updateMany(
      { role: "provider", registrationStatus: { $exists: false } },
      { $set: { registrationStatus: true } }
    );

    return res.status(200).json({
      success: true,
      matched: result.matchedCount,
      updated: result.modifiedCount,
      message: `Updated ${result.modifiedCount} existing provider accounts to registrationStatus: true`,
    });
  } catch (error) {
    console.error("Migration error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

module.exports = { migrateRegistrationStatus };
