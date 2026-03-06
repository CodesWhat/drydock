/**
 * @name Network data written to file
 * @description Writing data from network sources directly to files can persist
 *              attacker-controlled content on disk.
 * @kind path-problem
 * @problem.severity warning
 * @security-severity 6.5
 * @precision medium
 * @id js/drydock-http-to-file-access
 * @tags security
 *       external/cwe/cwe-912
 */

import javascript
import semmle.javascript.security.dataflow.HttpToFileAccessQuery
import HttpToFileAccessFlow::PathGraph
import ValidateFetchedIconPayload

from HttpToFileAccessFlow::PathNode source, HttpToFileAccessFlow::PathNode sink
where HttpToFileAccessFlow::flowPath(source, sink)
select sink.getNode(), source, sink, "Write to file system depends on a $@.", source.getNode(),
  "network data"
