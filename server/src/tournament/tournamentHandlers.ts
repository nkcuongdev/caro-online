import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { normalizeAvatar, type AvatarStorage } from '../avatars/avatars.js';
import type { AppConfig } from '../config.js';
import type { AckFailure, ErrorCode } from '../protocol.js';
import { ERROR_MESSAGES, GameError } from '../rooms/roomManager.js';
import { createRateLimiter } from '../socket/validation.js';
import { BOARD_SIZES, TURN_SECONDS } from '../types.js';
import { BEST_OF, TOURNAMENT_SIZES, type ParticipantAccount, type TournamentManager } from './tournamentManager.js';
import { toTournamentSnapshot, tournamentChannel } from './tournamentSerialize.js';

const tournamentId = z.string().regex(/^[A-Za-z0-9]{4,16}$/);
const name = z.string().max(64).optional();
const avatar = z.string().max(300).optional();

export const tournamentSchemas = {
  create: z.object({
    name,
    playerName: name,
    avatar,
    size: z.union(TOURNAMENT_SIZES.map((n) => z.literal(n))),
    /** Omitted = BO1, so older clients keep working. */
    bestOf: z.union(BEST_OF.map((n) => z.literal(n))).optional().default(1),
    boardSize: z.union(BOARD_SIZES.map((n) => z.literal(n))).optional(),
    turnSeconds: z.union(TURN_SECONDS.map((n) => z.literal(n))).optional(),
  }),
  enter: z.object({
    tournamentId,
    token: z.string().min(16).max(64).optional(),
    takeover: z.boolean().optional().default(false),
  }),
  join: z.object({ tournamentId, name, avatar }),
  profile: z.object({ tournamentId, name: z.string().min(1).max(64).optional(), avatar }),
  only: z.object({ tournamentId }),
  kick: z.object({ tournamentId, participantId: z.string().min(1).max(32) }),
  ready: z.object({ tournamentId, matchId: z.string().regex(/^r\d{1,2}m\d{1,2}$/) }),
};

interface TournamentSession {
  id: string;
  participantId?: string;
}

const fail = (code: ErrorCode, message = ERROR_MESSAGES[code]): AckFailure => ({ ok: false, error: code, message });

/**
 * Transport for tournaments, kept apart from the room handlers: a socket can
 * watch one tournament (the bracket) while it sits in one game room.
 */
