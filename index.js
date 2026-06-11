const app = require("./src/app");
const env = require("./src/config/env");
const { getClientPromise } = require("./src/config/db");

async function start() {
  await getClientPromise();
  console.log("Connected to MongoDB");

  app.listen(env.port, () => {
    console.log(`Linkaro backend listening on port ${env.port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
