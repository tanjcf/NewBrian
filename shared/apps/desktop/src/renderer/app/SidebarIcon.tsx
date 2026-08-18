export function SidebarIcon({ name }: { name: string }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const
  };

  if (name === "new-chat") {
    return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
  }
  if (name === "extensions") {
    return <svg {...common}><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><path d="M17 13v8M13 17h8" /></svg>;
  }
  if (name === "skills") {
    return <svg {...common}><path d="m12 3.7 1.15 4.15L17.3 9l-4.15 1.15L12 14.3l-1.15-4.15L6.7 9l4.15-1.15L12 3.7Z" /><path d="M5 4.5v3M3.5 6h3" /><path d="M18.5 15.5v2.6M17.2 16.8h2.6" /></svg>;
  }
  if (name === "plugins") {
    return <svg {...common}><path d="m8.2 8.2 3.8-3.8 3.8 3.8-3.8 3.8-3.8-3.8Z" /><path d="m4.4 15.8 3.8-3.8 3.8 3.8-3.8 3.8-3.8-3.8Z" /><path d="m12 15.8 3.8-3.8 3.8 3.8-3.8 3.8-3.8-3.8Z" /></svg>;
  }
  if (name === "automation") {
    return <svg {...common}><path d="M13 2 5 13h6l-1 9 8-12h-6l1-8Z" /></svg>;
  }
  if (name === "mcp") {
    return <svg {...common}><path d="M9 17H7A5 5 0 0 1 7 7h2" /><path d="M15 7h2a5 5 0 1 1 0 10h-2" /><path d="M8 12h8" /></svg>;
  }
  if (name === "search") {
    return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="m16.5 16.5 4 4" /></svg>;
  }
  if (name === "chat") {
    return <svg {...common}><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" /></svg>;
  }
  if (name === "mobile") {
    return <svg {...common}><rect x="7" y="2.5" width="10" height="19" rx="2" /><path d="M10.5 5h3M11 18.5h2" /></svg>;
  }
  if (name === "folder") {
    return <svg {...common}><path d="M3.5 6.5h6l2 2h9v8.5a2 2 0 0 1-2 2h-15v-12.5Z" /></svg>;
  }
  if (name === "folder-plus") {
    return <svg {...common}><path d="M3.5 6.5h6l2 2h9v8.5a2 2 0 0 1-2 2h-15v-12.5Z" /><path d="M14 12v5M11.5 14.5h5" /></svg>;
  }
  if (name === "folder-open") {
    return <svg {...common}><path d="M3.5 7h6l2 2h8.5" /><path d="m3.5 19 2.5-8h15l-2.5 8Z" /></svg>;
  }
  if (name === "pin") {
    return <svg {...common}><path d="m14.7 4.9 4.4 4.4" /><path d="m16.4 7.6-4.1 4.1" /><path d="m9.9 10.1 4 4" /><path d="M8.2 15.8 10 10l4 4-5.8 1.8Z" /><path d="m8.4 15.6-3.8 3.8" /></svg>;
  }
  if (name === "chevron-right") {
    return <svg {...common}><path d="m9 18 6-6-6-6" /></svg>;
  }
  if (name === "chevron-down") {
    return <svg {...common}><path d="m6 9 6 6 6-6" /></svg>;
  }
  if (name === "more") {
    return <svg {...common}><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></svg>;
  }
  if (name === "refresh") {
    return <svg {...common}><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>;
  }
  if (name === "download") {
    return <svg {...common}><path d="M12 3v12" /><path d="m6 11 6 6 6-6" /><path d="M4 21h16" /></svg>;
  }
  if (name === "vscode") {
    return <svg {...common}><path d="m16.5 3.8-7.2 6.7-3.2-2.4-2.3 2.1L7 12.5l-3.2 2.3 2.3 2.1 3.2-2.4 7.2 6.7 3.7-1.8V5.6l-3.7-1.8Z" /><path d="M16.5 7.7v9.6L11.3 12.5l5.2-4.8Z" /></svg>;
  }
  if (name === "external-link") {
    return <svg {...common}><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>;
  }
  if (name === "terminal") {
    return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="m7 9 3 3-3 3M13 16h4" /></svg>;
  }
  if (name === "computer") {
    return <svg {...common}><rect x="3" y="4" width="18" height="13" rx="2.5" /><path d="M8 21h8M12 17v4" /></svg>;
  }
  if (name === "ide") {
    return <svg {...common}><rect x="4" y="3" width="16" height="18" rx="2.5" /><path d="M8 7h8M8 11h5M8 15h8" /></svg>;
  }
  if (name === "sliders") {
    return <svg {...common}><path d="M4 7h8M16 7h4M4 17h3M11 17h9" /><circle cx="14" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></svg>;
  }
  if (name === "list-status") {
    return <svg {...common}><circle cx="5" cy="7" r="1.25" /><circle cx="5" cy="17" r="1.25" /><path d="M10 7h10M10 17h10M5 12h15" /></svg>;
  }
  if (name === "panel-right") {
    return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M15 4v16" /></svg>;
  }
  if (name === "maximize") {
    return <svg {...common}><path d="M9 4H4v5M15 4h5v5M20 15v5h-5M4 15v5h5" /></svg>;
  }
  if (name === "minimize") {
    return <svg {...common}><path d="M4 9h5V4M20 9h-5V4M15 20v-5h5M9 20v-5H4" /></svg>;
  }
  if (name === "git-worktree") {
    return <svg {...common}><circle cx="6" cy="5" r="2" /><circle cx="18" cy="7" r="2" /><circle cx="6" cy="19" r="2" /><path d="M6 7v10M8 7h5a5 5 0 0 1 5 5V9" /></svg>;
  }
  if (name === "edit") {
    return <svg {...common}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></svg>;
  }
  if (name === "archive") {
    return <svg {...common}><path d="M5.5 8.2h13v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2Z" /><path d="M4.6 4.8h14.8v3.4H4.6Z" /><path d="M9.7 12.4h4.6" /></svg>;
  }
  if (name === "remove") {
    return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
  }
  if (name === "settings") {
    return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.16.4.37.73.6 1 .3.32.7.46 1.1.4h.1v4h-.1a1.7 1.7 0 0 0-1.7.6Z" /></svg>;
  }
  if (name === "branch") {
    return <svg {...common}><circle cx="6" cy="5" r="2" /><circle cx="18" cy="7" r="2" /><circle cx="6" cy="19" r="2" /><path d="M6 7v10M8 7h5a5 5 0 0 1 5 5v-3" /></svg>;
  }
  if (name === "microphone") {
    return <svg {...common}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" /></svg>;
  }
  if (name === "speaker") {
    return <svg {...common}><path d="M4.5 9.5v5h3.2L12 18.5V5.5L7.7 9.5H4.5Z" /><path d="M15.2 9.2a3.4 3.4 0 0 1 0 5.6" /><path d="M17.4 7a6.2 6.2 0 0 1 0 10" /></svg>;
  }
  if (name === "stop") {
    return <svg {...common}><rect x="6.5" y="6.5" width="11" height="11" rx="1.5" /></svg>;
  }
  if (name === "hand") {
    return <svg {...common}><path d="M7.5 12.5V6.7a1.3 1.3 0 0 1 2.6 0v4.8" /><path d="M10.1 11V5.2a1.3 1.3 0 0 1 2.6 0V11" /><path d="M12.7 10.7V6.1a1.3 1.3 0 0 1 2.6 0v5.3" /><path d="M15.3 11.6V8.4a1.3 1.3 0 0 1 2.6 0v5.1c0 4.2-2.4 6.7-6.1 6.7h-.9a5.5 5.5 0 0 1-4.4-2.3l-2-2.8a1.4 1.4 0 0 1 2.2-1.7l1.2 1.4" /></svg>;
  }
  if (name === "shield-check") {
    return <svg {...common}><path d="M12 3.5 19 6v5.2c0 4.3-2.8 7.8-7 9.3-4.2-1.5-7-5-7-9.3V6l7-2.5Z" /><path d="m9.2 12 1.8 1.8 3.9-4" /></svg>;
  }
  if (name === "shield-alert") {
    return <svg {...common}><path d="M12 3.5 19 6v5.2c0 4.3-2.8 7.8-7 9.3-4.2-1.5-7-5-7-9.3V6l7-2.5Z" /><path d="M12 8v5" /><path d="M12 16h.01" /></svg>;
  }
  if (name === "shield-question") {
    return <svg {...common}><path d="M12 3.5 19 6v5.2c0 4.3-2.8 7.8-7 9.3-4.2-1.5-7-5-7-9.3V6l7-2.5Z" /><path d="M9.8 9.6a2.3 2.3 0 1 1 3.4 2c-.8.45-1.2.85-1.2 1.65" /><path d="M12 16h.01" /></svg>;
  }
  if (name === "shield-bolt") {
    return <svg {...common}><path d="M12 3.5 19 6v5.2c0 4.3-2.8 7.8-7 9.3-4.2-1.5-7-5-7-9.3V6l7-2.5Z" /><path d="m13.2 7.5-3.4 5h2.5l-1.2 4 3.5-5.3h-2.4l1-3.7Z" /></svg>;
  }
  if (name === "shield-unlock") {
    return <svg {...common}><path d="M12 3.5 19 6v5.2c0 4.3-2.8 7.8-7 9.3-4.2-1.5-7-5-7-9.3V6l7-2.5Z" /><path d="M9.3 11V9.5a2.7 2.7 0 0 1 5.1-1.2" /><rect x="8.5" y="11" width="7" height="5.2" rx="1.2" /><path d="M12 13.2v1.2" /></svg>;
  }
  if (name === "skill-grid") {
    return (
      <svg width={14} height={14} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="1.2" y="1.2" width="5.6" height="5.6" rx="1.2" fill="#7C5CFF" />
        <rect x="9.2" y="1.2" width="5.6" height="5.6" rx="1.2" fill="#22C55E" />
        <rect x="1.2" y="9.2" width="5.6" height="5.6" rx="1.2" fill="#EC4899" />
        <rect x="9.2" y="9.2" width="5.6" height="5.6" rx="1.2" fill="#F59E0B" />
      </svg>
    );
  }
  if (name === "skill-doc") {
    return (
      <svg width={18} height={18} viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="2.5" y="2" width="15" height="16" rx="3.5" fill="#3B82F6" />
        <path d="M6.5 6.8h7M6.5 10h7M6.5 13.2h4.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "paperclip") {
    return <svg {...common}><path d="m9.5 12.5 5.8-5.8a3 3 0 0 1 4.2 4.2l-8.2 8.2a5 5 0 0 1-7.1-7.1l8-8" /></svg>;
  }
  if (name === "target") {
    return <svg {...common}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3M22 12h-3M12 22v-3M2 12h3" /></svg>;
  }
  if (name === "plan") {
    return <svg {...common}><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></svg>;
  }
  if (name === "file-check") {
    return <svg {...common}><path d="M6 3h8l4 4v14H6Z" /><path d="M14 3v5h5M9 14l2 2 4-4" /></svg>;
  }
  if (name === "file-word") {
    return <svg {...common}><path d="M6 3h8l4 4v14H6Z" /><path d="M14 3v5h5M8.5 11l1.4 6 2.1-4 2.1 4 1.4-6" /></svg>;
  }
  if (name === "file-review") {
    return <svg {...common}><path d="M6 3h8l4 4v14H6Z" /><path d="M14 3v5h5M9 12h6M9 16h3" /><path d="m14 17 1 1 2-2" /></svg>;
  }
  if (name === "file-text") {
    return <svg {...common}><path d="M6 3h8l4 4v14H6Z" /><path d="M14 3v5h5M9 12h6M9 16h6" /></svg>;
  }
  if (name === "tool") {
    return <svg {...common}><path d="m12 3 3 3-3 3-3-3 3-3ZM6 12l3 3-3 3-3-3 3-3ZM18 12l3 3-3 3-3-3 3-3Z" /></svg>;
  }
  if (name === "plugin-document") {
    return <svg {...common}><path d="M7 3h7l4 4v14H7Z" /><path d="M14 3v5h5M10 12h5M10 16h5" /></svg>;
  }
  if (name === "plugin-pdf") {
    return <svg {...common}><path d="M7 3h7l4 4v14H7Z" /><path d="M14 3v5h5M9.5 16v-4h1.2a1.2 1.2 0 0 1 0 2.4H9.5M13 16v-4h1a2 2 0 0 1 0 4h-1M17 16v-4h2" /></svg>;
  }
  if (name === "plugin-spreadsheet") {
    return <svg {...common}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M4 9h16M4 15h16M10 9v12M15 9v12" /></svg>;
  }
  if (name === "plugin-presentation") {
    return <svg {...common}><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21l4-4 4 4M8 9h8M8 12h5" /></svg>;
  }
  if (name === "plugin-template") {
    return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><path d="M17.5 14v7M14 17.5h7" /></svg>;
  }
  if (name === "plugin-browser") {
    return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>;
  }
  if (name === "plugin-visualize") {
    return <svg {...common}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>;
  }
  if (name === "plugin-figma") {
    return <svg {...common}><path d="M8 3h4a3 3 0 0 1 0 6H8V3Z" /><path d="M8 9h4a3 3 0 1 1 0 6H8V9Z" /><path d="M8 15h4a3 3 0 1 1-3 3v-3Z" /><circle cx="15" cy="12" r="3" /></svg>;
  }
  if (name === "copy") {
    return <svg {...common}><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></svg>;
  }
  if (name === "thumb-up") {
    return <svg {...common}><path d="M7 10.5v9H4.7A1.7 1.7 0 0 1 3 17.8v-5.6a1.7 1.7 0 0 1 1.7-1.7H7Z" /><path d="M7 10.5 11.2 4c.4-.6 1.3-.8 1.9-.4.5.3.8.8.7 1.4l-.5 4h4.8a2.2 2.2 0 0 1 2.1 2.8l-1.5 5.6a3.4 3.4 0 0 1-3.3 2.6H7" /></svg>;
  }
  if (name === "thumb-down") {
    return <svg {...common}><path d="M7 13.5v-9H4.7A1.7 1.7 0 0 0 3 6.2v5.6a1.7 1.7 0 0 0 1.7 1.7H7Z" /><path d="M7 13.5 11.2 20c.4.6 1.3.8 1.9.4.5-.3.8-.8.7-1.4l-.5-4h4.8a2.2 2.2 0 0 0 2.1-2.8l-1.5-5.6A3.4 3.4 0 0 0 15.4 4H7" /></svg>;
  }
  if (name === "workspace-quant") {
    return <svg {...common}><path d="M4 19V5M4 19h16" /><path d="m7 15 3-4 3 2 4-6" /><path d="m15 7h2v2" /></svg>;
  }
  if (name === "workspace-game") {
    return <svg {...common}><path d="M7.5 8h9a4.5 4.5 0 0 1 4.2 6.1l-1.2 3.2a2.3 2.3 0 0 1-3.8.8L14 16h-4l-1.7 2.1a2.3 2.3 0 0 1-3.8-.8l-1.2-3.2A4.5 4.5 0 0 1 7.5 8Z" /><path d="M8 11v4M6 13h4M16.5 12h.01M18.5 14h.01" /></svg>;
  }
  if (name === "workspace-video") {
    return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m10 9 5 3-5 3Z" /></svg>;
  }
  if (name === "workspace-music") {
    return <svg {...common}><path d="M9 18V6l10-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" /><path d="M9 9l10-2" /></svg>;
  }
  if (name === "workspace-data") {
    return <svg {...common}><ellipse cx="12" cy="5" rx="7" ry="3" /><path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5" /><path d="M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></svg>;
  }
  if (name === "workspace-software") {
    return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="m8 9-3 3 3 3M12 16h5" /></svg>;
  }
  if (name === "workspace-document") {
    return <svg {...common}><path d="M6 3h8l4 4v14H6Z" /><path d="M14 3v5h5M9 12h6M9 16h5" /></svg>;
  }
  return <svg {...common}><circle cx="12" cy="12" r="8" /></svg>;
}
