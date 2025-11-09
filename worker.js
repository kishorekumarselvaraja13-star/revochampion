export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Serve robots.txt & sitemap.xml explicitly if present in assets
    if (url.pathname === "/robots.txt" || url.pathname === "/sitemap.xml") {
      // Static files in assets take precedence automatically, but this ensures correct headers if you customize
      return env.ASSETS.fetch(request);
    }

    // Try to serve static asset (js, css, images, etc.)
    let res = await env.ASSETS.fetch(request);
    if (res.status !== 404) {
      // Cache static assets longer
      const newHeaders = new Headers(res.headers);
      if (/\.(js|css|png|jpg|jpeg|gif|svg|woff2?)$/i.test(url.pathname)) {
        newHeaders.set("Cache-Control", "public, max-age=31536000, immutable");
        return new Response(res.body, { status: res.status, headers: newHeaders });
      }
      return res;
    }

    // SPA fallback: serve index.html for deep links like /features
    const indexReq = new Request(new URL("/", url).toString(), request);
    res = await env.ASSETS.fetch(indexReq);

    // Helpful headers for crawlers
    const headers = new Headers(res.headers);
    headers.set("Cache-Control", "public, max-age=300");
    headers.set("Content-Type", "text/html; charset=UTF-8");

    return new Response(res.body, { status: 200, headers });
  }
}
