// Serves the production build (`next start`) for the browser checks through a
// thin proxy that drops one directive from the Content-Security-Policy header:
// `upgrade-insecure-requests`. Production is https, where the directive is a
// no-op. WebKit applies it to plain-http loopback too and rewrites every
// subresource to https://127.0.0.1, which nothing here serves, so without this
// WebKit can't load the site at all. Every other directive passes through
// untouched, so CSP violations still fail the tests.
import { spawn } from "node:child_process";
import http from "node:http";

const port = Number(process.env.WEB_E2E_PORT || 3100);
const upstreamPort = port + 1;

const next = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(upstreamPort),
  ],
  { stdio: "inherit" },
);
next.on("exit", (code) => process.exit(code ?? 1));

const proxy = http.createServer((req, res) => {
  const upstream = http.request(
    {
      host: "127.0.0.1",
      port: upstreamPort,
      method: req.method,
      path: req.url,
      headers: req.headers,
    },
    (upstreamRes) => {
      const headers = { ...upstreamRes.headers };
      const csp = headers["content-security-policy"];
      if (typeof csp === "string") {
        headers["content-security-policy"] = csp
          .split(";")
          .map((directive) => directive.trim())
          .filter((directive) => directive && directive !== "upgrade-insecure-requests")
          .join("; ");
      }
      res.writeHead(upstreamRes.statusCode ?? 502, headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on("error", () => {
    res.writeHead(502);
    res.end();
  });
  req.pipe(upstream);
});
proxy.listen(port, "127.0.0.1");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    proxy.close();
    next.kill(signal);
  });
}
