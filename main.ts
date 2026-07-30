/**
 * WebSocket Relay for gocharting.com proxy
 * Deploy to Deno Deploy (free tier): https://dash.deno.com
 * 
 * Deployment steps:
 * 1. Go to https://dash.deno.com
 * 2. Click "New Project" -> "Import from GitHub" or "Upload files"
 * 3. Create a new project, name it (e.g., "gocharting-relay")
 * 4. Upload this file as main.ts
 * 5. The project will be available at: https://<project-name>.deno.dev
 * 6. Note the URL for Worker configuration
 */

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TARGET_WS_BASE = "wss://origin.ws.prodb";
const TARGET_ORIGIN = "https://gocharting.com";

interface RelayConfig {
  dc: string;
  tag: string;
  searchParams: string;
}

function parseRequestUrl(url: URL): RelayConfig | null {
  const parts = url.pathname.split("/").filter(Boolean);
  
  // Expected path: /ws/{dc}/ws
  if (parts.length < 2 || parts[0] !== "ws") {
    return null;
  }
  
  const dc = parts[1] || "blr1";
  const tag = url.searchParams.get("tag") || "";
  
  return { dc, tag, searchParams: url.search };
}

async function handleWebSocket(req: Request, config: RelayConfig): Promise<Response> {
  const upgradeHeader = req.headers.get("Upgrade");
  if (upgradeHeader !== "websocket") {
    return new Response("Expected WebSocket upgrade", { status: 400 });
  }

  // Create WebSocket pair
  const { socket: client, response } = Deno.upgradeWebSocket(req);

  // Target WebSocket URL
  const targetUrl = `${TARGET_WS_BASE}.${config.dc}.gocharting.com/${config.dc}/ws${config.searchParams}`;

  console.log(`[${config.dc}] Connecting to upstream: ${targetUrl}`);

  // Connect to upstream WebSocket server
  let upstreamWs: WebSocket | null = null;
  let upstreamConnected = false;

  try {
    upstreamWs = new WebSocket(targetUrl, {
      headers: {
        "Origin": TARGET_ORIGIN,
        "Host": `origin.ws.prodb.${config.dc}.gocharting.com`,
      }
    });
  } catch (e) {
    console.error(`[${config.dc}] Failed to create upstream WebSocket:`, e);
    client.close(1011, "Upstream connection failed");
    return response;
  }

  // Handle upstream WebSocket events
  upstreamWs.onopen = () => {
    console.log(`[${config.dc}] Upstream connected`);
    upstreamConnected = true;
  };

  upstreamWs.onmessage = (event) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(event.data);
    }
  };

  upstreamWs.onerror = (error) => {
    console.error(`[${config.dc}] Upstream WebSocket error:`, error);
    if (!upstreamConnected) {
      client.close(1011, "Upstream connection failed");
    }
  };

  upstreamWs.onclose = (event) => {
    console.log(`[${config.dc}] Upstream closed: code=${event.code}, reason=${event.reason}, wasClean=${event.wasClean}`);
    if (client.readyState === WebSocket.OPEN) {
      client.close(event.code, event.reason);
    }
  };

  // Handle client WebSocket events
  client.onmessage = (event) => {
    if (upstreamWs && upstreamWs.readyState === WebSocket.OPEN) {
      upstreamWs.send(event.data);
    }
  };

  client.onclose = (event) => {
    console.log(`[${config.dc}] Client closed: code=${event.code}, reason=${event.reason}, wasClean=${event.wasClean}`);
    if (upstreamWs && upstreamWs.readyState === WebSocket.OPEN) {
      upstreamWs.close(event.code, event.reason);
    }
  };

  client.onerror = (error) => {
    console.error(`[${config.dc}] Client WebSocket error:`, error);
    if (upstreamWs && upstreamWs.readyState === WebSocket.OPEN) {
      upstreamWs.close(1011, "Client error");
    }
  };

  return response;
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  
  // Health check
  if (url.pathname === "/health") {
    return new Response("OK", { status: 200 });
  }

  // WebSocket relay endpoint: /ws/{dc}/ws?tag=...
  if (url.pathname.startsWith("/ws/")) {
    const config = parseRequestUrl(url);
    if (!config) {
      return new Response("Invalid path", { status: 400 });
    }
    
    return handleWebSocket(req, config);
  }

  return new Response("Not Found", { status: 404 });
}

console.log("WebSocket Relay starting on port 8000");
console.log(`Target: ${TARGET_WS_BASE}.*.gocharting.com`);
serve(handleRequest, { port: 8000 });