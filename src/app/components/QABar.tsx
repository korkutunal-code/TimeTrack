/**
 * QABar — dev/test-only floating control panel.
 *
 * Shown when QA mode is enabled (?qa=1 in dev, or VITE_QA_MODE=true in prod).
 * Lets reviewers:
 *  - Impersonate a seeded test user (employee / manager / admin)
 *  - Override the calendar "today" to inspect any date
 *  - Enable/disable QA state without leaving the page
 *
 * NOT rendered in production builds unless explicitly opted in.
 */
import { useEffect, useState } from 'react';
import { Bug, Calendar, User, X } from 'lucide-react';
import { Button } from './ui/button';
import {
    isQAModeEnabled,
    getQASeedUsers,
    loadQAState,
    setQAEnabled,
    setQAImpersonate,
    setQADateOverride,
    clearQAState,
    type QAUserOverride,
} from '../lib/qaMode';

export function QABar() {
    const enabled = isQAModeEnabled();
    const [open, setOpen] = useState(false);
    const [state, setState] = useState(loadQAState());

    useEffect(() => {
        const handler = () => setState(loadQAState());
        window.addEventListener('tt:qa-state-changed', handler as EventListener);
        return () => window.removeEventListener('tt:qa-state-changed', handler as EventListener);
    }, []);

    if (!enabled) return null;

    const seedUsers = getQASeedUsers();
    const today = new Date().toISOString().slice(0, 10);

    return (
        <>
            {/* Floating launcher */}
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="fixed bottom-4 right-4 z-[9999] h-12 w-12 rounded-full bg-purple-600 text-white shadow-2xl flex items-center justify-center hover:bg-purple-700 transition"
                aria-label="Toggle QA panel"
                title="QA panel"
            >
                <Bug className="h-5 w-5" />
            </button>

            {/* Panel */}
            {open && (
                <div className="fixed bottom-20 right-4 z-[9999] w-80 max-h-[80vh] overflow-auto rounded-2xl bg-white shadow-2xl border border-purple-200 p-4 space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Bug className="h-4 w-4 text-purple-600" />
                            <h3 className="font-bold text-slate-900">QA Mode</h3>
                        </div>
                        <button onClick={() => setOpen(false)} aria-label="Close QA panel" className="text-slate-400 hover:text-slate-700">
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    {/* Enable toggle */}
                    <div className="flex items-center justify-between rounded-lg bg-slate-50 p-2">
                        <span className="text-sm font-medium text-slate-700">QA Override Active</span>
                        <input
                            type="checkbox"
                            checked={state.enabled}
                            onChange={(e) => {
                                setQAEnabled(e.target.checked);
                                setState(loadQAState());
                            }}
                            className="h-4 w-4 accent-purple-600"
                            aria-label="QA override active"
                        />
                    </div>

                    {state.enabled && (
                        <>
                            {/* Impersonate */}
                            <div className="space-y-2">
                                <div className="flex items-center gap-1 text-xs font-semibold text-slate-600 uppercase">
                                    <User className="h-3 w-3" /> Impersonate
                                </div>
                                <div className="grid grid-cols-1 gap-1">
                                    <button
                                        onClick={() => {
                                            setQAImpersonate(null);
                                            setState(loadQAState());
                                        }}
                                        className={`text-left text-xs px-2 py-1.5 rounded ${!state.impersonate ? 'bg-purple-100 text-purple-900 font-semibold' : 'hover:bg-slate-50 text-slate-600'}`}
                                    >
                                        Real logged-in user
                                    </button>
                                    {seedUsers.map((u: QAUserOverride) => (
                                        <button
                                            key={u.uid}
                                            onClick={() => {
                                                setQAImpersonate(u);
                                                setState(loadQAState());
                                            }}
                                            className={`text-left text-xs px-2 py-1.5 rounded ${state.impersonate?.uid === u.uid ? 'bg-purple-100 text-purple-900 font-semibold' : 'hover:bg-slate-50 text-slate-600'}`}
                                        >
                                            {u.name} <span className="text-slate-400">({u.role})</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Date override */}
                            <div className="space-y-2">
                                <div className="flex items-center gap-1 text-xs font-semibold text-slate-600 uppercase">
                                    <Calendar className="h-3 w-3" /> "Today" override
                                </div>
                                <input
                                    type="date"
                                    value={state.dateOverride || today}
                                    onChange={(e) => {
                                        setQADateOverride(e.target.value);
                                        setState(loadQAState());
                                    }}
                                    className="w-full rounded border border-slate-200 px-2 py-1 text-sm"
                                />
                                {state.dateOverride && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                            setQADateOverride(null);
                                            setState(loadQAState());
                                        }}
                                        className="w-full text-xs"
                                    >
                                        Reset to real today ({today})
                                    </Button>
                                )}
                            </div>

                            {/* Reset all */}
                            <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => {
                                    clearQAState();
                                    setState(loadQAState());
                                }}
                                className="w-full"
                            >
                                Clear all QA state
                            </Button>
                        </>
                    )}

                    <p className="text-[10px] text-slate-400 leading-tight">
                        QA mode is dev/test only. State lives in localStorage and never leaves your browser.
                    </p>
                </div>
            )}
        </>
    );
}
