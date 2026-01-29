import WebSocket, { RawData } from 'ws';
import http from 'http';
import url from 'url';
import dotenv from 'dotenv';

dotenv.config();

type ConnectionType = 'agent' | 'client';

interface TokenConnections {
    agents: Set<WebSocket>;
    clients: Set<WebSocket>;
}

const port = process.env.PORT ? Number(process.env.PORT) : 8080;
const wss = new WebSocket.Server({ port });
const connectionsByTokens = new Map<string, TokenConnections>();

function getOrCreateTokenConnections(token: string): TokenConnections {
    if (!connectionsByTokens.has(token)) {
        connectionsByTokens.set(token, {
            agents: new Set(),
            clients: new Set()
        });
    }

    return connectionsByTokens.get(token)!;
}

function registerConnection(ws: WebSocket, token: string, type: ConnectionType): void {
    const tokenConnections = getOrCreateTokenConnections(token);
    const connectionSet = type === 'agent' ? tokenConnections.agents : tokenConnections.clients;

    connectionSet.add(ws);

    console.log(`[INFO] ${type} connected with token: ${token}. Total ${type}s: ${connectionSet.size}`);
}

function handleMessage(token: string, type: ConnectionType, message: RawData): void {
    const messageForLog = message.toString().substring(0, 100);

    console.log(`[MESS] Received from ${type} with token ${token}: "${messageForLog}..."`);

    const tokenConnections = connectionsByTokens.get(token);

    if (!tokenConnections) {
        return;
    }

    const isFromAgent = type === 'agent';
    const targets = isFromAgent ? tokenConnections.clients : tokenConnections.agents;
    const targetType: ConnectionType = isFromAgent ? 'client' : 'agent';

    if (targets.size === 0) {
        console.log(`[WARN] No ${targetType}s for token ${token}.`);
        return;
    }

    console.log(`[MESS] Relaying to ${targets.size} ${targetType}(s) for token ${token}`);

    targets.forEach(target => {
        if (target.readyState === WebSocket.OPEN) {
            target.send(message);
        }
    });
}

function handleClose(ws: WebSocket, token: string, type: ConnectionType): void {
    const tokenConnections = connectionsByTokens.get(token);

    if (!tokenConnections) {
        return;
    }

    const connectionSet = type === 'agent' ? tokenConnections.agents : tokenConnections.clients;

    connectionSet.delete(ws);

    console.log(`[INFO] ${type} disconnected with token: ${token}. Remaining: ${connectionSet.size}`);

    if (tokenConnections.agents.size === 0 && tokenConnections.clients.size === 0) {
        connectionsByTokens.delete(token);

        console.log(`[INFO] Token ${token} removed as no connections are left.`);
    }
}

function handleConnection(ws: WebSocket, req: http.IncomingMessage): void {
    const { query } = url.parse(req.url || '', true);
    const token = query.token as string;
    const type = query.type as ConnectionType;

    if (!token || (type !== 'agent' && type !== 'client')) {
        ws.close(1008, 'Invalid token or type');
        console.log('[WARN] Invalid connection params. Closing connection.');
        return;
    }

    registerConnection(ws, token, type);

    ws.on('message', (message: RawData) => handleMessage(token, type, message));
    ws.on('close', () => handleClose(ws, token, type));
    ws.on('error', (error: Error) => console.error(`[ERROR] Token ${token}:`, error));
}

function shutdown(): void {
    console.log('\n[INFO] Server is shutting down.');

    wss.close(() => {
        console.log('[INFO] All WebSocket connections closed.');
        process.exit(0);
    });
}

wss.on('connection', handleConnection);
process.on('SIGINT', shutdown);

console.log(`[INFO] WebSocket relay server started on port ${port}`);
