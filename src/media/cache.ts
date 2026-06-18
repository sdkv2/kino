// Content-addressed file cache used across the pipeline (VO clips, stitched track, avatar mp4).
// The key is a content hash (see hash.ts); files are stored as `${key}.${ext}` under one dir
// (typically .kino-cache/). This lets edits that don't change inputs reuse paid API output for
// free. NOTE: the cache is append-only and never evicted — it grows unbounded; clear it by hand.
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";

export class Cache {
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
  }
  private file(key: string, ext: string) {
    return join(this.dir, `${key}.${ext}`);
  }
  // Returns the cached file path if present, else null.
  get(key: string, ext: string): string | null {
    const f = this.file(key, ext);
    return existsSync(f) ? f : null;
  }
  // Copies srcPath into the cache under (key, ext) and returns the cached path.
  put(key: string, ext: string, srcPath: string): string {
    const f = this.file(key, ext);
    copyFileSync(srcPath, f);
    return f;
  }
}
