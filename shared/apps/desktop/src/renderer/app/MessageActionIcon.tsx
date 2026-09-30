type MessageActionIconName = "copy" | "edit" | "thumbs-up" | "thumbs-down" | "branch" | "refresh";

const common = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.15,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const
};

export function MessageActionIcon({ name }: { name: MessageActionIconName }) {
  if (name === "copy") {
    return (
      <svg aria-hidden="true" {...common}>
        <rect x="8" y="8" width="11" height="11" rx="2" />
        <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
      </svg>
    );
  }
  if (name === "edit") {
    return (
      <svg aria-hidden="true" {...common}>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
      </svg>
    );
  }
  if (name === "thumbs-up") {
    return (
      <svg aria-hidden="true" {...common}>
        <path d="M7 10.5v9H4.7A1.7 1.7 0 0 1 3 17.8v-5.6a1.7 1.7 0 0 1 1.7-1.7H7Z" />
        <path d="M7 10.5 11.2 4c.4-.6 1.3-.8 1.9-.4.5.3.8.8.7 1.4l-.5 4h4.8a2.2 2.2 0 0 1 2.1 2.8l-1.5 5.6a3.4 3.4 0 0 1-3.3 2.6H7" />
      </svg>
    );
  }
  if (name === "thumbs-down") {
    return (
      <svg aria-hidden="true" {...common}>
        <path d="M7 13.5v-9H4.7A1.7 1.7 0 0 0 3 6.2v5.6a1.7 1.7 0 0 0 1.7 1.7H7Z" />
        <path d="M7 13.5 11.2 20c.4.6 1.3.8 1.9.4.5-.3.8-.8.7-1.4l-.5-4h4.8a2.2 2.2 0 0 0 2.1-2.8l-1.5-5.6A3.4 3.4 0 0 0 15.4 4H7" />
      </svg>
    );
  }
  if (name === "branch") {
    return (
      <svg aria-hidden="true" {...common}>
        <circle cx="6" cy="5" r="2" />
        <circle cx="18" cy="7" r="2" />
        <circle cx="6" cy="19" r="2" />
        <path d="M6 7v10M8 7h5a5 5 0 0 1 5 5V9" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" {...common}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}
