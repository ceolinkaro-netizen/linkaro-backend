const { MongoClient } = require("mongodb");
const env = require("./env");

const options = {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 30000,
};

const client = new MongoClient(env.mongodbUri, options);
let clientPromise;

function getClientPromise() {
  if (!clientPromise) {
    clientPromise = client.connect();
  }
  return clientPromise;
}

async function getDb() {
  const connectedClient = await getClientPromise();
  return connectedClient.db("linkaro");
}

// Ensures the geospatial index used for nearby-job lookups exists, and
// backfills the GeoJSON `geo` field on any legacy job documents that only
// have plain `latitude`/`longitude` fields.
async function ensureIndexes() {
  const db = await getDb();
  const jobs = db.collection("jobs");

  await jobs.updateMany(
    {
      latitude: { $exists: true },
      longitude: { $exists: true },
      geo: { $exists: false },
    },
    [
      {
        $set: {
          geo: { type: "Point", coordinates: ["$longitude", "$latitude"] },
        },
      },
    ]
  );

  await jobs.createIndex({ geo: "2dsphere" });

  // Backfill `categories` array from the legacy single `category` string
  // for providers who haven't been migrated yet.
  const users = db.collection("users");
  await users.updateMany(
    {
      role: "provider",
      category: { $exists: true, $type: "string" },
      categories: { $exists: false },
    },
    [{ $set: { categories: ["$category"] } }]
  );

  await jobs.createIndex({ userId: 1, createdAt: -1 });
  await jobs.createIndex({ assignedProviderId: 1, status: 1, completedAt: -1 });

  // Backfill GeoJSON `geo` for providers that only have plain
  // `latitude`/`longitude` (e.g. set before the geo field existed).
  await users.updateMany(
    {
      role: "provider",
      latitude: { $exists: true },
      longitude: { $exists: true },
      geo: { $exists: false },
    },
    [
      {
        $set: {
          geo: { type: "Point", coordinates: ["$longitude", "$latitude"] },
        },
      },
    ]
  );
  await users.createIndex({ geo: "2dsphere" });

  const providerServices = db.collection("providerServices");
  await providerServices.createIndex({ providerId: 1, createdAt: -1 });

  const messages = db.collection("messages");
  await messages.createIndex({ conversationId: 1, createdAt: -1 });

  const conversations = db.collection("conversations");
  await conversations.createIndex({ participants: 1, updatedAt: -1 });

  const notifications = db.collection("notifications");
  await notifications.createIndex({ userId: 1, createdAt: -1 });
  // Guards against a duplicate "nearby job" notification if the client
  // ever calls notify-nearby-match twice for the same job (e.g. a socket
  // event redelivered after a reconnect) before the first insert lands.
  await notifications.createIndex(
    { userId: 1, jobId: 1, type: 1 },
    {
      unique: true,
      partialFilterExpression: { type: "job_nearby" },
    }
  );
}

module.exports = { getDb, getClientPromise, ensureIndexes };
