"use client";

import type { AutomationLog } from "@/types/mentari";

interface LogDisplayProps {
  logs: AutomationLog[];
}

const levelStyles: Record<AutomationLog["level"], string> = {
  info: "text-blue-400",
  success: "text-green-400",
  error: "text-red-400",
  warning: "text-yellow-400",
};

const levelIcons: Record<AutomationLog["level"], string> = {
  info: "ℹ",
  success: "✓",
  error: "✗",
  warning: "⚠",
};

export default function LogDisplay({ logs }: LogDisplayProps) {
  if (logs.length === 0) return null;

  return (
    <div className="bg-gray-950 rounded-xl border border-gray-800 overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-800 flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-red-500" />
        <div className="w-3 h-3 rounded-full bg-yellow-500" />
        <div className="w-3 h-3 rounded-full bg-green-500" />
        <span className="ml-2 text-xs text-gray-500 font-mono">automation.log</span>
      </div>
      <div className="p-4 font-mono text-sm space-y-1 max-h-72 overflow-y-auto">
        {logs.map((log, i) => (
          <div key={i} className="flex gap-3 items-start">
            <span className="text-gray-600 text-xs shrink-0 mt-0.5">
              {new Date(log.timestamp).toLocaleTimeString()}
            </span>
            <span className={`shrink-0 font-bold ${levelStyles[log.level]}`}>
              {levelIcons[log.level]}
            </span>
            <span className="text-gray-300 break-all">{log.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
