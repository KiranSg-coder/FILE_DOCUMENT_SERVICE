require("./config/loadEnv"); // Phase 1: APP_ENV-aware .env loader (LOCAL_/PROD_ blocks)
const express = require("express");
const cors = require("cors");
const path = require("path");
const sequelizeConnection = require("./config/database");
const { BASE_UPLOAD_PATH, PORT } = require("./config/appConfig");
const fileRoutes = require("./routes/fileRoutes");

const app = express();
app.use(require("./middleware/safeErrorResponses"));

// S12: no wildcard origin with credentials.
const corsOrigin =
  (process.env.CORS_ORIGIN && process.env.CORS_ORIGIN !== "*" ? process.env.CORS_ORIGIN : "http://localhost:5173")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
app.use(cors({ origin: corsOrigin, credentials: true }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// S11: uploaded files are NOT served as public static content. They are only available
// through the authenticated, ownership-checked /files/:uuid/download route.

app.get("/", (req, res) => {
  res.send("File Doc service running....!");
});

app.use("/files", fileRoutes);

sequelizeConnection
  .authenticate()
  .then(() => {
    console.log("Database connection has been established successfully.");
    return sequelizeConnection.sync();
  })
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Error occurred while syncing database: ", err);
  });
