const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { ObjectId } = require("mongodb");
const { getDb } = require("../../config/db");
const env = require("../../config/env");
const { sendEmail, otpEmail } = require("../../lib/mailer");
const { deleteManyFromCloudinary } = require("../../lib/cloudinary");
const {
  VALID_GENDERS,
  VALID_CATEGORIES,
} = require("../../constants/categories");

const VALID_ROLES = ["consumer", "provider"];
const EMAIL_REGEX = /^[\w\-.]+@([\w-]+\.)+[\w-]{2,}$/;

async function checkAvailability(req, res) {
  const { email, cnic, phone, dialCode, role } = req.body;

  if (!email || !cnic || !role) {
    return res
      .status(400)
      .json({ message: "Email, CNIC and role are required" });
  }

  try {
    const db = await getDb();

    const existingEmail = await db
      .collection("users")
      .findOne({ email: email.toLowerCase().trim(), role });

    // A deactivated account is reactivated by signup, not blocked as a
    // duplicate — mirrors the same check in signupConsumer/signupProvider.
    const reactivateId =
      existingEmail && existingEmail.isActive === false
        ? existingEmail._id
        : null;

    if (existingEmail && !reactivateId) {
      return res.status(409).json({ message: "Email is already registered" });
    }

    const existingCnic = await db.collection("users").findOne({ cnic, role });
    if (existingCnic && !existingCnic._id.equals(reactivateId)) {
      return res.status(409).json({ message: "CNIC is already registered" });
    }

    if (phone) {
      const prefix = dialCode || "+92";
      const fullPhone = `${prefix}${phone}`;
      const existingPhone = await db
        .collection("users")
        .findOne({ phone: fullPhone, role });
      if (existingPhone && !existingPhone._id.equals(reactivateId)) {
        return res
          .status(409)
          .json({ message: "Phone number is already registered" });
      }
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Check availability error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function login(req, res) {
  const { email, password, role } = req.body;

  if (!email || !password || !role) {
    return res
      .status(400)
      .json({ message: "Email, password and role are required" });
  }

  if (!VALID_ROLES.includes(role)) {
    return res
      .status(400)
      .json({ message: "Invalid role. Must be 'consumer' or 'provider'" });
  }

  try {
    const db = await getDb();

    const user = await db
      .collection("users")
      .findOne({ email: email.toLowerCase().trim(), role: role });

    // A deactivated account (from "Delete Account") looks identical to a
    // non-existent one — it can only come back via signup, which reactivates it.
    if (!user || user.isActive === false) {
      return res
        .status(404)
        .json({ message: "There is no user registered with this email" });
    }

    const isHashed = /^\$2[aby]\$/.test(user.password);
    const passwordMatch = isHashed
      ? await bcrypt.compare(password, user.password)
      : password === user.password;

    if (!passwordMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    if (user.role !== role) {
      return res
        .status(403)
        .json({ message: "You don't have access with this role" });
    }

    // Provider whose registration hasn't been approved yet
    if (role === "provider" && user.registrationStatus === false) {
      return res
        .status(200)
        .json({ success: false, registrationPending: true });
    }

    const token = jwt.sign(
      { id: user._id.toString(), email: user.email, role: user.role },
      env.secretKey,
      { expiresIn: "30d" },
    );

    return res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        profileImage: user.profileImage || null,
      },
    });
  } catch (error) {
    console.error("Mobile login error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function providerLogin(req, res) {
  const { email, name, profileImage, provider, providerId, role } = req.body;

  if (!email || !provider || !providerId) {
    return res
      .status(400)
      .json({ message: "Email, provider and providerId are required" });
  }

  try {
    const db = await getDb();

    const normalizedEmail = email.toLowerCase().trim();

    // Look up by email + role so the same email can hold separate consumer/provider accounts
    let user = await db
      .collection("users")
      .findOne({ email: normalizedEmail, role });

    // ── User does not exist, or was deactivated → redirect to signup, which
    // reactivates a deactivated account with the freshly submitted details ──
    if (!user || user.isActive === false) {
      return res.status(200).json({ success: false, newUser: true });
    }

    // ── Registration pending check ────────────────────────────────────────────
    if (user.role === "provider" && user.registrationStatus === false) {
      return res
        .status(200)
        .json({ success: false, registrationPending: true });
    }

    // ── Return token ──────────────────────────────────────────────────────────
    const token = jwt.sign(
      { id: user._id.toString(), email: user.email, role: user.role },
      env.secretKey,
      { expiresIn: "7d" },
    );

    return res.status(200).json({
      success: true,
      token,
      user: {
        name: user.name,
        email: user.email,
        profileImage: user.profileImage,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Social login error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function resetPassword(req, res) {
  const { email, password, role } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  if (!role) {
    return res.status(400).json({ message: "Role is required" });
  }

  if (password.length < 6) {
    return res
      .status(400)
      .json({ message: "Password must be at least 6 characters" });
  }

  try {
    const db = await getDb();

    const query = { email: email.toLowerCase().trim(), role };

    const user = await db.collection("users").findOne(query);

    if (!user) {
      return res
        .status(404)
        .json({ message: "No account found with this email and role" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await db
      .collection("users")
      .updateOne(query, { $set: { password: hashedPassword } });

    return res
      .status(200)
      .json({ success: true, message: "Password updated successfully" });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function sendOtp(req, res) {
  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({ message: "Email and code are required" });
  }

  try {
    await sendEmail({
      to: email,
      subject: "Your Verification Code",
      html: otpEmail(code),
    });

    return res
      .status(200)
      .json({ success: true, message: "OTP sent successfully" });
  } catch (error) {
    console.error("Send OTP error:", error);
    return res.status(500).json({ message: "Failed to send email" });
  }
}

async function signupConsumer(req, res) {
  const {
    fullName,
    phone,
    dialCode,
    countryCode,
    country,
    email,
    cnic,
    password,
    profileImage,
  } = req.body;

  if (!fullName || !phone || !email || !cnic || !password) {
    return res
      .status(400)
      .json({
        message: "Full name, phone, email, CNIC and password are required",
      });
  }

  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ message: "Invalid email address" });
  }

  if (password.length < 6) {
    return res
      .status(400)
      .json({ message: "Password must be at least 6 characters" });
  }

  if (!profileImage) {
    return res.status(400).json({ message: "Profile photo is required" });
  }

  const prefix = dialCode || "+92";
  const fullPhone = `${prefix}${phone}`;

  try {
    const db = await getDb();

    const existing = await db
      .collection("users")
      .findOne({ email: email.toLowerCase().trim(), role: "consumer" });

    // A deactivated account (from "Delete Account") is reactivated with the
    // newly submitted details instead of blocking the signup as a duplicate.
    let reactivateId = null;
    if (existing) {
      if (existing.isActive === false) {
        reactivateId = existing._id;
      } else {
        return res.status(409).json({ message: "Email is already registered" });
      }
    }

    const existingCnic = await db
      .collection("users")
      .findOne({ cnic, role: "consumer" });
    if (existingCnic && !existingCnic._id.equals(reactivateId)) {
      return res.status(409).json({ message: "CNIC is already registered" });
    }

    const existingPhone = await db
      .collection("users")
      .findOne({ phone: fullPhone, role: "consumer" });
    if (existingPhone && !existingPhone._id.equals(reactivateId)) {
      return res
        .status(409)
        .json({ message: "Phone number is already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    if (reactivateId) {
      await db.collection("users").updateOne(
        { _id: reactivateId },
        {
          $set: {
            name: fullName,
            phone: fullPhone,
            dialCode: prefix,
            countryCode: countryCode || "PK",
            cnic,
            password: hashedPassword,
            profileImage,
            isActive: true,
            updatedAt: new Date(),
          },
        }
      );
    } else {
      await db.collection("users").insertOne({
        name: fullName,
        phone: fullPhone,
        dialCode: prefix,
        countryCode: countryCode || "PK",
        email: email.toLowerCase().trim(),
        cnic,
        password: hashedPassword,
        role: "consumer",
        profileImage,
        totalJobs: 0,
        isActive: true,
        createdAt: new Date(),
      });
    }

    return res
      .status(201)
      .json({ success: true, message: "Account created successfully" });
  } catch (error) {
    console.error("Consumer signup error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function signupProvider(req, res) {
  const {
    name,
    phone,
    dialCode,
    countryCode,
    country,
    state,
    email,
    street,
    city,
    cnic,
    zip,
    password,
    gender,
    categories,
    about,
    latitude,
    longitude,
    profileImage,
    cnicFrontImage,
    cnicBackImage,
  } = req.body;

  // Required field check
  if (
    !name ||
    !phone ||
    !email ||
    !street ||
    !city ||
    !cnic ||
    !zip ||
    !password ||
    !gender ||
    !Array.isArray(categories) || categories.length === 0
  ) {
    return res.status(400).json({ message: "All fields are required" });
  }

  // Validation
  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ message: "Invalid email address" });
  }

  if (password.length < 6) {
    return res
      .status(400)
      .json({ message: "Password must be at least 6 characters" });
  }

  if (!VALID_GENDERS.includes(gender)) {
    return res.status(400).json({ message: "Gender must be Male or Female" });
  }

  if (!categories.every((c) => VALID_CATEGORIES.includes(c))) {
    return res.status(400).json({ message: "One or more invalid categories" });
  }

  if (!profileImage || !cnicFrontImage || !cnicBackImage) {
    return res.status(400).json({
      message: "Profile photo, CNIC front and back images are required",
    });
  }

  const prefix = dialCode || "+92";
  const fullPhone = `${prefix}${phone}`;

  try {
    const db = await getDb();

    const existing = await db
      .collection("users")
      .findOne({ email: email.toLowerCase().trim(), role: "provider" });

    // A deactivated account (from "Delete Account") is reactivated with the
    // newly submitted details instead of blocking the signup as a duplicate.
    let reactivateId = null;
    if (existing) {
      if (existing.isActive === false) {
        reactivateId = existing._id;
      } else {
        return res.status(409).json({ message: "Email is already registered" });
      }
    }

    const existingCnic = await db
      .collection("users")
      .findOne({ cnic, role: "provider" });
    if (existingCnic && !existingCnic._id.equals(reactivateId)) {
      return res.status(409).json({ message: "CNIC is already registered" });
    }

    const existingPhone = await db
      .collection("users")
      .findOne({ phone: fullPhone, role: "provider" });
    if (existingPhone && !existingPhone._id.equals(reactivateId)) {
      return res
        .status(409)
        .json({ message: "Phone number is already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const lat = Number(latitude);
    const lng = Number(longitude);
    const geoFields = Number.isFinite(lat) && Number.isFinite(lng)
      ? { geo: { type: "Point", coordinates: [lng, lat] } }
      : {};

    const addressObj = {
      street,
      city,
      zip,
      state: typeof state === "string" ? state : "",
      country: typeof country === "string" ? country : "Pakistan",
    };

    if (reactivateId) {
      // Reactivating: delete services for categories that are no longer selected.
      const oldCategories = existing.categories || (existing.category ? [existing.category] : []);
      const removedCategories = oldCategories.filter((c) => !categories.includes(c));
      if (removedCategories.length > 0) {
        const oldServices = await db
          .collection("providerServices")
          .find({ providerId: reactivateId, category: { $in: removedCategories } })
          .toArray();

        if (oldServices.length > 0) {
          const allImages = oldServices.flatMap((s) => s.images || []);
          deleteManyFromCloudinary(allImages);
          await db
            .collection("providerServices")
            .deleteMany({ providerId: reactivateId, category: { $in: removedCategories } });
        }
      }

      await db.collection("users").updateOne(
        { _id: reactivateId },
        {
          $set: {
            name,
            phone: fullPhone,
            dialCode: prefix,
            countryCode: countryCode || "PK",
            address: addressObj,
            cnic,
            gender,
            categories,
            about: typeof about === "string" ? about.trim() : "",
            password: hashedPassword,
            profileImage,
            cnicFrontImage,
            cnicBackImage,
            registrationStatus: false,
            isActive: true,
            updatedAt: new Date(),
            ...geoFields,
          },
        }
      );
    } else {
      await db.collection("users").insertOne({
        name,
        phone: fullPhone,
        dialCode: prefix,
        countryCode: countryCode || "PK",
        email: email.toLowerCase().trim(),
        address: addressObj,
        cnic,
        gender,
        categories,
        about: typeof about === "string" ? about.trim() : "",
        password: hashedPassword,
        role: "provider",
        profileImage,
        totalJobs: 0,
        cnicFrontImage,
        cnicBackImage,
        subscriptionStatus: "inactive",
        badgeSubscriptionStatus: "inactive",
        registrationStatus: false,
        isActive: true,
        createdAt: new Date(),
        ...geoFields,
      });
    }

    return res
      .status(201)
      .json({ success: true, message: "Account created. Pending approval." });
  } catch (error) {
    console.error("Provider signup error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

// Switches the signed-in user to their other-role account (consumer <->
// provider), matched by email — both signup flows require it, and a single
// person is allowed one account per role. No password re-entry: the
// caller is already authenticated as the same real person.
async function switchRole(req, res) {
  try {
    const db = await getDb();

    const currentUser = await db
      .collection("users")
      .findOne({ _id: new ObjectId(req.decoded.id) });

    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const targetRole =
      currentUser.role === "consumer" ? "provider" : "consumer";

    const targetUser = await db
      .collection("users")
      .findOne({ email: currentUser.email, role: targetRole });

    if (!targetUser || targetUser.isActive === false) {
      return res.status(404).json({
        message: `You don't have a ${targetRole} account to switch to.`,
      });
    }

    if (targetRole === "provider" && targetUser.registrationStatus === false) {
      return res
        .status(200)
        .json({ success: false, registrationPending: true });
    }

    const token = jwt.sign(
      {
        id: targetUser._id.toString(),
        email: targetUser.email,
        role: targetUser.role,
      },
      env.secretKey,
      { expiresIn: "30d" },
    );

    return res
      .status(200)
      .json({ success: true, token, role: targetUser.role });
  } catch (error) {
    console.error("Switch role error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

module.exports = {
  checkAvailability,
  login,
  providerLogin,
  resetPassword,
  sendOtp,
  signupConsumer,
  signupProvider,
  switchRole,
};
