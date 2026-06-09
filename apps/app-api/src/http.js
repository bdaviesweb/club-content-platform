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

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
    "access-control-allow-headers": "content-type, authorization, svix-id, svix-timestamp, svix-signature",
    vary: "Origin"
  };
}

export function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json",
    ...corsHeaders()
  });
  res.end(JSON.stringify(payload));
}

export function sendNotFound(res) {
  sendJson(res, 404, { error: "Not found" });
}

export function sendMethodNotAllowed(res) {
  sendJson(res, 405, { error: "Method not allowed" });
}
