import WebSocket, {RawData} from 'ws';
import http from 'http';
import url from 'url';
import dotenv from 'dotenv';

dotenv.config();

class ConnectionRole {

    public readonly name: string;

    public readonly targets: string[];

    constructor(name: string, targets: string[]) {
        this.name = name;
        this.targets = targets;
    }
}

const roles = new Map<string, ConnectionRole>([
    ['agent', new ConnectionRole('agent', ['client'])],
    ['client', new ConnectionRole('client', ['agent'])],
    ['broadcast', new ConnectionRole('broadcast', ['broadcast'])],
]);

type TokenConnections = Map<string, Set<WebSocket>>;

const port = process.env.PORT ? Number(process.env.PORT) : 8080;
const wss = new WebSocket.Server({ port });
const connectionsByTokens = new Map<string, TokenConnections>();

function registerConnection(ws: WebSocket, token: string, type: string): void {
    const tokenConnections = getOrCreateTokenConnections(token);
    const connectionSet = tokenConnections.get(type);

    if (!connectionSet) {
        return;
    }

    connectionSet.add(ws);

    console.log(`[INFO] ${type} connected with token: ${token}. Total ${type}s: ${connectionSet.size}`);
}

function getOrCreateTokenConnections(token: string): TokenConnections {
    if (!connectionsByTokens.has(token)) {
        connectionsByTokens.set(token, createTokenConnections());
    }

    return connectionsByTokens.get(token)!;
}

function createTokenConnections(): TokenConnections {
    return new Map(
        Array.from(roles.keys()).map(
            roleName => [roleName, new Set()]
        )
    );
}

function handleMessage(ws: WebSocket, token: string, type: string, message: RawData): void {
    const messageForLog = message.toString().substring(0, 100);

    console.log(`[MESS] Received from ${type} with token ${token}: "${messageForLog}..."`);

    const tokenConnections = connectionsByTokens.get(token);

    if (!tokenConnections) {
        return;
    }

    const role = roles.get(type);

    if (!role) {
        return;
    }

    const targetSockets = role.targets
        .map(name => tokenConnections.get(name))
        .filter(set => !!set)
        .flatMap(set => Array.from(set))
        .filter(targetWs => targetWs !== ws)
        .filter(targetWs => targetWs.readyState === WebSocket.OPEN);

    targetSockets.forEach(targetWs => {
        targetWs.send(message);
    });

    if (targetSockets.length === 0) {
        console.log(`[WARN] No targets available for role ${type} with token ${token}.`);
    } else {
        console.log(`[MESS] Relaying to ${targetSockets.length} connection(s) for token ${token}`);
    }
}

function handleClose(ws: WebSocket, token: string, type: string): void {
    const tokenConnections = connectionsByTokens.get(token);

    if (!tokenConnections) {
        return;
    }

    const connectionSet = tokenConnections.get(type);

    if (connectionSet) {
        connectionSet.delete(ws);
        console.log(`[INFO] ${type} disconnected with token: ${token}. Remaining: ${connectionSet.size}`);
    }

    const hasConnections = Array.from(tokenConnections.values()).some(set => set.size > 0);

    if (!hasConnections) {
        connectionsByTokens.delete(token);
        console.log(`[INFO] Token ${token} removed as no connections are left.`);
    }
}

function handleConnection(ws: WebSocket, req: http.IncomingMessage): void {
    const { query } = url.parse(req.url || '', true);
    const token = query.token as string;
    const type = (query.role || query.type) as string;

    if (!token || !roles.has(type)) {
        ws.close(1008, 'Invalid token or role');
        console.log('[WARN] Invalid connection params. Closing connection.');
        return;
    }

    registerConnection(ws, token, type);

    ws.on('message', (message: RawData) => handleMessage(ws, token, type, message));
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
