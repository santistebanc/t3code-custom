import { T } from "gt-react";
import type { CSSProperties } from "react";

import { Badge } from "../components/ui/badge";

/** Custom: marks this build as the personal fork next to the sidebar wordmark. */
export function CustomBuildBadge() {
  return (
    <Badge
      variant="label"
      size="sm"
      className="self-center"
      style={{ "--label": "#a855f7" } as CSSProperties}
    >
      <T>Custom</T>
    </Badge>
  );
}
