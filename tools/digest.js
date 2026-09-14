const { formatLabel } = require("../src/format/label.js");
function digest(rows) { return rows.map((r) => formatLabel(r.name, r.count)); }
module.exports = { digest };
