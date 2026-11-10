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

## Optional infback9 code (CVE-2026-4738)

The second VEX statement applies only to `zlib@1.3.2-r2026092401`.
The vulnerable implementation is `contrib/infback9/inftree9.c`, an optional
Deflate64 implementation described in [upstream #1235](https://github.com/madler/zlib/pull/1235).
The standard shared-library build in this APK does not compile those files.

Published 1.7.0 and 1.7.1-rc.5 images were inspected on both amd64 and arm64.
Every downloaded layer hash matched its manifest; no infback9/inftree9 paths
or GDAL library were present. The libz ELF symbol tables contained normal
zlib symbols and none of the affected inflateBack9/inflate_table9 symbols.
[The artifact report](https://github.com/CodesWhat/drydock/pull/1544#issuecomment-6713748413)
records the immutable image index digests. This is `not_affected` because
the vulnerable code is absent, independently of the gzip-write backport above.

This statement does not cover other package revisions, other CVEs or custom
builds that compile infback9. Reassess it if the source or build recipe changes.
The finding remains visible in Grype's ignored matches with its VEX reason;
no ignore rule or severity threshold is changed.
