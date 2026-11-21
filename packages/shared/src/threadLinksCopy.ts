import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

import {
  formatThreadLink,
  formatThreadLinkMarkdown,
  replaceThreadLinks,
  threadLinkCandidates,
  type ThreadLink,
} from "./threadLinks.ts";

/** @public */
export function unknownThreadLinkLabel(
  link: ThreadLink,
  messageEnvironmentId: EnvironmentId,
  resolve: MFunctionType = mFallback,
): string {
  return link.environmentId === null || link.environmentId === messageEnvironmentId
    ? resolve(msg("Thread no longer available"))
    : resolve(msg("Thread on another machine"));
}

/**
 * Writes each link with its thread's current title, a hosted link as a v2 link. A link `title`
 * cannot resolve becomes plain text, its written label or a neutral one, except a labeled v1
 * link, which may open elsewhere.
 */
export function relabelThreadLinks(
  markdown: string,
  messageEnvironmentId: EnvironmentId,
  title: (ref: ScopedThreadRef) => string | undefined,
  resolve: MFunctionType = mFallback,
): string {
  return replaceThreadLinks(markdown, (written, label, href) => {
    for (const ref of threadLinkCandidates(written, messageEnvironmentId)) {
      const current = title(ref);
      if (current === undefined) continue;
      const displayTitle = current.trim() || label || ref.threadId;
      return written.exact
        ? formatThreadLinkMarkdown(href, displayTitle)
        : formatThreadLink(
            { environmentId: written.environmentId, threadId: ref.threadId },
            displayTitle,
          );
    }
    if (label !== undefined && written.environmentId === null) return undefined;
    return label?.trim() || unknownThreadLinkLabel(written, messageEnvironmentId, resolve);
  });
}
