import { useGT, T } from "gt-react-native";
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
  const gt = useGT();
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
    } catch (error) {
      setBusy(false);
      throw error;
    }
    setBusy(false);
  };
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={gt("Private controls")}
        onPress={() => {
          setOpen(true);
          void refresh();
        }}
        className="min-h-11 self-start justify-center px-3"
      >
        <Text className="text-sm text-foreground-muted">
          {props.policy === "disabled" ? gt("Private") : gt("Private + helpers")}
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
            <Text className="text-xl font-t3-bold text-foreground">
              <T>Private controls</T>
            </Text>
            <Text className="text-foreground-muted">
              <T>
                Full conversation context uses Tinfoil. External helpers receive only the exact
                packet you review and approve. Auto action permissions stay separate.
              </T>
            </Text>
            <View className="gap-2">
              <Button
                label={gt("Private only")}
                disabled={!props.canOperate || busy || props.policy === "disabled"}
                onPress={() => {
                  void update({
                    environmentId: props.environmentId,
                    input: { threadId: props.threadId, privateHelpers: "disabled" },
                  });
                }}
              />
              <Button
                label={gt("Private + helpers · review each packet")}
                disabled={!props.canOperate || busy || props.policy === "review"}
                onPress={() => {
                  void update({
                    environmentId: props.environmentId,
                    input: { threadId: props.threadId, privateHelpers: "review" },
                  });
                }}
              />
              <Button
                label={gt("Refresh helper packets")}
                disabled={busy}
                onPress={() => void refresh()}
              />
            </View>
            <Text className="text-foreground-muted">
              <T>
                Helpers have no parent history, workspace, tools, T3 access, or credentials. Their
                provider’s data terms apply to the approved packet. Reviews expire after 15 minutes
                or a server restart.
              </T>
            </Text>
            {packets.length === 0 ? (
              <Text className="text-foreground-muted">
                <T>Your private coordinator can prepare a self-contained helper packet.</T>
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
                  label={gt("Inspect exact outbound packet")}
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
                      label={gt("Approve packet once")}
                      disabled={
                        !props.canOperate ||
                        busy ||
                        reviewed !== packet.id ||
                        props.policy === "disabled"
                      }
                      onPress={() => void decision(packet, "approve")}
                    />
                    <Button
                      label={gt("Block packet")}
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
                      <T>Review privately before applying or executing this artifact.</T>
                    </Text>
                  </>
                )}
              </View>
            ))}
            <Button label={gt("Close")} onPress={() => setOpen(false)} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}
