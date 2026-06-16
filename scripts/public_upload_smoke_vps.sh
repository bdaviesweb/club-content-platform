#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-https://clubcontent-api.davmn.net}"
CLUB_SLUG="${CLUB_SLUG:-demo-soccer-club}"
SMOKE_MARKER="${SMOKE_MARKER:-public-upload-smoke-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}}"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

image_path="${tmp_dir}/smoke.png"
preview_path="${tmp_dir}/preview.bin"

node - <<'NODE' "${image_path}"
const fs = require('node:fs');
const path = process.argv[2];
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/9e0AAAAASUVORK5CYII=';
fs.writeFileSync(path, Buffer.from(pngBase64, 'base64'));
NODE

echo "Checking public API health..."
curl -fsS "${API_BASE_URL}/health"
echo

echo "Requesting public upload plan for ${SMOKE_MARKER}..."
sign_response="$(
  curl -fsS \
    -H 'content-type: application/json' \
    -d "$(node - <<'NODE' "${CLUB_SLUG}" "${SMOKE_MARKER}"
const clubSlug = process.argv[2];
const smokeMarker = process.argv[3];
process.stdout.write(JSON.stringify({
  clubSlug,
  files: [
    {
      filename: `${smokeMarker}.png`,
      mimeType: 'image/png',
      mediaType: 'photo'
    }
  ]
}));
NODE
)" \
    "${API_BASE_URL}/uploads/sign"
)"

IFS=$'\t' read -r upload_url object_key content_type <<EOF
$(SIGN_RESPONSE="${sign_response}" node - <<'NODE'
const response = JSON.parse(process.env.SIGN_RESPONSE);
const plan = response.uploads?.[0];

if (!plan) {
  throw new Error('No upload plan returned.');
}

process.stdout.write([
  plan.uploadUrl,
  plan.objectKey,
  plan.headers?.['content-type'] || 'image/png'
].join('\t'));
NODE
)
EOF

echo "Uploading smoke image to signed URL..."
curl -fsS \
  -X PUT \
  -H "content-type: ${content_type}" \
  --upload-file "${image_path}" \
  "${upload_url}" >/dev/null

echo "Reading preview back through the API..."
curl -fsS "${API_BASE_URL}/media/preview?key=$(node - <<'NODE' "${object_key}"
process.stdout.write(encodeURIComponent(process.argv[2]));
NODE
)" > "${preview_path}"

OBJECT_KEY="${object_key}" node - <<'NODE' "${preview_path}"
const fs = require('node:fs');
const path = process.argv[2];
const buf = fs.readFileSync(path);
const expected = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

if (buf.length < expected.length || !buf.subarray(0, expected.length).equals(expected)) {
  throw new Error('Preview bytes did not match a PNG image.');
}

console.log(`public_upload_smoke_passed=true`);
console.log(`object_key=${process.env.OBJECT_KEY || ''}`);
console.log(`preview_bytes=${buf.length}`);
NODE
