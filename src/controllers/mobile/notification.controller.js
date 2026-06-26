const { ObjectId } = require("mongodb");
const { getDb } = require("../../config/db");

async function listNotifications(req, res) {
  try {
    const db = await getDb();
    const collection = db.collection("notifications");
    const userId = new ObjectId(req.decoded.id);

    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    // Older than a month is only worth showing if it's still unread —
    // once read, it's served its purpose and just clutters the list.
    const notifications = await collection
      .find({
        userId,
        $or: [{ createdAt: { $gte: oneMonthAgo } }, { read: false }],
      })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    // The response reflects each notification's read state as of this
    // fetch; mark them read afterwards so the next visit shows them read.
    await collection.updateMany(
      { userId, read: false },
      { $set: { read: true } },
    );

    return res.status(200).json({
      success: true,
      notifications: notifications.map((n) => ({
        id: n._id,
        type: n.type,
        message: n.message,
        read: n.read,
        createdAt: n.createdAt,
        jobId: n.jobId || null,
      })),
    });
  } catch (error) {
    console.error("List notifications error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function getUnreadCount(req, res) {
  try {
    const db = await getDb();
    const count = await db.collection("notifications").countDocuments({
      userId: new ObjectId(req.decoded.id),
      read: false,
    });

    return res.status(200).json({ success: true, count });
  } catch (error) {
    console.error("Get unread notification count error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

module.exports = { listNotifications, getUnreadCount };
