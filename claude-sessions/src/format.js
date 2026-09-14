const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

/** "9.3 MB" — one decimal place once we're past bytes, so columns stay narrow. */
export function formatSize(bytes) {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  const rounded = unit === 0 ? String(value) : value.toFixed(1)
  return `${rounded} ${UNITS[unit]}`
}

/** Local time, minute precision: "2026-09-14 13:07". */
export function formatDate(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/** One line per session, columns sized to the widest value in the list. */
export function formatTable(sessions) {
  const rows = sessions.map((session) => [
    formatDate(session.date),
    session.project,
    `${session.turns} turns`,
    formatSize(session.bytes),
  ])

  const widths = rows.reduce(
    (acc, row) => row.map((cell, i) => Math.max(acc[i], cell.length)),
    [0, 0, 0, 0],
  )

  return rows
    .map(([date, project, turns, size]) =>
      [
        date,
        project.padEnd(widths[1]),
        turns.padStart(widths[2]),
        size.padStart(widths[3]),
      ].join('  '),
    )
    .join('\n')
}

export function toJson(sessions) {
  return JSON.stringify(
    sessions.map((session) => ({
      sessionId: session.sessionId,
      date: session.date.toISOString(),
      project: session.project,
      projectPath: session.projectPath,
      turns: session.turns,
      bytes: session.bytes,
      path: session.path,
    })),
    null,
    2,
  )
}
