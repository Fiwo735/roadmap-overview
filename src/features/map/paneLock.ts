const owners = new WeakMap<HTMLElement, Set<string>>()

/**
 * Make a map pane untouchable (the HTML `inert` attribute: no clicks, hovers, drags or focus) on behalf of
 * `owner`. Several features may lock the same pane (the ride, presentation mode): it stays locked until
 * every one of them has let go.
 */
export function lockPane(pane: HTMLElement, owner: string): void {
  const set = owners.get(pane) ?? new Set<string>()
  set.add(owner)
  owners.set(pane, set)
  pane.setAttribute('inert', '')
}

export function unlockPane(pane: HTMLElement, owner: string): void {
  const set = owners.get(pane)
  set?.delete(owner)
  if (!set || set.size === 0) pane.removeAttribute('inert')
}
