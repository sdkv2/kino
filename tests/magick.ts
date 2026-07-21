// Shell-free ImageMagick probe. argv arrays dodge shell quoting: cmd.exe passes single quotes
// through literally, and IM only WARNS on an unrecognized color (exit 0), silently yielding
// garbage stats — that combination faked "render failures" on Windows CI.
import { execFileSync } from "node:child_process";

export const magick = (args: string[]): string => execFileSync("magick", args).toString();
