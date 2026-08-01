import { createContext, useState, useEffect, useCallback } from 'react';
import { GetCurrentLoginSession, DetectNewLoginSession, CheckIfSessionIsNew, CheckAndRenewLoginToken } from '../../wailsjs/go/services/AuthService';
import { GetUsernameForUserID } from '../../wailsjs/go/services/LogReaderService';

export const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [activeLoginSession, setActiveLoginSession] = useState(null);   // currently logged in account
  const [newLoginSession, setNewLoginSession] = useState(null);         // only if new account detected
  const [newLoginUsername, setNewLoginUsername] = useState("");
  const [isSwitchingAccount, setIsSwitchingAccount] = useState(false);  // true while an account switch is in flight
  const [pendingSwitchUserId, setPendingSwitchUserId] = useState(null);

  const checkLoginStatus = useCallback(async () => {
    try {
      console.log("🔑 Checking Epic login state...");

      const currentSession = await GetCurrentLoginSession();

      // 0. renew login token if needed
      if (currentSession?.userId && !pendingSwitchUserId) {
        await CheckAndRenewLoginToken();
      }

      // 1. detect current session
      if (currentSession?.userId) {
        if (pendingSwitchUserId && currentSession.userId !== pendingSwitchUserId) {
          if (activeLoginSession?.userId && currentSession.userId === activeLoginSession.userId) {
            setPendingSwitchUserId(null);
            setActiveLoginSession(currentSession);
            setIsLoggedIn(true);

            const isNew = await CheckIfSessionIsNew(currentSession.userId);
            setNewLoginSession(isNew ? currentSession : null);
          }
          return;
        }

        setActiveLoginSession(currentSession);
        setIsLoggedIn(true);

        const isNew = await CheckIfSessionIsNew(currentSession.userId);
        setNewLoginSession(isNew ? currentSession : null);

        if (pendingSwitchUserId === currentSession.userId) {
          setPendingSwitchUserId(null);
        }
      } else {
        if (!isSwitchingAccount) {
          setActiveLoginSession(null);
        }
        setIsLoggedIn(false);
        setNewLoginSession(null);
      }

      // 2. detect if new login occurred
      const newSession = await DetectNewLoginSession();
      setNewLoginSession(newSession?.userId ? newSession : null);

    } catch (err) {
      console.log("ℹ️ Login detection info:", err);
      setIsLoggedIn(false);
      if (!isSwitchingAccount) {
        setActiveLoginSession(null);
      }
      setNewLoginSession(null);
    }
  }, [isSwitchingAccount]);

  useEffect(() => {
    const handleFocus = async () => {
      await checkLoginStatus();
    };

    checkLoginStatus();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [checkLoginStatus]);

  // When newLoginSession changes, try to fetch its username
  useEffect(() => {
    async function fetchUsername() {
      if (newLoginSession?.userId) {
        try {
          const uname = await GetUsernameForUserID(newLoginSession.userId);
          setNewLoginUsername(uname);
        } catch (err) {
          console.warn("⚠️ No username found in logs for this user:", err);
          setNewLoginUsername("");
        }
      } else {
        setNewLoginUsername("");
      }
    }
    fetchUsername();
  }, [newLoginSession]);

  return (
    <AuthContext.Provider
      value={{
        isLoggedIn,
        activeLoginSession,
        setActiveLoginSession,
        newLoginSession,
        setNewLoginSession,
        newLoginUsername,
        checkLoginStatus,
        isSwitchingAccount,
        setIsSwitchingAccount,
        pendingSwitchUserId,
        setPendingSwitchUserId,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
