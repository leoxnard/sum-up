/**
 * Hand-rolled stroke icon set. Emoji render differently on every platform (and
 * look like clip-art on Android), so every glyph in the UI is an inline SVG
 * that inherits `currentColor` and the surrounding font size.
 */

import type { CategoryKey } from "../lib/types";

interface IconProps {
  className?: string;
  /** Stroke width; bump it for small sizes if a glyph looks too thin. */
  width?: number;
}

function Svg({ className, width = 1.75, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ?? "size-[1.15em]"}
    >
      {children}
    </svg>
  );
}

export function IconUtensils(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 3v5a2.5 2.5 0 0 0 5 0V3" />
      <path d="M9.5 10.5V21" />
      <path d="M17.5 21v-8.5" />
      <path d="M17.5 12.5c-1.9 0-3-1.1-3-2.8C14.5 6.8 15.6 4.4 17.5 3v9.5Z" />
    </Svg>
  );
}

export function IconCart(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 4h2l2.2 9.9a1.8 1.8 0 0 0 1.8 1.4h7.7a1.8 1.8 0 0 0 1.8-1.4L19.5 7.5H6" />
      <circle cx="9.5" cy="19.5" r="1.3" />
      <circle cx="17" cy="19.5" r="1.3" />
    </Svg>
  );
}

export function IconCar(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 11.5 6.6 7.2A2 2 0 0 1 8.5 6h7a2 2 0 0 1 1.9 1.2L19 11.5" />
      <rect x="3" y="11.5" width="18" height="6" rx="2" />
      <path d="M6.5 17.5V19M17.5 17.5V19" />
      <path d="M6.8 14.5h1.4M15.8 14.5h1.4" />
    </Svg>
  );
}

export function IconHouse(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 10.4 12 3.8l8.5 6.6V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19Z" />
      <path d="M9.5 20.5v-6h5v6" />
    </Svg>
  );
}

export function IconTicket(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h15A1.5 1.5 0 0 1 21 8.5v1.6a2 2 0 0 0 0 3.8v1.6a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 15.5v-1.6a2 2 0 0 0 0-3.8Z" />
      <path d="M14 7.5v9" strokeDasharray="1.6 2.4" />
    </Svg>
  );
}

export function IconBag(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5.5 8h13l-1 11.4a1.5 1.5 0 0 1-1.5 1.4H8a1.5 1.5 0 0 1-1.5-1.4Z" />
      <path d="M9 10.5V7a3 3 0 0 1 6 0v3.5" />
    </Svg>
  );
}

export function IconTag(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20.4 13.2 13.2 20.4a2 2 0 0 1-2.8 0L4 14a2 2 0 0 1-.6-1.4V5A1.5 1.5 0 0 1 4.9 3.5h7.6a2 2 0 0 1 1.4.6l6.5 6.4a2 2 0 0 1 0 2.7Z" />
      <circle cx="8.2" cy="8.2" r="1.3" />
    </Svg>
  );
}

export function IconExchange(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 8.5h13" />
      <path d="M13.8 5.3 17 8.5l-3.2 3.2" />
      <path d="M20 15.5H7" />
      <path d="M10.2 12.3 7 15.5l3.2 3.2" />
    </Svg>
  );
}

export function IconChart(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="12" width="4.5" height="7.5" rx="1.4" />
      <rect x="9.8" y="8" width="4.5" height="11.5" rx="1.4" />
      <rect x="16" y="4.5" width="4.5" height="15" rx="1.4" />
    </Svg>
  );
}

export function IconSliders(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 4v5.2M5 14.8V20M12 4v2.2M12 11.8V20M19 4v8.2M19 17.8V20" />
      <circle cx="5" cy="12" r="2.2" />
      <circle cx="12" cy="9" r="2.2" />
      <circle cx="19" cy="15" r="2.2" />
    </Svg>
  );
}

export function IconCamera(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.8 8.6h2.9l1.2-2a1 1 0 0 1 .86-.5h6.5a1 1 0 0 1 .86.5l1.2 2h2.9a1.5 1.5 0 0 1 1.5 1.5v7.4a1.5 1.5 0 0 1-1.5 1.5H3.8a1.5 1.5 0 0 1-1.5-1.5v-7.4a1.5 1.5 0 0 1 1.5-1.5Z" />
      <circle cx="12" cy="13.6" r="3.2" />
    </Svg>
  );
}

export function IconDownload(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.8v10.4" />
      <path d="M8 10.4 12 14.4l4-4" />
      <path d="M4.5 16.6v1.9A1.6 1.6 0 0 0 6.1 20h11.8a1.6 1.6 0 0 0 1.6-1.5v-1.9" />
    </Svg>
  );
}

export function IconShare(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 14.2V3.8" />
      <path d="M8 7.8 12 3.8l4 4" />
      <path d="M4.5 16.6v1.9A1.6 1.6 0 0 0 6.1 20h11.8a1.6 1.6 0 0 0 1.6-1.5v-1.9" />
    </Svg>
  );
}

export function IconSparkles(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M11 3.5 12.6 8l4.4 1.6-4.4 1.6L11 15.6 9.4 11.2 5 9.6 9.4 8Z" />
      <path d="M18 14.5l.75 2 2 .75-2 .75-.75 2-.75-2-2-.75 2-.75Z" />
    </Svg>
  );
}

