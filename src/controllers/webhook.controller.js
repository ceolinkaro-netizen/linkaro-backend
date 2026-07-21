const { ObjectId } = require("mongodb");
const { getDb } = require("../config/db");
const { google } = require("googleapis");
const path = require("path");

const PACKAGE_NAME = "com.linkaro.app";

const NOTIFICATION_TYPE = {
  RENEWED: 2,
  CANCELED: 3,
  PURCHASED: 4,
  REVOKED: 12,
  EXPIRED: 13,
};

async function getAndroidPublisher() {
  const credentials = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT
    ? JSON.parse(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT)
    : require(path.join(__dirname, "../../esoteric-state-495621-q2-c54b98ce87e4.json"));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  });
  return google.androidpublisher({ version: "v3", auth });
}

async function googlePlayWebhook(req, res) {
  // Acknowledge immediately — Pub/Sub retries if it doesn't get 200 quickly
  res.status(200).json({ received: true });
  console.log("[Webhook] Google Play notification received");

  try {
    const message = req.body?.message;
    if (!message?.data) return;

    const decoded = JSON.parse(Buffer.from(message.data, "base64").toString("utf8"));
    const { subscriptionNotification, packageName } = decoded;

    if (!subscriptionNotification || packageName !== PACKAGE_NAME) return;

    const { notificationType, purchaseToken, subscriptionId } = subscriptionNotification;
    const isPro = subscriptionId === "linkaro_pro_monthly";
    const tokenField = isPro ? "subscriptionPurchaseToken" : "badgeSubscriptionPurchaseToken";
    const statusField = isPro ? "subscriptionStatus" : "badgeSubscriptionStatus";
    const expiryField = isPro ? "subscriptionExpiry" : "badgeSubscriptionExpiry";

    const db = await getDb();
    const user = await db.collection("users").findOne({ [tokenField]: purchaseToken });
    if (!user) return;

    if (notificationType === NOTIFICATION_TYPE.RENEWED) {
      const androidPublisher = await getAndroidPublisher();
      const result = await androidPublisher.purchases.subscriptionsv2.get({
        packageName: PACKAGE_NAME,
        token: purchaseToken,
      });
      const lineItem = result.data.lineItems?.find((item) => item.productId === subscriptionId);
      const expiryDate = lineItem?.expiryTime ? new Date(lineItem.expiryTime) : null;

      await Promise.all([
        db.collection("users").updateOne(
          { _id: user._id },
          { $set: { [expiryField]: expiryDate, [statusField]: "active", updatedAt: new Date() } }
        ),
        db.collection("subscriptions").insertOne({
          userId: user._id,
          subscriptionType: isPro ? "Basic Pro Plan" : "Verified Badge",
          paymentOption: "Google Play",
          amountPaid: isPro ? "Rs. 1499 / Month" : "Rs. 999 / Month",
          subscriptionDate: new Date(),
          subscriptionEndDate: expiryDate,
          purchaseToken,
        }),
      ]);
    } else if (
      notificationType === NOTIFICATION_TYPE.REVOKED ||
      notificationType === NOTIFICATION_TYPE.EXPIRED
    ) {
      await db.collection("users").updateOne(
        { _id: user._id },
        { $set: { [statusField]: "inactive", updatedAt: new Date() } }
      );
    }
    // CANCELED (3): user still has access until period ends — no action needed
    // PURCHASED (4): handled by verify endpoint — no action needed
  } catch (error) {
    console.error("Google Play webhook error:", error);
  }
}

module.exports = { googlePlayWebhook };
