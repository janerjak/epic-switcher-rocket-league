import { createContext, useContext, useEffect, useState } from 'react';
import { SessionContext } from './SessionContext';
import { fetchRocketLeagueRankProfile } from '../lib/rank';
import {
  LoadRankCache,
  SaveRankCache,
} from '../../wailsjs/go/services/RocketLeagueRankCacheService';

export const RocketLeagueRankContext = createContext();

const STALE_RANK_AGE_MS = 5 * 60 * 1000;
const EMPTY_CACHE = { version: 1, accounts: {} };

function normalizeRankCache(rawCache) {
  if (!rawCache) return EMPTY_CACHE;

  try {
    const parsed = typeof rawCache === 'string' ? JSON.parse(rawCache) : rawCache;
    const accounts = parsed?.accounts && typeof parsed.accounts === 'object' ? parsed.accounts : {};

    return {
      version: parsed?.version || 1,
      accounts,
    };
  } catch {
    return EMPTY_CACHE;
  }
}

function isCacheEntryStale(entry) {
  if (!entry?.fetchedAt) return false;

  const fetchedAt = Date.parse(entry.fetchedAt);
  if (!Number.isFinite(fetchedAt)) return false;

  return Date.now() - fetchedAt > STALE_RANK_AGE_MS;
}

function isCacheEntryFresh(entry, username) {
  if (!entry || entry.username !== username) return false;
  if (entry.error) return false;
  if (!entry.profile) return false;
  return !isCacheEntryStale(entry);
}

function getErrorMessage(error) {
  if (!error) return 'Unknown playlist fetch error.';
  if (typeof error === 'string') return error;
  return error.message || String(error);
}

export function RocketLeagueRankProvider({ children }) {
  const { sessions } = useContext(SessionContext);
  const [selectedPlaylist, setSelectedPlaylist] = useState('double');
  const [rankCache, setRankCache] = useState(EMPTY_CACHE);
  const [isCacheLoaded, setIsCacheLoaded] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());
  const [isFetching, setIsFetching] = useState(false);
  const [remainingCount, setRemainingCount] = useState(0);
  const [lastError, setLastError] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function loadCache() {
      try {
        const rawCache = await LoadRankCache();
        const nextCache = normalizeRankCache(rawCache);
        if (isMounted) {
          setRankCache(nextCache);
          setLastError('');
        }
      } catch (error) {
        console.error('Failed to load Rocket League rank cache', error);
        if (isMounted) {
          setRankCache(EMPTY_CACHE);
          setLastError('Failed to load cached playlist data.');
        }
      } finally {
        if (isMounted) {
          setIsCacheLoaded(true);
        }
      }
    }

    loadCache();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowTick(Date.now());
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, []);

  async function persistCache(nextCache) {
    const normalized = normalizeRankCache(nextCache);
    setRankCache(normalized);
    await SaveRankCache(JSON.stringify(normalized));
  }

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

    const currentAccounts = rankCache.accounts || {};
    const targets = candidates.filter(({ session, username }) => {
      const entry = currentAccounts[session.userId];
      return !isCacheEntryFresh(entry, username);
    });

    if (targets.length === 0) {
      setLastError('');
      return;
    }

    setIsFetching(true);
    setRemainingCount(targets.length);
    setLastError('');

    const nextAccounts = { ...currentAccounts };
    const fetchedAt = new Date().toISOString();
    let failureCount = 0;

    await Promise.allSettled(
      targets.map(async ({ session, username }) => {
        const existingEntry = currentAccounts[session.userId];
        try {
          const profile = await fetchRocketLeagueRankProfile(username, 'epic');
          nextAccounts[session.userId] = {
            username,
            profile,
            error: '',
            fetchedAt,
          };
        } catch (error) {
          failureCount += 1;
          nextAccounts[session.userId] = {
            username,
            profile: existingEntry?.username === username ? existingEntry.profile || null : null,
            error: getErrorMessage(error),
            fetchedAt: existingEntry?.profile && existingEntry?.username === username
              ? existingEntry.fetchedAt
              : fetchedAt,
          };
          console.error('Playlist scrape failed', { userId: session.userId, username, error });
        } finally {
          setRemainingCount((current) => Math.max(0, current - 1));
        }
      })
    );

    try {
      await persistCache({
        version: 1,
        accounts: nextAccounts,
      });
      setLastError(failureCount > 0 ? `Playlist fetch failed for ${failureCount} account(s).` : '');
    } catch (error) {
      console.error('Failed to save Rocket League rank cache', error);
      setLastError('Failed to save cached playlist data.');
    } finally {
      setIsFetching(false);
      setRemainingCount(0);
    }
  }

  return (
    <RocketLeagueRankContext.Provider
      value={{
        selectedPlaylist,
        setSelectedPlaylist,
        profiles: rankCache.accounts,
        rankCache,
        isCacheLoaded,
        nowTick,
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