export function registerTournamentHandlers(
  io: Server,
  tournaments: TournamentManager,
  cfg: AppConfig,
  avatars: AvatarStorage,
  /** The equipped name style of an account (`default` without one). */
  nameStyleOf: (userId: string | null) => string = () => 'default',
  /** The equipped avatar frame of an account (`frame_default` without one). */
  avatarFrameOf: (userId: string | null) => string = () => 'frame_default',
  /** The equipped title id of an account (null without one). */
  titleOf: (userId: string | null) => string | null = () => null,
) {
  io.on('connection', (socket: Socket) => {
    const allow = createRateLimiter(15, 1000);
    // `userId` is the socket's login, kept up to date by the room handlers (socket/handlers.ts).
    const data = socket.data as { tournament?: TournamentSession; userId?: string | null; identified?: Promise<void> };
    const avatarOf = (raw: string | undefined) => normalizeAvatar(raw, avatars);
    const account = (): ParticipantAccount => {
      const userId = data.userId ?? null;
      return { userId, nameStyle: nameStyleOf(userId), avatarFrame: avatarFrameOf(userId), titleId: titleOf(userId) };
    };

    function on<S extends z.ZodType>(event: string, schema: S, fn: (input: z.output<S>) => Promise<object | void>) {
      socket.on(event, async (raw: unknown, ack?: unknown) => {
        const reply = typeof ack === 'function' ? (ack as (res: unknown) => void) : () => {};
        if (!allow()) return reply(fail('RATE_LIMITED'));
        const parsed = schema.safeParse(raw ?? {});
        if (!parsed.success) return reply(fail('INVALID_PAYLOAD'));
        try {
          // The room handlers resolve the handshake login first (socket/handlers.ts).
          await data.identified;
          reply({ ok: true, ...((await fn(parsed.data)) ?? {}) });
        } catch (err) {
          if (err instanceof GameError) return reply(fail(err.code, err.message));
          console.error(`[socket] ${event} failed`, err);
          reply(fail('INTERNAL'));
        }
      });
    }

    const snapshot = (id: string) => {
      const t = tournaments.get(id);
      if (!t) throw new GameError('TOURNAMENT_NOT_FOUND');
      return toTournamentSnapshot(t, cfg);
    };

    const requireParticipant = (id: string) => {
      const s = data.tournament;
      if (s?.id !== id || !s.participantId) throw new GameError('NOT_IN_TOURNAMENT');
      return s.participantId;
    };

    const bind = (id: string, participantId?: string) => {
      socket.join(tournamentChannel(id));
      data.tournament = { id, participantId };
    };

    /** Stops watching the current tournament (if it's not `keep`). */
    const unbind = async (keep?: string) => {
      const s = data.tournament;
      if (!s || s.id === keep) return;
      socket.leave(tournamentChannel(s.id));
      delete data.tournament;
      await tournaments.detach(s.id, socket.id).catch(() => {});
    };

    on('tournament:create', tournamentSchemas.create, async (input) => {
      await unbind();
      const { tournament, participant } = await tournaments.create({
        name: input.name,
        playerName: input.playerName,
        avatar: avatarOf(input.avatar),
        size: input.size,
        bestOf: input.bestOf,
        boardSize: input.boardSize ?? cfg.boardSize,
        turnMs: input.turnSeconds ? input.turnSeconds * 1000 : cfg.turnMs,
        socketId: socket.id,
        account: account(),
      });
      bind(tournament.id, participant.id);
      return { tournamentId: tournament.id, participantId: participant.id, token: participant.token, state: snapshot(tournament.id) };
    });

    on('tournament:enter', tournamentSchemas.enter, async ({ tournamentId: id, token, takeover }) => {
      await unbind(id);
      const { participant } = await tournaments.enter(id, token, takeover, socket.id, account());
      bind(id, participant?.id);
      return participant
        ? { role: 'participant', participantId: participant.id, token: participant.token, state: snapshot(id) }
        : { role: 'spectator', state: snapshot(id) };
    });

    on('tournament:join', tournamentSchemas.join, async ({ tournamentId: id, name: playerName, avatar: raw }) => {
      await unbind(id);
      const { participant } = await tournaments.join(id, playerName, avatarOf(raw), socket.id, account());
      bind(id, participant.id);
      return { participantId: participant.id, token: participant.token, state: snapshot(id) };
    });

    on('tournament:profile', tournamentSchemas.profile, async ({ tournamentId: id, name: playerName, avatar: raw }) => {
      const value = raw === undefined ? undefined : avatarOf(raw);
      if (raw !== undefined && !value) throw new GameError('INVALID_PAYLOAD', 'Avatar không hợp lệ.');
      return tournaments.updateProfile(id, requireParticipant(id), { name: playerName, avatar: value });
    });

    on('tournament:leave', tournamentSchemas.only, async ({ tournamentId: id }) => {
      const participantId = requireParticipant(id);
      socket.leave(tournamentChannel(id));
      delete data.tournament;
      await tournaments.leave(id, participantId);
    });

    on('tournament:unwatch', tournamentSchemas.only, async ({ tournamentId: id }) => {
      if (data.tournament?.id === id && !data.tournament.participantId) await unbind();
    });

    on('tournament:kick', tournamentSchemas.kick, async ({ tournamentId: id, participantId }) => {
      const { kickedSockets } = await tournaments.kick(id, requireParticipant(id), participantId);
      for (const sid of kickedSockets) {
        const s = io.sockets.sockets.get(sid);
        if (!s) continue;
        const session = (s.data as { tournament?: TournamentSession }).tournament;
        if (session?.id === id) delete session.participantId;
        s.emit('tournament:kicked', { tournamentId: id });
      }
    });

    on('tournament:start', tournamentSchemas.only, async ({ tournamentId: id }) => {
      await tournaments.start(id, requireParticipant(id));
    });

    on('tournament:ready', tournamentSchemas.ready, async ({ tournamentId: id, matchId }) => {
      return tournaments.ready(id, requireParticipant(id), matchId);
    });

    socket.on('disconnect', () => {
      void unbind();
    });
  });
}
