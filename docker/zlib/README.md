# Temporary zlib security backport

Alpine 3.24 still ships zlib 1.3.2-r0 without the fix for CVE-2026-85091.
This package retains the upstream version and uses local revision 2026092401
to distinguish it from Alpine builds. It applies only upstream commit
[df84af25](https://github.com/madler/zlib/commit/df84af25dc1942490e1d1c899a07619152a46148).
The maintainer [confirmed this fixes the CVE on 1.3.2](https://github.com/madler/zlib/issues/1310#issuecomment-5709374730).

The build verifies source and patch checksums, runs upstream `make check`,
and checks that a failed direct gzip write clears its external input state.
The regression fails on unpatched 1.3.2. The public headers, library name,
and exported API are unchanged. The APK records CodesWhat as its packager.
Only that build's runtime APK enters the application image. Its public key
is mounted for the signature-verified offline install, then disappears. The
private signing key and build tools stay in the discarded build stage.

Grype still correctly matches the upstream 1.3.2 version. `fixed.vex.json`
records the verified backport for this exact APK revision and CVE, so the
finding remains visible in Grype's ignored matches with a `fixed` VEX status.
It does not suppress the original Alpine package or any other vulnerability.

Remove this stage and VEX statement once the official Alpine package includes
the fix, and explicitly install that official version. The local revision
sorts above Alpine's small revision numbers, so a generic upgrade alone will
not replace it with an official 1.3.2 rebuild.
