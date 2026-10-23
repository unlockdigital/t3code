import type {
  EnvironmentId,
  PrivateHelperPacket,
  PrivateHelpersPolicy,
  ThreadId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { serverEnvironment } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";

export function PrivateControls(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  policy: PrivateHelpersPolicy;
  canOperate: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [packets, setPackets] = useState<readonly PrivateHelperPacket[]>([]);
  const [reviewed, setReviewed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useAtomCommand(serverEnvironment.getPrivateHelperState);
  const decide = useAtomCommand(serverEnvironment.decidePrivateHelper);
  const update = useAtomCommand(threadEnvironment.updateMetadata);
  const refresh = async () => {
    const result = await load({
      environmentId: props.environmentId,
      input: { threadId: props.threadId },
    });
    if (AsyncResult.isSuccess(result)) setPackets(result.value.packets);
  };
  const decision = async (packet: PrivateHelperPacket, value: "approve" | "block") => {
    setBusy(true);
    try {
      const result = await decide({
        environmentId: props.environmentId,
        input: {
          threadId: props.threadId,
          packetId: packet.id,
          digest: packet.digest,
          decision: value,
        },
      });
      if (AsyncResult.isSuccess(result))
        setPackets((current) =>
          current.map((entry) => (entry.id === packet.id ? result.value : entry)),
        );
      setReviewed(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Private controls"
        onPress={() => {
          setOpen(true);
          void refresh();
        }}
        className="min-h-11 self-start justify-center px-3"
      >
        <Text className="text-sm text-foreground-muted">
          {props.policy === "disabled" ? "Private" : "Private + helpers"}
        </Text>
      </Pressable>
      <Modal
        visible={open}
        onRequestClose={() => setOpen(false)}
        presentationStyle="pageSheet"
        animationType="slide"
      >
        <SafeAreaView className="flex-1 bg-screen">
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
            <Text className="text-xl font-t3-bold text-foreground">Private controls</Text>
            <Text className="text-foreground-muted">
              Full conversation context uses Tinfoil. External helpers receive only the exact packet
              you review and approve. Auto action permissions stay separate.
            </Text>
            <View className="gap-2">
              <Button
                label="Private only"
                disabled={!props.canOperate || busy || props.policy === "disabled"}
                onPress={() => {
                  void update({
                    environmentId: props.environmentId,
                    input: { threadId: props.threadId, privateHelpers: "disabled" },
                  });
                }}
              />
              <Button
                label="Private + helpers · review each packet"
                disabled={!props.canOperate || busy || props.policy === "review"}
                onPress={() => {
                  void update({
                    environmentId: props.environmentId,
                    input: { threadId: props.threadId, privateHelpers: "review" },
                  });
                }}
              />
              <Button
                label="Refresh helper packets"
                disabled={busy}
                onPress={() => void refresh()}
              />
            </View>
            <Text className="text-foreground-muted">
              Helpers have no parent history, workspace, tools, T3 access, or credentials. Their
              provider’s data terms apply to the approved packet. Reviews expire after 15 minutes or
              a server restart.
            </Text>
            {packets.length === 0 ? (
              <Text className="text-foreground-muted">
                Your private coordinator can prepare a self-contained helper packet.
              </Text>
            ) : null}
            {packets.map((packet) => (
              <View key={packet.id} className="gap-3 rounded-xl border border-subtle-strong p-3">
                <Text className="font-t3-bold text-foreground">
                  {packet.modelSelection.instanceId} · {packet.modelSelection.model}
                </Text>
                <Text className="text-foreground-muted">{packet.status}</Text>
                <Text className="text-foreground">{packet.task.objective}</Text>
                <Button
                  label="Inspect exact outbound packet"
                  onPress={() => setReviewed(packet.id)}
                />
                {reviewed === packet.id ? (
                  <Text selectable className="text-xs text-foreground">
                    {packet.prompt}
                  </Text>
                ) : null}
                {packet.status === "awaiting-review" ? (
                  <View className="gap-2">
                    <Button
                      label="Approve packet once"
                      disabled={
                        !props.canOperate ||
                        busy ||
                        reviewed !== packet.id ||
                        props.policy === "disabled"
                      }
                      onPress={() => void decision(packet, "approve")}
                    />
                    <Button
                      label="Block packet"
                      disabled={!props.canOperate || busy}
                      onPress={() => void decision(packet, "block")}
                    />
                  </View>
                ) : null}
                {packet.artifact === undefined ? null : (
                  <>
                    <Text selectable className="text-xs text-foreground">
                      {packet.artifact}
                    </Text>
                    <Text className="text-foreground-muted">
                      Review privately before applying or executing this artifact.
                    </Text>
                  </>
                )}
              </View>
            ))}
            <Button label="Close" onPress={() => setOpen(false)} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}
