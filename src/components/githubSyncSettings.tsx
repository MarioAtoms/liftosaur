import { JSX, useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { IDispatch } from "../ducks/types";
import { GroupHeader } from "./groupHeader";
import { Text } from "./primitives/text";
import { TextInput } from "./primitives/textInput";
import { Tailwind_semantic } from "../utils/tailwindConfig";
import {
  GithubSync_idbStore,
  GithubSyncStore_emptyState,
  GithubSyncStore_loadConfig,
  GithubSyncStore_loadState,
} from "../sync/githubSyncStore";
import {
  GithubSyncSettings_emptyConfig,
  GithubSyncSettings_forgetToken,
  GithubSyncSettings_saveDraft,
  GithubSyncSettings_test,
  GithubSyncSettings_view,
  IGithubSyncDraft,
} from "../sync/githubSyncSettingsModel";
import { GithubSyncRuntime_subscribe } from "../sync/githubSyncRuntime";
import { IGithubSyncConfig, IGithubSyncDiskState } from "../sync/githubSyncTypes";
import { Thunk_githubSyncNow } from "../sync/thunks";

interface IProps {
  dispatch: IDispatch;
}

export function GithubSyncSettings(props: IProps): JSX.Element {
  const [config, setConfig] = useState<IGithubSyncConfig>(GithubSyncSettings_emptyConfig());
  const [disk, setDisk] = useState<IGithubSyncDiskState>(GithubSyncStore_emptyState());
  const [repoDraft, setRepoDraft] = useState(config.repo);
  const [tokenDraft, setTokenDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [localStatus, setLocalStatus] = useState<string | undefined>(undefined);
  const reload = useCallback(async () => {
    const [loadedConfig, loadedDisk] = await Promise.all([
      GithubSyncStore_loadConfig(GithubSync_idbStore),
      GithubSyncStore_loadState(GithubSync_idbStore),
    ]);
    setConfig(loadedConfig);
    setDisk(loadedDisk);
    setRepoDraft(loadedConfig.repo);
    setBusy(false);
  }, []);
  useEffect(() => {
    start(reload());
    return GithubSyncRuntime_subscribe(() => {
      start(reload());
    });
  }, [reload]);
  const view = GithubSyncSettings_view(config, disk, Date.now());
  const draft = (): IGithubSyncDraft => ({
    repo: repoDraft,
    token: tokenDraft,
    autoApply: view.autoApply,
    includeBodyStats: view.includeBodyStats,
  });
  return (
    <View>
      <GroupHeader name="Backup and coach sync (GitHub)" topPadding={true} />
      <Text className="pb-2 text-xs text-text-secondary">
        Backs up this phone to a private GitHub repo. A coach can change program text. The token stays on this device.
      </Text>
      <Field label="Repo">
        <TextInput
          testID="github-sync-repo"
          autoCapitalize="none"
          autoCorrect={false}
          value={repoDraft}
          onChangeText={setRepoDraft}
          onBlur={() => {
            start(GithubSyncSettings_saveDraft(GithubSync_idbStore, draft()).then(() => reload()));
          }}
          placeholder="owner/repo"
          placeholderTextColor={Tailwind_semantic().text.secondarysubtle}
          className="flex-1 py-2 text-right text-text-link"
        />
      </Field>
      <Field label="Token">
        <TextInput
          testID="github-sync-token"
          secureTextEntry={true}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          value={tokenDraft}
          onChangeText={setTokenDraft}
          onBlur={() => {
            if (tokenDraft.trim() === "") {
              return;
            }
            start(
              GithubSyncSettings_saveDraft(GithubSync_idbStore, draft()).then(() => {
                setTokenDraft("");
                return reload();
              })
            );
          }}
          placeholder={view.hasToken ? "Token saved" : "Paste a fine-grained token"}
          placeholderTextColor={Tailwind_semantic().text.secondarysubtle}
          className="flex-1 py-2 text-right text-text-link"
        />
      </Field>
      <StatusLine label={view.hasToken ? "Token saved" : "No token saved"} />
      <StatusLine label={view.expiryLabel} />
      {view.expiryWarning != null && <StatusLine label={view.expiryWarning} />}
      <StatusLine label={localStatus ?? view.lastPushLabel} />
      <Action
        testID="github-sync-test"
        name="Test connection"
        disabled={busy}
        onPress={() => {
          setBusy(true);
          start(
            GithubSyncSettings_saveDraft(GithubSync_idbStore, draft())
              .then(() => GithubSyncSettings_test(window.fetch.bind(window), GithubSync_idbStore))
              .then((message) => {
                setTokenDraft("");
                setLocalStatus(message);
                return reload();
              })
          );
        }}
      />
      <Action
        testID="github-sync-now"
        name="Sync now"
        disabled={busy}
        onPress={() => {
          setBusy(true);
          setLocalStatus(undefined);
          start(
            GithubSyncSettings_saveDraft(GithubSync_idbStore, draft()).then(() => {
              setTokenDraft("");
              props.dispatch(Thunk_githubSyncNow());
            })
          );
        }}
      />
      <Toggle
        testID="github-sync-auto-apply"
        name="Apply coach changes automatically"
        value={view.autoApply}
        onPress={() => {
          const typed = tokenDraft.trim() !== "";
          start(
            GithubSyncSettings_saveDraft(GithubSync_idbStore, { ...draft(), autoApply: !view.autoApply }).then(() => {
              if (typed) {
                setTokenDraft("");
              }
              return reload();
            })
          );
        }}
      />
      <Toggle
        testID="github-sync-body-stats"
        name="Include body stats"
        value={view.includeBodyStats}
        onPress={() => {
          const typed = tokenDraft.trim() !== "";
          start(
            GithubSyncSettings_saveDraft(GithubSync_idbStore, {
              ...draft(),
              includeBodyStats: !view.includeBodyStats,
            }).then(() => {
              if (typed) {
                setTokenDraft("");
              }
              return reload();
            })
          );
        }}
      />
      {view.hasToken && (
        <Action
          testID="github-sync-forget"
          name="Forget token"
          disabled={busy}
          onPress={() => {
            setTokenDraft("");
            start(GithubSyncSettings_forgetToken(GithubSync_idbStore).then(() => reload()));
          }}
        />
      )}
    </View>
  );
}

function start(task: Promise<unknown>): void {
  task.catch(() => undefined);
}

function Field(props: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <View className="flex-row items-center py-2 border-b border-border-neutral">
      <Text className="pr-2 text-base text-text-primary">{props.label}</Text>
      {props.children}
    </View>
  );
}

function StatusLine(props: { label: string }): JSX.Element {
  return (
    <View className="py-2 border-b border-border-neutral">
      <Text className="text-xs text-text-secondary">{props.label}</Text>
    </View>
  );
}

function Action(props: { name: string; testID: string; disabled?: boolean; onPress: () => void }): JSX.Element {
  return (
    <Pressable
      testID={props.testID}
      disabled={props.disabled}
      className="py-3 border-b border-border-neutral"
      onPress={props.onPress}
    >
      <Text className="text-base text-text-primary">{props.name}</Text>
    </Pressable>
  );
}

function Toggle(props: { name: string; testID: string; value: boolean; onPress: () => void }): JSX.Element {
  return (
    <Pressable testID={props.testID} className="py-3 border-b border-border-neutral" onPress={props.onPress}>
      <View className="flex-row items-center">
        <Text className="flex-1 pr-2 text-base text-text-primary">{props.name}</Text>
        <Text className="text-base text-text-link">{props.value ? "On" : "Off"}</Text>
      </View>
    </Pressable>
  );
}
