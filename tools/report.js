const { renderLabel } = require("../src/format/label.js");
function printReport(rows) { return rows.map((r) => renderLabel(r.name, r.count)).join("\n"); }
module.exports = { printReport };
