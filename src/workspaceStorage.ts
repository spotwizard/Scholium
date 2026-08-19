export const workspaceStorageKeys = {
  lastOpenedMarkdownPath: "scholium:last-opened-markdown-path",
  lastOpenedMarkdownRootDirectory: "scholium:last-opened-markdown-root-directory",
  lastOpenedDropboxWorkspace: "scholium:last-opened-dropbox-workspace",
  documentTabSession: "scholium:document-tab-session",
} as const;

const secondaryWorkspaceStorageSeededKey = "scholium:secondary-workspace-seeded";

type WorkspaceStorageWindow = {
  location: Pick<Location, "search">;
  localStorage: Storage;
  sessionStorage: Storage;
};

export function currentWindowWorkspaceStorage(
  targetWindow: WorkspaceStorageWindow = window,
) {
  const isSecondaryWindow =
    new URLSearchParams(targetWindow.location.search).get("scholium-window") === "secondary";
  if (!isSecondaryWindow) return targetWindow.localStorage;

  if (
    targetWindow.sessionStorage.getItem(secondaryWorkspaceStorageSeededKey) !== "true"
  ) {
    Object.values(workspaceStorageKeys).forEach((key) => {
      const value = targetWindow.localStorage.getItem(key);
      if (value === null) {
        targetWindow.sessionStorage.removeItem(key);
      } else {
        targetWindow.sessionStorage.setItem(key, value);
      }
    });
    targetWindow.sessionStorage.setItem(secondaryWorkspaceStorageSeededKey, "true");
  }

  return targetWindow.sessionStorage;
}
