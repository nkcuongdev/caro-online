import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { AchievementUnlockHost } from './components/achievements/AchievementUnlockHost';
import { AuthModalHost } from './components/auth/AuthModal';
import { ToastProvider } from './components/Toasts';
import { Card, Logo } from './components/ui';
import { GamePage } from './pages/GamePage';
import { LobbyPage } from './pages/LobbyPage';
import { ProfilePage } from './pages/ProfilePage';
import { TournamentPage } from './pages/TournamentPage';

export function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LobbyPage />} />
          <Route path="/game/:roomId" element={<GamePage />} />
          <Route path="/t/:tournamentId" element={<TournamentPage />} />
          <Route path="/me" element={<ProfilePage />} />
          <Route path="/me/achievements" element={<ProfilePage tab="achievements" />} />
          <Route path="/me/titles" element={<ProfilePage tab="titles" />} />
          <Route path="/me/name-styles" element={<ProfilePage tab="nameStyles" />} />
          <Route path="/me/avatar-frames" element={<ProfilePage tab="avatarFrames" />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        <AuthModalHost />
        <AchievementUnlockHost />
      </BrowserRouter>
    </ToastProvider>
  );
}

function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 p-4">
      <Logo />
      <Card className="w-full max-w-sm p-8 text-center">
        <h1 className="font-display text-2xl font-bold text-slate-800">Không tìm thấy trang</h1>
        <p className="mt-2 text-sm text-slate-500">Trang này không tồn tại.</p>
        <Link to="/" className="mt-5 inline-block font-display font-semibold text-brand-600 hover:underline">
          Về sảnh →
        </Link>
      </Card>
    </div>
  );
}
