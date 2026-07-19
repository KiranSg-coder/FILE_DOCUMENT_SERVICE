const sequelize = require("../config/database");
const path = require("path");
const fs = require("fs");
const { BASE_UPLOAD_PATH } = require("../config/appConfig");
const storageService = require("../services/storageService");

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
      uploadedBy,
    } = req.body;

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
      message: error.message,
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

    if (!fileData) {
      return res.status(404).json({ message: "File not found" });
    }

    const existsOnStorage = await storageService.exists(fileData.STORAGEKEY);

    if (!existsOnStorage) {
      return res.status(404).json({
        message: "File not found on disk",
      });
    }

    const storageKeyUrl = fileData.STORAGEKEY.replace(/\\/g, "/");
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const downloadUrl = `${baseUrl}/files/${storageKeyUrl}`;

    return res.json({
      fileName: fileData.FILENAME,
      mimeType: fileData.MIMETYPE,
      downloadUrl,
    });
  } catch (error) {
    console.error("File fetch error:", error);
    return res.status(500).json({
      message: "Failed to retrieve file",
      error: error.message,
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

    if (!fileData) {
      return res.status(404).json({
        message: "File not found",
      });
    }

    const existsOnStorage = await storageService.exists(fileData.STORAGEKEY);

    if (!existsOnStorage) {
      return res.status(404).json({
        message: "File not found on storage",
      });
    }

    const absolutePath = storageService.getAbsolutePath(fileData.STORAGEKEY);

    res.setHeader("Content-Type", fileData.MIMETYPE);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileData.FILENAME}"`
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

    const response = files.map((file) => ({
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

module.exports = {
  uploadFile,
  getFileByUuid,
  downloadFileByUuid,
  listFiles,
  healthCheck,
};

