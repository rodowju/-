import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { WebSocketServer, type WebSocket } from 'ws';
import { MAX_MESSAGE_BYTES, PROTOCOL, checkGhost, encode, parseC2S, pickGhost, type S2C } from '@freeze/net';
import { GhostStore } from './ghostStore';
import { Matchmaker } from './matchmaker';
import type { MatchRoom, Peer } from './room';

export interface ServerOptions {
  readonly port: number;
  readonly host?: string;
  /** 허용 Origin (쉼표 구분). 비우면 '*' (개발용) */
  readonly allowedOrigins?: readonly string[];
  readonly ghostFile?: string;
  readonly queueWaitMs?: number;
  readonly countdownMs?: number;
  readonly maxHumans?: number;
  /** 테스트용 시계 주입 */
  readonly now?: () => number;
}

export interface RunningServer {
  readonly port: number;
  readonly store: GhostStore;
  readonly rooms: Set<MatchRoom>;
  close(): Promise<void>;
}

const MAX_BODY = 64 * 1024;
const POST_PER_MIN = 20;

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const now = opts.now ?? (() => performance.now());
  const store = new GhostStore(opts.ghostFile);
  const rooms = new Set<MatchRoom>();
  const roomOf = new Map<string, MatchRoom>();
  const posts = new Map<string, number[]>();

  const matchmaker = new Matchmaker({
    now,
    waitMs: opts.queueWaitMs ?? 8000,
    maxHumans: opts.maxHumans ?? 4,
    countdownMs: opts.countdownMs ?? 3000,
    onRoom: (room) => {
      rooms.add(room);
      // 룸 소속 등록은 피어 id 로
      for (const [id, peer] of peers) if (room.has(peer)) roomOf.set(id, room);
    },
  });
  const peers = new Map<string, Peer>();

  // ───────── HTTP (고스트 API) ─────────
  const cors = (req: IncomingMessage, res: ServerResponse): void => {
    const origin = req.headers.origin ?? '';
    const allowed = opts.allowedOrigins?.length ? opts.allowedOrigins : ['*'];
    if (allowed.includes('*')) res.setHeader('Access-Control-Allow-Origin', '*');
    else if (allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
  };
  const json = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const rateLimited = (ip: string): boolean => {
    const t = Date.now();
    const list = (posts.get(ip) ?? []).filter((x) => t - x < 60_000);
    list.push(t);
    posts.set(ip, list);
    return list.length > POST_PER_MIN;
  };

  const http = createServer((req, res) => {
    cors(req, res);
    const url = new URL(req.url ?? '/', 'http://x');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    if (req.method === 'GET' && url.pathname === '/healthz') {
      json(res, 200, { ok: true, rooms: rooms.size, queued: matchmaker.waiting() });
      return;
    }
    if (url.pathname === '/api/ghosts' && req.method === 'POST') {
      if (rateLimited(req.socket.remoteAddress ?? '?')) return json(res, 429, { ok: false, reason: 'rate' });
      let size = 0;
      const chunks: Buffer[] = [];
      let aborted = false;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) {
          aborted = true;
          json(res, 413, { ok: false, reason: 'too-large' });
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        if (aborted) return;
        let body: unknown;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          return json(res, 400, { ok: false, reason: 'json' });
        }
        const r = checkGhost(body);
        if (!r.ok) return json(res, 422, r);
        const added = store.add(r.sub, r.finishTick, r.score);
        json(res, 200, { ok: true, finishTick: r.finishTick, score: r.score, stored: !!added, rank: added?.rank ?? 0 });
      });
      return;
    }
    if (url.pathname === '/api/ghosts' && req.method === 'GET') {
      const stage = Number(url.searchParams.get('stage'));
      const target = Number(url.searchParams.get('target') ?? Infinity);
      if (!Number.isInteger(stage) || stage < 1) return json(res, 400, { ok: false, reason: 'stage' });
      const g = pickGhost(store.list(stage), Number.isFinite(target) ? target : Infinity);
      // 고스트 없음은 오류가 아니다: 204 (브라우저 콘솔에 오류로 찍히지 않음)
      if (!g) {
        res.writeHead(204).end();
        return;
      }
      return json(res, 200, { ok: true, stage: g.stage, assist: g.assist, finishTick: g.finishTick, inputs: g.inputs });
    }
    if (url.pathname === '/api/leaderboard' && req.method === 'GET') {
      const stage = Number(url.searchParams.get('stage'));
      if (!Number.isInteger(stage) || stage < 1) return json(res, 400, { ok: false, reason: 'stage' });
      return json(res, 200, { ok: true, stage, top: store.leaderboard(stage) });
    }
    json(res, 404, { ok: false, reason: 'not-found' });
  });

  // ───────── WebSocket (실시간 매치) ─────────
  const wss = new WebSocketServer({
    server: http,
    path: '/ws',
    maxPayload: MAX_MESSAGE_BYTES,
    verifyClient: (info: { origin: string }) => {
      const allowed = opts.allowedOrigins?.length ? opts.allowedOrigins : ['*'];
      return allowed.includes('*') || allowed.includes(info.origin);
    },
  });

  wss.on('connection', (ws: WebSocket) => {
    const id = randomUUID();
    const peer: Peer = {
      id,
      send: (msg: S2C) => {
        if (ws.readyState === ws.OPEN) ws.send(encode(msg));
      },
    };
    peers.set(id, peer);
    let hello = false;
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const msg = parseC2S(data.toString());
      if (!msg) return;
      if (msg.t === 'hello') {
        if (msg.v !== PROTOCOL) {
          peer.send({ t: 'error', code: 'protocol' });
          ws.close();
          return;
        }
        hello = true;
        peer.send({ t: 'welcome', v: PROTOCOL });
        return;
      }
      if (!hello) return;
      const room = roomOf.get(id);
      if (msg.t === 'ping' && !room) {
        peer.send({ t: 'pong', c: msg.c, s: now() });
        return;
      }
      if (msg.t === 'queue' && !room) {
        matchmaker.enqueue(peer, msg.stage);
        return;
      }
      if (msg.t === 'leave' && !room) {
        matchmaker.remove(peer);
        return;
      }
      room?.onMessage(peer, msg);
    });
    ws.on('close', () => {
      matchmaker.remove(peer);
      roomOf.get(id)?.onLeave(peer);
      roomOf.delete(id);
      peers.delete(id);
    });
  });

  const loop = setInterval(() => {
    matchmaker.tick();
    for (const room of rooms) {
      if (room.update()) {
        rooms.delete(room);
        for (const [pid, r] of roomOf) if (r === room) roomOf.delete(pid);
      }
    }
  }, 4);

  await new Promise<void>((resolve) => http.listen(opts.port, opts.host ?? '0.0.0.0', resolve));
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;

  return {
    port,
    store,
    rooms,
    close: async () => {
      clearInterval(loop);
      for (const c of wss.clients) c.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => http.close(() => r()));
      store.flush();
    },
  };
}
