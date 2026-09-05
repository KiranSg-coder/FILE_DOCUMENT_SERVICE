const path = require("path");

require("dotenv").config();

const BASE_UPLOAD_PATH =
  process.env.BASE_UPLOAD_PATH || "D:/FILE_DOC_STORAGE";

const TEMP_UPLOAD_PATH =
  process.env.TEMP_UPLOAD_PATH || path.join(BASE_UPLOAD_PATH, "temp");

const PORT = Number(process.env.PORT) || 6008;

// Storage backend config
// Currently only "local" is active. When S3 is introduced,
// STORAGE_BACKEND can be switched to "s3" and the S3 settings
// below can be used by the storage service.
const STORAGE_BACKEND = process.env.STORAGE_BACKEND || "local";

// Example S3 configuration (for future use only)
// const S3_BUCKET = process.env.S3_BUCKET;
// const S3_REGION = process.env.S3_REGION;
// const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID;
// const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY;

module.exports = {
  BASE_UPLOAD_PATH,
  TEMP_UPLOAD_PATH,
  PORT,
  STORAGE_BACKEND,
  // S3_BUCKET,
  // S3_REGION,
  // S3_ACCESS_KEY_ID,
  // S3_SECRET_ACCESS_KEY,
};

