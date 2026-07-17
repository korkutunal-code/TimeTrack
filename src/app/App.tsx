import { useState, useEffect } from 'react';
import { authService, User } from './lib/auth';
import { dbService } from './lib/database';
import { LoginPage } from './components/LoginPage';
import { TodayEntry } from './components/employee/TodayEntry';
import { ClockPunch } from './components/employee/ClockPunch';
import { HistoryView } from './components/employee/HistoryView';
import { TeamDashboard } from './components/manager/TeamDashboard';
import { AdminPanel } from './components/admin/AdminPanel';
import { PayrollReports } from './components/admin/PayrollReports';
import { AuditViewer } from './components/admin/AuditViewer';
import { PatternMetrics } from './components/admin/PatternMetrics';
import { CorrectionRequests } from './components/admin/CorrectionRequests';
import { Card } from './components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Badge } from './components/ui/badge';
import { UserAvatar } from './components/ui/user-avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu';
import { Toaster } from './components/ui/sonner';
import { LogOut, Clock, Users, Settings, FileText, Search, TrendingUp, FileWarning } from 'lucide-react';
import { QABar } from './components/QABar';
import { ReportProblemButton } from './components/ReportProblemButton';

type EmployeeView = 'today' | 'history';
type ManagerView = 'dashboard';
type AdminView = 'panel' | 'payroll' | 'audit' | 'metrics' | 'corrections';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  const testMode =
    import.meta.env.VITE_TEST_MODE === 'true' ||
    (import.meta.env.DEV && new URLSearchParams(window.location.search).has('test'));
  const usingEmulators =
    import.meta.env.VITE_USE_EMULATORS === 'true' ||
    (import.meta.env.DEV && new URLSearchParams(window.location.search).has('emu'));
  // Audit fix: previously both `ClockPunch` (new, one-tap) and `TodayEntry`
  // (legacy, multi-step form) rendered stacked for every employee. Two
  // competing UIs caused inconsistent behaviour across users. Now ClockPunch
  // is the primary employee surface; TodayEntry is opt-in via ?classic=1 so
  // pilot users can fall back if needed.
  const useClassicEntry = new URLSearchParams(window.location.search).get('classic') === '1';

  // View state
  const [employeeView, setEmployeeView] = useState<EmployeeView>('today');
  const [adminView, setAdminView] = useState<AdminView>('panel');

  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = authService.onAuthStateChanged((user) => {
      setCurrentUser(user);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadUsersIfAllowed() {
      if (!currentUser) {
        setAllUsers([]);
        return;
      }

      // Only managers/admins can list all users (Firestore rules enforce this too).
      if (currentUser.role === 'manager' || currentUser.role === 'admin') {
        try {
          const users = await dbService.getAllUsers();
          if (!cancelled) setAllUsers(users);
        } catch {
          if (!cancelled) setAllUsers([]);
        }
      } else {
        setAllUsers([]);
      }
    }

    loadUsersIfAllowed();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.uid, currentUser?.role]);

  const handleLogout = async () => {
    await authService.logout();
    setEmployeeView('today');
    setAdminView('panel');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <>
        <LoginPage onLoginSuccess={() => { }} />
        <Toaster />
      </>
    );
  }

  const renderHeader = () => (
    <header className="bg-white/70 backdrop-blur-xl border-b border-indigo-100/50 shadow-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 md:py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 md:gap-3">
            <div className="bg-gradient-to-tr from-indigo-600 to-violet-500 p-2 md:p-2.5 rounded-xl shadow-md shadow-indigo-500/20">
              <Clock className="size-5 md:size-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-slate-900 text-base md:text-lg tracking-tight">TimeTracker</h1>
              <p className="text-xs md:text-sm text-slate-500 hidden sm:block font-medium">Welcome back!</p>
            </div>
            {(testMode || usingEmulators) && (
              <div className="hidden sm:flex items-center gap-2 ml-4">
                {usingEmulators && <Badge variant="outline" className="border-indigo-200 text-indigo-700 bg-indigo-50/50">EMULATORS</Badge>}
                {testMode && <Badge variant="secondary" className="bg-violet-100 text-violet-800">TEST MODE</Badge>}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Account menu"
                className="rounded-full outline-none cursor-pointer transition-transform hover:scale-105 active:scale-95 focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
              >
                <UserAvatar
                  name={currentUser.name}
                  size="md"
                  className="size-8 sm:size-10"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={8} className="w-56 p-2">
                <div className="px-2 py-1.5">
                  <p className="text-sm font-bold text-slate-800 tracking-tight truncate">
                    {currentUser.name}
                  </p>
                  <p className="text-xs text-indigo-600 font-medium uppercase tracking-wider">
                    {currentUser.role === 'employee'
                      ? `Emp #${currentUser.uid.substring(0, 4)}`
                      : currentUser.role}
                  </p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => handleLogout()}
                  className="cursor-pointer w-full justify-start gap-2 font-medium"
                >
                  <LogOut className="size-4" />
                  <span>Sign Out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  );

  const renderEmployeeView = () => (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {employeeView === 'today' ? (
        <div className="max-w-4xl mx-auto space-y-6">
          {useClassicEntry ? (
            <TodayEntry
              user={currentUser}
              onViewHistory={() => setEmployeeView('history')}
            />
          ) : (
            <ClockPunch
              user={currentUser}
              onViewHistory={() => setEmployeeView('history')}
            />
          )}
        </div>
      ) : (
        <HistoryView
          user={currentUser}
          onBack={() => setEmployeeView('today')}
        />
      )}
    </div>
  );

  const renderManagerView = () => (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <Tabs defaultValue="team" className="space-y-6">
        <TabsList className="grid grid-cols-2 w-full">
          <TabsTrigger value="team">
            <Users className="size-4 mr-2" />
            Team
          </TabsTrigger>
          <TabsTrigger value="my-time">
            <Clock className="size-4 mr-2" />
            My Time
          </TabsTrigger>
        </TabsList>

        <TabsContent value="team">
          <TeamDashboard user={currentUser} allUsers={allUsers} />
        </TabsContent>

        <TabsContent value="my-time">
          {useClassicEntry ? (
            employeeView === 'today' ? (
              <TodayEntry
                user={currentUser}
                onViewHistory={() => setEmployeeView('history')}
              />
            ) : (
              <HistoryView
                user={currentUser}
                onBack={() => setEmployeeView('today')}
              />
            )
          ) : (
            <ClockPunch
              user={currentUser}
              onViewHistory={() => setEmployeeView('history')}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );

  const renderAdminView = () => (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <Tabs value={adminView} onValueChange={(v) => setAdminView(v as AdminView)} className="space-y-4">
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <TabsList className="grid grid-cols-3 sm:grid-cols-6 w-full gap-1">
            <TabsTrigger value="panel" className="text-xs sm:text-sm">
              <Settings className="size-4 mr-0 sm:mr-2" />
              <span className="hidden sm:inline">Admin</span>
              <span className="sm:hidden">Panel</span>
            </TabsTrigger>
            <TabsTrigger value="payroll" className="text-xs sm:text-sm">
              <FileText className="size-4 mr-0 sm:mr-2" />
              <span className="hidden sm:inline">Payroll</span>
              <span className="sm:hidden">Pay</span>
            </TabsTrigger>
            <TabsTrigger value="audit" className="text-xs sm:text-sm">
              <Search className="size-4 mr-0 sm:mr-2" />
              <span>Audit</span>
            </TabsTrigger>
            <TabsTrigger value="metrics" className="text-xs sm:text-sm">
              <TrendingUp className="size-4 mr-0 sm:mr-2" />
              <span className="hidden sm:inline">Metrics</span>
              <span className="sm:hidden">Stats</span>
            </TabsTrigger>
            <TabsTrigger value="team" className="text-xs sm:text-sm">
              <Users className="size-4 mr-0 sm:mr-2" />
              <span>Team</span>
            </TabsTrigger>
            <TabsTrigger value="corrections" className="text-xs sm:text-sm">
              <FileWarning className="size-4 mr-0 sm:mr-2" />
              <span className="hidden sm:inline">Corrections</span>
              <span className="sm:hidden">Fix</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="panel">
          <AdminPanel
            currentUser={currentUser}
            allUsers={allUsers}
            onUsersChange={setAllUsers}
          />
        </TabsContent>

        <TabsContent value="payroll">
          <PayrollReports allUsers={allUsers} />
        </TabsContent>

        <TabsContent value="audit">
          <AuditViewer allUsers={allUsers} />
        </TabsContent>

        <TabsContent value="metrics">
          <PatternMetrics allUsers={allUsers} />
        </TabsContent>

        <TabsContent value="team">
          <TeamDashboard user={currentUser} allUsers={allUsers} />
        </TabsContent>

        <TabsContent value="corrections">
          <CorrectionRequests currentUser={currentUser} />
        </TabsContent>
      </Tabs>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {isOffline && (
        <div className="bg-amber-500 text-white text-center py-2 px-4 text-sm font-medium animate-in slide-in-from-top-2">
          You are currently offline. Time entries will be saved when your connection is restored.
        </div>
      )}
      {renderHeader()}

      {currentUser.role === 'employee' && renderEmployeeView()}
      {currentUser.role === 'manager' && renderManagerView()}
      {currentUser.role === 'admin' && renderAdminView()}

      <Toaster />
      <QABar />
      <ReportProblemButton />
    </div>
  );
}