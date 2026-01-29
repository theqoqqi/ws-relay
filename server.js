const WebSocket = require('ws');
const url = require('url');

require('dotenv').config();

const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });
const connectionsByTokens = new Map();

function getOrCreateTokenConnections(token) {
    if (!connectionsByTokens.has(token)) {
        connectionsByTokens.set(token, {
            agents: new Set(),
            clients: new Set()
        });
    }

    return connectionsByTokens.get(token);
}

function registerConnection(ws, token, type) {
    const tokenConnections = getOrCreateTokenConnections(token);
    const connectionSet = type === 'agent' ? tokenConnections.agents : tokenConnections.clients;

    connectionSet.add(ws);

    console.log(`[INFO] ${type} connected with token: ${token}. Total ${type}s: ${connectionSet.size}`);
}

function handleMessage(ws, token, type, message) {
    const messageForLog = message.toString().substring(0, 100);

    console.log(`[MESS] Received from ${type} with token ${token}: "${messageForLog}..."`);

    const tokenConnections = connectionsByTokens.get(token);
    const isFromAgent = type === 'agent';
    const targets = isFromAgent ? tokenConnections.clients : tokenConnections.agents;
    const targetType = isFromAgent ? 'client' : 'agent';

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

function handleClose(ws, token, type) {
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

function handleConnection(ws, req) {
    const { query } = url.parse(req.url, true);
    const { token, type } = query;

    if (!token || !type || (type !== 'agent' && type !== 'client')) {
        console.log('[WARN] Invalid connection params. Closing connection.');
        ws.close(1008, 'Invalid token or type');
        return;
    }

    registerConnection(ws, token, type);

    ws.on('message', (message) => handleMessage(ws, token, type, message));
    ws.on('close', () => handleClose(ws, token, type));
    ws.on('error', (error) => console.error(`[ERROR] Token ${token}:`, error));
}

function shutdown() {
    console.log('\n[INFO] Server is shutting down.');
    wss.close(() => {
        console.log('[INFO] All WebSocket connectionsByTokens closed.');
        process.exit(0);
    });
}

wss.on('connection', handleConnection);
process.on('SIGINT', shutdown);

console.log(`[INFO] WebSocket relay server started on port ${port}`);
