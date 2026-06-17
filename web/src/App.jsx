import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import Login from './pages/Login.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import AdminLayout from './pages/admin/AdminLayout.jsx';
import Dashboard from './pages/admin/Dashboard.jsx';
import Employees from './pages/admin/Employees.jsx';
import NewEmployee from './pages/admin/NewEmployee.jsx';
import ReviewQueue from './pages/admin/ReviewQueue.jsx';
import EmployeeDetail from './pages/admin/EmployeeDetail.jsx';
import Accept from './pages/onboarding/Accept.jsx';
import OnboardingForm from './pages/onboarding/OnboardingForm.jsx';
import Done from './pages/onboarding/Done.jsx';

function RequireAuth({ children }) {
  const { auth } = useAuth();
  const loc = useLocation();
  if (!auth?.token) return <Navigate to="/login" state={{ from: loc }} replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/change-password" element={<RequireAuth><ChangePassword /></RequireAuth>} />

      {/* Public onboarding (token links from email) */}
      <Route path="/onboarding/accept" element={<Accept />} />
      <Route path="/onboarding/form" element={<OnboardingForm />} />
      <Route path="/onboarding/done" element={<Done />} />

      {/* HR admin */}
      <Route path="/admin" element={<RequireAuth><AdminLayout /></RequireAuth>}>
        <Route index element={<Dashboard />} />
        <Route path="employees" element={<Employees />} />
        <Route path="employees/new" element={<NewEmployee />} />
        <Route path="employees/:id" element={<EmployeeDetail />} />
        <Route path="review" element={<ReviewQueue />} />
      </Route>

      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}
