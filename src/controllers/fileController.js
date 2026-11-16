const sequelize = require("../config/database");
const path = require("path");
const fs = require("fs");
const { BASE_UPLOAD_PATH } = require("../config/appConfig");
const storageService = require("../services/storageService");
const { canAccessFile } = require("../middleware/authenticateUser");

/** Strip characters that could break or inject into a Content-Disposition header. */
const safeDownloadName = (name) =>
  String(name || "download").replace(/[\r\n"\\]/g, "_").slice(0, 200);

const { promises: fsPromises } = fs;

const sanitizeFolderPath = (segment) => {
  if (!segment) {
    return "";
  }

  if (
    segment.includes("..") ||
    segment.startsWith("/") ||
    segment.startsWith("\\")
  ) {
    throw new Error("Invalid folder path");
  }

  return segment;
};

const uploadFile = async (req, res) => {
  const uploadedFiles = [];

  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "At least one file is required" });
    }

    const {
      entityCode,
      companyCode,
      branchCode,
      appCode,
      moduleType,
      moduleRefId,
      folderPath,
    } = req.body;

    // S11: the owner is the authenticated user, never a client-supplied value.
    // Internal service calls may attribute an upload on a user's behalf.
    const uploadedBy = req.isInternal ? req.body.uploadedBy || req.userId : req.userId;

    if (
      !entityCode ||
      !companyCode ||
      !branchCode ||
      !appCode ||
      !moduleType ||
      !moduleRefId ||
      !uploadedBy
    ) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const safeFolderPath = sanitizeFolderPath(folderPath || "");

    for (const file of req.files) {
      const storageKey = path
        .join(
          entityCode,
          companyCode,
          branchCode,
          appCode,
          moduleType,
          moduleRefId,
          safeFolderPath,
          file.filename
        )
        .replace(/\\/g, "/");

      await storageService.saveFromTemp(file.path, storageKey);

      const [result] = await sequelize.query(
        `
        EXEC PR_FILE_UPLOAD
          @ENTITYCODE   = :entityCode,
          @COMPANYCODE  = :companyCode,
          @BRANCHCODE   = :branchCode,
          @APP_CODE      = :appCode,
          @MODULETYPE   = :moduleType,
          @MODULEREFID = :moduleRefId,
          @FOLDERPATH   = :folderPath,
          @STORAGEKEY   = :storageKey,
          @FILENAME     = :fileName,
          @FILESIZE     = :fileSize,
          @MIMETYPE     = :mimeType,
          @UPLOADEDBY   = :uploadedBy
        `,
        {
          replacements: {
            entityCode,
            companyCode,
            branchCode,
            appCode,
            moduleType,
            moduleRefId,
            folderPath: safeFolderPath || null,
            storageKey,
            fileName: file.originalname,
            fileSize: file.size,
            mimeType: file.mimetype,
            uploadedBy,
          },
          type: sequelize.QueryTypes.SELECT,
        }
      );

      if (!result?.FILE_ID) {
        throw new Error(result?.MESSAGE || "DB insert failed");
      }

      uploadedFiles.push({
        fileId: result.FILE_ID,
        fileUuid: result.FILEUUID,
        fileName: file.originalname,
        path: storageKey,
      });
    }

    return res.status(201).json({
      message: "Files uploaded successfully",
      files: uploadedFiles,
    });
  } catch (error) {
    console.error("Upload error:", error);

    if (req.files) {
      await Promise.all(
        req.files.map(async (file) => {
          try {
            await fsPromises.unlink(file.path);
          } catch (err) {
            // ignore cleanup errors
          }
        })
      );
    }

    return res.status(500).json({
      message: "File upload failed. Please try again.",
    });
  }
};

