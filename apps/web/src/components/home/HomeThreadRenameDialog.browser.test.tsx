import "../../index.css";
import { expect, it, vi } from "vite-plus/test";
import { userEvent, page } from "vite-plus/test/browser";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { render } from "../../../test/render";
import { makeThreadFixture } from "../../test-fixtures";

const state = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("../../state/use-orchestration-command", () => ({
  useOrchestrationCommand: () => state.update,
}));
vi.mock("../../state/threads", () => ({ threadEnvironment: { updateMetadata: "metadata" } }));
import { HomeThreadRenameDialog } from "./HomeThreadRenameDialog";

it("keeps an empty rename open and submits a trimmed title to the original environment", async () => {
  state.update.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  const thread = makeThreadFixture({
    environmentId: EnvironmentId.make("remote"),
    id: ThreadId.make("mcp:example"),
    title: "Original",
  });
  const closed = vi.fn();
  await using _screen = await render(<HomeThreadRenameDialog thread={thread} onClose={closed} />);
  await userEvent.fill(page.getByRole("textbox", { name: "Thread title" }), "   ");
  await userEvent.click(page.getByRole("button", { name: "Save", exact: true }));
  await expect.element(page.getByRole("alert")).toHaveTextContent("Enter a thread title.");
  expect(state.update).not.toHaveBeenCalled();
  expect(closed).not.toHaveBeenCalled();
  await userEvent.fill(page.getByRole("textbox", { name: "Thread title" }), "  Updated title  ");
  await userEvent.click(page.getByRole("button", { name: "Save", exact: true }));
  expect(state.update).toHaveBeenCalledExactlyOnceWith({
    environmentId: thread.environmentId,
    input: { threadId: thread.id, title: "Updated title" },
  });
  expect(closed).toHaveBeenCalledOnce();
});
