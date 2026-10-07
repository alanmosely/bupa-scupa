# Code signing plan

Optional future work. The maintainer excluded signing from the 0.1.0 release
requirements on 7 October 2026; publish its signature status as unsigned.

Status: not enrolled and not signed. No signing certificate was found in the
current user's or machine's certificate store. No service account, payment or
signing application has been submitted.

First choice: [SignPath Foundation](https://signpath.org/). It offers free signing
for qualifying open-source projects. Acceptance is not automatic: the project
must be public, maintained and released, with a verifiable build, suitable team
roles, MFA and an explicit signing policy. Review the final dependency inventory
against [the programme terms](https://signpath.org/terms.html)
before applying. Do not claim SignPath sponsorship before acceptance.

Paid alternative: Azure Artifact Signing for an eligible UK organisation.
[Microsoft's comparison](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
lists approximately USD 9.99/month, identity verification, and current individual
eligibility limited to the US and Canada. For a UK individual, choose an eligible
CA offering individual code signing if SignPath is unavailable; check its actual
identity requirements and quote before purchasing. Signing does not guarantee
immediate SmartScreen reputation.

Once enrolled, integrate the selected service into the verified CI build, sign
the inner application and the portable launcher, verify Authenticode and the
publisher identity, rerun portable checks, then regenerate checksums. Keep keys
and tokens in the service or CI secret store. Do not distribute a self-signed
certificate as if it were publicly trusted.

After signing, run `scripts/verify-signatures.ps1 -ExpectedThumbprint <thumbprint>`
with the public certificate fingerprint obtained independently from the signing
provider. It checks both the inner application and portable launcher for a valid,
timestamped Authenticode signature from that exact certificate. It fails for the
current unsigned previews. Rebuild the ZIP with the signed inner application,
rerun portable tests and regenerate checksums; never sign after checksumming.
