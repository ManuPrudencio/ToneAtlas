import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

const PORT = Number(process.env.PORT ?? 8080);
const CATALOG_URL = process.env.CATALOG_URL ?? 'http://localhost:8000';
const PRESETS_URL = process.env.PRESETS_URL ?? 'http://localhost:3000';

const app = express();

const proxy = (target, pathFilter) =>
  createProxyMiddleware({
    target,
    pathFilter,
    changeOrigin: true,
    pathRewrite: { '^/api': '' },
    on: {
      error: (error, req, res) => {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Service not reachable: ${error.code ?? error.message}` }));
      },
    },
  });

app.use(proxy(CATALOG_URL, '/api/songs'));
app.use(proxy(PRESETS_URL, ['/api/amps', '/api/presets']));

const check = async (url) => {
  try {
    const response = await fetch(`${url}/health`);
    return response.ok ? 'ok' : 'down';
  } catch {
    return 'down';
  }
};

app.get('/api/health', async (req, res) => {
  const [catalog, presets] = await Promise.all([check(CATALOG_URL), check(PRESETS_URL)]);
  const allOk = catalog === 'ok' && presets === 'ok';
  res.status(allOk ? 200 : 503).json({ gateway: 'ok', catalog, presets });
});

const post = async (url) => {
  const response = await fetch(url, { method: 'POST' });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
};

app.post('/api/seed', async (req, res) => {
  try {
    const [songs, amps] = await Promise.all([
      post(`${CATALOG_URL}/songs/seed`),
      post(`${PRESETS_URL}/amps/seed`),
    ]);
    res.json({ songs, amps });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Gateway listening on http://localhost:${PORT}`);
});