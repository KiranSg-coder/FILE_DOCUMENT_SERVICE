const multer = require("multer");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const { TEMP_UPLOAD_PATH } = require("./appConfig");

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/xml",
  "text/xml",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/octet-stream",
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Ensure temp folder exists before writing the file
    if (!fs.existsSync(TEMP_UPLOAD_PATH)) {
      fs.mkdirSync(TEMP_UPLOAD_PATH, { recursive: true });
    }
    cb(null, TEMP_UPLOAD_PATH);
  },

  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}_${file.originalname}`;
    cb(null, uniqueName);
  },
});

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(new Error("Invalid file type. Only PDF, JPG, PNG, XML, and Excel (XLSX) allowed"));
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: 10 },
});

module.exports = upload;
