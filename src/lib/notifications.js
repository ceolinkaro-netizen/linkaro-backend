const { ObjectId } = require("mongodb");
const { getDb } = require("../config/db");
const { sendPushNotification } = require("./push");

// Records an in-app notification for a user. Callers fire this
// fire-and-forget (same pattern as sendEmail) so a notification failure
// never blocks the action that triggered it. Pass `io` (req.app.get("io"))
// so the user's home screen badge updates in real time.
//
// `skipPush` is for callers where the client is, by construction, already
// actively connected and aware of the event in real time (e.g. it just
// received this exact job via a socket event and is showing its own toast)
// — sending a push there too would just produce a second, duplicate toast
// the instant the FCM message round-trips back to the same foregrounded app.
async function createNotification({
  userId,
  type,
  message,
  io,
  jobId,
  skipPush = false,
}) {
  const db = await getDb();
  await db.collection("notifications").insertOne({
    userId: new ObjectId(userId),
    type,
    message,
    jobId: jobId ? new ObjectId(jobId) : null,
    read: false,
    createdAt: new Date(),
  });

  if (io) {
    io.to(`user:${userId}`).emit("notification_created", {});
  }

  if (skipPush) return;

  sendPushNotification({
    userId,
    title: "Linkaro",
    body: message,
    data: jobId ? { type, jobId: jobId.toString() } : { type },
  }).catch((err) => console.error("Push notification error:", err));
}

module.exports = { createNotification };
