import { useId, type ReactElement } from "react";

/** Small colorful icons — inline SVG */
export function NodeGlyph(props: { wfType: string }): ReactElement {
  const uid = useId().replace(/:/g, "");
  const t = props.wfType;
  const iconClass = "h-5 w-5 shrink-0";

  if (t.startsWith("trigger.")) {
    const gid = `tg-${uid}`;
    return (
      <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="24" y2="24">
            <stop stopColor="#f472b6" />
            <stop offset="1" stopColor="#a855f7" />
          </linearGradient>
        </defs>
        <path
          d="M13 3L4 14h6l-2 7 10-11h-6l2-7z"
          stroke={`url(#${gid})`}
          strokeWidth="1.5"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    );
  }
  if (t.includes("file.")) {
    return (
      <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"
          stroke="#38bdf8"
          strokeWidth="1.5"
          fill="rgba(56,189,248,0.12)"
        />
        <path d="M14 2v6h6" stroke="#22d3ee" strokeWidth="1.5" />
      </svg>
    );
  }
  if (t === "http.request") {
    const gid = `globe-${uid}`;
    return (
      <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden>
        <defs>
          <linearGradient id={gid} x1="3" y1="3" x2="21" y2="21">
            <stop stopColor="#ae53ba" />
            <stop offset="1" stopColor="#2a8af6" />
          </linearGradient>
        </defs>
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke={`url(#${gid})`}
          strokeWidth="1.5"
          fill="rgba(42,138,246,0.15)"
        />
        <ellipse cx="12" cy="12" rx="4" ry="9" stroke="#7dd3fc" strokeWidth="1" />
        <path d="M3 12h18" stroke="#7dd3fc" strokeWidth="1" />
      </svg>
    );
  }
  if (t.includes("email")) {
    return (
      <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect
          x="4"
          y="6"
          width="16"
          height="12"
          rx="1.5"
          stroke="#f0abfc"
          strokeWidth="1.5"
          fill="rgba(240,171,252,0.1)"
        />
        <path d="M4 8l8 5 8-5" stroke="#e879f9" strokeWidth="1.5" />
      </svg>
    );
  }
  if (t.includes("slack")) {
    return (
      <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect
          x="4"
          y="4"
          width="7"
          height="7"
          rx="1"
          fill="#60a5fa"
          opacity="0.9"
        />
        <rect
          x="13"
          y="4"
          width="7"
          height="7"
          rx="1"
          fill="#34d399"
          opacity="0.9"
        />
        <rect
          x="4"
          y="13"
          width="7"
          height="7"
          rx="1"
          fill="#fbbf24"
          opacity="0.9"
        />
        <rect
          x="13"
          y="13"
          width="7"
          height="7"
          rx="1"
          fill="#f472b6"
          opacity="0.9"
        />
      </svg>
    );
  }
  if (t.includes("postgres")) {
    return (
      <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden>
        <ellipse
          cx="12"
          cy="6"
          rx="8"
          ry="3"
          stroke="#5eead4"
          strokeWidth="1.5"
          fill="rgba(94,234,212,0.15)"
        />
        <path d="M4 6v12c0 1.5 3.5 3 8 3s8-1.5 8-3V6" stroke="#5eead4" strokeWidth="1.5" />
      </svg>
    );
  }
  if (t === "noop") {
    return (
      <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle
          cx="12"
          cy="12"
          r="8"
          stroke="#94a3b8"
          strokeWidth="1.5"
          strokeDasharray="3 2"
          fill="rgba(148,163,184,0.1)"
        />
      </svg>
    );
  }

  const cid = `code-${uid}`;
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden>
      <defs>
        <linearGradient id={cid} x1="8" y1="9" x2="16" y2="15">
          <stop stopColor="#c084fc" />
          <stop offset="1" stopColor="#38bdf8" />
        </linearGradient>
      </defs>
      <path
        d="M8 9l4 4 4-4M8 15l4 4 4-4"
        stroke={`url(#${cid})`}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
