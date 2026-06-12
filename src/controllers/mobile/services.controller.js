const { ObjectId } = require("mongodb");
const { getDb } = require("../../config/db");

async function myServices(req, res) {
  try {
    const db = await getDb();

    const services = await db
      .collection("providerServices")
      .find({ providerId: new ObjectId(req.decoded.id) })
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({ success: true, services });
  } catch (error) {
    console.error("Get my services error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function postService(req, res) {
  const { title, category, description, availability, location, images } = req.body;

  if (!title || !category || !description || !availability || !location) {
    return res.status(400).json({ message: "All fields are required" });
  }

  try {
    const db = await getDb();
    const providerId = new ObjectId(req.decoded.id);

    const user = await db.collection("users").findOne({ _id: providerId });
    if (!user || user.role !== "provider") {
      return res.status(403).json({ message: "Only providers can post services" });
    }

    const categories = Array.isArray(user.categories) ? user.categories : [];
    if (!categories.includes(category)) {
      return res.status(400).json({ message: "Selected category is not in your profile" });
    }

    const existing = await db
      .collection("providerServices")
      .findOne({ providerId, category });
    if (existing) {
      return res.status(409).json({ message: "You already have a service for this category" });
    }

    const result = await db.collection("providerServices").insertOne({
      providerId,
      title: title.trim(),
      category,
      description: description.trim(),
      availability,
      location: location.trim(),
      images: Array.isArray(images) ? images : [],
      createdAt: new Date(),
    });

    return res.status(201).json({ success: true, serviceId: result.insertedId });
  } catch (error) {
    console.error("Post service error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

module.exports = { myServices, postService };
