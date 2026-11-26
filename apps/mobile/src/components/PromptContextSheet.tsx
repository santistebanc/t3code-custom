import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { T, useGT } from "gt-react-native";
import { useContext, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { promptContext } from "../state/prompt-context";
import { ComposerInlineControl } from "./ComposerToolbar";
import { AppText as Text } from "./ui/AppText";
import { Button } from "./ui/Button";
import { Sheet } from "./ui/Sheet";

export function PromptContextControl({ threadRef }: { threadRef: ScopedThreadRef }) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <ComposerInlineControl
        label={gt("Context")}
        icon="doc.text"
        iconOnly
        accessibilityLabel={gt("Inspect prompt context")}
        showChevron={false}
        onPress={() => setOpen(true)}
      />
      {open && (
        <Sheet title={gt("Prompt context")} onClose={() => setOpen(false)}>
          <PromptContextContents threadRef={threadRef} />
        </Sheet>
      )}
    </>
  );
}

function PromptContextContents({ threadRef }: { threadRef: ScopedThreadRef }) {
  const gt = useGT();
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
        <T>What T3 supplied to the provider. Messages and conversation history are omitted.</T>
      </Text>
      <Button label={gt("Refresh")} size="compact" onPress={() => registry.refresh(atom)} />
      {result._tag === "Initial" ? (
        <Text>
          <T>Loading context...</T>
        </Text>
      ) : result._tag === "Failure" ? (
        <Text>
          <T>Could not load context. Try refreshing.</T>
        </Text>
      ) : (
        <>
          <ScrollView horizontal contentContainerClassName="gap-2">
            {result.value.snapshots.map((item) => (
              <Button
                key={item.id}
                size="compact"
                label={gt("Turn {ordinal}", { ordinal: item.ordinal })}
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
                {gt("Captured {date} - Sent by T3", {
                  date: new Date(result.value.snapshot.capturedAt).toLocaleString(),
                })}
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
              <T>
                No captures yet. Context capture is available for new Codex turns started after this
                feature was installed.
              </T>
            </Text>
          )}
        </>
      )}
      <Text className="text-sm text-foreground-muted">
        <T>
          Claude turns list what was used, the instruction files, skills, and MCP tools Claude Code
          loaded, and what T3 added. Codex turns show only what T3 sent. The provider's own built-in
          prompt is never shown.
        </T>
      </Text>
    </ScrollView>
  );
}
