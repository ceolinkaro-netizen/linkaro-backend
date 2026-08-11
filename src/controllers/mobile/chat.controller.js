const { ObjectId } = require("mongodb");
const { getDb } = require("../../config/db");
const { isUserOnline } = require("../../sockets");
const { sendPushNotification } = require("../../lib/push");

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const INBOX_LIMIT = 10;
const VALID_TYPES = ["text", "image", "location", "voice"];

function sortedParticipants(a, b) {
  return [a, b].sort((x, y) => x.toString().localeCompare(y.toString()));
}

async function touchLastSeen(db, userId) {
  await db
    .collection("users")
    .updateOne({ _id: new ObjectId(userId) }, { $set: { lastSeenAt: new Date() } });
}

async function buildConversationSummary(db, conversation, forUserId) {
  const otherId = conversation.participants
    .find((p) => p.toString() !== forUserId)
    .toString();

  const other = await db
    .collection("users")
    .findOne(
      { _id: new ObjectId(otherId) },
      { projection: { name: 1, profileImage: 1 } }
    );

  return {
    conversationId: conversation._id.toString(),
    otherUserId: otherId,
    otherUserName: other?.name ?? null,
    otherUserProfileImage: other?.profileImage ?? null,
    isOnline: isUserOnline(otherId),
    lastMessage: conversation.lastMessage,
    unreadCount: conversation.unreadCount?.[forUserId] ?? 0,
    updatedAt: conversation.updatedAt,
    jobId: conversation.jobId?.toString() ?? null,
    jobTitle: conversation.jobTitle ?? null,
    status: conversation.status ?? "active",
  };
}

// Called by jobs controller after a provider is hired.
// Locks all conversations for the job except the hired provider's.
async function lockJobConversations(db, io, jobId, hiredProviderId) {
  const jobObjId = new ObjectId(jobId);
  const providerObjId = new ObjectId(hiredProviderId);

  const conversations = await db
    .collection("conversations")
    .find({ jobId: jobObjId })
    .toArray();

  for (const conv of conversations) {
    const isHiredSession = conv.participants.some(
      (p) => p.toString() === hiredProviderId
    );
    if (!isHiredSession) {
      await db
        .collection("conversations")
        .updateOne({ _id: conv._id }, { $set: { status: "locked" } });
      if (io) {
        io.to(`conv:${conv._id.toString()}`).emit("conversation_status_changed", {
          conversationId: conv._id.toString(),
          status: "locked",
        });
        // Update inbox tiles for both participants
        for (const p of conv.participants) {
          io.to(`user:${p.toString()}`).emit("conversation_update", {
            conversationId: conv._id.toString(),
            status: "locked",
          });
        }
      }
    }
  }
}

// Called by jobs controller when a job is completed.
// Closes the active (hired provider) conversation for the job.
async function closeJobConversation(db, io, jobId) {
  const conv = await db
    .collection("conversations")
    .findOne({ jobId: new ObjectId(jobId), status: "active" });

  if (!conv) return;

  await db
    .collection("conversations")
    .updateOne({ _id: conv._id }, { $set: { status: "closed" } });

  if (io) {
    io.to(`conv:${conv._id.toString()}`).emit("conversation_status_changed", {
      conversationId: conv._id.toString(),
      status: "closed",
    });
    for (const p of conv.participants) {
      io.to(`user:${p.toString()}`).emit("conversation_update", {
        conversationId: conv._id.toString(),
        status: "closed",
      });
    }
  }
}

