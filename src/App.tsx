import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AdminLayout from "@/components/layout/AdminLayout";
import Dashboard from "@/pages/Dashboard";
import Requests from "@/pages/Requests";
import LogsAI from "@/pages/LogsAI";
import LogsCurl from "@/pages/LogsCurl";
import SettingsPage from "@/pages/SettingsPage";
import AllowedDirections from "@/pages/AllowedDirections";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route element={<AdminLayout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/requests" element={<Requests />} />
            <Route path="/logs/ai" element={<LogsAI />} />
            <Route path="/logs/curl" element={<LogsCurl />} />
            <Route path="/logs" element={<Navigate to="/logs/ai" replace />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/directions" element={<AllowedDirections />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
