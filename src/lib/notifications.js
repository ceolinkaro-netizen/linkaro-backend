const { ObjectId } = require("mongodb");
const { getDb } = require("../config/db");
const { sendPushNotification } = require("./push");

// Records an in-app notification for a user. Callers fire this
// fire-and-forget (same pattern as sendEmail) so a notification failure
// never blocks the action that triggered it. Pass `io` (req.app.get("io"))
// so the user's home screen badge updates in real time.
async function createNotification({ userId, type, message, io }) {
  const db = await getDb();
  await db.collection("notifications").insertOne({
    userId: new ObjectId(userId),
    type,
    message,
    read: false,
    createdAt: new Date(),
  });

  if (io) {
    io.to(`user:${userId}`).emit("notification_created", {});
  }

  sendPushNotification({
    userId,
    title: "Linkaro",
    body: message,
    data: { type },
  }).catch((err) => console.error("Push notification error:", err));
}

module.exports = { createNotification };