export function IconImage(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4.5" width="18" height="15" rx="2.4" />
      <circle cx="8.6" cy="9.8" r="1.5" />
      <path d="M3.4 16.8 8 12.6a1.6 1.6 0 0 1 2.2 0l3.4 3.2M13 14.6l2-1.7a1.6 1.6 0 0 1 2.1 0l3.5 3" />
    </Svg>
  );
}

export function IconMic(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="9" y="2.8" width="6" height="11.4" rx="3" />
      <path d="M5.5 11.2a6.5 6.5 0 0 0 13 0M12 17.7V21" />
    </Svg>
  );
}

export function IconStop(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="6" y="6" width="12" height="12" rx="2.2" fill="currentColor" />
    </Svg>
  );
}

export function IconClipboard(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="5" y="4.5" width="14" height="16" rx="2.4" />
      <path d="M9 4.5a3 3 0 0 1 6 0" />
      <path d="M8.8 11.5h6.4M8.8 15.3h4.2" />
    </Svg>
  );
}

export function IconText(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 6.5h15M4.5 11h15M4.5 15.5h9.5M4.5 20h6" />
    </Svg>
  );
}

export function IconUser(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
    </Svg>
  );
}

export function IconUsers(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9.5" cy="8" r="3.3" />
      <path d="M3 19.5a6.5 6.5 0 0 1 13 0" />
      <path d="M16 5.1a3.3 3.3 0 0 1 0 6.4M17.5 14.2a6.5 6.5 0 0 1 3.5 5.3" />
    </Svg>
  );
}

export function IconCalendar(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="5.5" width="17" height="15" rx="2.2" />
      <path d="M3.5 10h17M8.5 3.5V7M15.5 3.5V7" />
    </Svg>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 9.5 12 15.5l6-6" />
    </Svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5.5v13M5.5 12h13" />
    </Svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 12.5 9.2 17 19.5 6.8" />
    </Svg>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2.4" />
      <path d="M15.5 5.6A2 2 0 0 0 13.6 3.5H5.9A2.4 2.4 0 0 0 3.5 5.9v7.7a2 2 0 0 0 2.1 1.9" />
    </Svg>
  );
}

export function IconArrowLeft(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M19 12H5" />
      <path d="M10.5 5.5 4 12l6.5 6.5" />
    </Svg>
  );
}

export function IconArrowRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12h14" />
      <path d="M13.5 5.5 20 12l-6.5 6.5" />
    </Svg>
  );
}

export function IconAlert(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.8 2.9 19.4a1.3 1.3 0 0 0 1.1 1.9h16a1.3 1.3 0 0 0 1.1-1.9L12 3.8Z" />
      <path d="M12 9.8v4.4" />
      <path d="M12 17.6h.01" />
    </Svg>
  );
}

const CATEGORY_ICON: Record<CategoryKey, (props: IconProps) => React.ReactElement> = {
  food: IconUtensils,
  groceries: IconCart,
  transport: IconCar,
  accommodation: IconHouse,
  activities: IconTicket,
  shopping: IconBag,
  other: IconTag,
};

/** The glyph for an entry: exchange arrows for payments, category icon otherwise. */
export function EntryIcon({
  kind,
  category,
  className,
}: {
  kind?: string;
  category?: CategoryKey | null;
  className?: string;
}) {
  if (kind === "payment") return <IconExchange className={className} />;
  const Glyph = CATEGORY_ICON[category ?? "other"];
  return <Glyph className={className} />;
}

export function CategoryIcon({
  category,
  className,
}: {
  category: CategoryKey;
  className?: string;
}) {
  const Glyph = CATEGORY_ICON[category];
  return <Glyph className={className} />;
}

export function IconTrash(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 6.5h15" />
      <path d="M9.5 6.5V5A1.5 1.5 0 0 1 11 3.5h2A1.5 1.5 0 0 1 14.5 5v1.5" />
      <path d="M6.5 6.5 7.4 19a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5l.9-12.5" />
      <path d="M10.5 10.5v6M13.5 10.5v6" />
    </Svg>
  );
}

/* ---- Tab bar ------------------------------------------------------- */
/* Deliberately flatter than the content icons: at 21px inside the capsule,
   the detailed category glyphs turn to mush. */

export function IconPie(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.6a8.4 8.4 0 1 0 8.4 8.4H12Z" />
      <path d="M14.6 3.9a8.4 8.4 0 0 1 5.5 5.5h-5.5Z" />
    </Svg>
  );
}

export function IconList(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 6.5h15M4.5 11h15M4.5 15.5h9.5M4.5 20h6" />
    </Svg>
  );
}

export function IconBars(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 13.4a1.4 1.4 0 0 1 1.4-1.4h1.7a1.4 1.4 0 0 1 1.4 1.4v6.1H3.5Z" />
      <path d="M9.8 9.4A1.4 1.4 0 0 1 11.2 8h1.7a1.4 1.4 0 0 1 1.4 1.4v10.1H9.8Z" />
      <path d="M16 5.9a1.4 1.4 0 0 1 1.4-1.4h1.7a1.4 1.4 0 0 1 1.4 1.4v13.6H16Z" />
    </Svg>
  );
}

export function IconBackspace(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 4.5h10.5A2 2 0 0 1 20.5 6.5v11a2 2 0 0 1-2 2H8L2.5 12 8 4.5Z" />
      <path d="M11 9.5l5 5M16 9.5l-5 5" />
    </Svg>
  );
}
