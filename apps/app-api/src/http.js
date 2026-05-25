export async function readText(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

export async function readJson(req) {
  const raw = await readText(req);

  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

export function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

export function sendNotFound(res) {
  sendJson(res, 404, { error: "Not found" });
}

export function sendMethodNotAllowed(res) {
  sendJson(res, 405, { error: "Method not allowed" });
}
