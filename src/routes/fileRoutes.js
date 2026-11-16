const express = require("express");
const router = express.Router();
const upload = require("../config/multerConfig");
const fileController = require("../controllers/fileController");
const { authenticateUser } = require("../middleware/authenticateUser");

function handleUpload(req, res, next) {
  upload.array("files", 10)(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message });
    }
    next();
  });
}

router.get("/health", fileController.healthCheck);
// P0-R5 / B13: signed, expiring link — the signature is the permission (no token).
router.get("/s/:fileUuid", fileController.serveSignedFile);

// S11: every route below requires a verified user token or the internal service key.
router.use(authenticateUser);
router.post("/upload", handleUpload, fileController.uploadFile);
router.get("/:fileUuid/signed-link", fileController.createSignedLink);
router.get("/:fileUuid", fileController.getFileByUuid);
router.get("/", fileController.listFiles);
router.get("/:fileUuid/download", fileController.downloadFileByUuid);

module.exports = router;
