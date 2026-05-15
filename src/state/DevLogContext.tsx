import React, { createContext, useContext, useEffect, useState } from "react";

export interface DevLogEntry {
  level: "warn" | "error";
  message: string;
  timestamp: number;
}

// Patch at module load time so nothing is missed before React mounts.
const _entries: DevLogEntry[] = [];
let _onEntry: ((e: DevLogEntry) => void) | null = null;

function addEntry(entry: DevLogEntry) {
  _entries.push(entry);
  _onEntry?.(entry);
}

if (import.meta.env.DEV) {
  // console.warn / console.error
  const _origWarn = console.warn.bind(console);
  const _origError = console.error.bind(console);
  console.warn = (...args: unknown[]) => {
    _origWarn(...args);
    addEntry({ level: "warn", message: args.map(String).join(" "), timestamp: Date.now() });
  };
  console.error = (...args: unknown[]) => {
    _origError(...args);
    addEntry({ level: "error", message: args.map(String).join(" "), timestamp: Date.now() });
  };

  // Unhandled JS errors and resource load failures
  window.addEventListener("error", (event) => {
    const msg = event.message
      || (event.filename ? `Script error in ${event.filename}` : "Unknown error");
    addEntry({ level: "error", message: msg, timestamp: Date.now() });
  });

  // Unhandled promise rejections
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason instanceof Error
      ? event.reason.message
      : String(event.reason);
    addEntry({ level: "error", message: `Unhandled rejection: ${reason}`, timestamp: Date.now() });
  });

  // fetch — catch non-ok HTTP responses and network failures
  const _origFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
    const url = typeof args[0] === "string"
      ? args[0]
      : args[0] instanceof URL
        ? args[0].href
        : (args[0] as Request).url;
    try {
      const response = await _origFetch(...args);
      if (!response.ok) {
        addEntry({
          level: "error",
          message: `${response.status} ${response.statusText} — ${url}`,
          timestamp: Date.now(),
        });
      }
      return response;
    } catch (err) {
      addEntry({
        level: "error",
        message: `Network error: ${err} — ${url}`,
        timestamp: Date.now(),
      });
      throw err;
    }
  };
}

interface DevLogContextValue {
  entries: DevLogEntry[];
  isOpen: boolean;
  open: () => void;
  close: () => void;
  clear: () => void;
}

const DevLogContext = createContext<DevLogContextValue | null>(null);

export function DevLogProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<DevLogEntry[]>([..._entries]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    // Sync entries captured between initial render and this effect
    setEntries([..._entries]);
    // Subscribe for all future entries
    _onEntry = () => setEntries([..._entries]);
    return () => {
      _onEntry = null;
    };
  }, []);

  return (
    <DevLogContext.Provider value={{
      entries,
      isOpen,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      clear: () => { _entries.length = 0; setEntries([]); },
    }}>
      {children}
    </DevLogContext.Provider>
  );
}

export function useDevLog(): DevLogContextValue {
  const ctx = useContext(DevLogContext);
  if (!ctx) throw new Error("useDevLog must be used within DevLogProvider");
  return ctx;
}