async function startConversation(req, res) {
  const { otherUserId, jobId } = req.body;

  if (!otherUserId || !ObjectId.isValid(otherUserId)) {
    return res.status(400).json({ message: "Valid otherUserId is required" });
  }
  if (!jobId || !ObjectId.isValid(jobId)) {
    return res.status(400).json({ message: "Valid jobId is required" });
  }
  if (otherUserId === req.decoded.id) {
    return res.status(400).json({ message: "Cannot start a conversation with yourself" });
  }

  try {
    const db = await getDb();
    const myId = req.decoded.id;

    // Block check — neither party may start a session with the other if blocked
    const [me, other] = await Promise.all([
      db.collection("users").findOne(
        { _id: new ObjectId(myId) },
        { projection: { blockedUsers: 1 } }
      ),
      db.collection("users").findOne(
        { _id: new ObjectId(otherUserId) },
        { projection: { blockedUsers: 1 } }
      ),
    ]);
    if (
      me?.blockedUsers?.some((id) => id.toString() === otherUserId) ||
      other?.blockedUsers?.some((id) => id.toString() === myId)
    ) {
      return res.status(403).json({ message: "You cannot start a conversation with this user" });
    }

    const participants = sortedParticipants(
      new ObjectId(myId),
      new ObjectId(otherUserId)
    );
    const jobObjId = new ObjectId(jobId);

    // One session per pair per job — return existing if found
    const existing = await db.collection("conversations").findOne({
      participants,
      jobId: jobObjId,
    });

    if (existing) {
      return res.status(200).json({
        success: true,
        conversationId: existing._id,
        jobTitle: existing.jobTitle ?? null,
        status: existing.status ?? "active",
        isNew: false,
      });
    }

    const job = await db.collection("jobs").findOne(
      { _id: jobObjId },
      { projection: { title: 1 } }
    );

    const now = new Date();
    const doc = {
      participants,
      jobId: jobObjId,
      jobTitle: job?.title ?? null,
      status: "active",
      lastMessage: null,
      unreadCount: {},
      createdAt: now,
      updatedAt: now,
    };

    const result = await db.collection("conversations").insertOne(doc);

    return res.status(201).json({
      success: true,
      conversationId: result.insertedId,
      jobTitle: doc.jobTitle,
      status: "active",
      isNew: true,
    });
  } catch (error) {
    console.error("Start conversation error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function getConversations(req, res) {
  try {
    const db = await getDb();
    const myId = req.decoded.id;
    const limit = Math.min(Number(req.query.limit) || INBOX_LIMIT, MAX_LIMIT);
    const cursor = req.query.cursor ? new Date(req.query.cursor) : null;

    await touchLastSeen(db, myId);

    const query = { participants: new ObjectId(myId), jobId: { $exists: true } };
    if (cursor && !isNaN(cursor.getTime())) {
      query.updatedAt = { $lt: cursor };
    }

    // Fetch one extra to determine hasMore
    const docs = await db
      .collection("conversations")
      .find(query)
      .sort({ updatedAt: -1 })
      .limit(limit + 1)
      .toArray();

    const hasMore = docs.length > limit;
    const conversations = docs.slice(0, limit);

    const otherIds = [
      ...new Set(
        conversations.map((c) =>
          c.participants.find((p) => p.toString() !== myId).toString()
        )
      ),
    ].map((id) => new ObjectId(id));

    const users = await db
      .collection("users")
      .find({ _id: { $in: otherIds } })
      .project({ name: 1, profileImage: 1 })
      .toArray();
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    const result = conversations.map((c) => {
      const otherId = c.participants
        .find((p) => p.toString() !== myId)
        .toString();
      const other = userMap.get(otherId);

      return {
        conversationId: c._id.toString(),
        otherUserId: otherId,
        otherUserName: other?.name ?? null,
        otherUserProfileImage: other?.profileImage ?? null,
        isOnline: isUserOnline(otherId),
        lastMessage: c.lastMessage,
        unreadCount: c.unreadCount?.[myId] ?? 0,
        updatedAt: c.updatedAt,
        jobId: c.jobId?.toString() ?? null,
        jobTitle: c.jobTitle ?? null,
        status: c.status ?? "active",
      };
    });

    // nextCursor is the updatedAt of the last returned item
    const nextCursor = conversations.length > 0
      ? conversations[conversations.length - 1].updatedAt?.toISOString()
      : null;

    return res.status(200).json({ success: true, conversations: result, hasMore, nextCursor });
  } catch (error) {
    console.error("Get conversations error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function getMyOpenJobs(req, res) {
  try {
    const db = await getDb();
    const myId = req.decoded.id;
    const providerId = req.query.providerId;

    // Determine which job categories the provider covers
    let allowedCategories = null;
    if (providerId) {
      const provider = await db
        .collection("users")
        .findOne(
          { _id: new ObjectId(providerId) },
          { projection: { categories: 1 } }
        );
      if (provider?.categories?.length) {
        allowedCategories = provider.categories;
      }
    }

    const jobQuery = {
      userId: new ObjectId(myId),
      status: "open",
      assignedProviderId: { $exists: false },
    };
    if (allowedCategories) {
      jobQuery.category = { $in: allowedCategories };
    }

    const jobs = await db
      .collection("jobs")
      .find(jobQuery)
      .project({ title: 1, category: 1, createdAt: 1 })
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      jobs: jobs.map((j) => ({
        _id: j._id.toString(),
        title: j.title,
        category: j.category ?? null,
      })),
    });
  } catch (error) {
    console.error("Get open jobs error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function getMessages(req, res) {
  const { conversationId } = req.params;
  const { before } = req.query;
  const myId = req.decoded.id;

  if (!ObjectId.isValid(conversationId)) {
    return res.status(400).json({ message: "Invalid conversation id" });
  }

  try {
    const db = await getDb();

    const conversation = await db
      .collection("conversations")
      .findOne({ _id: new ObjectId(conversationId) });

    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }
    if (!conversation.participants.some((p) => p.toString() === myId)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const limit = Math.min(
      Number(req.query.limit) || DEFAULT_LIMIT,
      MAX_LIMIT
    );

    const query = { conversationId: new ObjectId(conversationId) };
    if (before) {
      const beforeDate = new Date(before);
      if (!isNaN(beforeDate.getTime())) {
        query.createdAt = { $lt: beforeDate };
      }
    }

    const docs = await db
      .collection("messages")
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .toArray();

    const hasMore = docs.length > limit;
    const page = docs.slice(0, limit).reverse();

    const otherId = conversation.participants
      .find((p) => p.toString() !== myId)
      .toString();
    const otherLastRead = conversation.lastRead?.[otherId]
      ? new Date(conversation.lastRead[otherId])
      : null;

    const messages = page.map((m) => ({
      ...m,
      read:
        m.senderId.toString() === myId &&
        otherLastRead != null &&
        m.createdAt <= otherLastRead,
    }));

    const hadUnread = (conversation.unreadCount?.[myId] ?? 0) > 0;
    const now = new Date();
    await db.collection("conversations").updateOne(
      { _id: new ObjectId(conversationId) },
      { $set: { [`unreadCount.${myId}`]: 0, [`lastRead.${myId}`]: now } }
    );
    await touchLastSeen(db, myId);

    if (hadUnread) {
      const io = req.app.get("io");
      if (io) {
        io.to(`conv:${conversationId}`).emit("messages_read", {
          conversationId,
          userId: myId,
          readAt: now.toISOString(),
        });
        io.to(`user:${myId}`).emit("conversation_update", {
          conversationId,
          unreadCount: 0,
        });
      }
    }

    return res.status(200).json({ success: true, messages, hasMore });
  } catch (error) {
    console.error("Get messages error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function sendMessage(req, res) {
  const {
    conversationId,
    type,
    text,
    attachmentUrl,
    duration,
    latitude,
    longitude,
    address,
  } = req.body;
  const myId = req.decoded.id;

  if (!conversationId || !ObjectId.isValid(conversationId)) {
    return res.status(400).json({ message: "Valid conversationId is required" });
  }
  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ message: "Invalid message type" });
  }

  try {
    const db = await getDb();

    const conversation = await db
      .collection("conversations")
      .findOne({ _id: new ObjectId(conversationId) });

    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }
    if (!conversation.participants.some((p) => p.toString() === myId)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const convStatus = conversation.status ?? "active";
    if (convStatus === "closed") {
      return res.status(403).json({ message: "This conversation is closed" });
    }
    if (convStatus === "locked") {
      // Only the hired provider (the one participant who is a provider) can still
      // send messages — but at this point the session is already locked for
      // everyone. The hired provider's session stays "active"; locked means
      // this is NOT the hired session.
      return res.status(403).json({ message: "This conversation is read-only" });
    }

    const otherId = conversation.participants
      .find((p) => p.toString() !== myId)
      .toString();

    const [recipient, sender] = await Promise.all([
      db.collection("users").findOne({ _id: new ObjectId(otherId) }, { projection: { blockedUsers: 1 } }),
      db.collection("users").findOne({ _id: new ObjectId(myId) }, { projection: { blockedUsers: 1, name: 1 } }),
    ]);
    if (
      recipient?.blockedUsers?.some((id) => id.toString() === myId) ||
      sender?.blockedUsers?.some((id) => id.toString() === otherId)
    ) {
      return res.status(403).json({ message: "You cannot send messages to this user" });
    }

    const now = new Date();

    const messageDoc = {
      conversationId: new ObjectId(conversationId),
      senderId: new ObjectId(myId),
      type,
      text: text ?? null,
      attachmentUrl: attachmentUrl ?? null,
      duration: Number.isFinite(Number(duration)) ? Number(duration) : null,
      latitude: Number.isFinite(Number(latitude)) ? Number(latitude) : null,
      longitude: Number.isFinite(Number(longitude)) ? Number(longitude) : null,
      address: address ?? null,
      createdAt: now,
    };

    const result = await db.collection("messages").insertOne(messageDoc);

    let previewText = text ?? null;
    if (type === "image") previewText = "Photo";
    else if (type === "location") previewText = "Location";
    else if (type === "voice") previewText = "Voice message";

    await db.collection("conversations").updateOne(
      { _id: new ObjectId(conversationId) },
      {
        $set: {
          lastMessage: { type, text: previewText, createdAt: now },
          updatedAt: now,
        },
        $inc: { [`unreadCount.${otherId}`]: 1 },
      }
    );

    await touchLastSeen(db, myId);

    sendPushNotification({
      userId: otherId,
      title: sender?.name || "New message",
      body: previewText || "",
      data: { type: "chat", conversationId },
    }).catch((err) => console.error("Push notification error:", err));

    const savedMessage = { ...messageDoc, _id: result.insertedId, read: false };

    const io = req.app.get("io");
    if (io) {
      // Explicitly stringify ObjectId fields so socket.io always emits plain
      // hex strings regardless of the BSON version's toJSON() behaviour.
      const messageToEmit = {
        _id: result.insertedId.toString(),
        conversationId: conversationId,
        senderId: myId,
        type,
        text: savedMessage.text,
        attachmentUrl: savedMessage.attachmentUrl,
        duration: savedMessage.duration,
        latitude: savedMessage.latitude,
        longitude: savedMessage.longitude,
        address: savedMessage.address,
        createdAt: now.toISOString(),
        read: false,
      };
      io.to(`conv:${conversationId}`).emit("new_message", {
        conversationId,
        message: messageToEmit,
      });

      const updatedConversation = await db
        .collection("conversations")
        .findOne({ _id: new ObjectId(conversationId) });

      for (const participantId of [myId, otherId]) {
        const summary = await buildConversationSummary(
          db,
          updatedConversation,
          participantId
        );
        io.to(`user:${participantId}`).emit("conversation_update", summary);
      }
    }

    return res.status(201).json({ success: true, message: savedMessage });
  } catch (error) {
    console.error("Send message error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function discardConversation(req, res) {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ message: "Invalid conversation id" });
  }
  try {
    const db = await getDb();
    const myId = req.decoded.id;
    const conv = await db.collection("conversations").findOne({
      _id: new ObjectId(id),
      participants: new ObjectId(myId),
    });
    if (!conv) return res.status(404).json({ message: "Not found" });

    const msgCount = await db
      .collection("messages")
      .countDocuments({ conversationId: new ObjectId(id) });
    if (msgCount > 0) {
      return res.status(400).json({ message: "Conversation has messages" });
    }

    await db.collection("conversations").deleteOne({ _id: new ObjectId(id) });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Discard conversation error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

module.exports = {
  startConversation,
  getConversations,
  getMyOpenJobs,
  getMessages,
  sendMessage,
  lockJobConversations,
  closeJobConversation,
  discardConversation,
};
