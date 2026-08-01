import { createContext, useContext, useState } from 'react';
import { SessionContext } from './SessionContext';
import { fetchRocketLeagueProfile } from '../lib/trn';

export const RocketLeagueRankContext = createContext();

export function RocketLeagueRankProvider({ children }) {
  const { sessions } = useContext(SessionContext);
  const [selectedPlaylist, setSelectedPlaylist] = useState('double');
  const [profiles, setProfiles] = useState({});
  const [isFetching, setIsFetching] = useState(false);
  const [remainingCount, setRemainingCount] = useState(0);
  const [lastError, setLastError] = useState('');

  async function refreshRanks() {
    if (isFetching) return;

    const candidates = sessions
      .map((session) => ({
        session,
        username: session.username || session.alias || '',
      }))
      .filter(({ username }) => Boolean(username));

    if (candidates.length === 0) {
      setLastError('No account usernames available to fetch playlists.');
      return;
    }

    setIsFetching(true);
    setRemainingCount(candidates.length);
    setLastError('');

    const nextProfiles = {};
    let failureCount = 0;

    await Promise.allSettled(
      candidates.map(async ({ session, username }) => {
        try {
          const profile = await fetchRocketLeagueProfile(username, 'epic');
          nextProfiles[session.userId] = {
            username,
            profile,
            error: null,
            fetchedAt: new Date().toISOString(),
          };
        } catch (error) {
          failureCount += 1;
          nextProfiles[session.userId] = {
            username,
            profile: null,
            error,
            fetchedAt: new Date().toISOString(),
          };
          console.error('Playlist scrape failed', { userId: session.userId, username, error });
        } finally {
          setRemainingCount((current) => Math.max(0, current - 1));
        }
      })
    );

    setProfiles((current) => ({ ...current, ...nextProfiles }));
    setLastError(failureCount > 0 ? `Playlist fetch failed for ${failureCount} account(s).` : '');
    setIsFetching(false);
  }

  return (
    <RocketLeagueRankContext.Provider
      value={{
        selectedPlaylist,
        setSelectedPlaylist,
        profiles,
        isFetching,
        remainingCount,
        lastError,
        refreshRanks,
      }}
    >
      {children}
    </RocketLeagueRankContext.Provider>
  );
}
