import { ThemeProvider } from './ThemeContext';
import { AuthProvider } from './AuthContext';
import { SessionProvider } from './SessionContext';
import { ViewModeProvider } from './ViewModeContext';
import { AvatarCacheProvider } from './AvatarCacheContext';
import { RocketLeagueRankProvider } from './RocketLeagueRankContext';

export function AppProviders({ children }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SessionProvider>
          <ViewModeProvider>
            <AvatarCacheProvider>
              <RocketLeagueRankProvider>
                {children}
              </RocketLeagueRankProvider>
            </AvatarCacheProvider>
          </ViewModeProvider>
        </SessionProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
