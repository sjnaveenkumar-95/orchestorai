export function printPairingUsage(log = console.log) {
  log("Usage:");
  log("  npm run pairing:list");
  log("  npm run pairing:approve -- <code>");
}

export function runPairingCommand({ store, argv, log = console.log, error = console.error }) {
  const [command, arg] = argv;

  if (!command || command === "help") {
    printPairingUsage(log);
    return 0;
  }

  if (command === "list") {
    const pending = store.listPending();
    const approved = store.listApproved();

    log("Pending requests:");
    if (pending.length === 0) {
      log("  (none)");
    } else {
      for (const entry of pending) {
        log(
          `  - user=${entry.userId} code=${entry.code} createdAt=${entry.createdAt} name=${entry.meta?.name || ""}`,
        );
      }
    }

    log("Approved users:");
    if (approved.length === 0) {
      log("  (none)");
    } else {
      for (const entry of approved) {
        log(`  - user=${entry.userId} approvedAt=${entry.approvedAt} name=${entry.meta?.name || ""}`);
      }
    }
    return 0;
  }

  if (command === "approve") {
    const code = String(arg || "").trim();
    if (!code) {
      error("Missing pairing code.");
      printPairingUsage(log);
      return 1;
    }

    const result = store.approveByCode(code);
    if (!result) {
      error(`No pending pairing request found for code ${code}.`);
      return 1;
    }

    log(`Approved user ${result.userId} at ${result.approvedAt}`);
    return 0;
  }

  error(`Unknown command: ${command}`);
  printPairingUsage(log);
  return 1;
}
