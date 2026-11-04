import type { JSX } from "react";
import { Pressable, View } from "react-native";
import { IDispatch } from "../ducks/types";
import { IGithubSyncNotice } from "../sync/githubSyncTypes";
import { GithubSync_bannerText } from "../sync/githubSyncRuntime";
import { Thunk_githubSyncUndo } from "../sync/thunks";
import { lb } from "lens-shmens";
import { IState, updateState } from "../models/state";
import { Text } from "./primitives/text";

interface IProps {
  notice?: IGithubSyncNotice;
  dispatch: IDispatch;
}

export function GithubSyncBanner(props: IProps): JSX.Element | null {
  const notice = props.notice;
  if (notice == null || notice.items.length === 0) {
    return null;
  }
  return (
    <View className="absolute bottom-0 left-0 z-20 w-full p-4" testID="github-sync-banner">
      <View className="px-4 py-3 rounded shadow-lg bg-green-200">
        <Text className="text-sm text-text-primary">{GithubSync_bannerText(notice)}</Text>
        <View className="flex-row mt-2">
          <Pressable
            testID="github-sync-undo"
            className="mr-4"
            onPress={() => {
              props.dispatch(Thunk_githubSyncUndo());
            }}
          >
            <Text className="text-sm font-semibold text-text-link">Undo</Text>
          </Pressable>
          <Pressable
            testID="github-sync-dismiss"
            onPress={() => {
              updateState(
                props.dispatch,
                [lb<IState>().p("githubSyncNotice").record(undefined)],
                "Dismiss coach change notice"
              );
            }}
          >
            <Text className="text-sm text-text-secondary">Close</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
