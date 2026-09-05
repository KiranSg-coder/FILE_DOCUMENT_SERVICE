require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const sequelizeConnection = require("./config/database");
const { BASE_UPLOAD_PATH, PORT } = require("./config/appConfig");
const fileRoutes = require("./routes/fileRoutes");

const app = express();

const corsOrigin =
  process.env.CORS_ORIGIN === "*"
    ? true
    : (process.env.CORS_ORIGIN || "http://localhost:5173")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
app.use(cors({ origin: corsOrigin, credentials: true }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/files", express.static(BASE_UPLOAD_PATH));

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
