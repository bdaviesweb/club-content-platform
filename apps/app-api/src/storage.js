import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "node:crypto";

const bucketName = process.env.S3_BUCKET || "club-content";
const internalEndpoint = process.env.S3_ENDPOINT;
const publicEndpoint = process.env.S3_PUBLIC_BASE_URL || internalEndpoint;

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
  return filename.replace(/[^a-zA-Z0-9._-]/g, "-");
}

export async function createUploadPlan({
  clubSlug,
  mediaType,
  mimeType,
  filename
}) {
  const safeFilename = sanitizeFilename(filename);
  const objectKey = [
    "uploads",
    clubSlug || "unknown-club",
    `${Date.now()}-${crypto.randomUUID()}-${safeFilename}`
  ].join("/");

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

export function buildPublicObjectUrl(objectKey) {
  if (!publicEndpoint || !objectKey) {
    return null;
  }

  const base = String(publicEndpoint).replace(/\/+$/, "");
  const encodedKey = String(objectKey)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${base}/${encodeURIComponent(bucketName)}/${encodedKey}`;
}
