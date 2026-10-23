import { ProviderDriverKind } from "@t3tools/contracts";
import { defineProviderClient } from "@t3tools/provider-core/client";

import { OpenCodeSettings } from "./settings.ts";

export const openCodeClient = defineProviderClient({
  driverKind: ProviderDriverKind.make("opencode"),
  label: "OpenCode",
  settingsSchema: OpenCodeSettings,
  icon: {
    viewBox: "0 0 32 40",
    fill: { light: "#211E1E", dark: "#F1ECEC" },
    paths: [
      { d: "M24 32H8V16H24V32Z", fill: { light: "#CFCECD", dark: "#4B4646" } },
      { d: "M24 8H8V32H24V8ZM32 40H0V0H32V40Z" },
    ],
  },
  instanceIcons: {
    "opencode-tinfoil": {
      viewBox: "0 0 960 960",
      fill: { light: "#000000", dark: "#ffffff" },
      // Official mark: https://tinfoil.sh/brand-assets/icon-black.svg
      paths: [
        {
          d: "M955.4,718.23l-674.69,205.77L6.34,708.97,268.9,35.01l686.5,683.22ZM164.94,665.52l143.05,112.11,397.97-121.37-387.26-385.41-153.76,394.66Z",
        },
      ],
    },
  },
});
