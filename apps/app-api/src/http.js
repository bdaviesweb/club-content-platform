export async function readJson(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");

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
