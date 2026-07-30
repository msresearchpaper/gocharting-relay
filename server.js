import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';

const PORT = process.env.PORT || 8000;
const TARGET_WS_BASE = 'wss://origin.ws.prodb';
const TARGET_ORIGIN = 'https://gocharting.com';

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return;
  }
  
  res.writeHead(404);
  res.end('Not Found');
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  console.log(`[${new Date().toISOString()}] Upgrade: ${url.pathname}${url.search}`);
  
  if (!url.pathname.startsWith('/ws/')) {
    console.log(`[${new Date().toISOString()}] Rejected: invalid path`);
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }
  
  wss.handleUpgrade(req, socket, head, (ws, req) => {
    console.log(`[${new Date().toISOString()}] WebSocket upgrade successful`);
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (client, req) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean);
  const dc = parts[1] || 'blr1';
  const searchParams = url.search;
  
  console.log(`[${new Date().toISOString()}][${dc}] Client connected, params: ${searchParams}`);
  
  const targetUrl = `${TARGET_WS_BASE}.${dc}.gocharting.com/${dc}/ws${searchParams}`;
  console.log(`[${dc}] Connecting to upstream: ${targetUrl}`);
  
  const upstream = new WebSocket(targetUrl, {
    headers: {
      'Origin': TARGET_ORIGIN,
      'Host': `origin.ws.prodb.${dc}.gocharting.com`,
    }
  });
  
  upstream.on('open', () => {
    console.log(`[${dc}] ✅ Upstream connected`);
  });
  
  upstream.on('message', (data) => {
    console.log(`[${dc}] Upstream → Client: ${data.toString().substring(0, 50)}`);
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
  
  upstream.on('error', (error) => {
    console.error(`[${dc}] ❌ Upstream error:`, error.message);
  });
  
  upstream.on('close', (code, reason) => {
    console.log(`[${dc}] Upstream closed: code=${code}, reason=${reason ? reason.toString() : 'none'}`);
    if (client.readyState === WebSocket.OPEN) {
      client.close(code, reason);
    }
  });
  
  client.on('open', () => {
    console.log(`[${dc}] Client ready`);
  });
  
  client.on('message', (data) => {
    console.log(`[${dc}] Client → Upstream: ${data.toString().substring(0, 50)}`);
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data);
    }
  });
  
  client.on('error', (error) => {
    console.error(`[${dc}] Client error:`, error.message);
  });
  
  client.on('close', (code, reason) => {
    console.log(`[${dc}] Client closed: code=${code}`);
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.close(code, reason);
    }
  });
  
  // Log if client doesn't connect within 5 seconds
  setTimeout(() => {
    if (upstream.readyState === WebSocket.CONNECTING) {
      console.log(`[${dc}] ⚠️ Upstream still connecting after 5s`);
    }
  }, 5000);
});

server.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Relay started on port ${PORT}`);
});

// Keep process alive
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down');
  process.exit(0);
});
