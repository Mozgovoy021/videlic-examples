const { renderLabel } = require("../src/format/label.js");
function digest(rows) { return rows.map((r) => renderLabel(r.name, r.count)); }
module.exports = { digest };
