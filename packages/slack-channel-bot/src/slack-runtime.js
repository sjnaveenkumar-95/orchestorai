export function channelBotOwnsChannelType(channelType) {
  return channelType === "channel" || channelType === "group" || channelType === "mpim";
}
