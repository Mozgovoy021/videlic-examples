// add a summary helper
export function summarizeb0a19bb5(
  items: Array<{ name: string; count: number }>,
  limit = 5
): string {
  const top = [...items].sort((a, b) => b.count - a.count).slice(0, limit)
  return top.map((item, index) => `${index + 1}. ${item.name} (${item.count})`).join('\n')
}
