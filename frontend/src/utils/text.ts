/**
 * Strip [[Name]] and {Name} entity markers from raw log text,
 * leaving just the display name. Used wherever raw_text is shown
 * as a snippet (log list, todo group headers, etc.).
 */
export function stripMarkers(text: string): string {
  return text
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\{([^}]+)\}/g, '$1')
}
