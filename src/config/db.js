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

module.exports = { getDb, getClientPromise };
