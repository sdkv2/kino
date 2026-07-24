# Developer Certificate of Origin

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

Sign-off is separate from the [CLA](CLA.md): the DCO certifies where the code came from,
the CLA grants the rights the project needs to ship and relicense it. Contributions need
both.

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
