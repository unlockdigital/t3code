import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const THREAD_LINK_PROTOCOL = "t3-thread";
const V1_PREFIX = `${THREAD_LINK_PROTOCOL}://v1/`;
const V2_PREFIX = `${THREAD_LINK_PROTOCOL}://v2/`;
const APP_THREAD_PREFIX = String.raw`t3code(?:-dev|-preview|-unlock)?:\/\/threads\/`;
const APP_THREAD_SEGMENT = "[A-Za-z0-9_%-]+";
const APP_THREAD_HREF = `${APP_THREAD_PREFIX}${APP_THREAD_SEGMENT}/${APP_THREAD_SEGMENT}`;
const APP_THREAD_LINK = new RegExp(
  `^${APP_THREAD_PREFIX}(${APP_THREAD_SEGMENT})/(${APP_THREAD_SEGMENT})$`,
);
// Code comes first so links written inside a code span or fence stay literal.
const THREAD_LINK_OUTSIDE_CODE = new RegExp(
  String.raw`(?<fence>(\`{3,}|~{3,})[\s\S]*?(?:\2|$))|(?<span>(\`+)[^\n]*?\4)|\[(?<label>[^\]\n]*)\]\((?<href>t3-thread:\/\/v[12]\/[^\s)]+|${APP_THREAD_HREF})\)|<(?<autolink>t3-thread:\/\/v[12]\/[^\s<>]+|${APP_THREAD_HREF})>|(?<bare>${APP_THREAD_HREF})(?![\w%/?#-])`,
  "g",
);

const decodeThreadId = Schema.decodeUnknownOption(ThreadId);
const decodeEnvironmentId = Schema.decodeUnknownOption(EnvironmentId);

/** A v1 link names no environment; the message's own, or a unique match, stands in. */
export interface ThreadLink {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId;
  /** App links decode their URL segments once. */
  readonly exact?: true;
}

