// Still serving /v1 traffic until the migration finishes.
function handleRequest(req) { return { ok: true, body: req.body }; }
module.exports = { handleRequest };
