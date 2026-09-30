import { Link } from 'react-router';
import { useMatchLauncher } from '../../hooks/useMatchLauncher';
import { useTournament } from '../../hooks/useTournament';
import type { RoomTournamentLink } from '../../lib/protocol';
import { roundName } from '../../lib/tournament';
import { Trophy, useCountdown } from './parts';
import { ReadyCheckModal } from './ReadyCheckModal';

/**
 * Header chip for a tournament match room. It keeps the tournament connected
 * while the player is on the game page, so their next ready check pops up here
 * (and moves them into the next room) without going back to the bracket.
 * In a best-of series it also shows the score and counts down to the next game.
 */
export function TournamentMatchBar({ link, roomId }: { link: RoomTournamentLink; roomId: string }) {
  const { t, me, actions } = useTournament(link.id);
  const { myMatch } = useMatchLauncher(t, me, roomId);
  const isFinal = link.round === link.totalRounds - 1;
  const bestOf = link.bestOf ?? 1;
  const thisMatch = t?.rounds.flat().find((m) => m.id === link.matchId) ?? null;
  const nextIn = useCountdown(thisMatch?.status === 'LIVE' ? thisMatch.nextGameAt : null);

  return (
    <>
      <Link
        to={`/t/${link.id}`}
        title="Về bracket"
        className="group inline-flex min-w-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 px-2.5 py-1.5 text-xs font-bold text-amber-800 shadow-soft ring-1 ring-amber-200 transition-all hover:-translate-y-0.5 hover:ring-amber-300 sm:text-sm"
      >
        <Trophy className="h-4 w-4 shrink-0 transition-transform group-hover:rotate-12" />
        <span className="hidden max-w-40 truncate sm:inline">{link.name} ·</span>
        <span className={isFinal ? 'font-display text-orange-600' : 'font-display text-amber-700'}>{roundName(link.round, link.totalRounds)}</span>
        {bestOf > 1 && (
          <span className="tabular rounded-md bg-white/80 px-1.5 text-[11px] text-violet-600 ring-1 ring-violet-200">
            BO{bestOf}
            {thisMatch && thisMatch.games > 0 && (
              <>
                {' '}
                · Ván {thisMatch.games}
              </>
            )}
          </span>
        )}
        <span className="hidden rounded-md bg-white/80 px-1.5 text-[11px] text-amber-600 ring-1 ring-amber-200 group-hover:text-orange-600 md:inline">Bracket</span>
      </Link>

      {nextIn > 0 && thisMatch && (
        // Above the result dialog (z-50) so the countdown is visible over it.
        <div className="pointer-events-none fixed inset-x-0 top-3 z-[52] flex justify-center px-4" role="status" aria-live="polite">
          <div className="animate-fade-up flex items-center gap-2 rounded-full bg-violet-600 py-1.5 pr-4 pl-1.5 font-display text-sm font-bold text-white shadow-[0_10px_24px_-10px_rgb(124_58_237/0.8)]">
            <span className="tabular grid h-7 w-7 place-items-center rounded-full bg-white text-violet-600">{nextIn}</span>
            Ván {thisMatch.games + 1} bắt đầu · đổi quân
          </div>
        </div>
      )}

      {t && me.participantId && myMatch?.status === 'READY_CHECK' && (
        <ReadyCheckModal key={myMatch.id} t={t} match={myMatch} myId={me.participantId} onReady={() => actions.ready(myMatch.id)} />
      )}
    </>
  );
}
