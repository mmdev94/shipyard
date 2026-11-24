// Vite-only: bundles /templates/** as text into a lazily loaded chunk.
const ALL = import.meta.glob('/templates/**/*', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>

export async function loadTemplateFiles(id: string): Promise<Record<string, string>> {
  const prefix = `/templates/${id}/`
  const entries = Object.entries(ALL).filter(([p]) => p.startsWith(prefix))
  if (!entries.length) throw new Error(`Unknown template: ${id}`)
  const files: Record<string, string> = {}
  await Promise.all(entries.map(async ([p, load]) => (files[p.slice(prefix.length)] = await load())))
  return files
}
