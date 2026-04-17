const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 5173);
const PUBLIC_DIR = path.join(__dirname, "..", "public");

function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  res.end(text);
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
}

function readBodyJson(req, { maxBytes }) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function isLikelyApiKey(s) {
  if (typeof s !== "string") return false;
  const trimmed = s.trim();
  if (trimmed.length < 20 || trimmed.length > 80) return false;
  // Google API keys are typically base64-ish with '-' '_' allowed.
  return /^[A-Za-z0-9_\-]+$/.test(trimmed);
}

function postFormJson(urlString, formObj, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const body = new URLSearchParams(formObj).toString();

    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
          "Content-Length": Buffer.byteLength(body),
          "User-Agent": "light-translator/0.1",
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed;
          try {
            parsed = text ? JSON.parse(text) : {};
          } catch {
            reject(new Error(`Upstream returned non-JSON (status ${res.statusCode})`));
            return;
          }
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            const message =
              parsed?.error?.message ||
              parsed?.error?.errors?.[0]?.message ||
              `Upstream error (status ${res.statusCode})`;
            const err = new Error(message);
            err.statusCode = res.statusCode;
            err.upstream = parsed;
            reject(err);
          }
        });
      }
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("Upstream timeout"));
    });
    req.write(body);
    req.end();
  });
}

async function handleApiDetect(req, res) {
  const body = await readBodyJson(req, { maxBytes: 1024 * 1024 });
  const apiKey = body.apiKey;
  const text = body.text;
  if (!isLikelyApiKey(apiKey)) return sendJson(res, 400, { error: "APIキーが不正です。" });
  if (typeof text !== "string" || text.trim().length === 0)
    return sendJson(res, 400, { error: "text が空です。" });

  const url = `https://translation.googleapis.com/language/translate/v2/detect?key=${encodeURIComponent(
    apiKey.trim()
  )}`;
  const data = await postFormJson(url, { q: text });
  const detection = data?.data?.detections?.[0]?.[0];
  if (!detection?.language) return sendJson(res, 502, { error: "言語判定に失敗しました。", raw: data });
  sendJson(res, 200, {
    language: detection.language,
    confidence: detection.confidence,
    isReliable: detection.isReliable,
  });
}

async function handleApiTranslate(req, res) {
  const body = await readBodyJson(req, { maxBytes: 1024 * 1024 });
  const apiKey = body.apiKey;
  const text = body.text;
  const target = body.target;
  if (!isLikelyApiKey(apiKey)) return sendJson(res, 400, { error: "APIキーが不正です。" });
  if (typeof text !== "string" || text.trim().length === 0)
    return sendJson(res, 400, { error: "text が空です。" });
  if (target !== "ja" && target !== "en") return sendJson(res, 400, { error: "target は ja/en のみです。" });

  const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(
    apiKey.trim()
  )}`;
  const data = await postFormJson(url, { q: text, target, format: "text" });
  const t = data?.data?.translations?.[0];
  if (!t?.translatedText) return sendJson(res, 502, { error: "翻訳に失敗しました。", raw: data });
  sendJson(res, 200, {
    translatedText: t.translatedText,
    detectedSourceLanguage: t.detectedSourceLanguage,
  });
}

async function handleApiPing(req, res) {
  const body = await readBodyJson(req, { maxBytes: 256 * 1024 });
  const apiKey = body.apiKey;
  if (!isLikelyApiKey(apiKey)) return sendJson(res, 400, { error: "APIキーが不正です。" });
  // A lightweight call to validate the key. Uses Translation API "languages" endpoint.
  const url = `https://translation.googleapis.com/language/translate/v2/languages?key=${encodeURIComponent(
    apiKey.trim()
  )}&target=en`;
  // This endpoint is GET; we still keep the request code simple by POSTing an empty form to a GET-only URL would fail.
  // So use https.get here.
  const result = await new Promise((resolve, reject) => {
    const u = new URL(url);
    const req2 = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "GET",
        headers: { "User-Agent": "light-translator/0.1" },
        timeout: 10000,
      },
      (resp) => {
        const chunks = [];
        resp.on("data", (c) => chunks.push(c));
        resp.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed;
          try {
            parsed = text ? JSON.parse(text) : {};
          } catch {
            reject(new Error("Upstream returned non-JSON"));
            return;
          }
          if (resp.statusCode && resp.statusCode >= 200 && resp.statusCode < 300) resolve(parsed);
          else {
            const message = parsed?.error?.message || `Upstream error (status ${resp.statusCode})`;
            reject(new Error(message));
          }
        });
      }
    );
    req2.on("error", reject);
    req2.on("timeout", () => req2.destroy(new Error("Upstream timeout")));
    req2.end();
  });

  const count = Array.isArray(result?.data?.languages) ? result.data.languages.length : 0;
  sendJson(res, 200, { ok: true, languages: count });
}

function safeResolvePublicPath(urlPathname) {
  // Prevent path traversal
  const decoded = decodeURIComponent(urlPathname);
  const cleaned = decoded.replaceAll("\\", "/");
  const rel = cleaned.startsWith("/") ? cleaned.slice(1) : cleaned;
  const resolved = path.join(PUBLIC_DIR, rel);
  if (!resolved.startsWith(PUBLIC_DIR)) return null;
  return resolved;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "POST" && url.pathname === "/api/detect") return await handleApiDetect(req, res);
    if (req.method === "POST" && url.pathname === "/api/translate") return await handleApiTranslate(req, res);
    if (req.method === "POST" && url.pathname === "/api/ping") return await handleApiPing(req, res);

    if (req.method !== "GET" && req.method !== "HEAD") return sendText(res, 405, "Method Not Allowed");

    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = safeResolvePublicPath(pathname);
    if (!filePath) return sendText(res, 400, "Bad Request");

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return sendText(res, 404, "Not Found");

    const file = fs.readFileSync(filePath);
    res.writeHead(200, {
      "Content-Type": contentTypeFor(filePath),
      "Content-Length": file.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "microphone=(self)",
    });
    if (req.method === "HEAD") return res.end();
    res.end(file);
  } catch (e) {
    const message = typeof e?.message === "string" ? e.message : "Internal Server Error";
    // Surface upstream errors cleanly for the UI.
    if ((req.url || "").startsWith("/api/")) return sendJson(res, 500, { error: message });
    return sendText(res, 500, message);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`light-translator running on http://127.0.0.1:${PORT}`);
});