const getFileByUuid = async (req, res) => {
  try {
    const { fileUuid } = req.params;

    if (!fileUuid) {
      return res.status(400).json({ message: "File UUID is required" });
    }

    const [fileData] = await sequelize.query(
      `
      EXEC PR_GET_FILE_BY_UUID
        @FILEUUID = :fileUuid
      `,
      {
        replacements: { fileUuid },
        type: sequelize.QueryTypes.SELECT,
      }
    );

    // S11: same 404 for "missing" and "not yours" so ids cannot be probed.
    if (!fileData || !canAccessFile(req, fileData)) {
      return res.status(404).json({ message: "File not found" });
    }

    const existsOnStorage = await storageService.exists(fileData.STORAGEKEY);

    if (!existsOnStorage) {
      return res.status(404).json({
        message: "File not found",
      });
    }

    const storageKeyUrl = fileData.STORAGEKEY.replace(/\\/g, "/");
    // Authenticated, ownership-checked download route (no public static paths).
    const downloadUrl = `/files/${encodeURIComponent(fileUuid)}/download`;
    void storageKeyUrl;

    return res.json({
      fileName: fileData.FILENAME,
      mimeType: fileData.MIMETYPE,
      downloadUrl,
    });
  } catch (error) {
    console.error("File fetch error:", error);
    return res.status(500).json({
      message: "Failed to retrieve file",
    });
  }
};

const downloadFileByUuid = async (req, res) => {
  try {
    const { fileUuid } = req.params;

    if (!fileUuid) {
      return res.status(400).json({
        message: "File UUID is required",
      });
    }

    const [fileData] = await sequelize.query(
      `EXEC PR_GET_FILE_BY_UUID @FILEUUID = :fileUuid`,
      {
        replacements: { fileUuid },
        type: sequelize.QueryTypes.SELECT,
      }
    );

    // S11: owner (or internal service) only; same 404 for missing and not-yours.
    if (!fileData || !canAccessFile(req, fileData)) {
      return res.status(404).json({
        message: "File not found",
      });
    }

    const existsOnStorage = await storageService.exists(fileData.STORAGEKEY);

    if (!existsOnStorage) {
      return res.status(404).json({
        message: "File not found",
      });
    }

    const absolutePath = storageService.getAbsolutePath(fileData.STORAGEKEY);

    res.setHeader("Content-Type", fileData.MIMETYPE);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeDownloadName(fileData.FILENAME)}"`
    );
    res.setHeader("Content-Length", fileData.FILESIZE);

    const stream = fs.createReadStream(absolutePath);
    stream.pipe(res);

    stream.on("error", (err) => {
      console.error("Download stream error:", err);
      res.status(500).end();
    });
  } catch (error) {
    console.error("Download error:", error);
    return res.status(500).json({
      message: "Failed to download file",
    });
  }
};

const listFiles = async (req, res) => {
  try {
    const {
      entityCode,
      companyCode,
      branchCode,
      appCode,
      moduleType,
      moduleRefId,
    } = req.query;

    const files = await sequelize.query(
      `
      EXEC PR_GET_FILES_LIST
        @ENTITYCODE   = :entityCode,
        @COMPANYCODE  = :companyCode,
        @BRANCHCODE   = :branchCode,
        @APP_CODE      = :appCode,
        @MODULETYPE   = :moduleType,
        @MODULEREFID = :moduleRefId
      `,
      {
        replacements: {
          entityCode: entityCode || null,
          companyCode: companyCode || null,
          branchCode: branchCode || null,
          appCode: appCode || null,
          moduleType: moduleType || null,
          moduleRefId: moduleRefId || null,
        },
        type: sequelize.QueryTypes.SELECT,
      }
    );

    // S11: users only ever see their own files; internal callers see the filtered set.
    const visible = req.isInternal
      ? files
      : files.filter((file) => String(file.UPLOADEDBY ?? "") === String(req.userId));

    const response = visible.map((file) => ({
      fileUuid: file.FILEUUID,
      fileName: file.FILENAME,
      fileSize: file.FILESIZE,
      mimeType: file.MIMETYPE,
      uploadedBy: file.UPLOADEDBY,
      uploadedAt: file.UPLOADEDAT,
      moduleType: file.MODULETYPE,
      moduleRefId: file.MODULEREFID,
      viewUrl: `/files/${file.FILEUUID}/download`,
    }));

    return res.json(response);
  } catch (error) {
    console.error("List files error:", error);
    return res.status(500).json({
      message: "Failed to fetch files",
    });
  }
};

