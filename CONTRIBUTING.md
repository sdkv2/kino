# Contributing to kino

Thanks for helping out. Small, focused PRs are the fastest to review.

## Setup

```bash
git clone https://github.com/sdkv2/kino.git && cd kino
npm install
npm run build          # tsc → dist/
npm link               # optional: makes `kino` available globally
```

Requires Node 18+ and ffmpeg/ffprobe (plus ImageMagick for storyboards). `bash setup.sh`
automates all of this, including an API-key walkthrough.

No API keys are needed for most development: `kino build <spec> --mock` renders a full
structural preview for free. Real voiceover/avatar runs need keys in a project `.env`
(see [docs/getting-started.md](docs/getting-started.md)).

## Development loop

```bash
npm run dev -- <args>   # run the CLI from source via tsx
npm test                # vitest, single run
npm run test:watch      # watch mode
```

The CLI runs from compiled `dist/` — rebuild (`npm run build`) before testing a change
through the `kino` binary rather than `npm run dev`.

## Pull requests

- Branch from `main`: `feat/…`, `fix/…`, `docs/…`, `chore/…`.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org):
  `fix: remove audio artifact at the end of every VO beat`.
- Add or update tests for behavior changes; `npm test` must pass.
- Keep renders deterministic — no wall-clock time, randomness, or network reads inside
  the render path.
- Agent playbooks live only in [`skills/`](skills/); don't edit the fan-out copies.

## Releases (maintainers)

Bump `version` in `package.json`, add a [`CHANGELOG.md`](CHANGELOG.md) entry, merge to
`main`, then cut a GitHub Release — [publish.yml](.github/workflows/publish.yml) ships
`@sdkv2/kino` to npm via trusted publishing.
