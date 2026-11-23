// Preference applies on the next launch, before the canvas acquires a context.
export type RendererPreference = 'auto' | 'webgpu' | 'webgl';

export function rendererPreference(value: unknown): RendererPreference {
  return value === 'webgpu' || value === 'webgl' ? value : 'auto';
}

export const backendStatus = { name: 'WebGL2', adapter: '' };

/** A display pixel center can lie exactly between two source rows when the
 * reduced ratio of source rows to display rows has an even numerator. */
export function hasRowSamplingTies(source: number, display: number): boolean {
  if (source <= 0 || display <= 0) return false;
  while (source % 2 === 0 && display % 2 === 0) {
    source /= 2;
    display /= 2;
  }
  return source % 2 === 0;
}
