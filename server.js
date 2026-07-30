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

wss.on('connection', (client, req) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean);
  
  // Path format: /ws/{dc}/ws
  if (parts.length < 3 || parts[0] !== 'ws') {
    console.log(`Invalid path: ${url.pathname}`);
    client.close(1008, 'Invalid path');
    return;
  }
  
  const dc = parts[1] || 'blr1';
  const searchParams = url.search;
  
  console.log(`[${dc}] New connection, search: ${searchParams}`);
  
  const targetUrl = `${TARGET_WS_BASE}.${dc}.gocharting.com/${dc}/ws${searchParams}`;
  
  const upstream = new WebSocket(targetUrl, {
    headers: {
      'Origin': TARGET_ORIGIN,
      'Host': `origin.ws.prodb.${dc}.gocharting.com`,
    }
  });
  
  upstream.on('open', () => {
    console.log(`[${dc}] Upstream connected`);
  });
  
  upstream.on('message', (data) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
  
  upstream.on('error', (error) => {
    console.error(`[${dc}] Upstream error:`, error.message);
  });
  
  upstream.on('close', (code, reason) => {
    console.log(`[${dc}] Upstream closed: code=${code}`);
    if (client.readyState === WebSocket.OPEN) {
      client.close(code, reason);
    }
  });
  
  client.on('message', (data) => {
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
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  console.log(`Upgrade request: ${url.pathname}${url.search}`);
  
  if (url.pathname.startsWith('/ws/')) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    console.log(`Rejected path: ${url.pathname}`);
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`WebSocket Relay started on port ${PORT}`);
  console.log(`Target: ${TARGET_WS_BASE}.*.gocharting.com`);
});
