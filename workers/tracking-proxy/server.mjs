/**
 * Run the tracking proxy as a plain Node server (Docker, any host), outside
 * Vercel. ACA Cloud keeps deploying api/proxy.ts to Vercel; this wraps the same
 * handler so a self-hosted install can serve its unsubscribe and click links
 * from its own machine.
 *
 *   node --experimental-strip-types server.mjs   (Node 22; 23+ needs no flag)
 *
 * Needs SUPABASE_URL. Listens on PORT (default 8080); /health answers "ok".
 */

import http from "node:http";
import handler from "./api/proxy.ts";

const port = Number(process.env.PORT || 8080);

function toHeaders(raw) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(key, v);
  }
  return headers;
}

http
  .createServer(async (req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
      return;
    }
    try {
      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      const request = new Request(`http://${req.headers.host ?? "localhost"}${req.url}`, {
        method: req.method,
        headers: toHeaders(req.headers),
        body: hasBody ? req : undefined,
        duplex: "half",
      });
      const response = await handler(request);
      const headers = {};
      response.headers.forEach((value, key) => {
        if (key !== "set-cookie") headers[key] = value;
      });
      const cookies = response.headers.getSetCookie?.() ?? [];
      if (cookies.length) headers["set-cookie"] = cookies;
      res.writeHead(response.status, headers);
      if (response.body) {
        for await (const chunk of response.body) res.write(chunk);
      }
      res.end();
    } catch (err) {
      console.error("[tracking-proxy] request failed", err);
      if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Bad gateway");
    }
  })
  .listen(port, () => console.log(`[tracking-proxy] listening on :${port}`));
