import { useEffect, useContext, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { SessionContext } from '../context/SessionContext';
import toast from 'react-hot-toast';
import { AddDetectedSession, MoveAsideActiveSession } from '../../wailsjs/go/services/AuthService';
import { LoadSessions } from '../../wailsjs/go/services/SessionStore';
import {
  HiOutlineCheckCircle,
  HiOutlineExclamationCircle,
  HiOutlineInformationCircle,
  HiOutlineXCircle,
  HiViewGrid,
  HiViewList,
  HiPlus,
  HiPencil,
} from 'react-icons/hi';
import styles from './Accounts.module.css';
import { ViewModeContext } from '../context/ViewModeContext';
import { SwitchAccount } from '../../wailsjs/go/services/SwitchService';
import { STORAGE_KEYS } from '../constants/storageKeys';
import CustomizeAvatarModal from '../components/modals/CustomizeAvatarModal';
import AddAccountModal from '../components/modals/AddAccountModal';
import { SelectAndSaveAvatar, RemoveAvatar } from '../../wailsjs/go/services/AvatarService';
import { useAvatarCache } from '../context/AvatarCacheContext';
import { getBorderThickness } from '../components/modals/CustomizeAvatarModal/avatarUtils';
import SuccessSprout from '../components/SuccessSprout';
import { extractTrnModeStats, getTrnModeLabel } from '../lib/trn';
import { RocketLeagueRankContext } from '../context/RocketLeagueRankContext';

const RANK_STALE_MS = 5 * 60 * 1000;

function getFirstVisibleChar(str) {
  if (!str) return '';
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  const firstSegment = [...segmenter.segment(str)][0]?.segment || '';
  const isEmoji = /\p{Emoji}/u.test(firstSegment);
  return isEmoji ? firstSegment : firstSegment.toUpperCase();
}

function getRankMeta(session, profiles, selectedPlaylist, nowTick) {
  const entry = profiles?.[session.userId] || null;
  const profile = entry?.profile || null;
  const rankInfo = extractTrnModeStats(profile, selectedPlaylist);
  const mmrValue = rankInfo?.mmr;
  const mmr = typeof mmrValue === 'number'
    ? mmrValue
    : typeof mmrValue === 'string' && mmrValue.trim() !== ''
      ? Number(mmrValue)
      : NaN;
  const hasMmr = Number.isFinite(mmr);

  const fetchedAt = entry?.fetchedAt ? Date.parse(entry.fetchedAt) : NaN;
  const isStale = Number.isFinite(fetchedAt) ? nowTick - fetchedAt > RANK_STALE_MS : false;
  const hasError = Boolean(entry?.error);
  const hasProfile = Boolean(profile);
  const isMissing = !entry || (!hasProfile && !hasError) || !hasMmr;
  const sortBucket = hasError || isMissing ? 1 : 0;
  const sortValue = hasMmr ? mmr : Number.POSITIVE_INFINITY;

  return {
    entry,
    rankInfo,
    mmr: hasMmr ? mmr : null,
    isStale,
    hasError,
    isMissing,
    sortBucket,
    sortValue,
  };
}

export default function Accounts() {
  const location = useLocation();
  const { sessions, setSessions, isLoading } = useContext(SessionContext);
  const {
    activeLoginSession,
    setActiveLoginSession,
    newLoginSession,
    setNewLoginSession,
    newLoginUsername,
    checkLoginStatus,
    isSwitchingAccount,
    setIsSwitchingAccount,
  } = useContext(AuthContext);

  const { viewMode, setViewMode } = useContext(ViewModeContext);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBorder, setShowBorder] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.SHOW_AVATAR_BORDER);
    return stored !== null ? stored === 'true' : true;
  });
  const [borderThickness, setBorderThickness] = useState(getBorderThickness);
  const [lastSwitchedId, setLastSwitchedId] = useState(null);
  const [switchingToId, setSwitchingToId] = useState(null);
  const autoSwitchAttemptRef = useRef(null);
  const {
    selectedPlaylist,
    nowTick,
    profiles,
    lastError,
    remainingCount,
    isFetching,
    isCacheLoaded,
  } = useContext(RocketLeagueRankContext);
  const { cacheVersion } = useAvatarCache();

  useEffect(() => {
    checkLoginStatus();
  }, [location.pathname, checkLoginStatus]);

  useEffect(() => {
    const loadBorder = () => {
      const storedBorder = localStorage.getItem(STORAGE_KEYS.SHOW_AVATAR_BORDER);
      if (storedBorder !== null) setShowBorder(storedBorder === 'true');
      setBorderThickness(getBorderThickness());
    };

    window.addEventListener('storage', loadBorder);
    return () => window.removeEventListener('storage', loadBorder);
  }, []);

  async function handleAccept() {
    const sessionToSave = { ...newLoginSession, username: newLoginUsername || '' };
    await AddDetectedSession(sessionToSave);
    const loaded = await LoadSessions();
    setSessions(loaded || []);
    toast.success('Account added!', { id: 'add-account' });
    setNewLoginSession(null);
  }

  async function handleAddMainAction() {
    try {
      await MoveAsideActiveSession();
      toast.success('Epic Games Launcher restarted - log in with your other account.', { id: 'move-aside-active-session' });
      setShowAddModal(false);
    } catch (error) {
      console.error(error);
      toast.error('Failed to move aside active session.', { id: 'move-aside-error' });
    }
  }

  async function handleSwitchAccount(session) {
    if (isSwitchingAccount) return;

    setIsSwitchingAccount(true);
    setSwitchingToId(session.userId);
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.LAUNCHER_MINIMIZED_ON_SWITCH);
      const launchMinimized = stored !== null ? stored === 'true' : true;
      await SwitchAccount(session, launchMinimized);
      setActiveLoginSession(session);
      setLastSwitchedId(session.userId);

      setTimeout(() => {
        setLastSwitchedId(null);
      }, 2500);
    } catch (error) {
      console.error(error);
      toast.error('Failed to switch account.', { id: 'switch-account-error' });
    } finally {
      setSwitchingToId(null);
      setIsSwitchingAccount(false);
    }
  }

  async function handleAvatarClick() {
    setShowAvatarModal(true);
  }

  async function handleAvatarSelect() {
    if (!activeSession) return;
    try {
      const filename = await SelectAndSaveAvatar(activeSession.userId);
      if (filename) {
        setSessions((prev) => prev.map((session) => (
          session.userId === activeSession.userId ? { ...session, avatarImage: filename } : session
        )));
        toast.success('Avatar updated!', { id: 'avatar-success' });
      }
    } catch (error) {
      console.error(error);
      toast.error('Failed to update avatar.', { id: 'avatar-error' });
    }
  }

  async function handleAvatarRemove() {
    if (!activeSession) return;
    try {
      await RemoveAvatar(activeSession.userId);
      setSessions((prev) => prev.map((session) => (
        session.userId === activeSession.userId ? { ...session, avatarImage: '' } : session
      )));
    } catch (error) {
      console.error(error);
      toast.error('Failed to clear avatar.', { id: 'avatar-error' });
    }
  }

  const activeUserId = activeLoginSession?.userId || null;

  let activeSession = activeUserId
    ? sessions.find((session) => session.userId === activeUserId) || activeLoginSession
    : null;

  const isNewSession = newLoginSession && activeLoginSession && newLoginSession.userId === activeLoginSession.userId;

  if (isNewSession && activeSession) {
    activeSession = { ...activeSession, username: newLoginUsername || activeSession.username };
  }

  const rankedSessions = useMemo(() => {
    return sessions
      .map((session) => {
        const displayName = session.alias || session.username || session.userId;
        const rankMeta = getRankMeta(session, profiles, selectedPlaylist, nowTick);

        return {
          session,
          displayName,
          ...rankMeta,
        };
      })
      .sort((left, right) => {
        if (left.sortBucket !== right.sortBucket) return left.sortBucket - right.sortBucket;
        if (left.sortValue !== right.sortValue) return left.sortValue - right.sortValue;
        return left.displayName.localeCompare(right.displayName);
      });
  }, [nowTick, profiles, selectedPlaylist, sessions]);

  const activeRankMeta = activeSession ? getRankMeta(activeSession, profiles, selectedPlaylist, nowTick) : null;
  const lowestRankedSession = rankedSessions.find((item) => item.sortBucket === 0 && Number.isFinite(item.sortValue)) || null;
  const nonActiveRankedSessions = rankedSessions.filter((item) => item.session.userId !== activeUserId);
  const nonActiveAccountsCount = sessions.filter((session) => session.userId !== activeUserId).length;
  const accountsLabel = 'Select an account to switch';

  useEffect(() => {
    const shouldAutoSwitch = localStorage.getItem(STORAGE_KEYS.AUTO_SWITCH_LOWEST_ACCOUNT) === 'true';

    if (!shouldAutoSwitch) {
      autoSwitchAttemptRef.current = null;
      return;
    }

    if (!isCacheLoaded || isLoading || isSwitchingAccount || switchingToId || !lowestRankedSession || !activeSession) {
      return;
    }

    if (activeUserId === lowestRankedSession.session.userId) {
      autoSwitchAttemptRef.current = null;
      return;
    }

    if (autoSwitchAttemptRef.current === lowestRankedSession.session.userId) {
      return;
    }

    autoSwitchAttemptRef.current = lowestRankedSession.session.userId;
    handleSwitchAccount(lowestRankedSession.session);
  }, [activeSession, activeUserId, isCacheLoaded, isLoading, isSwitchingAccount, lowestRankedSession, switchingToId]);

  function renderRankBadge(rankMeta) {
    if (!rankMeta?.rankInfo) {
      return null;
    }

    const rankText = [
      rankMeta.rankInfo.divisionName,
      rankMeta.mmr != null ? `${Math.round(rankMeta.mmr)} MMR` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    return (
      <div className={styles.rankBadge} title={rankMeta.rankInfo.rankName || rankText || 'Playlist rank'}>
        {rankMeta.rankInfo.imageURL ? (
          <img src={rankMeta.rankInfo.imageURL} alt="" className={styles.rankImage} />
        ) : (
          <div className={styles.rankImageFallback}>RL</div>
        )}
        <div className={styles.rankTextBlock}>
          <div className={styles.rankLabel}>{getTrnModeLabel(selectedPlaylist)}</div>
          <div className={styles.rankValue}>{rankText || 'No rank data'}</div>
        </div>
      </div>
    );
  }

  function renderRankStatus(rankMeta) {
    if (rankMeta?.hasError) {
      return (
        <span className={`${styles.rankStatusIcon} ${styles.rankStatusError}`} title={rankMeta.entry?.error || 'Rank fetch failed'}>
          <HiOutlineXCircle />
        </span>
      );
    }

    if (rankMeta?.isStale) {
      return (
        <span className={`${styles.rankStatusIcon} ${styles.rankStatusStale}`} title="Cached rank data is stale. Click Fetch to refresh.">
          <HiOutlineExclamationCircle />
        </span>
      );
    }

    if (rankMeta?.isMissing) {
      return (
        <span className={`${styles.rankStatusIcon} ${styles.rankStatusMissing}`} title="No cached rank data yet.">
          <HiOutlineInformationCircle />
        </span>
      );
    }

    return null;
  }

  return (
    <div className={styles.pageWrapper}>
      {!isLoading && (
        <>
          {sessions.length === 0 && !activeLoginSession ? (
            <div className={styles.noActiveAccountMessage}>
              <div className={styles.noActiveAccountText}>
                Log into Epic Games Launcher to get started
              </div>
            </div>
          ) : (
            <>
              {!activeSession && (
                <div className={styles.notLoggedInSection}>
                  <div className={styles.notLoggedInCard}>
                    <div className={styles.notLoggedInInfo}>
                      <div className={styles.notLoggedInName}>
                        Not logged in
                      </div>
                      <div className={styles.notLoggedInMeta}>
                        Select an account from the list, or login with a different one in the Epic Games Launcher
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeSession && (
                <div className={styles.activeAccountSection}>
                  <div className={styles.activeAccountContent}>
                    <div className={styles.avatarLabelGroup}>
                      <div className={styles.activeAvatarWrapper} onClick={handleAvatarClick}>
                        <div
                          className={`${styles.activeAccountAvatar} ${!showBorder ? styles.activeAccountAvatarNoBorder : ''}`}
                          style={{
                            background: activeSession.avatarColor || undefined,
                            padding: showBorder ? `${borderThickness}px` : undefined,
                          }}
                        >
                          {activeSession.avatarImage ? (
                            <img
                              src={`/avatar-thumb/${activeSession.avatarImage}?v=${cacheVersion}`}
                              alt=""
                              className={styles.customAvatarImage}
                            />
                          ) : (
                            getFirstVisibleChar(activeSession.alias || activeSession.username || activeSession.userId)
                          )}
                          <div className={styles.avatarOverlay}>
                            <HiPencil />
                          </div>
                        </div>

                        <div className={styles.activeAccountBadge} onClick={(event) => event.stopPropagation()}>
                          <HiOutlineCheckCircle />
                          <span>Currently logged in</span>
                        </div>
                      </div>

                      <div className={styles.activeAccountInfo}>
                        <div className={styles.activeAccountName}>
                          {activeSession.alias || activeSession.username || activeSession.userId}
                          {lastSwitchedId === activeSession.userId && <SuccessSprout key={activeSession.userId} />}
                        </div>

                        <div className={styles.activeRankRow}>
                          {renderRankBadge(activeRankMeta)}
                          {renderRankStatus(activeRankMeta)}
                        </div>

                        <div className={styles.lowestAccountActionRow}>
                          {lowestRankedSession ? (
                            lowestRankedSession.session.userId === activeUserId ? (
                              <div className={styles.lowestAccountBadge}>Lowest account</div>
                            ) : (
                              <button
                                type="button"
                                className={styles.lowestAccountButton}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleSwitchAccount(lowestRankedSession.session);
                                }}
                              >
                                Switch to lowest account
                              </button>
                            )
                          ) : null}
                        </div>

                        {isNewSession && (
                          <button
                            className={styles.addDetectedButton}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleAccept();
                            }}
                          >
                            <HiPlus />
                            <span>Add to Switcher</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className={styles.activeAccountSide} />
                  </div>
                </div>
              )}

              {nonActiveAccountsCount > 0 && (
                <>
                  <div className={styles.subtitleRow}>
                    <div className={styles.subtitleWithIcon}>
                      <div className={styles.subtitle}>{accountsLabel}</div>
                      <div className={styles.addTooltipWrapper}>
                        <HiOutlineInformationCircle className={styles.addIcon} />
                        <div className={styles.tooltip}>
                          Switching accounts <strong>will close and relaunch the Epic Games Launcher</strong>. This is required for the switch to work.
                        </div>
                      </div>
                    </div>

                    <div className={styles.subtitleControls}>
                      {(isFetching || lastError) && (
                        <div className={styles.trnStatusRow}>
                          {isFetching && (
                            <span className={styles.trnStatus}>
                              Refreshing {remainingCount} account{remainingCount === 1 ? '' : 's'}...
                            </span>
                          )}
                          {lastError && <span className={styles.trnError}>{lastError}</span>}
                        </div>
                      )}

                      {nonActiveAccountsCount >= 2 && (
                        <div className={styles.viewToggle}>
                          <button
                            className={`${styles.toggleBtn} ${viewMode === 'list' ? styles.activeToggle : ''}`}
                            onClick={() => setViewMode('list')}
                          >
                            <HiViewList />
                          </button>
                          <button
                            className={`${styles.toggleBtn} ${viewMode === 'grid' ? styles.activeToggle : ''}`}
                            onClick={() => setViewMode('grid')}
                          >
                            <HiViewGrid />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className={`${styles.listContainer} ${viewMode === 'grid' ? styles.gridView : styles.listView}`}>
                    {nonActiveRankedSessions.map((item) => {
                      const session = item.session;
                      const displayName = item.displayName;
                      const isSwitchingToThis = switchingToId === session.userId;
                      const isLowest = lowestRankedSession?.session.userId === session.userId;

                      return (
                        <div
                          key={session.userId}
                          className={`${styles.listItem} ${isSwitchingAccount ? styles.listItemDisabled : ''} ${isSwitchingToThis ? styles.listItemSwitching : ''} ${isLowest ? styles.listItemLowest : ''}`}
                          onClick={() => handleSwitchAccount(session)}
                          aria-disabled={isSwitchingAccount}
                        >
                          <div className={styles.avatarWrapper}>
                            <div
                              className={`${styles.avatar} ${!showBorder ? styles.avatarNoBorder : ''}`}
                              style={{
                                background: session.avatarColor || undefined,
                                padding: showBorder ? '2px' : 0,
                              }}
                            >
                              {session.avatarImage ? (
                                <img
                                  src={`/avatar-thumb/${session.avatarImage}?v=${cacheVersion}`}
                                  alt=""
                                  className={styles.customAvatarImage}
                                />
                              ) : (
                                getFirstVisibleChar(displayName)
                              )}
                            </div>
                          </div>

                          <div className={styles.textBlock}>
                            <div className={styles.inlineRow}>
                              <div className={styles.displayName}>{displayName}</div>
                              {isLowest && <div className={styles.lowestListBadge}>Lowest</div>}
                            </div>
                            <div className={styles.inlineRow}>
                              {renderRankBadge(item)}
                              {renderRankStatus(item)}
                            </div>
                          </div>

                          <div className={`${styles.itemOverlay} ${isSwitchingToThis ? styles.itemOverlayVisible : ''}`}>
                            {isSwitchingToThis ? (
                              <span className={styles.switchingSpinner} />
                            ) : (
                              <span>click to switch</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {sessions.length > 0 && sessions.filter((session) => session.userId !== activeUserId).length === 0 && (
                <div className={styles.noOtherAccountsMessage}>
                  <div className={styles.noOtherAccountsText}>
                    You haven't added any other accounts yet.
                  </div>
                  <button
                    className={`${styles.addDetectedButton} ${styles.noScaleButton}`}
                    onClick={() => setShowAddModal(true)}
                  >
                    <HiPlus />
                    <span>Add account</span>
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {showAvatarModal && (
        <CustomizeAvatarModal
          username={activeSession?.alias || activeSession?.username || activeSession?.userId}
          userId={activeSession?.userId}
          currentAvatarImage={activeSession?.avatarImage}
          currentAvatarColor={activeSession?.avatarColor}
          isLocked={isNewSession}
          onSelect={handleAvatarSelect}
          onRemove={handleAvatarRemove}
          onCancel={() => setShowAvatarModal(false)}
          onAvatarChange={(filename) => {
            setSessions((prev) => prev.map((session) => (
              session.userId === activeSession?.userId ? { ...session, avatarImage: filename } : session
            )));
          }}
          onColorChange={(color) => {
            setSessions((prev) => prev.map((session) => (
              session.userId === activeSession?.userId ? { ...session, avatarColor: color } : session
            )));
          }}
        />
      )}

      {showAddModal && (
        <AddAccountModal
          onMoveAside={handleAddMainAction}
          onCancel={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}
