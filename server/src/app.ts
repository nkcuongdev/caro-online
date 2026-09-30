import cors from 'cors';
import express from 'express';
import { createServer, type Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { AccountStore } from './accounts/accountStore.js';
import { createAuthRouter } from './accounts/authRoutes.js';
import { AuthService } from './accounts/authService.js';
import { MatchRecorder } from './accounts/matchRecorder.js';
import { registerAchievementHooks } from './achievements/achievementEvents.js';
import { AchievementManager } from './achievements/achievementManager.js';
import { createAvatarRouter } from './avatars/avatarRoutes.js';
import { createAvatarStorage, type AvatarStorage } from './avatars/avatars.js';
import { CommsHub, DEFAULT_COMMS_LIMITS, type CommsLimits } from './comms/commsHub.js';
import { createIceProvider } from './comms/iceProvider.js';
import { DEFAULT_STANDS_LIMITS, StandsHub, type StandsLimits } from './comms/standsHub.js';
import { isOriginAllowed, type AppConfig } from './config.js';
import { createAvatarFrameRouter } from './cosmetics/avatarFrameRoutes.js';
import { AvatarFrameService, avatarFrameLinks } from './cosmetics/avatarFrameService.js';
import { createNameStyleRouter } from './cosmetics/nameStyleRoutes.js';
import { NameStyleService, nameStyleLinks } from './cosmetics/nameStyleService.js';
import { DEFAULT_AVATAR_FRAME } from './cosmetics/avatarFrames.js';
import { DEFAULT_NAME_STYLE } from './cosmetics/nameStyles.js';
import { MemoryRoomRepository, type RoomRepository } from './rooms/roomRepository.js';
import { RoomManager, type SeatCosmetics } from './rooms/roomManager.js';
import { RewardService } from './rewards/rewardService.js';
import { registerSocketHandlers } from './socket/handlers.js';
import { createSocketSink, userChannel } from './socket/socketSink.js';
import { TitleService } from './titles/titleService.js';
import { TimerManager } from './timer/timerManager.js';
import { registerTournamentHandlers } from './tournament/tournamentHandlers.js';
import { TournamentManager } from './tournament/tournamentManager.js';
import { createTournamentSink } from './tournament/tournamentSerialize.js';

export interface CaroServer {
  httpServer: HttpServer;
  io: Server;
  manager: RoomManager;
  tournaments: TournamentManager;
  accounts: AccountStore;
  close(): Promise<void>;
}

export function createCaroServer(
  cfg: AppConfig,
  repo: RoomRepository = new MemoryRoomRepository(),
  commsLimits?: Partial<CommsLimits> & { stands?: Partial<StandsLimits> },
  avatars: AvatarStorage = createAvatarStorage(cfg.avatars),
  accounts: AccountStore = new AccountStore(cfg.accounts.databasePath, undefined, cfg.accounts.databaseAuthToken),
): CaroServer {
  const originCheck = (origin: string | undefined, cb: (err: Error | null, ok?: boolean) => void) =>
    cb(null, isOriginAllowed(origin, cfg.clientOrigins));

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(cors({ origin: originCheck }));

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: originCheck, methods: ['GET', 'POST'] },
    // Faster dead-connection detection than the defaults (25s/20s), so the
    // opponent sees "offline" within a few seconds of a network drop.
    pingInterval: 10_000,
    pingTimeout: 8_000,
    maxHttpBufferSize: 16_000,
  });

  const timers = new TimerManager();
  const manager = new RoomManager(repo, timers, createSocketSink(() => io, cfg), cfg);
  const comms = new CommsHub(io, manager, { ...DEFAULT_COMMS_LIMITS, ...commsLimits });
  const ice = createIceProvider(cfg.voice);
  if (ice) comms.setIceProvider(ice);
  const stands = new StandsHub(io, manager, avatars, { ...DEFAULT_STANDS_LIMITS, ...commsLimits?.stands });
  const auth = new AuthService(accounts, cfg.accounts);
  const recorder = new MatchRecorder(accounts, manager);
  const rewards = new RewardService(accounts);
  const achievements = new AchievementManager(accounts, undefined, rewards);
  const titles = new TitleService(accounts, achievements);
  registerAchievementHooks(io, recorder, achievements, (userId) => accounts.coins(userId));
  const nameStyles = new NameStyleService(accounts, nameStyleLinks(achievements.definitions));
  const avatarFrames = new AvatarFrameService(accounts, avatarFrameLinks(achievements.definitions));

  // Seats show their account's equipped title, name style and avatar frame, and follow them live when they change.
  // Rooms and tournaments read them synchronously, so they come from this cache: signing in fills it (auth.identify
  // waits for that), equipping updates it, and a miss answers the defaults, loads, then re-dresses the seats.
  const cosmetics = createCosmeticsCache(
    async (userId) => {
      const [titleId, nameStyle, avatarFrame] = await Promise.all([titles.equippedTitleId(userId), nameStyles.equippedFor(userId), avatarFrames.equippedFor(userId)]);
      return { titleId, nameStyle, avatarFrame };
    },
    (userId, c) => {
      void manager.refreshCosmetics(userId);
      void tournaments.refreshNameStyle(userId, c.nameStyle);
      void tournaments.refreshAvatarFrame(userId, c.avatarFrame);
      void tournaments.refreshTitle(userId, c.titleId);
    },
  );
  auth.onIdentified((userId) => cosmetics.warm(userId));
  manager.setCosmeticsResolver((userId) => cosmetics.get(userId));
  nameStyles.onEquipped((userId, nameStyle) => {
    cosmetics.patch(userId, { nameStyle });
    void manager.refreshCosmetics(userId);
    void tournaments.refreshNameStyle(userId, nameStyle);
  });
  avatarFrames.onEquipped((userId, avatarFrame) => {
    cosmetics.patch(userId, { avatarFrame });
    void manager.refreshCosmetics(userId);
    void tournaments.refreshAvatarFrame(userId, avatarFrame);
  });
  titles.onEquipped((userId, titleId) => {
    cosmetics.patch(userId, { titleId });
    void manager.refreshCosmetics(userId);
    void tournaments.refreshTitle(userId, titleId);
    // The account's other tabs update their header and collection.
    void titles
      .equippedTitle(userId)
      .then((title) => io.to(userChannel(userId)).emit('title:equipped', { titleId, title }))
      .catch((err) => console.error('[titles] equip broadcast failed', err));
  });
  const tournaments = new TournamentManager(manager, timers, createTournamentSink(() => io, cfg), cfg);
  registerSocketHandlers(io, manager, cfg, comms, avatars, stands, auth, (socketId, userId) => {
    const c = userId ? cosmetics.get(userId) : NO_COSMETICS;
    void tournaments.setSocketAccount(socketId, { userId, nameStyle: c.nameStyle, avatarFrame: c.avatarFrame, titleId: c.titleId });
  });
  registerTournamentHandlers(
    io,
    tournaments,
    cfg,
    avatars,
    (userId) => (userId ? cosmetics.get(userId).nameStyle : DEFAULT_NAME_STYLE),
    (userId) => (userId ? cosmetics.get(userId).avatarFrame : DEFAULT_AVATAR_FRAME),
    (userId) => (userId ? cosmetics.get(userId).titleId : null),
  );
  app.use(createAvatarRouter(cfg.avatars, avatars));
  app.use(createAuthRouter(cfg.accounts, auth, recorder, avatars, achievements, titles));
  // The account's other tabs and devices follow a purchase (balance) or an equip (header, collection).
  app.use(createNameStyleRouter(auth, nameStyles, (userId, patch) => io.to(userChannel(userId)).emit('account:updated', patch)));
  app.use(createAvatarFrameRouter(auth, avatarFrames, (userId, patch) => io.to(userChannel(userId)).emit('account:updated', patch)));

  app.get('/', (_req, res) => {
    res.json({ name: 'caro-online-server', status: 'ok' });
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  app.get('/api/stats', async (_req, res) => {
    res.json(await manager.stats());
  });

  app.get('/api/rooms/:roomId', async (req, res) => {
    const roomId = String(req.params.roomId);
    // Unknown rooms answer 200 { exists: false } rather than 404, so a lookup
    // from the lobby doesn't surface as a network error in the browser console.
    if (!/^[A-Za-z0-9]{4,16}$/.test(roomId)) return res.status(400).json({ exists: false });
    const room = await manager.getRoom(roomId);
    if (!room) return res.json({ exists: false });
    res.json({
      exists: true,
      status: room.status,
      players: room.players.length,
      seatAvailable: room.players.length < 2 && room.mode !== 'tournament',
      boardSize: room.boardSize,
      turnMs: room.turnMs,
      hostName: room.players[0]?.name ?? null,
      hostAvatar: room.players[0]?.avatar ?? null,
      hostNameStyle: room.players[0]?.nameStyle ?? null,
      hostAvatarFrame: room.players[0]?.avatarFrame ?? null,
    });
  });

  app.get('/api/tournaments/:id', (req, res) => {
    const id = String(req.params.id);
    if (!/^[A-Za-z0-9]{4,16}$/.test(id)) return res.status(400).json({ exists: false });
    const t = tournaments.get(id);
    if (!t) return res.json({ exists: false });
    const host = t.participants.find((p) => p.id === t.hostId);
    res.json({
      exists: true,
      name: t.name,
      status: t.status,
      size: t.size,
      bestOf: t.bestOf,
      players: t.participants.length,
      hostName: host?.name ?? null,
      hostAvatar: host?.avatar ?? null,
      hostNameStyle: host?.nameStyle ?? null,
      hostAvatarFrame: host?.avatarFrame ?? null,
    });
  });

  const tick = setInterval(() => void manager.tick(), cfg.timerBroadcastMs);
  const sweep = setInterval(
    () =>
      void manager.sweep().then(() => {
        recorder.prune();
        return Promise.all([accounts.pruneSessions().catch((err) => console.error('[accounts] session prune failed', err)), comms.prune(), stands.prune(), tournaments.sweep()]);
      }),
    60_000,
  );

  return {
    httpServer,
    io,
    manager,
    tournaments,
    accounts,
    async close() {
      clearInterval(tick);
      clearInterval(sweep);
      timers.clearAll();
      await new Promise<void>((resolve) => io.close(() => resolve()));
      // Let finished games reach the database before it closes.
      await recorder.idle();
      await accounts.close();
    },
  };
}

const NO_COSMETICS: SeatCosmetics = { titleId: null, nameStyle: DEFAULT_NAME_STYLE, avatarFrame: DEFAULT_AVATAR_FRAME };
/** Accounts kept; the least recently used drop out first. */
const COSMETICS_CACHE_SIZE = 5_000;

/**
 * Equipped cosmetics per account, readable synchronously. `load` reads the
 * database; `onLoaded` runs when a miss finished loading, so whoever got the
 * defaults can re-dress.
 */
function createCosmeticsCache(load: (userId: string) => Promise<SeatCosmetics>, onLoaded: (userId: string, c: SeatCosmetics) => void) {
  const entries = new Map<string, SeatCosmetics>();
  const pending = new Map<string, Promise<SeatCosmetics>>();
  const put = (userId: string, c: SeatCosmetics) => {
    entries.delete(userId);
    entries.set(userId, c);
    if (entries.size > COSMETICS_CACHE_SIZE) entries.delete(entries.keys().next().value!);
  };
  const warm = (userId: string): Promise<SeatCosmetics> => {
    const hit = entries.get(userId);
    if (hit) return Promise.resolve(hit);
    let p = pending.get(userId);
    if (!p) {
      p = load(userId)
        .then((c) => (put(userId, c), c))
        .finally(() => pending.delete(userId));
      pending.set(userId, p);
    }
    return p;
  };
  return {
    warm: async (userId: string) => {
      await warm(userId);
    },
    get(userId: string): SeatCosmetics {
      const hit = entries.get(userId);
      if (hit) return hit;
      warm(userId).then(
        (c) => onLoaded(userId, c),
        (err) => console.error('[cosmetics] load failed', err),
      );
      return NO_COSMETICS;
    },
    patch(userId: string, change: Partial<SeatCosmetics>) {
      const hit = entries.get(userId);
      if (hit) put(userId, { ...hit, ...change });
    },
  };
}
