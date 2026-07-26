# kino Contributor Licence Agreement

**Not legal advice, and not yet reviewed by a lawyer. If you are contributing on behalf of an
employer, have someone who can bind that employer read this first.**

kino is source-available (free for individuals, non-profits, and teams ≤ 3; company licence required for for-profit teams of 4+). This agreement exists so the project can keep shipping under a licence of its choosing without having to track down every past contributor for permission — the situation that has stranded plenty of projects mid-relicence. Signing it does not take your rights away: you keep full ownership of everything you write.

## Who signs

Everyone whose code, documentation, skills, or other material is merged into
[sdkv2/kino](https://github.com/sdkv2/kino). You sign once; it covers all your past and future
contributions to the project.

## How to sign

Add a row to [Signatures](#signatures) at the bottom of this file in your first pull request,
and sign off your commits per the [DCO](#developer-certificate-of-origin) below. That row is your signature — no separate form,
no bot.

## What you agree to

By signing, you agree to the following for every contribution you submit to kino.

**1. You keep your copyright.** Nothing here transfers ownership. You may use, sell, relicense,
or republish your own contribution anywhere else, on any terms, with no obligation to kino.

**2. Copyright licence.** You grant sdkv2 and every recipient of kino a perpetual, worldwide,
non-exclusive, royalty-free, irrevocable licence to reproduce, modify, publicly display, publicly
perform, sublicense, and distribute your contribution and derivative works of it.

**3. Patent licence.** You grant sdkv2 and every recipient of kino a perpetual, worldwide,
non-exclusive, royalty-free, irrevocable (except as stated below) patent licence to make, use,
sell, offer to sell, import, and otherwise transfer your contribution, covering only the patent
claims you can license that are necessarily infringed by your contribution alone or by combining
it with the project it was submitted to. If you start patent litigation alleging that kino or a
contribution to it infringes a patent, the patent licences granted to you under this agreement
terminate as of the date that litigation is filed.

**4. Relicensing.** You agree that sdkv2 may distribute your contribution, and license it to
others, under the Kino Licence, the MIT Licence, or under any other licence — including a commercial or
source-available licence, and as part of a paid or hosted product. This is the operative clause:
it is what lets the project change course later without a rights cleanup.

**5. You have the right to grant this.** The contribution is your original work, or you have the
rights and permissions to submit it under these terms. If your employer has rights to work you
create, you have permission to contribute on your employer's behalf, or your employer has waived
those rights for your contributions to kino. This mirrors what you certify in the
[DCO](#developer-certificate-of-origin).

**6. Third-party material.** If a contribution includes work you did not write — a vendored
library, a snippet from elsewhere, a font, an asset — say so in the pull request, and include
its licence and origin. Do not submit third-party material whose licence conflicts with kino's.

**7. No warranty and no obligation.** You provide your contribution "as is", without warranties
of any kind, to the extent the law allows. Nothing here obliges sdkv2 to use, merge, or ship any
contribution.

**8. AI-assisted contributions.** Code written with help from an AI coding tool is welcome — much
of kino was. You are still the one certifying clauses 5 and 6: you are responsible for reviewing
what the tool produced and for its provenance. Credit the tool with a `Co-Authored-By:` trailer
if you like; the tool is not a party to this agreement.

## Changes

If this agreement changes materially, the change applies to contributions made after it lands.
Contributions already merged stay under the version in effect when they were merged; the git
history of this file is the record.

## Developer Certificate of Origin

Every commit to kino must be signed off. Sign-off is your statement that you wrote the
patch, or otherwise have the right to submit it under the project's licence.

Add the trailer automatically with `-s`:

```bash
git commit -s -m "fix: trim the trailing silence on the last VO beat"
```

which appends:

```
Signed-off-by: Your Name <your.email@example.com>
```

Use your real name and an email you can be reached at. Forgot to sign off? Fix the last
commit with `git commit --amend -s`, or a range with
`git rebase --signoff <base>`, then force-push the branch.

Sign-off is separate from the agreement above: the DCO certifies where the code came from,
the CLA grants the rights the project needs to ship and relicense it. Contributions need both.

---

The text below is the Developer Certificate of Origin, version 1.1, reproduced verbatim.

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same license (unless I am permitted to submit
    under a different license), as indicated in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

## Signatures

Everyone below has agreed to the terms above. Copy the line, fill it in, keep the list
alphabetical by GitHub handle:

```
| [@handle](https://github.com/handle) | Your Name | YYYY-MM-DD |
```

Contributing on behalf of an employer? Put the company in the Name column
(`Your Name (Acme, Inc.)`) so the record is unambiguous.

| GitHub | Name | Signed |
|---|---|---|
| [@sdkv2](https://github.com/sdkv2) | sdkv2 | 2026-07-24 |
