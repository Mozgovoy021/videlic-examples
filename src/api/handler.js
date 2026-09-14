function isEmptyBody(body) {
  if (body === undefined || body === null) return true;
  if (typeof body === "string") return body.trim() === "";
  if (Array.isArray(body)) return body.length === 0;
  if (typeof body === "object") return Object.keys(body).length === 0;
  return false;
}

function handleRequest(req) {
  if (isEmptyBody(req.body)) return { ok: false, error: "request body is empty" };
  return { ok: true, body: req.body };
}

module.exports = { handleRequest, isEmptyBody };
