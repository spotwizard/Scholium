use serde::{Deserialize, Serialize};

const STALE_CONNECTION_ERROR: &str =
    "Dropbox connection changed while the request was running; try again.";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DropboxTokenStore {
    pub(crate) app_key: String,
    pub(crate) access_token: String,
    pub(crate) refresh_token: Option<String>,
    pub(crate) expires_at: Option<u64>,
}

#[derive(Clone)]
pub(crate) struct DropboxTokenSnapshot {
    connection_generation: u64,
    revision: u64,
    pub(crate) tokens: DropboxTokenStore,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct DropboxConnectionSnapshot {
    generation: u64,
}

#[derive(Default)]
pub(crate) struct DropboxTokenState {
    connection_generation: u64,
    revision: u64,
    tokens: Option<DropboxTokenStore>,
}

impl DropboxTokenState {
    pub(crate) fn load(&mut self, tokens: Option<DropboxTokenStore>) {
        self.tokens = tokens;
        self.connection_generation = self.connection_generation.wrapping_add(1);
        self.revision = 0;
    }

    pub(crate) fn current(&self) -> Option<DropboxTokenStore> {
        self.tokens.clone()
    }

    pub(crate) fn token_snapshot(&self) -> Option<DropboxTokenSnapshot> {
        self.tokens.clone().map(|tokens| DropboxTokenSnapshot {
            connection_generation: self.connection_generation,
            revision: self.revision,
            tokens,
        })
    }

    pub(crate) fn connection_snapshot(&self) -> DropboxConnectionSnapshot {
        DropboxConnectionSnapshot {
            generation: self.connection_generation,
        }
    }

    pub(crate) fn commit_refresh(
        &mut self,
        snapshot: &DropboxTokenSnapshot,
        refreshed_tokens: DropboxTokenStore,
        persist: impl FnOnce(&DropboxTokenStore) -> Result<(), String>,
    ) -> Result<DropboxTokenStore, String> {
        if self.connection_generation != snapshot.connection_generation {
            return Err(STALE_CONNECTION_ERROR.to_string());
        }

        if self.revision != snapshot.revision {
            return self
                .tokens
                .clone()
                .ok_or_else(|| STALE_CONNECTION_ERROR.to_string());
        }

        persist(&refreshed_tokens)?;
        self.tokens = Some(refreshed_tokens.clone());
        self.revision = self.revision.wrapping_add(1);
        Ok(refreshed_tokens)
    }

    pub(crate) fn commit_connection(
        &mut self,
        snapshot: DropboxConnectionSnapshot,
        tokens: DropboxTokenStore,
        persist: impl FnOnce(&DropboxTokenStore) -> Result<(), String>,
    ) -> Result<(), String> {
        if self.connection_generation != snapshot.generation {
            return Err(STALE_CONNECTION_ERROR.to_string());
        }

        persist(&tokens)?;
        self.tokens = Some(tokens);
        self.connection_generation = self.connection_generation.wrapping_add(1);
        self.revision = 0;
        Ok(())
    }

    pub(crate) fn disconnect(
        &mut self,
        delete_persisted: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        delete_persisted()?;
        self.tokens = None;
        self.connection_generation = self.connection_generation.wrapping_add(1);
        self.revision = 0;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tokens(account: &str, access_token: &str) -> DropboxTokenStore {
        DropboxTokenStore {
            app_key: account.to_string(),
            access_token: access_token.to_string(),
            refresh_token: Some(format!("refresh-{account}")),
            expires_at: Some(1),
        }
    }

    fn connected_state(account: &str, access_token: &str) -> DropboxTokenState {
        let mut state = DropboxTokenState::default();
        state.load(Some(tokens(account, access_token)));
        state
    }

    #[test]
    fn stale_refresh_after_disconnect_and_reconnect_never_persists_or_crosses_accounts() {
        let mut state = connected_state("old-account", "old-access");
        let refresh_snapshot = state.token_snapshot().unwrap();

        state.disconnect(|| Ok(())).unwrap();
        let reconnect_snapshot = state.connection_snapshot();
        state
            .commit_connection(
                reconnect_snapshot,
                tokens("new-account", "new-access"),
                |_| Ok(()),
            )
            .unwrap();

        let mut persist_count = 0;
        let result = state.commit_refresh(
            &refresh_snapshot,
            tokens("old-account", "stale-access"),
            |_| {
                persist_count += 1;
                Ok(())
            },
        );

        assert!(result.is_err());
        assert_eq!(persist_count, 0);
        assert_eq!(state.current().unwrap().app_key, "new-account");
        assert_eq!(state.current().unwrap().access_token, "new-access");
    }

    #[test]
    fn concurrent_refreshes_commit_once_and_share_the_current_token() {
        let mut state = connected_state("account", "old-access");
        let first_snapshot = state.token_snapshot().unwrap();
        let second_snapshot = first_snapshot.clone();
        let mut persist_count = 0;

        let first = state
            .commit_refresh(&first_snapshot, tokens("account", "first-access"), |_| {
                persist_count += 1;
                Ok(())
            })
            .unwrap();
        let second = state
            .commit_refresh(&second_snapshot, tokens("account", "second-access"), |_| {
                persist_count += 1;
                Ok(())
            })
            .unwrap();

        assert_eq!(persist_count, 1);
        assert_eq!(first.access_token, "first-access");
        assert_eq!(second.access_token, "first-access");
        assert_eq!(state.current().unwrap().access_token, "first-access");
    }

    #[test]
    fn persistence_failures_leave_memory_and_revision_unchanged() {
        let mut state = connected_state("account", "old-access");
        let refresh_snapshot = state.token_snapshot().unwrap();

        assert!(state
            .commit_refresh(
                &refresh_snapshot,
                tokens("account", "failed-access"),
                |_| Err("write failed".to_string()),
            )
            .is_err());
        assert_eq!(state.current().unwrap().access_token, "old-access");

        assert!(state
            .disconnect(|| Err("delete failed".to_string()))
            .is_err());
        assert_eq!(state.current().unwrap().access_token, "old-access");

        let connection_snapshot = state.connection_snapshot();
        assert!(state
            .commit_connection(
                connection_snapshot,
                tokens("new-account", "failed-oauth-access"),
                |_| Err("write failed".to_string()),
            )
            .is_err());
        assert_eq!(state.current().unwrap().access_token, "old-access");

        let mut persist_count = 0;
        state
            .commit_refresh(
                &refresh_snapshot,
                tokens("account", "recovered-access"),
                |_| {
                    persist_count += 1;
                    Ok(())
                },
            )
            .unwrap();
        assert_eq!(persist_count, 1);
        assert_eq!(state.current().unwrap().access_token, "recovered-access");
    }

    #[test]
    fn oauth_completion_started_before_disconnect_cannot_persist() {
        let mut state = DropboxTokenState::default();
        let oauth_snapshot = state.connection_snapshot();

        state.disconnect(|| Ok(())).unwrap();

        let mut persist_count = 0;
        let result = state.commit_connection(
            oauth_snapshot,
            tokens("account", "stale-oauth-access"),
            |_| {
                persist_count += 1;
                Ok(())
            },
        );

        assert!(result.is_err());
        assert_eq!(persist_count, 0);
        assert!(state.current().is_none());
    }
}