function appThreadSegment(id: string): string {
  return encodeURIComponent(id).replace(
    /[.!~*'()]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function appThreadLink(ref: ScopedThreadRef, scheme = "t3code"): string {
  return `${scheme}://threads/${appThreadSegment(ref.environmentId)}/${appThreadSegment(ref.threadId)}`;
}

export function parseThreadLinkHref(href: string): ThreadLink | null {
  const app = APP_THREAD_LINK.exec(href);
  if (app) {
    try {
      const environmentId = Option.getOrNull(decodeEnvironmentId(decodeURIComponent(app[1]!)));
      const threadId = Option.getOrNull(decodeThreadId(decodeURIComponent(app[2]!)));
      return environmentId === null || threadId === null
        ? null
        : { environmentId, threadId, exact: true };
    } catch {
      return null;
    }
  }
  // Legacy thread IDs may contain literal percent escapes.
  if (href.startsWith(V1_PREFIX)) {
    const threadId = Option.getOrNull(decodeThreadId(href.slice(V1_PREFIX.length)));
    return threadId === null ? null : { environmentId: null, threadId };
  }
  if (!href.startsWith(V2_PREFIX)) return null;
  const path = href.slice(V2_PREFIX.length);
  const slash = path.indexOf("/");
  if (slash < 0) return null;
  const environmentId = Option.getOrNull(decodeEnvironmentId(path.slice(0, slash)));
  const threadId = Option.getOrNull(decodeThreadId(path.slice(slash + 1)));
  return environmentId === null || threadId === null ? null : { environmentId, threadId };
}

export function percentDecodedThreadLinkId(threadId: ThreadId): ThreadId | null {
  try {
    const decoded = decodeURIComponent(threadId);
    return decoded === threadId ? null : Option.getOrNull(decodeThreadId(decoded));
  } catch {
    return null;
  }
}

/** The threads a link can name, in its own environment or else the message's: as written, then decoded. */
export function threadLinkCandidates(
  link: ThreadLink,
  messageEnvironmentId: EnvironmentId,
): ReadonlyArray<ScopedThreadRef> {
  const environmentId = link.environmentId ?? messageEnvironmentId;
  const decodedId = link.exact ? null : percentDecodedThreadLinkId(link.threadId);
  const written = { environmentId, threadId: link.threadId };
  return decodedId === null ? [written] : [written, { environmentId, threadId: decodedId }];
}

/** A v1 link its message's environment lacks opens a unique match elsewhere; a v2 link never does. */
export function guessThreadLinkRef(
  link: ThreadLink,
  refs: ReadonlyArray<ScopedThreadRef>,
): ScopedThreadRef | null {
  if (link.environmentId !== null) return null;
  const decodedId = percentDecodedThreadLinkId(link.threadId);
  for (const threadId of decodedId === null ? [link.threadId] : [link.threadId, decodedId]) {
    let match: ScopedThreadRef | null = null;
    for (const ref of refs) {
      if (ref.threadId !== threadId) continue;
      if (match !== null) return null;
      match = ref;
    }
    if (match !== null) return match;
  }
  return null;
}

export function threadLinkHref(link: ThreadLink | string): string {
  if (typeof link === "string") return `${V1_PREFIX}${link}`;
  return link.environmentId === null
    ? `${V1_PREFIX}${link.threadId}`
    : `${V2_PREFIX}${link.environmentId}/${link.threadId}`;
}

/** Without a label, an autolink: clients show the thread's current title. */
export function formatThreadLink(ref: ThreadLink | string, label?: string): string {
  return formatThreadLinkMarkdown(threadLinkHref(ref), label);
}

export function formatThreadLinkMarkdown(href: string, label?: string): string {
  const cleaned = label
    ?.replace(/[[\]\\\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? `[${cleaned}](${href})` : `<${href}>`;
}

/** Accept the same clipboard value in the app and the CLI. Keep literal percent escapes. */
export function parseThreadReference(value: string): ThreadLink | null {
  const trimmed = value.trim();
  const markdown = /^\[[^\]\n]*\]\(([^\s)]+)\)$/.exec(trimmed);
  const href = markdown?.[1] ?? trimmed;
  if (href.startsWith(`${THREAD_LINK_PROTOCOL}:`))
    return /^t3-thread:\/\/v[12]\/[^\s)]+$/.test(href) ? parseThreadLinkHref(href) : null;
  if (markdown || /\s|:\/\//.test(href)) return parseThreadLinkHref(href);
  const threadId = Option.getOrNull(decodeThreadId(href));
  return threadId === null ? null : { environmentId: null, threadId };
}

export function hasThreadLinks(markdown: string): boolean {
  return markdown.includes(`${THREAD_LINK_PROTOCOL}://v`) || markdown.includes("://threads/");
}

/** Every thread the markdown's links can name, so their titles are keyed reads. */
export function threadLinkRefs(
  markdown: string,
  messageEnvironmentId: EnvironmentId,
): ReadonlyArray<ScopedThreadRef> {
  const refs = new Map<string, ScopedThreadRef>();
  const pattern = new RegExp(THREAD_LINK_OUTSIDE_CODE);
  for (let match = pattern.exec(markdown); match !== null; match = pattern.exec(markdown)) {
    const href = match.groups?.href ?? match.groups?.autolink ?? match.groups?.bare;
    const link = href === undefined ? null : parseThreadLinkHref(href);
    if (link === null) continue;
    for (const ref of threadLinkCandidates(link, messageEnvironmentId)) {
      refs.set(`${ref.environmentId}/${ref.threadId}`, ref);
    }
  }
  return [...refs.values()];
}

export function unknownThreadLinkLabel(
  link: ThreadLink,
  messageEnvironmentId: EnvironmentId,
): string {
  return link.environmentId === null || link.environmentId === messageEnvironmentId
    ? "Thread no longer available"
    : "Thread on another machine";
}

export function replaceThreadLinks(
  markdown: string,
  replace: (link: ThreadLink, label: string | undefined, href: string) => string | undefined,
): string {
  if (!hasThreadLinks(markdown)) return markdown;
  return markdown.replace(THREAD_LINK_OUTSIDE_CODE, (source, ...args) => {
    const groups = args.at(-1) as Partial<Record<"href" | "autolink" | "bare" | "label", string>>;
    const href = groups.href ?? groups.autolink ?? groups.bare;
    if (href === undefined) return source;
    const link = parseThreadLinkHref(href);
    return (link && replace(link, groups.label, href)) ?? source;
  });
}

/**
 * Writes each link with its thread's current title. A link `title` cannot resolve becomes plain
 * text, its written label or a neutral one, except a labeled v1 link, which may open elsewhere.
 */
export function relabelThreadLinks(
  markdown: string,
  messageEnvironmentId: EnvironmentId,
  title: (ref: ScopedThreadRef) => string | undefined,
): string {
  return replaceThreadLinks(markdown, (written, label, href) => {
    const environmentId = written.environmentId ?? messageEnvironmentId;
    const decoded = written.exact ? null : percentDecodedThreadLinkId(written.threadId);
    const threadId =
      title({ environmentId, threadId: written.threadId }) === undefined &&
      decoded !== null &&
      title({ environmentId, threadId: decoded }) !== undefined
        ? decoded
        : written.threadId;
    const current = title({ environmentId, threadId });
    if (current === undefined) {
      if (label !== undefined && written.environmentId === null) return undefined;
      return label?.trim() || unknownThreadLinkLabel(written, messageEnvironmentId);
    }
    const displayTitle = current.trim() || label || threadId;
    return written.exact
      ? formatThreadLinkMarkdown(href, displayTitle)
      : formatThreadLink({ environmentId: written.environmentId, threadId }, displayTitle);
  });
}
