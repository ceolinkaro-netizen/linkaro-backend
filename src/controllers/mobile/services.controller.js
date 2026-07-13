const { ObjectId } = require("mongodb");
const { getDb } = require("../../config/db");
const { deleteManyFromCloudinary } = require("../../lib/cloudinary");

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
  const { title, category, description, location, images } = req.body;

  if (!title || !category || !description || !location) {
    return res.status(400).json({ message: "All fields are required" });
  }

  try {
    const db = await getDb();
    const providerId = new ObjectId(req.decoded.id);

    const user = await db.collection("users").findOne({ _id: providerId });
    if (!user || user.role !== "provider") {
      return res.status(403).json({ message: "Only providers can post services" });
    }

    if (!user.categories?.includes(category)) {
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

async function updateService(req, res) {
  const { serviceId, title, category, description, location, images } = req.body;

  if (!serviceId || !title || !category || !description || !location) {
    return res.status(400).json({ message: "All fields are required" });
  }

  try {
    const db = await getDb();
    const providerId = new ObjectId(req.decoded.id);

    const service = await db.collection("providerServices").findOne({
      _id: new ObjectId(serviceId),
      providerId,
    });
    if (!service) {
      return res.status(404).json({ message: "Service not found" });
    }

    const user = await db.collection("users").findOne({ _id: providerId });
    if (!user?.categories?.includes(category)) {
      return res.status(400).json({ message: "Selected category is not in your profile" });
    }

    const existing = await db.collection("providerServices").findOne({
      providerId,
      category,
      _id: { $ne: new ObjectId(serviceId) },
    });
    if (existing) {
      return res.status(409).json({ message: "You already have a service for this category" });
    }

    const newImages = Array.isArray(images) ? images : [];

    await db.collection("providerServices").updateOne(
      { _id: new ObjectId(serviceId) },
      {
        $set: {
          title: title.trim(),
          category,
          description: description.trim(),
          location: location.trim(),
          images: newImages,
          updatedAt: new Date(),
        },
      }
    );

    // Any image dropped from the array during this edit is now orphaned.
    const removedImages = (service.images || []).filter(
      (url) => !newImages.includes(url)
    );
    deleteManyFromCloudinary(removedImages);

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Update service error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

module.exports = { myServices, postService, updateService };
