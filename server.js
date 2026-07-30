import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';

const PORT = process.env.PORT || 8000;
const TARGET_WS_BASE = 'wss://origin.ws.prodb';
const TARGET_ORIGIN = 'https://gocharting.com';

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  
  console.log(`HTTP: ${req.method} ${url.pathname}`);
  
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
  console.log(`Upgrade: ${url.pathname}${url.search}`);
  console.log(`Headers: ${JSON.stringify(req.headers)}`);
  
  if (!url.pathname.startsWith('/ws/')) {
    console.log(`Rejected: invalid path`);
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }
  
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 3 || parts[0] !== 'ws') {
    console.log(`Rejected: invalid path format: ${parts.join('/')}`);
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }
  
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (client, req) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean);
  const dc = parts[1] || 'blr1';
  const searchParams = url.search;
  
  console.log(`[${dc}] Connection established`);
  
  const targetUrl = `${TARGET_WS_BASE}.${dc}.gocharting.com/${dc}/ws${searchParams}`;
  console.log(`[${dc}] Connecting to: ${targetUrl}`);
  
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
    client.close(1011, 'Upstream error');
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

server.listen(PORT, () => {
  console.log(`Relay started on port ${PORT}`);
});
