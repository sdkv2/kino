// Turn a thrown value into a single human-readable CLI line. Kept side-effect-free (no CLI wiring) so
// it's unit-testable and importable without running the program. The full stack is still available via
// KINO_DEBUG (wired in cli.ts).
export function formatCliError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
