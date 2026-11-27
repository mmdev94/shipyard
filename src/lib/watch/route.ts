// Links inside the measurements pages (#/proof…), from Watchtower's own routes.
export const href = {
  home: '#/proof',
  site: (slug: string) => `#/proof/site/${slug}`,
  how: (section?: string) => `#/proof/how${section ? `?${section}` : ''}`,
}
