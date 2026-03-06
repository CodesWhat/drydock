/**
 * Extends the HTTP-to-file-access query to recognize validated icon payloads.
 *
 * `validateFetchedIconPayload` bounds the upstream payload size and verifies
 * that the bytes match the expected icon format (PNG/SVG) before writing.
 */

import javascript
import semmle.javascript.security.dataflow.HttpToFileAccessQuery as HttpToFileAccess

/**
 * A call to `validateFetchedIconPayload(value, extension)` is a barrier for
 * network-data-to-file taint flow.
 */
class ValidateFetchedIconPayloadBarrier extends HttpToFileAccess::Sanitizer {
  ValidateFetchedIconPayloadBarrier() {
    exists(DataFlow::CallNode call |
      call.getCalleeName() = "validateFetchedIconPayload" and
      this = call
    )
  }
}
