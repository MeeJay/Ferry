import { useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useApp } from '@/store/app';
import { AppLayout } from '@/components/Layout';
import { PageLoader } from '@/components/ui';
import LoginPage from '@/pages/Login';
import UploadPage from '@/pages/Upload';
import MySharesPage from '@/pages/MyShares';
import RequestsPage from '@/pages/Requests';
import SettingsPage from '@/pages/Settings';
import PublicPage from '@/pages/Public';
import AdminLayout from '@/pages/admin/AdminLayout';
import AdminDashboard from '@/pages/admin/Dashboard';
import AdminFiles from '@/pages/admin/Files';
import AdminUsers from '@/pages/admin/Users';
import AdminProfiles from '@/pages/admin/Profiles';
import AdminSettings from '@/pages/admin/Settings';
import AdminAudit from '@/pages/admin/Audit';

function RequireAuth({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const me = useApp((s) => s.me);
  const loc = useLocation();
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (admin && me.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  const { ready, init } = useApp();
  useEffect(() => { init(); }, [init]);
  if (!ready) return <PageLoader />;
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route index element={<UploadPage />} />
        <Route path="/my" element={<MySharesPage />} />
        <Route path="/my/requests" element={<RequestsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/admin" element={<RequireAuth admin><AdminLayout /></RequireAuth>}>
          <Route index element={<AdminDashboard />} />
          <Route path="files" element={<AdminFiles />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="profiles" element={<AdminProfiles />} />
          <Route path="settings/:tab?" element={<AdminSettings />} />
          <Route path="audit" element={<AdminAudit />} />
        </Route>
      </Route>
      {/* Everything else is a share or drop link: /{prefix}/{name}[/{file}] */}
      <Route path="*" element={<PublicPage />} />
    </Routes>
  );
}
