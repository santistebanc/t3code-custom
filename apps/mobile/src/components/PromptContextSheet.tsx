import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useContext, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { promptContext } from "../state/prompt-context";
import { ComposerInlineControl } from "./ComposerToolbar";
import { AppText as Text } from "./ui/AppText";
import { Button } from "./ui/Button";
import { Sheet } from "./ui/Sheet";

export function PromptContextControl({ threadRef }: { threadRef: ScopedThreadRef }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ComposerInlineControl
        label="Context"
        icon="doc.text"
        iconOnly
        accessibilityLabel="Inspect prompt context"
        showChevron={false}
        onPress={() => setOpen(true)}
      />
      {open && (
        <Sheet title="Prompt context" onClose={() => setOpen(false)}>
          <PromptContextContents threadRef={threadRef} />
        </Sheet>
      )}
    </>
  );
}

function PromptContextContents({ threadRef }: { threadRef: ScopedThreadRef }) {
  const [snapshotId, setSnapshotId] = useState<string>();
  const [expandedSource, setExpandedSource] = useState<string>();
  const registry = useContext(RegistryContext);
  const atom = promptContext({
    environmentId: threadRef.environmentId,
    input: {
      threadId: threadRef.threadId,
      ...(snapshotId === undefined ? {} : { snapshotId }),
    },
  });
  const result = useAtomValue(atom);
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerClassName="gap-4 p-4">
      <Text className="text-sm text-foreground-muted">
        What T3 supplied to the provider. Messages and conversation history are omitted.
      </Text>
      <Button label="Refresh" size="compact" onPress={() => registry.refresh(atom)} />
      {result._tag === "Initial" ? (
        <Text>Loading context...</Text>
      ) : result._tag === "Failure" ? (
        <Text>Could not load context. Try refreshing.</Text>
      ) : (
        <>
          <ScrollView horizontal contentContainerClassName="gap-2">
            {result.value.snapshots.map((item) => (
              <Button
                key={item.id}
                size="compact"
                label={`Turn ${item.ordinal}`}
                tone={
                  (snapshotId ?? result.value.snapshots[0]?.id) === item.id
                    ? "primary"
                    : "secondary"
                }
                onPress={() => setSnapshotId(item.id)}
              />
            ))}
          </ScrollView>
          {result.value.snapshot ? (
            <>
              <Text className="text-xs text-foreground-muted">
                Captured {new Date(result.value.snapshot.capturedAt).toLocaleString()} - Sent by T3
              </Text>
              {result.value.snapshot.entries.map((entry) => (
                <View key={entry.source} className="gap-2 rounded-xl border border-border p-3">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: expandedSource === entry.source }}
                    onPress={() =>
                      setExpandedSource(expandedSource === entry.source ? undefined : entry.source)
                    }
                  >
                    <Text className="text-sm font-t3-medium">{entry.source}</Text>
                  </Pressable>
                  {expandedSource === entry.source && (
                    <Text selectable className="text-sm">
                      {entry.text}
                    </Text>
                  )}
                </View>
              ))}
            </>
          ) : (
            <Text>
              No captures yet. Context capture is available for new Codex turns started after this
              feature was installed.
            </Text>
          )}
        </>
      )}
      <Text className="text-sm font-t3-medium">Not exposed by the provider</Text>
      <Text className="text-sm text-foreground-muted">
        Built-in instructions, resolved AGENTS.md files, skills, and tool definitions are assembled
        inside the provider runtime. This capture is not the complete model prompt. Other providers
        do not yet support context capture.
      </Text>
    </ScrollView>
  );
}
