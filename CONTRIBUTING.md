# Contributing to kino

Thanks for helping out. Small, focused PRs are the fastest to review.

## Setup

```bash
git clone https://github.com/sdkv2/kino.git && cd kino
npm install
npm run build          # tsc → dist/
npm link               # optional: makes `kino` available globally
```

Requires Node 22+ and ffmpeg/ffprobe (plus ImageMagick for storyboards). `bash setup.sh`
automates all of this, including an API-key walkthrough.

No API keys are needed for most development: `kino build <spec> --mock` renders a full
structural preview for free. Real voiceover/avatar runs need keys in a project `.env`
(see [docs/getting-started.md](docs/getting-started.md)).

## Development loop

```bash
npm run dev -- <args>   # run the CLI from source via tsx
npm test                # vitest, single run — everything except the GPU/CoreML scopes
npm run test:watch      # watch mode
```

`npm test` is what CI runs on every PR and what must pass before you push. The two heavyweight
GPU consumers live in their own scopes so they never compete for one machine's GPU — running them
together is what made them flaky, not the assertions themselves:

```bash
npm run test:gpu     # the 24 pixel test files (real Chrome + SwiftShader + ImageMagick), one at a time
npm run test:metal   # CoreML segmentation; needs a Mac with a SAM venv, skips elsewhere
npm run test:full    # everything at once — the combination that produces the contention failures
```

`test:gpu` also runs in CI on every push to `main`. To run it against a branch before merging:
`gh workflow run ci.yml --ref <branch>`.

If a pixel test fails, do **not** reach for deleting it or loosening its threshold until it also
fails in the serialised `npm run test:gpu` — see the quarantine notes in `vitest.config.ts` for
three occasions when "flaky GPU test" turned out to be a real bug.

The CLI runs from compiled `dist/` — rebuild (`npm run build`) before testing a change
through the `kino` binary rather than `npm run dev`.

## Sign-off and the CLA

Two one-time bits of paperwork, both done inside your PR:

1. **Sign off every commit** — `git commit -s`. This is the
   [Developer Certificate of Origin](.github/CLA.md#developer-certificate-of-origin): your
   statement that you have the right to submit the patch. Missed it? `git commit --amend -s`
   (or `git rebase --signoff <base>`), then force-push.
2. **Sign the [CLA](.github/CLA.md)** — add a row to its
   [Signatures](.github/CLA.md#signatures) table in your first PR. You keep the copyright to everything you write; the agreement grants kino the licence it
   needs to ship your work and, if the project's licensing ever changes, to carry it forward
   without hunting down every past contributor.

If a contribution includes third-party code or assets, flag it in the PR with its licence and
origin. AI-assisted contributions are fine — you're still the one certifying provenance.

## Pull requests

- Branch from `main`: `feat/…`, `fix/…`, `docs/…`, `chore/…`.
- Sign off your commits (`-s`) and, on your first PR, add yourself to the
  [CLA signatures](.github/CLA.md#signatures).
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
