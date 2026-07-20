const CSP_NONCE_PATTERN = /^[A-Za-z0-9+/_-]+={0,2}$/u;

export function buildContentSecurityPolicy(nonce, isDevelopment) {
  if (!CSP_NONCE_PATTERN.test(nonce)) {
    throw new Error("Content Security Policy nonce must be a base64 or base64url value");
  }

  const scriptSources = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(isDevelopment ? ["'unsafe-eval'"] : []),
    "https://va.vercel-scripts.com",
  ];

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://img.shields.io https://github.com https://qlty.sh https://api.star-history.com",
    "font-src 'self' data:",
    "connect-src 'self' https://va.vercel-scripts.com",
    "frame-src https://demo.getdrydock.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}
