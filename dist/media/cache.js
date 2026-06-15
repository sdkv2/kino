import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
export class Cache {
    dir;
    constructor(dir) {
        this.dir = dir;
        mkdirSync(dir, { recursive: true });
    }
    file(key, ext) {
        return join(this.dir, `${key}.${ext}`);
    }
    get(key, ext) {
        const f = this.file(key, ext);
        return existsSync(f) ? f : null;
    }
    put(key, ext, srcPath) {
        const f = this.file(key, ext);
        copyFileSync(srcPath, f);
        return f;
    }
}
