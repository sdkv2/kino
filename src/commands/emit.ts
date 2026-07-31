// The discovery commands (`kino backgrounds`, `elements`, `transitions`, `brand`, `fonts`,
// `voices`, `avatars`) answer two audiences: a person reading a terminal, and an agent that ran the
// command specifically to learn a parameter name. `--as json` serves the second without making the
// first read JSON.
//
// Every payload is built from the SAME constant the text renderer prints, so the two cannot drift
// into disagreeing about what exists — which would be worse than having no JSON at all.

/** One catalogued choice: the ids it covers, and the guidance that makes it a real recommendation
 *  rather than a bare list. `label` is how the text renderer groups them on one line. */
export interface Choice {
  label: string;
  ids: string[];
  note: string;
}

export function emitJson(payload: unknown): void {
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
}

/** True when the caller asked for JSON. Kept in one place so every command spells the check the
 *  same way — and so `--as` can grow a format later without hunting for string comparisons. */
export const wantsJson = (opts: { as?: string } | undefined): boolean => opts?.as === "json";

/**
 * Render a catalogue entry as `    · <label>   — <note>`, dropping the note onto wrapped
 * continuation lines when the label is too long to share the row.
 */
export function choiceLines(c: Choice, labelWidth = 12, width = 92): string {
  const head = `    · ${c.label}`;
  if (c.label.length <= labelWidth) {
    return `${head.padEnd(6 + labelWidth)} — ${c.note}\n`;
  }
  const indent = " ".repeat(19);
  const words = c.note.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line && (indent + line + " " + w).length > width) {
      lines.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) lines.push(line);
  return `${head}\n${lines.map((l) => indent + l + "\n").join("")}`;
}
