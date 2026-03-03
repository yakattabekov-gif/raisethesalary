import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import AdminLayout from "@/components/layout/AdminLayout";
import Dashboard from "@/pages/Dashboard";
import Requests from "@/pages/Requests";
import LogsAI from "@/pages/LogsAI";
import LogsCurl from "@/pages/LogsCurl";
import SettingsPage from "@/pages/SettingsPage";
import AllowedDirections from "@/pages/AllowedDirections";
import EndpointConfig from "@/pages/EndpointConfig";
import SparkCities from "@/pages/SparkCities";
import ProfileSettings from "@/pages/ProfileSettings";
import UserManagement from "@/pages/UserManagement";
import Login from "@/pages/Login";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const ProtectedRoutes = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/requests" element={<Requests />} />
        <Route path="/logs/ai" element={<LogsAI />} />
        <Route path="/logs/curl" element={<LogsCurl />} />
        <Route path="/logs" element={<Navigate to="/logs/ai" replace />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/directions" element={<AllowedDirections />} />
        <Route path="/endpoints" element={<EndpointConfig />} />
        <Route path="/cities" element={<SparkCities />} />
        <Route path="/profile" element={<ProfileSettings />} />
        <Route path="/users" element={<UserManagement />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginGuard />} />
          <Route path="/*" element={<ProtectedRoutes />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

const LoginGuard = () => {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return <Login />;
};

export default App;