const healthCheck = async (req, res) => {
  try {
    await sequelize.authenticate();
    return res.json({
      status: "ok",
    });
  } catch (error) {
    console.error("Health check error:", error);
    return res.status(500).json({
      status: "error",
      message: "Service is unavailable",
    });
  }
};

// ---------------------------------------------------------------- P0-R5 / B13 signed links
const signedLink = require("../lib/signedLink");
const INLINE_TYPES = /^(image\/(png|jpe?g|gif|webp)|application\/pdf|video\/(mp4|webm)|audio\/(mpeg|ogg|wav))$/i;

async function loadFile(fileUuid) {
  const [fileData] = await sequelize.query(`EXEC PR_GET_FILE_BY_UUID @FILEUUID = :fileUuid`, {
    replacements: { fileUuid },
    type: sequelize.QueryTypes.SELECT,
  });
  return fileData || null;
}

/** GET /files/:fileUuid/signed-link?ttl=300 — owner (or internal service) only. */
const createSignedLink = async (req, res) => {
  try {
    if (!signedLink.isConfigured()) {
      return res.status(503).json({ success: false, error: { code: "FILE_LINKS_NOT_CONFIGURED", message: "File links are not available yet." } });
    }
    const { fileUuid } = req.params;
    const fileData = await loadFile(fileUuid);
    // Same 404 for missing and not-yours (S11).
    if (!fileData || !canAccessFile(req, fileData)) {
      return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "File not found" } });
    }
    const signed = signedLink.sign(fileData.FILEUUID || fileUuid, req.query.ttl);
    if (!signed) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "File not found" } });
    const qs = `exp=${signed.exp}&sig=${encodeURIComponent(signed.sig)}`;
    const dl = req.query.download === "1" ? "&download=1" : "";
    return res.json({
      success: true,
      data: { path: `/files/s/${encodeURIComponent(fileData.FILEUUID || fileUuid)}?${qs}${dl}`, expiresAt: signed.expiresAt },
    });
  } catch (error) {
    console.error("Signed link error:", error?.message);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Could not create a file link." } });
  }
};

/** GET /files/s/:fileUuid?exp=&sig= — no token; the signature is the permission. */
const serveSignedFile = async (req, res) => {
  try {
    const { fileUuid } = req.params;
    const check = signedLink.verify(fileUuid, req.query.exp, req.query.sig);
    if (!check.ok) {
      if (check.reason === "NOT_CONFIGURED") {
        return res.status(503).json({ success: false, error: { code: "FILE_LINKS_NOT_CONFIGURED", message: "File links are not available yet." } });
      }
      const status = check.reason === "EXPIRED" ? 410 : 403;
      return res.status(status).json({ success: false, error: { code: check.reason === "EXPIRED" ? "LINK_EXPIRED" : "LINK_INVALID", message: check.reason === "EXPIRED" ? "This link has expired." : "This link isn't valid." } });
    }
    const fileData = await loadFile(fileUuid);
    if (!fileData || !(await storageService.exists(fileData.STORAGEKEY))) {
      return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "File not found" } });
    }
    const inline = req.query.download !== "1" && INLINE_TYPES.test(String(fileData.MIMETYPE || ""));
    res.setHeader("Content-Type", fileData.MIMETYPE || "application/octet-stream");
    res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${safeDownloadName(fileData.FILENAME)}"`);
    res.setHeader("Content-Length", fileData.FILESIZE);
    res.setHeader("Cache-Control", `private, max-age=${Math.max(0, check.remainingSeconds - 5)}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    const stream = fs.createReadStream(storageService.getAbsolutePath(fileData.STORAGEKEY));
    stream.on("error", () => res.status(500).end());
    stream.pipe(res);
  } catch (error) {
    console.error("Signed download error:", error?.message);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Failed to download file" } });
  }
};

module.exports = {
  uploadFile,
  getFileByUuid,
  downloadFileByUuid,
  listFiles,
  healthCheck,
  createSignedLink,
  serveSignedFile,
};

