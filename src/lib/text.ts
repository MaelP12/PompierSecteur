/** Normalise un texte pour la recherche : minuscules, sans accents ni ponctuation. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’'‘`\-_.,/()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Tous les mots de la requête doivent apparaître dans le nom (ordre libre). */
export function matches(search: string, query: string): boolean {
  const q = normalize(query)
  if (!q) return false
  return q.split(' ').every((w) => search.includes(w))
}
