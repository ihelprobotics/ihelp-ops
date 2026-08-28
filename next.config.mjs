// Security headers, applied to every response.
//
// This platform holds 1:1 notes, feedback about people, leave including sick
// leave, and a token that can write to every repository the company has. The
// row-level security in db/ decides who may read a row; these decide what a
// browser is allowed to do with the page once it has it. Both are needed —
// policies do not help if the page itself can be framed by somebody else's site
// and clicked through.
//
// Written out rather than pulled from a package, because each line is a
// decision and a dependency would hide them.

const securityHeaders = [
  // Nothing here is meant to be embedded anywhere. Framing it is only ever
  // somebody putting an invisible copy over their own page so a person clicks
  // "Merge" thinking it is something else.
  { key: "X-Frame-Options", value: "DENY" },

  // Browsers must not guess a type. An uploaded file served as text/plain but
  // sniffed as HTML is how a stored payload becomes a script.
  { key: "X-Content-Type-Options", value: "nosniff" },

  // A task title reaching a third party through the Referer would leak what
  // the company is working on to anywhere a link points. Same-origin keeps the
  // path for our own navigation and sends only the origin outward.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  // None of these are used, and a page that cannot ask cannot be tricked into
  // asking on somebody's behalf.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },

  // Once over https, stay there. Two years and preload is the value browsers
  // accept for the preload list; the platform is https-only in production.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },

  // The content policy. The screens load nothing from anywhere: no CDN, no
  // font host, no analytics, no images beyond what the app serves. So the
  // policy can be tight enough to be worth having.
  //
  // 'unsafe-inline' for styles is not laziness — the styling is inlined by
  // design (docs: plain CSS in the component, no framework), and styled-jsx
  // emits inline <style>. Scripts are 'self' only, which is the half that
  // matters: an injected <script src> or an inline handler is refused.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://avatars.githubusercontent.com https://lh3.googleusercontent.com",
      "font-src 'self' data:",
      // The browser talks only to us. Everything reaching GitHub, Supabase or
      // Resend happens on the server, with credentials the browser never sees.
      "connect-src 'self'",
      "form-action 'self' https://accounts.google.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
];

const nextConfig = {
  experimental: { serverActions: { bodySizeLimit: "2mb" } },

  // The version and commit are useful in an incident and harmless to publish;
  // the framework version is a hint to somebody probing, and is not.
  poweredByHeader: false,

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
