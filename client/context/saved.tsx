import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useAuth } from "@/context/auth";
import { request } from "@/lib/api";

export type SavedEventSummary = {
  id: string;
  title: string;
  category: string | null;
  start_time: string | null;
  end_time: string | null;
  description?: string | null;
  cover_image_url?: string | null;
  price?: number | null;
  rating_avg?: number | null;
  rating_count?: number | null;
  tags?: string[] | null;
  location?: {
    name?: string | null;
    address?: string | null;
    features?: unknown;
  } | null;
  latitude?: number | null;
  longitude?: number | null;
  distance_km?: number | null;
};

type SavedContextValue = {
  savedIds: Set<string>;
  savedEvents: SavedEventSummary[];
  savedLoading: boolean;
  savedError: string | null;
  pendingSaveIds: Set<string>;
  isEventSaved: (eventId: string | null | undefined) => boolean;
  refreshSaved: () => Promise<void>;
  toggleSave: (event: SavedEventSummary) => Promise<boolean>;
};

const SavedContext = createContext<SavedContextValue | null>(null);

export function SavedProvider({ children }: { children: ReactNode }) {
  const { isAuthed, authLoading } = useAuth();
  const [savedEvents, setSavedEvents] = useState<SavedEventSummary[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [pendingSaveIds, setPendingSaveIds] = useState<Set<string>>(() => new Set());
  const refreshSeqRef = useRef(0);

  const savedIds = useMemo(() => {
    return new Set(savedEvents.map((event) => event.id));
  }, [savedEvents]);

  const refreshSaved = useCallback(async () => {
    if (!isAuthed) {
      setSavedEvents([]);
      setSavedError(null);
      return;
    }

    const seq = refreshSeqRef.current + 1;
    refreshSeqRef.current = seq;
    setSavedLoading(true);

    try {
      const data = await request<{ events?: SavedEventSummary[] }>("/api/saved", { timeoutMs: 12000 });
      if (refreshSeqRef.current !== seq) {
        return;
      }
      setSavedEvents(data.events ?? []);
      setSavedError(null);
    } catch (err) {
      if (refreshSeqRef.current !== seq) {
        return;
      }
      const message = err instanceof Error ? err.message : "Unable to load saved events";
      setSavedError(message);
    } finally {
      if (refreshSeqRef.current === seq) {
        setSavedLoading(false);
      }
    }
  }, [isAuthed]);

  useEffect(() => {
    if (authLoading) {
      return;
    }
    if (!isAuthed) {
      setSavedEvents([]);
      setSavedError(null);
      setSavedLoading(false);
      setPendingSaveIds(new Set());
      return;
    }
    refreshSaved();
  }, [authLoading, isAuthed, refreshSaved]);

  const isEventSaved = useCallback(
    (eventId: string | null | undefined) => {
      if (!eventId) return false;
      return savedIds.has(eventId);
    },
    [savedIds]
  );

  const toggleSave = useCallback(
    async (event: SavedEventSummary) => {
      if (!event.id) {
        throw new Error("event.id is required");
      }
      if (!isAuthed) {
        throw new Error("Sign in to save events.");
      }
      const { id } = event;
      if (pendingSaveIds.has(id)) {
        return isEventSaved(id);
      }

      const currentlySaved = isEventSaved(id);
      setPendingSaveIds((prev) => new Set(prev).add(id));

      if (currentlySaved) {
        setSavedEvents((prev) => prev.filter((item) => item.id !== id));
      } else {
        setSavedEvents((prev) => {
          if (prev.some((item) => item.id === id)) {
            return prev;
          }
          return [event, ...prev];
        });
      }

      try {
        if (currentlySaved) {
          await request(`/api/saved/${id}`, { method: "DELETE", timeoutMs: 12000 });
          setSavedError(null);
          return false;
        }

        await request("/api/saved", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event_id: id }),
          timeoutMs: 12000,
        });
        setSavedError(null);
        return true;
      } catch (err) {
        if (currentlySaved) {
          setSavedEvents((prev) => (prev.some((item) => item.id === id) ? prev : [event, ...prev]));
        } else {
          setSavedEvents((prev) => prev.filter((item) => item.id !== id));
        }
        const message = err instanceof Error ? err.message : "Unable to update saved events";
        setSavedError(message);
        throw err;
      } finally {
        setPendingSaveIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [isAuthed, pendingSaveIds, isEventSaved]
  );

  const value = useMemo<SavedContextValue>(
    () => ({
      savedIds,
      savedEvents,
      savedLoading,
      savedError,
      pendingSaveIds,
      isEventSaved,
      refreshSaved,
      toggleSave,
    }),
    [savedIds, savedEvents, savedLoading, savedError, pendingSaveIds, isEventSaved, refreshSaved, toggleSave]
  );

  return <SavedContext.Provider value={value}>{children}</SavedContext.Provider>;
}

export function useSaved() {
  const context = useContext(SavedContext);
  if (!context) {
    throw new Error("useSaved must be used within SavedProvider");
  }
  return context;
}
