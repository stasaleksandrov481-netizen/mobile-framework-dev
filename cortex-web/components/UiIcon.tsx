import type { SVGProps } from "react";

type IconName = "arrow-up-right" | "arrow-right" | "download" | "clock" | "check" | "close" | "shield";
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
    </svg>
  );
}
