const { ObjectId } = require("mongodb");
const { getDb } = require("../../config/db");

async function myTickets(req, res) {
  try {
    const db = await getDb();

    const tickets = await db
      .collection("tickets")
      .find({ userId: new ObjectId(req.decoded.id) })
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({ success: true, tickets });
  } catch (error) {
    console.error("Get my tickets error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function postTicket(req, res) {
  const { title, description, priority, images } = req.body;

  if (!title || !description || !priority) {
    return res.status(400).json({ message: "All fields are required" });
  }

  try {
    const db = await getDb();

    const result = await db.collection("tickets").insertOne({
      userId: new ObjectId(req.decoded.id),
      title: title.trim(),
      description: description.trim(),
      priority,
      images: Array.isArray(images) ? images : [],
      status: "pending",
      createdAt: new Date(),
    });

    return res.status(201).json({ success: true, ticketId: result.insertedId });
  } catch (error) {
    console.error("Post ticket error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

module.exports = { myTickets, postTicket };
