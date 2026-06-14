import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "node:crypto";

const bucketName = process.env.S3_BUCKET || "club-content";
const internalEndpoint = process.env.S3_ENDPOINT;
const publicEndpoint = process.env.S3_PUBLIC_BASE_URL || internalEndpoint;
const maxUploadFiles = 6;
const allowedMediaTypes = new Set(["photo", "video"]);
const displayablePhotoMimeTypes = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp"
]);

let internalClient;
let signingClient;

function buildClient(endpoint) {
  return new S3Client({
      region: "us-east-1",
      endpoint,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY,
        secretAccessKey: process.env.S3_SECRET_KEY
      },
      forcePathStyle: true
    });
}

function getInternalS3Client() {
  if (!internalClient) {
    internalClient = buildClient(internalEndpoint);
  }

  return internalClient;
}

function getSigningS3Client() {
  if (!signingClient) {
    signingClient = buildClient(publicEndpoint);
  }

  return signingClient;
}

export async function ensureBucket() {
  const s3 = getInternalS3Client();

  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
  } catch (_error) {
    await s3.send(new CreateBucketCommand({ Bucket: bucketName }));
  }
}

function sanitizeFilename(filename = "upload.bin") {
  const sanitized = String(filename || "upload.bin").replace(/[^a-zA-Z0-9._-]/g, "-");
  return sanitized.replace(/^[.-]+|[.-]+$/g, "") || "upload.bin";
}

function sanitizePathSegment(value, fallback) {
  const sanitized = String(value || fallback).replace(/[^a-zA-Z0-9._-]/g, "-");
  return sanitized.replace(/^[.-]+|[.-]+$/g, "") || fallback;
}

function normalizeRequiredString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function validateUploadRequest(body = {}) {
  const clubSlug = normalizeRequiredString(body.clubSlug);

  if (!clubSlug || !Array.isArray(body.files) || !body.files.length) {
    return {
      valid: false,
      error: "clubSlug and a non-empty files array are required"
    };
  }

  if (body.files.length > maxUploadFiles) {
    return {
      valid: false,
      error: `At most ${maxUploadFiles} files can be signed at once`
    };
  }

  const files = [];
  for (const [index, file] of body.files.entries()) {
    const mediaType = normalizeRequiredString(file?.mediaType).toLowerCase();
    const mimeType = normalizeRequiredString(file?.mimeType).toLowerCase();
    const filename = normalizeRequiredString(file?.filename);

    if (!allowedMediaTypes.has(mediaType)) {
      return {
        valid: false,
        error: `files[${index}].mediaType must be photo or video`
      };
    }

    if (!mimeType || !mimeType.startsWith(`${mediaType === "photo" ? "image" : "video"}/`)) {
      return {
        valid: false,
        error: `files[${index}].mimeType must match the media type`
      };
    }

    if (mediaType === "photo" && !displayablePhotoMimeTypes.has(mimeType)) {
      return {
        valid: false,
        error: `files[${index}].mimeType must be image/jpeg, image/png, or image/webp for photos`
      };
    }

    if (!filename) {
      return {
        valid: false,
        error: `files[${index}].filename is required`
      };
    }

    files.push({ mediaType, mimeType, filename });
  }

  return {
    valid: true,
    value: {
      clubSlug,
      files
    }
  };
}

export function buildUploadObjectKey({
  clubSlug,
  filename,
  timestamp = Date.now(),
  id = crypto.randomUUID()
}) {
  const safeFilename = sanitizeFilename(filename);
  const safeClubSlug = sanitizePathSegment(clubSlug, "unknown-club");

  return [
    "uploads",
    safeClubSlug,
    `${timestamp}-${id}-${safeFilename}`
  ].join("/");
}

export async function createUploadPlan({
  clubSlug,
  mediaType,
  mimeType,
  filename
}) {
  const objectKey = buildUploadObjectKey({ clubSlug, filename });

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: objectKey,
    ContentType: mimeType,
    Metadata: {
      mediaType: mediaType || "unknown"
    }
  });

  const uploadUrl = await getSignedUrl(getSigningS3Client(), command, {
    expiresIn: 900
  });

  return {
    bucket: bucketName,
    objectKey,
    uploadUrl,
    method: "PUT",
    headers: {
      "content-type": mimeType
    }
  };
}

export async function getStoredObject(objectKey) {
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: objectKey
  });

  return getInternalS3Client().send(command);
}

export async function getStoredObjectMetadata(objectKey) {
  const command = new HeadObjectCommand({
    Bucket: bucketName,
    Key: objectKey
  });

  return getInternalS3Client().send(command);
}

export function isDisplayPreviewMimeType(mimeType) {
  const normalized = normalizeRequiredString(mimeType).toLowerCase();
  return normalized.startsWith("video/") || displayablePhotoMimeTypes.has(normalized);
}

export function buildPublicObjectUrl(objectKey) {
  if (!objectKey) {
    return null;
  }

  const publicAppUrl = process.env.PUBLIC_APP_URL || process.env.API_PUBLIC_BASE_URL || "";
  if (publicAppUrl) {
    const base = String(publicAppUrl).replace(/\/+$/, "");
    return `${base}/media/preview?key=${encodeURIComponent(objectKey)}`;
  }

  if (!publicEndpoint) {
    return null;
  }

  const base = String(publicEndpoint).replace(/\/+$/, "");
  const encodedKey = String(objectKey)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${base}/${encodeURIComponent(bucketName)}/${encodedKey}`;
}
