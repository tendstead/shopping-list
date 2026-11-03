# CI and automatic releases

After repository/account setup, Checks runs Docker-backed checks for PRs and the
default branch, and builds the production image without publishing. A PR with
more than one release label fails validation. Nonrelease labels are ignored.

A merged default-branch PR with exactly one of `patch`, `minor`, or `major` starts
the Release workflow. Unlabeled PRs create no release and do not require Docker Hub
credentials. Add these GitHub repository settings before your first publication:

- Variable `DOCKERHUB_USERNAME`: the publishing account.
- Variable `DOCKERHUB_IMAGE`: `namespace/image` (no version suffix).
- Secret `DOCKERHUB_TOKEN`: a Docker Hub access token with push permission.
- Give the built-in GITHUB_TOKEN contents:write and pull-requests:read as declared
  in the workflow; branch/tag protections must allow the intended release tags.

The baseline is 0.0.0. Git tags are `vX.Y.Z`; image tags are `X.Y.Z`. Version
allocation creates an annotated tag pointing to the merged SHA, with PR/version
metadata, before pushing the image. The atomic Git reference creation and
retry loop prevent competing jobs from claiming the same version. Existing tags
are included in the baseline, even if created before this automation.

The workflow serializes releases with `queue: max`; GitHub currently retains up
to 100 pending jobs. If this queue is exceeded, use a manual retry for canceled
PRs. Atomic allocation also protects concurrent invocations outside that queue.
If publication fails, do not delete the allocation tag: rerunning reuses that
PR's version and commit. The image is explicitly built from the merged SHA; the
GitHub release is explicitly created after the Docker push with generated notes
and the image reference. No tag-triggered follow-up workflow is required.

Use Actions → Release → Run workflow → merged PR number to recover publication,
or rerun the failed workflow. The target merged SHA is resolved and verified before
publication even when the default branch has moved on. Repeat release creation is
idempotent; an existing release is retained. Release credentials and remote
publication have not been exercised locally by this implementation task.

Release unit tests cover label validation, semantic increments, concurrent atomic
allocation, exact-PR retry, changed labels, credential-free validation, and image
failure recovery. These tests support the algorithm, not live account permissions
or Docker Hub availability. Those are deployment checks.
