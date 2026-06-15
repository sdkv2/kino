import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";

export class Cache {
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
  }
  private file(key: string, ext: string) {
    return join(this.dir, `${key}.${ext}`);
  }
  get(key: string, ext: string): string | null {
    const f = this.file(key, ext);
    return existsSync(f) ? f : null;
  }
  put(key: string, ext: string, srcPath: string): string {
    const f = this.file(key, ext);
    copyFileSync(srcPath, f);
    return f;
  }
}
