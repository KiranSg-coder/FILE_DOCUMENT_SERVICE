const express = require("express");
const router = express.Router();
const upload = require("../config/multerConfig");
const fileController = require("../controllers/fileController");

function handleUpload(req, res, next) {
  upload.array("files", 10)(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message });
    }
    next();
  });
}

router.get("/health", fileController.healthCheck);
router.post("/upload", handleUpload, fileController.uploadFile);
router.get("/:fileUuid", fileController.getFileByUuid);
router.get("/", fileController.listFiles);
router.get("/:fileUuid/download", fileController.downloadFileByUuid);

module.exports = router;
