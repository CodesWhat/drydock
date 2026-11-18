// Static site-wide Content Security Policy, served from next.config.mjs headers().
//
// Why 'unsafe-inline' instead of a nonce or hashes: a per-request nonce forced
// every page to render dynamically (one function invocation per hit, bot crawls
// included). Hashes can't replace it either. Next streams per-page inline
// bootstrap scripts (self.__next_f.push(...) flight data) whose contents differ
// on every page and change every build, so a single static header can't
// enumerate them. Everything else stays strict: scripts load only from 'self'
// and the analytics proxy, and object-src, base-uri, frame-ancestors, form-action
// and connect-src stay locked to known origins. 'strict-dynamic' is omitted on
// purpose because browsers ignore 'unsafe-inline' when it is present.
export function buildContentSecurityPolicy(isDevelopment) {
  const scriptSources = [
    "'self'",
    "'unsafe-inline'",
    ...(isDevelopment ? ["'unsafe-eval'"] : []),
    "https://e.codeswhat.com",
  ];

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://img.shields.io https://github.com https://qlty.sh https://www.bestpractices.dev https://codecov.io https://awesome.re https://api.star-history.com",
    "font-src 'self' data:",
    "connect-src 'self' https://e.codeswhat.com",
    `frame-src https://demo.getdrydock.com${isDevelopment ? " http://127.0.0.1:4179" : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(!isDevelopment ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
