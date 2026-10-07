# Clean Windows acceptance

Optional future work. The maintainer excluded fresh-machine testing from the
0.1.0 release requirements on 7 October 2026. Do not claim this test has passed.

Use a fresh Windows 10/11 x64 installation and a normal user account, with no
Node, development tools or PDF reader installed. Install Edge or Chrome before
testing sync; offline archive commands need neither. Keep Defender enabled.
Windows Sandbox requires a supported Pro, Enterprise or Education edition;
Windows Home cannot run it. A restricted PATH on a developer machine is useful
but does not establish a clean OS test.

Transfer the EXE, app ZIP, source ZIP and SHA256SUMS.txt together to a local folder.
Copy `scripts/clean-windows.ps1` from the reviewed source. Inspect it, then run:

```powershell
& .\clean-windows.ps1 -ReleaseDirectory 'D:\Release' -AllowUnsignedPreview
```

Omit `-AllowUnsignedPreview` when testing a signed build.
Do not weaken Windows security or execution policy to run an untrusted artifact.
The script verifies hashes, signature status and offline agent commands for both
distributions. It uses new temporary folders and leaves evidence there. It does
not read existing archives, download anything, install software, enable Windows
features, restart the PC or upload results. Hashes detect altered files; obtain
the checksum manifest through a trusted route.

After the script succeeds, complete these checks yourself:

1. Record the Windows edition/build, whether this is a fresh OS, executable hash,
   publisher and any SmartScreen/antivirus result. Never label an unsigned preview signed.
2. Double-click the portable EXE. Read the storage notice and choose a private
   archive. Verify the default Sync button works without entering names.
3. Sign in manually, complete MFA, review the discovered household and confirm
   each member. Include a zero-claim member where available. If discovery refuses
   the layout, record that failure; using manual setup does not pass discovery.
4. Compare all displayed amounts and member ownership against actual statements.
   Repeat sync; unchanged statements must not produce duplicate claims.
5. Cancel another sync. Reopen SCUPA and confirm the archive and raw PDFs remain.
6. Repeat launch using the extracted ZIP. Replace the executable and verify the
   archive persists. Disconnect the network and check the saved claims/report.

Keep real records and screenshots private. Record aggregate results alongside
the script's `acceptance.json`. A successful script alone cannot pass the live
account, GUI, clean-OS provenance or signing-identity checks.
