import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useContext, useState } from "react";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { promptContext } from "../../state/promptContext";
import { formatEnvironmentQueryError } from "../../state/query";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
} from "../ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "../ui/select";

export function PromptContextDialog({
  threadRef,
  open,
  onOpenChange,
}: {
  threadRef: ScopedThreadRef;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Prompt context</DialogTitle>
          <DialogDescription>
            Inspect what T3 supplied to the provider for a turn. Messages and conversation history
            are omitted.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>{open && <PromptContextContents threadRef={threadRef} />}</DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

function PromptContextContents({ threadRef }: { threadRef: ScopedThreadRef }) {
  const [snapshotId, setSnapshotId] = useState<string>();
  const registry = useContext(RegistryContext);
  const atom = promptContext({
    environmentId: threadRef.environmentId,
    input: {
      threadId: threadRef.threadId,
      ...(snapshotId === undefined ? {} : { snapshotId }),
    },
  });
  const result = useAtomValue(atom);
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "prompt context" });
  if (result._tag === "Initial") return <p role="status">Loading context...</p>;
  if (result._tag === "Failure")
    return (
      <div className="space-y-3">
        <p role="alert">{formatEnvironmentQueryError(result.cause)}</p>
        <Button variant="outline" size="sm" onClick={() => registry.refresh(atom)}>
          Retry
        </Button>
      </div>
    );
  const { snapshot, snapshots } = result.value;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => registry.refresh(atom)}
          disabled={result.waiting}
        >
          Refresh
        </Button>
        {snapshot && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              copyToClipboard(
                snapshot.entries.map((entry) => `${entry.source}\n\n${entry.text}`).join("\n\n"),
              )
            }
          >
            {isCopied ? "Copied" : "Copy context"}
          </Button>
        )}
      </div>
      {snapshots.length > 0 && (
        <div className="space-y-1">
          <label htmlFor="prompt-context-turn" className="text-sm font-medium">
            Captured turn
          </label>
          <Select
            items={snapshots.map((item) => ({ value: item.id, label: `Turn ${item.ordinal}` }))}
            value={snapshotId ?? snapshots[0]?.id}
            onValueChange={(value) => setSnapshotId(value ?? undefined)}
          >
            <SelectTrigger id="prompt-context-turn">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {snapshots.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  Turn {item.ordinal}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      )}
      {snapshot ? (
        <>
          <p className="text-xs text-muted-foreground">
            Captured {new Date(snapshot.capturedAt).toLocaleString()}
          </p>
          {snapshot.entries.map((entry, index) => (
            <details
              key={entry.source}
              open={index === 0}
              className="rounded-lg border border-border p-3"
            >
              <summary className="cursor-pointer break-words text-sm font-medium">
                {entry.source}
              </summary>
              <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">
                {entry.text}
              </pre>
            </details>
          ))}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          No captured context for this turn. Captures are available for new Codex and Claude turns
          started after this feature was installed.
        </p>
      )}
      <p className="border-t border-border pt-4 text-sm text-muted-foreground">
        Claude turns list what was used, the instruction files, skills, and MCP tools Claude Code
        loaded, and what T3 added. Codex turns show only what T3 sent. The provider's own built-in
        prompt is never shown.
      </p>
    </div>
  );
}
