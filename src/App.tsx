import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import FailuresPage from "./pages/FailuresPage";
import RunDetailPage from "./pages/RunDetailPage";
import StatsPage from "./pages/StatsPage";
import BadRequestsPage from "./pages/BadRequestsPage";
import ActiveRunsPage from "./pages/ActiveRunsPage";
import SettingsPage from "./pages/SettingsPage";
import ReleaseTrackerPage from "./pages/ReleaseTrackerPage";
import RcaPage from "./pages/RcaPage";
import RcaDocViewerPage from "./pages/RcaDocViewerPage";
import RcaCreatorPage from "./pages/RcaCreatorPage";
import RecoveryRunsPage from "./pages/RecoveryRunsPage";
import RecoveryRunDetailPage from "./pages/RecoveryRunDetailPage";
import LoginScreen from "./pages/LoginScreen";
import Spinner from "./components/Spinner";
import { useAuth } from "./api/auth";

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner label="Checking session…" />
      </div>
    );
  }

  if (!user) return <LoginScreen />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<FailuresPage />} />
        <Route path="failures" element={<FailuresPage />} />
        <Route path="active-runs" element={<ActiveRunsPage />} />
        <Route path="runs/:syncId" element={<RunDetailPage />} />
        <Route path="stats" element={<StatsPage />} />
        <Route path="bad-requests" element={<BadRequestsPage />} />
        <Route path="releases" element={<ReleaseTrackerPage />} />
        <Route path="rca" element={<RcaPage />} />
        <Route path="rca/new" element={<RcaCreatorPage />} />
        <Route path="rca/:id" element={<RcaDocViewerPage />} />
        <Route path="recovery/runs" element={<RecoveryRunsPage />} />
        <Route path="recovery/runs/:id" element={<RecoveryRunDetailPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
