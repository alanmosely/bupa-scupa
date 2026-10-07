# Working on BUPA SCUPA

This file describes development. For operating an installed archive, read
AGENT_API.md and use the supported API rather than editing records directly.

- Keep login and MFA manual, in a headed browser. Never implement credential
  storage or automate the first-import member confirmation.
- Preserve raw PDFs and changed revisions. Never delete the user's archive.
- Preserve cross-member reference verification. Known profiles must match known
  claims and must not contain another member's known references.
- Never commit an archive, household config, portal capture or real statement.
  Fixtures must be synthetic. Only synthetic references beginning CL000101 are
  permitted in public fixtures and examples.
- Keep core logic shared by GUI and CLI. Keep the JSON envelope versioned.
- Keep published JSON Schemas and contract tests aligned. Agent events must
  expose control state only, never portal text, claim references or names.
- Reserve agent response/event destinations before any archive mutation.
- Maintain the narrow IPC boundary, sandbox, CSP and denied renderer networking.
- Do not expose arbitrary paths or commands through the preload bridge.
- Before completion run npm test, npm run check, and appropriate desktop smoke
  tests. Build changes require a portable-release smoke test.
- CI must provision the PDF reader and set SCUPA_REQUIRE_PDF_TESTS=1 so extraction
  and cancellation coverage cannot silently disappear on fresh checkouts.
- Publication checks must inspect every tracked file, including staged blobs,
  as well as allowlisted source. New public paths require allowlist review.
- Use Playwright's installed `msedge` channel, then `chrome`, for sync. Do not
  bundle or automatically install a browser, or reuse a personal browser profile.
  No dependencies on a developer's absolute paths or installed PDF tool.
- Use exact dependency versions and preserve notices. Review release artifacts
  against docs/RELEASE.md. Build artifacts and caches are ignored.
- Electron updates must include matching FFmpeg source and DLL pins in
  vendor-lock.json. Preserve resources/ffmpeg and follow docs/FFMPEG.md.
- No agent delegation is needed for normal contributions.

## Portal conventions

The profile uses `h3.a-list-lval-key` and `p.a-list-lval-value`. Dependant card
headings include relationship suffixes. Preserve `memberid` in dependant links:
query-free `/my-claims` returns to the holder, who is absent from dependant cards.
Discovery must stop on ambiguous metadata and require human confirmation.

## Publication

Keep source and binaries local until the user explicitly authorises a push to
https://github.com/alanmosely/bupa-scupa. The first public version is 0.1.0, tagged
v0.1.0. Inspect the exact staged files against the public allowlist; never include
the parent private repository. Follow docs/RELEASE.md and report unresolved
licensing, signing or acceptance checks even when publication is authorised.
