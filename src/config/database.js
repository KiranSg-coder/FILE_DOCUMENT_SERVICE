const { Sequelize } = require("sequelize");

const DB_NAME = process.env.DB_NAME || "TTPL_FILE_DOCUMENT_SERVICE";
const DB_USER = process.env.DB_USER || "auth";
const DB_PASSWORD = process.env.DB_PASSWORD || "1234";
const DB_HOST = process.env.DB_HOST || "DESKTOP-C1F49GD";

const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
  host: DB_HOST,
  dialect: "mssql",
  logging: false,
  dialectOptions: {
    options: {
      encrypt: true,
      trustServerCertificate: true,
    },
  },
  pool: {
    max: 5,
    min: 0,
    idle: 30000,
  },
});

module.exports = sequelize;
