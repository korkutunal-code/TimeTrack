/**
 * dragmeService.ts — Stub for optional Dragme task-sync integration.
 *
 * Dragme is an external task-management service. All methods silently no-op
 * when the service is unconfigured (VITE_DRAGME_API_URL / VITE_DRAGME_API_KEY
 * env vars not set). This matches the behaviour described in AGENTS.md.
 *
 * A real implementation should communicate with the Dragme API via those env
 * vars. This stub satisfies all imports in TodayEntry.tsx without breaking
 * any existing functionality.
 */

export interface DragmeTask {
  /** Unique task identifier in Dragme */
  id: string;
  /** Human-readable task name */
  name: string;
  /** Optional project/category name the task belongs to */
  project?: string;
}

interface SyncEntryParams {
  entryId: string;
  taskId: string;
  totalHours: number;
  date: string;
  userId: string;
}

class DragmeService {
  private readonly configured: boolean;

  constructor() {
    const apiUrl = import.meta.env.VITE_DRAGME_API_URL;
    const apiKey = import.meta.env.VITE_DRAGME_API_KEY;
    this.configured = Boolean(apiUrl && apiKey);
  }

  /**
   * Fetch the list of available tasks from Dragme.
   * Returns an empty array when unconfigured (dropdown shows "No tasks available").
   */
  async fetchTasks(): Promise<DragmeTask[]> {
    if (!this.configured) {
      return [];
    }

    // TODO: implement real Dragme API call when configured
    // Example:
    //   const res = await fetch(`${import.meta.env.VITE_DRAGME_API_URL}/tasks`, {
    //     headers: { 'X-Api-Key': import.meta.env.VITE_DRAGME_API_KEY },
    //   });
    //   return res.json();
    return [];
  }

  /**
   * Push a completed time entry to Dragme for task-level time tracking.
   * Silently no-ops when unconfigured.
   */
  async syncEntry(params: SyncEntryParams): Promise<void> {
    if (!this.configured) {
      return;
    }

    // TODO: implement real Dragme API sync when configured
    // Example:
    //   await fetch(`${import.meta.env.VITE_DRAGME_API_URL}/entries`, {
    //     method: 'POST',
    //     headers: {
    //       'Content-Type': 'application/json',
    //       'X-Api-Key': import.meta.env.VITE_DRAGME_API_KEY,
    //     },
    //     body: JSON.stringify(params),
    //   });
    void params;
  }
}

export const dragmeService = new DragmeService();
