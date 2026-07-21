const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { ObjectId } = require("mongodb");
const { getDb } = require("../../config/db");
const env = require("../../config/env");
const { VALID_CATEGORIES } = require("../../constants/categories");
const { isUserOnline } = require("../../sockets");
const { deleteManyFromCloudinary } = require("../../lib/cloudinary");
const { google } = require("googleapis");
const path = require("path");

const PACKAGE_NAME = "com.linkaro.app";

async function getAndroidPublisher() {
  const credentials = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT
    ? JSON.parse(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT)
    : require(path.join(__dirname, "../../../esoteric-state-495621-q2-c54b98ce87e4.json"));

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  });
  return google.androidpublisher({ version: "v3", auth });
}

function withOnlineStatus(user) {
  const { lastSeenAt, ...rest } = user;
  return {
    ...rest,
    isOnline: isUserOnline(user._id.toString()),
  };
}

async function me(req, res) {
  try {
    const db = await getDb();

    const [user, settings] = await Promise.all([
      db.collection("users").findOne(
        { _id: new ObjectId(req.decoded.id) },
        { projection: { password: 0 } }
      ),
      db.collection("settings").findOne({ key: "subscriptionRequired" }),
    ]);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const subscriptionRequired = settings?.value !== false;
    return res.status(200).json({ success: true, user: { ...user, subscriptionRequired } });
  } catch (error) {
    console.error("Get user error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

// Providers within `radius` km of the consumer's current coordinates,
// ranked by rating, then verified badge, then jobs completed — distance is
// only used as the search cutoff, not for ordering.
async function listProviders(req, res) {
  try {
    const db = await getDb();

    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(200).json({
        success: true,
        needsLocation: true,
        providers: [],
      });
    }

    const radiusKm = Number(req.query.radius) || 10;

    const providers = await db
      .collection("users")
      .aggregate([
        {
          $geoNear: {
            near: { type: "Point", coordinates: [lng, lat] },
            distanceField: "distanceMeters",
            maxDistance: radiusKm * 1000,
            spherical: true,
            query: {
              role: "provider",
              registrationStatus: true,
              subscriptionStatus: "active",
            },
          },
        },
        {
          $addFields: {
            isVerified: {
              $cond: [{ $eq: ["$badgeSubscriptionStatus", "active"] }, 1, 0],
            },
            sortRating: { $ifNull: ["$rating", 0] },
            sortJobsCompleted: { $ifNull: ["$jobsCompleted", 0] },
          },
        },
        {
          $sort: {
            sortRating: -1,
            isVerified: -1,
            sortJobsCompleted: -1,
          },
        },
        {
          $project: {
            name: 1,
            profileImage: 1,
            categories: 1,
            address: 1,
            badgeSubscriptionStatus: 1,
            rating: 1,
            jobsCompleted: 1,
            phone: 1,
            lastSeenAt: 1,
            distanceKm: { $divide: ["$distanceMeters", 1000] },
          },
        },
      ])
      .toArray();

    return res.status(200).json({
      success: true,
      needsLocation: false,
      providers: providers.map(withOnlineStatus),
    });
  } catch (error) {
    console.error("List providers error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function providerDetail(req, res) {
  try {
    const db = await getDb();
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid provider id" });
    }

    const provider = await db.collection("users").findOne(
      { _id: new ObjectId(id), role: "provider" },
      {
        projection: {
          name: 1,
          profileImage: 1,
          category: 1,
          about: 1,
          address: 1,
          badgeSubscriptionStatus: 1,
          rating: 1,
          jobsCompleted: 1,
          phone: 1,
          lastSeenAt: 1,
        },
      }
    );

    if (!provider) {
      return res.status(404).json({ message: "Provider not found" });
    }

    const services = await db
      .collection("providerServices")
      .find({ providerId: new ObjectId(id) })
      .sort({ createdAt: -1 })
      .toArray();

    const reviewedJobs = await db
      .collection("jobs")
      .find({
        assignedProviderId: new ObjectId(id),
        status: "completed",
        review: { $exists: true, $ne: "" },
      })
      .sort({ completedAt: -1 })
      .project({ rating: 1, review: 1, completedAt: 1, userId: 1 })
      .toArray();

    const consumerIds = [
      ...new Set(reviewedJobs.map((job) => job.userId.toString())),
    ].map((consumerId) => new ObjectId(consumerId));

    const consumers = await db
      .collection("users")
      .find({ _id: { $in: consumerIds } })
      .project({ name: 1, profileImage: 1 })
      .toArray();
    const consumerMap = new Map(consumers.map((c) => [c._id.toString(), c]));

    const reviews = reviewedJobs.map((job) => {
      const consumer = consumerMap.get(job.userId.toString());
      return {
        rating: job.rating ?? 0,
        review: job.review ?? "",
        completedAt: job.completedAt,
        consumerName: consumer?.name ?? null,
        consumerProfileImage: consumer?.profileImage ?? null,
      };
    });

    return res.status(200).json({
      success: true,
      provider: withOnlineStatus(provider),
      services,
      reviews,
    });
  } catch (error) {
    console.error("Get provider detail error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function profileImage(req, res) {
  const { id, token } = req.query;

  if (!id || !token) {
    return res.status(400).json({ message: "User ID and token are required" });
  }

  // Verify token
  let decoded;
  try {
    decoded = jwt.verify(token, env.secretKey);
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }

  // Token must belong to the requested user
  if (decoded.id !== id) {
    return res.status(403).json({ message: "Access denied" });
  }

  try {
    const db = await getDb();

    const user = await db
      .collection("users")
      .findOne(
        { _id: new ObjectId(id) },
        {
          projection: {
            profileImage: 1,
            totalJobs: 1,
            jobsCompleted: 1,
            name: 1,
            email: 1,
          },
        }
      );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({
      success: true,
      name: user.name || null,
      email: user.email || null,
      profileImage: user.profileImage || null,
      totalJobs: user.totalJobs ?? 0,
      jobsCompleted: user.jobsCompleted ?? 0,
    });
  } catch (error) {
    console.error("Profile image error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function subscription(req, res) {
  const { subscriptionType, paymentOption, amountPaid, receiptImage } = req.body;

  if (!subscriptionType) {
    return res.status(400).json({ message: "subscriptionType is required" });
  }

  if (!paymentOption) {
    return res.status(400).json({ message: "paymentOption is required" });
  }

  if (!amountPaid) {
    return res.status(400).json({ message: "amountPaid is required" });
  }

  if (!receiptImage) {
    return res.status(400).json({ message: "receiptImage is required" });
  }

  try {
    const db = await getDb();

    const user = await db
      .collection("users")
      .findOne({ _id: new ObjectId(req.decoded.id) });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // subscriptionEndDate is intentionally not set here — it's only set once
    // an admin approves the subscription (see updateSubscriptionStatus).
    // Otherwise the cron that auto-expires subscriptions could flip a still-
    // pending submission to "inactive" before anyone reviewed it.
    const subscriptionDate = new Date();

    await db.collection("subscriptions").insertOne({
      userId: new ObjectId(req.decoded.id),
      subscriptionType,
      paymentOption,
      amountPaid,
      subscriptionDate,
      receiptImage,
    });

    return res.status(201).json({
      success: true,
      message: "Subscription created successfully",
      data: {
        userId: req.decoded.id,
        subscriptionType,
        paymentOption,
        amountPaid,
        subscriptionDate,
        receiptImage,
      },
    });
  } catch (error) {
    console.error("Subscription error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function updateBadgeSubscription(req, res) {
  const { badgeSubscriptionStatus } = req.body;

  if (badgeSubscriptionStatus === undefined || badgeSubscriptionStatus === null) {
    return res.status(400).json({ message: "badgeSubscriptionStatus is required" });
  }

  try {
    const db = await getDb();

    await db
      .collection("users")
      .updateOne(
        { _id: new ObjectId(req.decoded.id) },
        {
          $set: {
            badgeSubscriptionStatus,
            subscriptionDate: new Date(),
            updatedAt: new Date(),
          },
        },
      );

    return res.status(200).json({ success: true, message: "Badge subscription status updated" });
  } catch (error) {
    console.error("Update badge subscription error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function updateProfile(req, res) {
  const { token, ...fields } = req.body;

  try {
    const db = await getDb();

    const user = await db
      .collection("users")
      .findOne({ _id: new ObjectId(req.decoded.id) });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Build update object based on role
    const update = {};

    if (fields.name) update.name = fields.name;
    if (fields.cnic) update.cnic = fields.cnic;
    if (fields.gender) update.gender = fields.gender;
    if (fields.profileImage) update.profileImage = fields.profileImage;

    // Phone — store full E.164 number (dialCode + localNumber)
    if (fields.phone) {
      const prefix = fields.dialCode || user.dialCode || "+92";
      update.phone = fields.phone.startsWith(prefix)
        ? fields.phone
        : `${prefix}${fields.phone}`;
      update.dialCode = prefix;
    }
    if (fields.countryCode) update.countryCode = fields.countryCode;

    // Uniqueness checks (excluding this user, scoped to their role)
    if (update.cnic && update.cnic !== user.cnic) {
      const existingCnic = await db.collection("users").findOne({
        _id: { $ne: user._id },
        cnic: update.cnic,
        role: user.role,
      });
      if (existingCnic) {
        return res.status(409).json({ message: "CNIC is already registered" });
      }
    }

    if (update.phone && update.phone !== user.phone) {
      const existingPhone = await db.collection("users").findOne({
        _id: { $ne: user._id },
        phone: update.phone,
        role: user.role,
      });
      if (existingPhone) {
        return res.status(409).json({ message: "Phone number is already registered" });
      }
    }

    // Address fields
    if (fields.street || fields.city || fields.zip || fields.state !== undefined || fields.country) {
      const existing = user.address || {};
      update.address = {
        street: fields.street ?? existing.street ?? "",
        city: fields.city ?? existing.city ?? "",
        zip: fields.zip ?? existing.zip ?? "",
        state: fields.state ?? existing.state ?? "",
        country: fields.country ?? existing.country ?? "Pakistan",
      };
    }

    // Categories — allowed for any role so auto-add from post_a_service_screen
    // works even when the stored token belongs to the consumer twin account.
    if (Array.isArray(fields.categories) && fields.categories.length > 0) {
      if (!fields.categories.every((c) => VALID_CATEGORIES.includes(c))) {
        return res.status(400).json({ message: "One or more invalid categories" });
      }
      update.categories = fields.categories;
    }

    // Provider-only fields
    if (user.role === "provider") {
      if (fields.email) update.email = fields.email.toLowerCase().trim();
      if (typeof fields.about === "string") {
        update.about = fields.about.trim();
      }
      const lat = Number(fields.latitude);
      const lng = Number(fields.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        update.geo = { type: "Point", coordinates: [lng, lat] };
      }
      if (fields.cnicFrontImage) update.cnicFrontImage = fields.cnicFrontImage;
      if (fields.cnicBackImage) update.cnicBackImage = fields.cnicBackImage;
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }

    // Removing categories invalidates services posted under them — only
    // delete services for categories that are no longer in the provider's list.
    if (update.categories) {
      const oldCategories = user.categories || (user.category ? [user.category] : []);
      const removedCategories = oldCategories.filter((c) => !update.categories.includes(c));
      if (removedCategories.length > 0) {
        const oldServices = await db
          .collection("providerServices")
          .find({ providerId: user._id, category: { $in: removedCategories } })
          .toArray();

        if (oldServices.length > 0) {
          const allImages = oldServices.flatMap((s) => s.images || []);
          deleteManyFromCloudinary(allImages);
          await db
            .collection("providerServices")
            .deleteMany({ providerId: user._id, category: { $in: removedCategories } });
        }
      }
    }

    await db
      .collection("users")
      .updateOne({ _id: new ObjectId(req.decoded.id) }, { $set: update });

    // Tell the provider's own connected socket(s) to rejoin under the new
    // category — room membership doesn't update itself just because the
    // database did, and the socket may well stay connected for the rest
    // of this session without ever reconnecting on its own.
    if (update.categories) {
      const oldSorted = [...(user.categories || (user.category ? [user.category] : []))].sort();
      const newSorted = [...update.categories].sort();
      if (JSON.stringify(oldSorted) !== JSON.stringify(newSorted)) {
        const io = req.app.get("io");
        if (io) io.to(`user:${req.decoded.id}`).emit("category_changed");
      }
    }

    // Replaced images are now orphaned in Cloudinary — clean them up. Fired
    // without awaiting so the response isn't held up by the delete calls.
    const replacedImages = [
      "profileImage",
      "cnicFrontImage",
      "cnicBackImage",
    ]
      .filter((field) => update[field] && update[field] !== user[field])
      .map((field) => user[field]);
    deleteManyFromCloudinary(replacedImages);

    return res.status(200).json({ success: true, message: "Profile updated successfully" });
  } catch (error) {
    console.error("Update profile error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function updateSubscription(req, res) {
  const { subscriptionStatus } = req.body;

  if (subscriptionStatus === undefined || subscriptionStatus === null) {
    return res.status(400).json({ message: "subscriptionStatus is required" });
  }

  try {
    const db = await getDb();

    await db
      .collection("users")
      .updateOne(
        { _id: new ObjectId(req.decoded.id) },
        {
          $set: {
            subscriptionStatus,
            subscriptionDate: new Date(),
            updatedAt: new Date(),
          },
        },
      );

    return res.status(200).json({ success: true, message: "Subscription status updated" });
  } catch (error) {
    console.error("Update subscription error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function verifyPassword(req, res) {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ message: "Password is required" });
  }

  try {
    const db = await getDb();

    const user = await db
      .collection("users")
      .findOne({ _id: new ObjectId(req.decoded.id) });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const isHashed = /^\$2[aby]\$/.test(user.password);
    const passwordMatch = isHashed
      ? await bcrypt.compare(password, user.password)
      : password === user.password;

    if (!passwordMatch) {
      return res.status(401).json({ message: "Incorrect password" });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Verify password error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function checkEmail(req, res) {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  try {
    const db = await getDb();

    const user = await db
      .collection("users")
      .findOne({ _id: new ObjectId(req.decoded.id) });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const existing = await db.collection("users").findOne({
      _id: { $ne: user._id },
      email: normalizedEmail,
      role: user.role,
    });

    if (existing) {
      return res.status(409).json({ message: "Email is already registered" });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Check email error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function updateEmail(req, res) {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  try {
    const db = await getDb();

    const user = await db
      .collection("users")
      .findOne({ _id: new ObjectId(req.decoded.id) });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const existing = await db.collection("users").findOne({
      _id: { $ne: user._id },
      email: normalizedEmail,
      role: user.role,
    });

    if (existing) {
      return res.status(409).json({ message: "Email is already registered" });
    }

    await db
      .collection("users")
      .updateOne({ _id: user._id }, { $set: { email: normalizedEmail } });

    return res.status(200).json({ success: true, message: "Email updated successfully" });
  } catch (error) {
    console.error("Update email error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

// "Delete Account" — soft-deletes the account instead of removing it, so it
// can be reactivated by signing up again with the same email (see
// signupConsumer/signupProvider). Login and provider-switch both treat a
// deactivated account as if it doesn't exist.
async function deactivateAccount(req, res) {
  try {
    const db = await getDb();

    await db
      .collection("users")
      .updateOne(
        { _id: new ObjectId(req.decoded.id) },
        { $set: { isActive: false, updatedAt: new Date() } }
      );

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Deactivate account error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

// Saves/refreshes the device's FCM registration token so push notifications
// can be sent to it. Called on login and whenever Firebase rotates the token.
async function updateFcmToken(req, res) {
  const { fcmToken } = req.body;

  if (!fcmToken) {
    return res.status(400).json({ message: "fcmToken is required" });
  }

  try {
    const db = await getDb();

    await db
      .collection("users")
      .updateOne(
        { _id: new ObjectId(req.decoded.id) },
        { $set: { fcmToken, updatedAt: new Date() } }
      );

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Update FCM token error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

// Server-side mirror of the Settings screen's Push Notifications toggle —
// without this, the server has no way to know it shouldn't send a push,
// since once delivered to a backgrounded/terminated app the OS displays it
// automatically regardless of any in-app preference.
async function updatePushPreference(req, res) {
  const { enabled } = req.body;

  if (typeof enabled !== "boolean") {
    return res.status(400).json({ message: "enabled (boolean) is required" });
  }

  try {
    const db = await getDb();

    await db
      .collection("users")
      .updateOne(
        { _id: new ObjectId(req.decoded.id) },
        { $set: { pushNotificationsEnabled: enabled, updatedAt: new Date() } }
      );

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Update push preference error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function updateLocation(req, res) {
  const lat = Number(req.body.lat);
  const lng = Number(req.body.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ message: "Valid lat and lng are required" });
  }

  try {
    const db = await getDb();
    await db.collection("users").updateOne(
      { _id: new ObjectId(req.decoded.id) },
      {
        $set: {
          geo: { type: "Point", coordinates: [lng, lat] },
          locationUpdatedAt: new Date(),
        },
      }
    );
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Update location error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function verifyGooglePlayPurchase(req, res) {
  const { purchaseToken, productId } = req.body;

  if (!purchaseToken || !productId) {
    return res.status(400).json({ message: "purchaseToken and productId are required" });
  }

  try {
    const androidPublisher = await getAndroidPublisher();

    const result = await androidPublisher.purchases.subscriptionsv2.get({
      packageName: PACKAGE_NAME,
      token: purchaseToken,
    });

    const sub = result.data;

    if (sub.subscriptionState !== "SUBSCRIPTION_STATE_ACTIVE" && sub.subscriptionState !== "SUBSCRIPTION_STATE_IN_GRACE_PERIOD") {
      return res.status(400).json({ success: false, message: "Subscription is not active" });
    }

    const lineItem = sub.lineItems?.find((item) => item.productId === productId);
    if (!lineItem) {
      return res.status(400).json({ success: false, message: "Product not found in purchase" });
    }

    const expiryDate = lineItem.expiryTime ? new Date(lineItem.expiryTime) : null;

    const db = await getDb();
    const userId = req.decoded.id;

    const subscriptionType = productId === "linkaro_pro_monthly" ? "Basic Pro Plan" : "Verified Badge";
    const amountPaid = productId === "linkaro_pro_monthly" ? "Rs. 1499 / Month" : "Rs. 999 / Month";

    let updateFields = { updatedAt: new Date() };
    if (productId === "linkaro_pro_monthly") {
      updateFields.subscriptionStatus = "active";
      updateFields.subscriptionExpiry = expiryDate;
      updateFields.subscriptionPurchaseToken = purchaseToken;
    } else if (productId === "linkaro_verified_monthly") {
      updateFields.badgeSubscriptionStatus = "active";
      updateFields.badgeSubscriptionExpiry = expiryDate;
      updateFields.badgeSubscriptionPurchaseToken = purchaseToken;
    } else {
      return res.status(400).json({ success: false, message: "Unknown product ID" });
    }

    const now = new Date();
    const existingUser = await db.collection("users").findOne({ _id: new ObjectId(userId) });
    await Promise.all([
      db.collection("users").updateOne({ _id: new ObjectId(userId) }, { $set: updateFields }),
      db.collection("subscriptions").insertOne({
        userId: new ObjectId(userId),
        subscriptionType,
        paymentOption: "Google Play",
        amountPaid,
        subscriptionDate: now,
        subscriptionEndDate: expiryDate,
        purchaseToken,
      }),
    ]);

    const io = req.app.get("io");
    if (io) {
      io.to(`user:${userId}`).emit("subscription_updated", {
        subscriptionStatus: productId === "linkaro_pro_monthly" ? "active" : (existingUser?.subscriptionStatus ?? "inactive"),
        badgeSubscriptionStatus: productId === "linkaro_verified_monthly" ? "active" : (existingUser?.badgeSubscriptionStatus ?? "inactive"),
      });
    }

    return res.status(200).json({ success: true, message: "Subscription activated", expiryDate });
  } catch (error) {
    console.error("Google Play purchase verification error:", error);
    return res.status(500).json({ success: false, message: "Failed to verify purchase" });
  }
}

module.exports = {
  me,
  listProviders,
  providerDetail,
  profileImage,
  subscription,
  updateBadgeSubscription,
  updateProfile,
  updateSubscription,
  verifyPassword,
  checkEmail,
  updateEmail,
  deactivateAccount,
  updateFcmToken,
  updatePushPreference,
  updateLocation,
  verifyGooglePlayPurchase,
};
