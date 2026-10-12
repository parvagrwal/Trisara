const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

/** Prefix a site-relative path with NEXT_PUBLIC_BASE_PATH (for files in public/). */
export function withBase(path: string): string {
  return `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}
