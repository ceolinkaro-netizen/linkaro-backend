const { initializeApp, cert } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const { ObjectId } = require("mongodb");
const env = require("../config/env");
const { getDb } = require("../config/db");

let app = null;

function getFirebaseApp() {
  if (app) return app;

  const { projectId, clientEmail, privateKey } = env.firebase;
  if (!projectId || !clientEmail || !privateKey) {
    console.warn(
      "Firebase credentials not configured; skipping push notification"
    );
    return null;
  }

  app = initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
  return app;
}

// Sends a push notification to a single user's registered device, if they
// have one and haven't turned push notifications off. Callers fire this
// fire-and-forget (same pattern as sendEmail/createNotification) so a push
// failure never blocks the action that triggered it.
async function sendPushNotification({ userId, title, body, data }) {
  const firebaseApp = getFirebaseApp();
  if (!firebaseApp) return;

  const db = await getDb();
  const user = await db
    .collection("users")
    .findOne(
      { _id: new ObjectId(userId) },
      { projection: { fcmToken: 1, pushNotificationsEnabled: 1 } }
    );

  if (!user?.fcmToken || user.pushNotificationsEnabled === false) return;

  const stringData = {};
  for (const [key, value] of Object.entries(data || {})) {
    stringData[key] = String(value);
  }

  try {
    await getMessaging(firebaseApp).send({
      token: user.fcmToken,
      notification: { title, body },
      data: stringData,
      android: { priority: "high" },
    });
  } catch (error) {
    // Token is no longer valid (app uninstalled, etc.) — clear it so future
    // sends don't keep failing against it.
    if (
      error?.code === "messaging/registration-token-not-registered" ||
      error?.code === "messaging/invalid-registration-token"
    ) {
      await db
        .collection("users")
        .updateOne({ _id: new ObjectId(userId) }, { $unset: { fcmToken: "" } });
    } else {
      console.error("Push notification error:", error);
    }
  }
}

module.exports = { sendPushNotification };
