const fs = require("fs");
const path = require("path");
const { BASE_UPLOAD_PATH, STORAGE_BACKEND } = require("../config/appConfig");

const { promises: fsPromises } = fs;

// Local filesystem implementation (active)
const getAbsolutePath = (storageKey) =>
  path.join(BASE_UPLOAD_PATH, storageKey);

const ensureDirectoryForKey = async (storageKey) => {
  const absolutePath = getAbsolutePath(storageKey);
  const dir = path.dirname(absolutePath);
  await fsPromises.mkdir(dir, { recursive: true });
};

const saveFromTemp = async (tempPath, storageKey) => {
  await ensureDirectoryForKey(storageKey);
  const finalPath = getAbsolutePath(storageKey);
  await fsPromises.rename(tempPath, finalPath);
  return finalPath;
};

const exists = async (storageKey) => {
  try {
    const absolutePath = getAbsolutePath(storageKey);
    await fsPromises.access(absolutePath);
    return true;
  } catch {
    return false;
  }
};

const createReadStream = (storageKey) => {
  const absolutePath = getAbsolutePath(storageKey);
  return fs.createReadStream(absolutePath);
};

// S3 implementation sketch (for future use only)
// When S3 is introduced, uncomment the code below,
// install @aws-sdk/client-s3, and add a small switch
// on STORAGE_BACKEND to delegate to S3 instead of local disk.
//
// const {
//   S3_BUCKET,
//   S3_REGION,
//   S3_ACCESS_KEY_ID,
//   S3_SECRET_ACCESS_KEY,
// } = require("../config/appConfig");
// const {
//   S3Client,
//   PutObjectCommand,
//   GetObjectCommand,
// } = require("@aws-sdk/client-s3");
//
// const s3Client = new S3Client({
//   region: S3_REGION,
//   credentials: {
//     accessKeyId: S3_ACCESS_KEY_ID,
//     secretAccessKey: S3_SECRET_ACCESS_KEY,
//   },
// });
//
// const saveFromTempS3 = async (tempPath, storageKey, mimeType) => {
//   const fileStream = fs.createReadStream(tempPath);
//   await s3Client.send(
//     new PutObjectCommand({
//       Bucket: S3_BUCKET,
//       Key: storageKey,
//       Body: fileStream,
//       ContentType: mimeType,
//     })
//   );
// };
//
// const createReadStreamS3 = async (storageKey) => {
//   const result = await s3Client.send(
//     new GetObjectCommand({
//       Bucket: S3_BUCKET,
//       Key: storageKey,
//     })
//   );
//   return result.Body;
// };

module.exports = {
  STORAGE_BACKEND,
  getAbsolutePath,
  saveFromTemp,
  exists,
  createReadStream,
};

