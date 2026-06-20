const { ObjectId } = require("mongodb");
const { getDb } = require("../config/db");
const env = require("../config/env");
const {
  sendEmail,
  registrationVerifiedEmail,
  registrationUnverifiedEmail,
  subscriptionStatusEmail,
} = require("../lib/mailer");
const { createNotification } = require("../lib/notifications");

const BLOCKED_USER_FIELDS = [
  "password", "role", "subscriptionStatus", "badgeSubscriptionStatus",
  "totalJobs", "_id", "emailVerified", "provider", "providerId", "createdAt",
];

async function checkExpiredSubscriptions(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${env.cronSecret}`) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const db = await getDb();
    const now = new Date();

    const expired = await db
      .collection("subscriptions")
      .find({
        subscriptionEndDate: { $lt: now, $exists: true },
      })
      .project({ _id: 1, userId: 1, subscriptionType: 1 })
      .toArray();

    if (expired.length === 0) {
      return res.status(200).json({ success: true, updated: 0 });
    }

    let updated = 0;

    for (const sub of expired) {
      const isBadge = (sub.subscriptionType || "").toLowerCase().includes("badge");
      const userField = isBadge ? "badgeSubscriptionStatus" : "subscriptionStatus";

      const result = await db.collection("users").updateOne(
        {
          _id: sub.userId,
          [userField]: { $nin: ["inactive", "fraud"] },
        },
        { $set: { [userField]: "inactive" } }
      );

      if (result.modifiedCount > 0) updated++;
    }

    return res.status(200).json({ success: true, updated });
  } catch (error) {
    console.error("Check expired subscriptions error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function deleteUser(req, res) {
  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ message: "id is required" });
  }

  try {
    const db = await getDb();

    await db.collection("users").deleteOne({ _id: new ObjectId(id) });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Delete user error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function getJobs(req, res) {
  try {
    const db = await getDb();

    const jobs = await db
      .collection("jobs")
      .aggregate([
        {
          $lookup: {
            from: "users",
            localField: "userId",
            foreignField: "_id",
            as: "consumer",
          },
        },
        {
          $unwind: {
            path: "$consumer",
            preserveNullAndEmptyArrays: true,
          },
        },
        { $sort: { createdAt: -1 } },
      ])
      .toArray();

    return res.status(200).json({ success: true, jobs });
  } catch (error) {
    console.error("Get jobs error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function getProviders(req, res) {
  try {
    const db = await getDb();

    const providers = await db
      .collection("users")
      .find({
        role: "provider",
        subscriptionStatus: { $ne: "inactive" },
        badgeSubscriptionStatus: { $ne: "inactive" },
      })
      .sort({ subscriptionDate: -1 })
      .project({
        // ── Only remove sensitive fields ──
        password: 0,
        cnicFrontImage: 0,
        cnicBackImage: 0,
      })
      .toArray();

    return res.status(200).json({
      success: true,
      count: providers.length,
      providers,
    });
  } catch (error) {
    console.error("Get providers error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function getSubscription(req, res) {
  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ message: "Subscription ID is required" });
  }

  try {
    const db = await getDb();

    const results = await db
      .collection("subscriptions")
      .aggregate([
        { $match: { _id: new ObjectId(id) } },
        {
          $lookup: {
            from: "users",
            localField: "userId",
            foreignField: "_id",
            as: "user",
          },
        },
        { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 1,
            subscriptionType: 1,
            subscriptionDate: 1,
            amountPaid: 1,
            paymentOption: 1,
            receiptImage: 1,
            createdAt: 1,
            "user.name": 1,
            "user.email": 1,
            "user.phone": 1,
            "user.category": 1,
            "user.gender": 1,
            "user.address": 1,
            "user.cnic": 1,
            "user.profileImage": 1,
            "user.cnicFrontImage": 1,
            "user.cnicBackImage": 1,
            "user.role": 1,
            "user.totalJobs": 1,
            "user.subscriptionStatus": 1,
            "user.badgeSubscriptionStatus": 1,
          },
        },
      ])
      .toArray();

    if (!results.length) {
      return res.status(404).json({ message: "Subscription not found" });
    }

    return res.status(200).json({ success: true, subscription: results[0] });
  } catch (error) {
    console.error("Get subscription error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function getSubscriptions(req, res) {
  try {
    const db = await getDb();

    const subscriptions = await db
      .collection("subscriptions")
      .aggregate([
        {
          $lookup: {
            from: "users",
            localField: "userId",
            foreignField: "_id",
            as: "user",
          },
        },
        { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 1,
            plan: 1,
            subscriptionType: 1,
            subscriptionDate: 1,
            subscriptionEndDate: 1,
            amountPaid: 1,
            paymentMethod: 1,
            dateSubmitted: 1,
            status: 1,

            priority: 1,
            createdAt: 1,
            "user.name": 1,
            "user.email": 1,
            "user.phone": 1,
            "user.category": 1,
            "user.gender": 1,
            "user.address": 1,
            "user.cnic": 1,
            "user.role": 1,
            "user.totalJobs": 1,
            "user.subscriptionStatus": 1,
            "user.badgeSubscriptionStatus": 1,
          },
        },
        { $sort: { createdAt: -1 } },
      ])
      .toArray();

    return res.status(200).json({
      success: true,
      count: subscriptions.length,
      subscriptions,
    });
  } catch (error) {
    console.error("Get subscriptions error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function getUser(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ message: "id is required" });

  try {
    const db = await getDb();

    const user = await db
      .collection("users")
      .findOne(
        { _id: new ObjectId(id) },
        { projection: { password: 0 } }
      );

    if (!user) return res.status(404).json({ message: "User not found" });

    return res.status(200).json({ success: true, user });
  } catch (error) {
    console.error("Get user error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function getUsers(req, res) {
  try {
    const db = await getDb();

    const users = await db
      .collection("users")
      .find({ role: { $in: ["consumer", "provider"] } })
      .project({ password: 0, cnicFrontImage: 0, cnicBackImage: 0 })
      .sort({ createdAt: -1 })
      .toArray();

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const revenueAgg = await db
      .collection("subscriptions")
      .aggregate([
        { $match: { createdAt: { $gte: monthStart }, amountPaid: { $type: "number" } } },
        { $group: { _id: null, total: { $sum: "$amountPaid" } } },
      ])
      .toArray();

    const monthlyRevenue = revenueAgg[0]?.total || 0;
    const serviceProviders = users.filter((u) => u.role === "provider").length;
    const consumers = users.filter((u) => u.role === "consumer").length;

    return res.status(200).json({
      success: true,
      users,
      stats: {
        totalUsers: users.length,
        serviceProviders,
        consumers,
        monthlyRevenue,
      },
    });
  } catch (error) {
    console.error("Get users error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function updateSubscriptionStatus(req, res) {
  const { id, status } = req.body;

  if (!id || !status) {
    return res.status(400).json({ message: "id and status are required" });
  }

  const VALID = ["active", "rejected", "fraud"];
  if (!VALID.includes(status)) {
    return res.status(400).json({ message: "Invalid status value" });
  }

  try {
    const db = await getDb();

    const subscription = await db
      .collection("subscriptions")
      .findOne({ _id: new ObjectId(id) });

    if (!subscription) {
      return res.status(404).json({ message: "Subscription not found" });
    }

    const isBadge = (subscription.subscriptionType || "")
      .toLowerCase()
      .includes("badge");
    const userStatusField = isBadge
      ? "badgeSubscriptionStatus"
      : "subscriptionStatus";

    const user = await db
      .collection("users")
      .findOne({ _id: new ObjectId(subscription.userId) });

    await db
      .collection("users")
      .updateOne(
        { _id: new ObjectId(subscription.userId) },
        { $set: { [userStatusField]: status } },
      );

    // Send email notification
    if (user?.email) {
      const subjects = {
        active: "Your Linkaro subscription has been approved",
        rejected: "Your Linkaro subscription was not approved",
        fraud: "Important notice about your Linkaro subscription",
      };
      const html = subscriptionStatusEmail(
        user.name || "there",
        status,
        subscription.subscriptionType
      );
      sendEmail({ to: user.email, subject: subjects[status], html }).catch((err) =>
        console.error("Email send error:", err)
      );
    }

    if (user) {
      const messages = {
        active: "Your subscription has been approved and activated.",
        rejected: "Your subscription request has been rejected.",
        fraud: "Your subscription has been flagged for review.",
      };
      createNotification({
        userId: user._id,
        type: "subscription_status",
        message: messages[status],
      }).catch((err) => console.error("Notification create error:", err));
    }

    return res.status(200).json({ success: true, status });
  } catch (error) {
    console.error("Update subscription status error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function updateUser(req, res) {
  const { id, ...fields } = req.body;
  if (!id) return res.status(400).json({ message: "id is required" });

  try {
    const db = await getDb();

    const user = await db.collection("users").findOne({ _id: new ObjectId(id) });
    if (!user) return res.status(404).json({ message: "User not found" });

    const update = {};

    if (fields.name)   update.name   = fields.name;
    if (fields.gender) update.gender = fields.gender;
    if (fields.cnic)   update.cnic   = fields.cnic;

    if (fields.phone) {
      update.phone = fields.phone.startsWith("+92") ? fields.phone : `+92${fields.phone}`;
    }

    if (fields.street || fields.city || fields.zip) {
      const existing = user.address || {};
      update.address = {
        street: fields.street ?? existing.street ?? "",
        city:   fields.city   ?? existing.city   ?? "",
        zip:    fields.zip    ?? existing.zip    ?? "",
      };
    }

    if (fields.profileImage) update.profileImage = fields.profileImage;
    if (fields.registrationStatus !== undefined && fields.registrationStatus !== null) update.registrationStatus = fields.registrationStatus;

    if (user.role === "provider") {
      if (fields.category)       update.category       = fields.category;
      if (fields.cnicFrontImage) update.cnicFrontImage = fields.cnicFrontImage;
      if (fields.cnicBackImage)  update.cnicBackImage  = fields.cnicBackImage;
    }

    // Remove any blocked fields that may have slipped through
    BLOCKED_USER_FIELDS.forEach((k) => delete update[k]);

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }

    update.updatedAt = new Date();

    const prevStatus = user.registrationStatus;
    await db.collection("users").updateOne({ _id: new ObjectId(id) }, { $set: update });

    // Send email if registrationStatus changed
    if (
      "registrationStatus" in update &&
      update.registrationStatus !== prevStatus &&
      user.email
    ) {
      const name = update.name || user.name || "there";
      const html = update.registrationStatus === true
        ? registrationVerifiedEmail(name)
        : registrationUnverifiedEmail(name);
      const subject = update.registrationStatus === true
        ? "Your Linkaro account has been verified"
        : "Your Linkaro verification has been revoked";
      sendEmail({ to: user.email, subject, html }).catch((err) =>
        console.error("Email send error:", err)
      );

      createNotification({
        userId: user._id,
        type: "id_approved",
        message: update.registrationStatus === true
          ? "Your ID has been approved!"
          : "Your ID verification has been revoked.",
      }).catch((err) => console.error("Notification create error:", err));
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Update user error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

module.exports = {
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
};
