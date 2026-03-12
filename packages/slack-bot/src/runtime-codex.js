export function resolveSlackBotCodexAdapter({ channelType, defaultAdapter, directMessageAdapter }) {
  if (channelType === "im" && directMessageAdapter) {
    return directMessageAdapter;
  }
  return defaultAdapter;
}
