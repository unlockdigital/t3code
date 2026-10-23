// Every visit broadcasts to all shell subscribers. Streaming updates need a ten-second limit;
// an unseen completion still lands immediately.
const VISIT_DISPATCH_THROTTLE_MS = 10_000;

export function createThreadVisitTracker() {
  let lastDispatchedKey: string | null = null;
  let lastDispatchAt: number | null = null;
  return {
    schedule(input: {
      readonly threadKey: string;
      readonly updatedAt: string;
      readonly lastVisitedAt: string | undefined;
      readonly completedAt: string | null | undefined;
      readonly isActive: () => boolean;
      readonly dispatch: () => void;
    }) {
      if (!input.isActive()) return;
      const updatedAt = Date.parse(input.updatedAt);
      if (Number.isNaN(updatedAt)) return;
      const lastVisitedAt = input.lastVisitedAt ? Date.parse(input.lastVisitedAt) : NaN;
      if (!Number.isNaN(lastVisitedAt) && lastVisitedAt >= updatedAt) return;
      const key = `${input.threadKey}:${input.updatedAt}`;
      // A mark-unread rewind on the open thread stays sticky until new activity or reopening.
      if (lastDispatchedKey === key) return;
      const dispatch = () => {
        // Navigation can be pending while the previous ChatView and its timer are still mounted.
        if (!input.isActive()) return;
        lastDispatchedKey = key;
        lastDispatchAt = Date.now();
        input.dispatch();
      };
      const completedAt = input.completedAt ? Date.parse(input.completedAt) : NaN;
      const unseenCompletion =
        !Number.isNaN(completedAt) && (Number.isNaN(lastVisitedAt) || completedAt > lastVisitedAt);
      const elapsed =
        lastDispatchAt === null ? VISIT_DISPATCH_THROTTLE_MS : Date.now() - lastDispatchAt;
      if (unseenCompletion || elapsed >= VISIT_DISPATCH_THROTTLE_MS) {
        dispatch();
        return;
      }
      const timer = setTimeout(dispatch, VISIT_DISPATCH_THROTTLE_MS - elapsed);
      return () => clearTimeout(timer);
    },
  };
}
