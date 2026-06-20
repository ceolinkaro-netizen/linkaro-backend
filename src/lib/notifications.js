const { ObjectId } = require("mongodb");
const { getDb } = require("../config/db");

// Records an in-app notification for a user. Callers fire this
// fire-and-forget (same pattern as sendEmail) so a notification failure
// never blocks the action that triggered it.
async function createNotification({ userId, type, message }) {
  const db = await getDb();
  await db.collection("notifications").insertOne({
    userId: new ObjectId(userId),
    type,
    message,
    read: false,
    createdAt: new Date(),
  });
}

module.exports = { createNotification };
