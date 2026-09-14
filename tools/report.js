const { formatLabel } = require("../src/format/label.js");
function printReport(rows) { return rows.map((r) => formatLabel(r.name, r.count)).join("\n"); }
module.exports = { printReport };
