const { ObjectId } = require("mongodb");
const { getDb } = require("../../config/db");

async function myJobs(req, res) {
  try {
    const db = await getDb();

    const jobs = await db
      .collection("jobs")
      .find({ userId: new ObjectId(req.decoded.id) })
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({ success: true, jobs });
  } catch (error) {
    console.error("Get my jobs error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function postJob(req, res) {
  const { title, category, problem, location, scheduledTime } = req.body;

  if (!title || !category || !problem || !location) {
    return res.status(400).json({ message: "All fields are required" });
  }

  try {
    const db = await getDb();

    const result = await db.collection("jobs").insertOne({
      userId: new ObjectId(req.decoded.id),
      title: title.trim(),
      category,
      problem: problem.trim(),
      location: location.trim(),
      scheduledTime: scheduledTime || "ASAP",
      status: "open",
      createdAt: new Date(),
    });

    await db
      .collection("users")
      .updateOne({ _id: new ObjectId(req.decoded.id) }, { $inc: { totalJobs: 1 } });

    return res.status(201).json({ success: true, jobId: result.insertedId });
  } catch (error) {
    console.error("Post job error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

module.exports = { myJobs, postJob };
