import { useState, useEffect, useRef } from 'react';
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
import { SystemSettingsView, type SettingsGuard } from './components/admin/SystemSettingsView';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { UserAvatar } from './components/ui/user-avatar';
import { TimeZoneSelector } from './components/ui/time-zone-selector';
import { TimezoneViewToggle } from './components/ui/timezone-view-toggle';
import type { TimeViewMode } from '../utils/timeView';
import { DEFAULT_DISPLAY_TIMEZONE } from './lib/timezones';
import { Save, RotateCcw, ArrowLeft } from 'lucide-react';

/** localStorage key for the persisted display-timezone choice ('auto' or IANA id). */
const DISPLAY_TIMEZONE_STORAGE_KEY = 'timetrack.displayTimezone';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu';
import { Toaster } from './components/ui/sonner';
import { LogOut, Clock, Users, Settings, FileText, Search, TrendingUp, FileWarning, Sliders } from 'lucide-react';
import { QABar } from './components/QABar';
import { ReportProblemButton } from './components/ReportProblemButton';

type EmployeeView = 'today' | 'history';
type AdminView = 'panel' | 'payroll' | 'audit' | 'metrics' | 'corrections' | 'settings';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  // Display-only time zone for the punch screen's live date/time/zone label.
  // Pure UI state — never affects storage or calculations (AGENTS.md §2).
  // The value is either the 'auto' sentinel (tracks the OS timezone, the
  // default) or a concrete IANA id (manual override). Persisted to
  // localStorage so the choice survives reloads; 'auto' re-resolves the OS
  // TZ on each load so traveling users follow their device clock.
  const [displayTimezone, setDisplayTimezoneState] = useState<string>(
    () => localStorage.getItem(DISPLAY_TIMEZONE_STORAGE_KEY) || DEFAULT_DISPLAY_TIMEZONE,
  );
  const setDisplayTimezone = (tz: string) => {
    setDisplayTimezoneState(tz);
    try {
      localStorage.setItem(DISPLAY_TIMEZONE_STORAGE_KEY, tz);
    } catch {
      // localStorage may be unavailable (private mode / quota); the in-memory
      // choice still works for the session.
    }
  };

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
  // Admin/Manager timezone view (Req 4): 'local' = employee local tz (default),
  // 'pt' = America/Los_Angeles (California Time). Applied to analysis views.
  const [timeViewMode, setTimeViewMode] = useState<TimeViewMode>('local');

  // Unsaved-changes navigation guard for the Settings tab.
  // settingsGuardRef lets SystemSettingsView expose its dirty state +
  // save/discard/highlight handlers to us without prop-drilling.
  // pendingTab holds the admin tab the user tried to switch to while dirty;
  // when set, the Unsaved Changes modal is shown.
  const settingsGuardRef = useRef<SettingsGuard>(null);
  const [pendingTab, setPendingTab] = useState<AdminView | null>(null);
  const [guardBusy, setGuardBusy] = useState(false);

  // Browser unload guard: if the Settings form is dirty, prompt before the
  // page is closed/refreshed. beforeunload requires a string return (ignored
  // by modern browsers but necessary to trigger the native prompt).
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (settingsGuardRef.current?.isDirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

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

  // Depend on uid/role primitives (not the user object identity) so this only
  // re-runs when the signed-in user or their role actually changes.
  const currentUserUid = currentUser?.uid;
  const currentUserRole = currentUser?.role;

  useEffect(() => {
    let cancelled = false;

    async function loadUsersIfAllowed() {
      if (!currentUserUid) {
        setAllUsers([]);
        return;
      }

      // Only managers/admins can list all users (Firestore rules enforce this too).
      if (currentUserRole === 'manager' || currentUserRole === 'admin') {
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
  }, [currentUserUid, currentUserRole]);

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
            {currentUser.role !== 'admin' && (
              <TimeZoneSelector value={displayTimezone} onChange={setDisplayTimezone} />
            )}
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
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
              displayTimezone={displayTimezone}
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
              displayTimezone={displayTimezone}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );

  const renderAdminView = () => (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <Tabs
        value={adminView}
        onValueChange={(v) => {
          const next = v as AdminView;
          // Intercept tab switches away from Settings when there are unsaved
          // edits: show the Unsaved Changes modal instead of navigating.
          if (adminView === 'settings' && next !== 'settings' && settingsGuardRef.current?.isDirty()) {
            setPendingTab(next);
            return;
          }
          setAdminView(next);
        }}
        className="space-y-4"
      >
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <TabsList className="grid grid-cols-3 sm:grid-cols-7 w-full gap-1">
            <TabsTrigger value="panel" className="text-xs sm:text-sm">
              <Settings className="size-4 mr-0 sm:mr-2" />
              <span className="hidden sm:inline">User Base</span>
              <span className="sm:hidden">User Base</span>
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
            <TabsTrigger value="settings" className="text-xs sm:text-sm">
              <Sliders className="size-4 mr-0 sm:mr-2" />
              <span className="hidden sm:inline">Settings</span>
              <span className="sm:hidden">Set</span>
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
          <div className="mb-3">
            <TimezoneViewToggle mode={timeViewMode} onChange={setTimeViewMode} />
          </div>
          <PayrollReports allUsers={allUsers} timeViewMode={timeViewMode} />
        </TabsContent>

        <TabsContent value="audit">
          <div className="mb-3">
            <TimezoneViewToggle mode={timeViewMode} onChange={setTimeViewMode} />
          </div>
          <AuditViewer allUsers={allUsers} timeViewMode={timeViewMode} />
        </TabsContent>

        <TabsContent value="metrics">
          <div className="mb-3">
            <TimezoneViewToggle mode={timeViewMode} onChange={setTimeViewMode} />
          </div>
          <PatternMetrics allUsers={allUsers} timeViewMode={timeViewMode} />
        </TabsContent>

        <TabsContent value="team">
          <div className="mb-3">
            <TimezoneViewToggle mode={timeViewMode} onChange={setTimeViewMode} />
          </div>
          <TeamDashboard user={currentUser} allUsers={allUsers} timeViewMode={timeViewMode} />
        </TabsContent>

        <TabsContent value="corrections">
          <CorrectionRequests currentUser={currentUser} />
        </TabsContent>

        <TabsContent value="settings">
          <SystemSettingsView ref={settingsGuardRef} currentUser={currentUser} />
        </TabsContent>
      </Tabs>

      {/* Unsaved Changes navigation guard (Settings tab only). */}
      <Dialog open={pendingTab !== null} onOpenChange={(open) => { if (!open) setPendingTab(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
            <DialogDescription>
              You have unsaved settings changes. What would you like to do before leaving?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-col gap-2 sm:flex-col sm:justify-stretch">
            <Button
              className="w-full"
              disabled={guardBusy}
              onClick={async () => {
                setGuardBusy(true);
                const ok = await settingsGuardRef.current?.save();
                setGuardBusy(false);
                if (ok) {
                  const next = pendingTab;
                  setPendingTab(null);
                  if (next) setAdminView(next);
                }
              }}
            >
              <Save className="size-4 mr-2" />
              Save settings
            </Button>
            <Button
              variant="outline"
              className="w-full"
              disabled={guardBusy}
              onClick={() => {
                settingsGuardRef.current?.discard();
                const next = pendingTab;
                setPendingTab(null);
                if (next) setAdminView(next);
              }}
            >
              <RotateCcw className="size-4 mr-2" />
              Discard changes
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => {
                settingsGuardRef.current?.highlightDirty();
                setPendingTab(null);
              }}
            >
              <ArrowLeft className="size-4 mr-2" />
              Get back to the settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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