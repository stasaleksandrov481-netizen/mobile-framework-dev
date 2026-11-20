import type { SVGProps } from "react";

type IconName = "arrow-up-right" | "arrow-right" | "download" | "clock" | "check" | "close" | "shield" | "telegram" |
  "lock" | "mic" | "bolt" | "layers" | "bell" | "spark" | "phone" | "user" | "mail";
type IconProps = SVGProps<SVGSVGElement> & { name: IconName; size?: number };

/** A single crisp, consistent set of rounded 1.8px icons for the marketing UI. */
export default function UiIcon({ name, size = 18, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {name === "arrow-up-right" && <path d="M5 19 19 5M8 5h11v11" />}
      {name === "arrow-right" && <path d="M4 12h15m-6-6 6 6-6 6" />}
      {name === "download" && <path d="M12 3v12m-4.5-4.5L12 15l4.5-4.5M4 20h16" />}
      {name === "clock" && <><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3.2 2" /></>}
      {name === "check" && <path d="m4.5 12.5 5 5L19.5 7" />}
      {name === "close" && <path d="M6 6l12 12M18 6 6 18" />}
      {name === "shield" && <><path d="M12 3 4.5 6v5.5c0 4.6 3 7.9 7.5 9.5 4.5-1.6 7.5-4.9 7.5-9.5V6L12 3Z" /><path d="m9.5 12 1.6 1.6 3.5-3.5" /></>}
      {name === "telegram" && <path fill="currentColor" stroke="none" d="M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0Zm5.9 8.18-1.96 9.26c-.15.66-.54.82-1.09.51l-3.02-2.22-1.45 1.4c-.16.16-.3.29-.6.29l.21-3.06 5.57-5.03c.24-.22-.05-.34-.37-.12l-6.88 4.33-2.97-.93c-.64-.2-.66-.64.13-.95l11.6-4.47c.54-.2 1.01.13.83.99Z" />}
      {name === "lock" && <><rect x="5" y="10.5" width="14" height="10" rx="2.6" /><path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7" /></>}
      {name === "mic" && <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></>}
      {name === "bolt" && <path d="M13 2.5 5 13.5h6l-1 8 8-11h-6l1-8Z" />}
      {name === "layers" && <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></>}
      {name === "bell" && <><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15L6 16.5Z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>}
      {name === "spark" && <path d="M12 3c.6 4.6 1.9 5.9 6.5 6.5-4.6.6-5.9 1.9-6.5 6.5-.6-4.6-1.9-5.9-6.5-6.5C10.1 8.9 11.4 7.6 12 3ZM18.5 15.5c.3 1.9.8 2.4 2.5 2.7-1.7.3-2.2.8-2.5 2.7-.3-1.9-.8-2.4-2.5-2.7 1.7-.3 2.2-.8 2.5-2.7Z" />}
      {name === "phone" && <><rect x="6.5" y="2.5" width="11" height="19" rx="3" /><path d="M10.5 18.5h3" /></>}
      {name === "user" && <><circle cx="12" cy="8.5" r="4" /><path d="M4.5 20.5c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" /></>}
      {name === "mail" && <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></>}
    </svg>
  );
}
