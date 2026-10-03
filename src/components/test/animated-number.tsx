"use client";

import { memo } from "react";
import { useAnimatedNumber } from "@/hooks/use-animated-number";

export const AnimatedNumber = memo(function AnimatedNumber({
  value,
  animate,
}: {
  value: number | null;
  animate: boolean;
}) {
  const element = useAnimatedNumber(value, animate);
  return (
    <span
      ref={element}
      className="live-number"
      aria-hidden="true"
      data-animated-value=""
      data-target={value ?? ""}
    />
  );
});
