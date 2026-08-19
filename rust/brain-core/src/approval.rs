use std::collections::HashMap;
use std::time::{Duration, Instant};

#[derive(Debug)]
struct Grant {
    project_id: String,
    operation: String,
    expires_at: Instant,
}

#[derive(Default)]
pub struct ApprovalRegistry {
    grants: HashMap<String, Grant>,
}

impl ApprovalRegistry {
    pub fn register(
        &mut self,
        token: String,
        project_id: String,
        operation: String,
        ttl: Duration,
    ) -> Result<(), &'static str> {
        if token.trim().len() < 32 || project_id.trim().is_empty() || operation.trim().is_empty() {
            return Err("BRAIN_CORE_APPROVAL_INVALID");
        }
        if ttl.is_zero() || ttl > Duration::from_secs(300) {
            return Err("BRAIN_CORE_APPROVAL_TTL_INVALID");
        }
        self.grants.insert(
            token,
            Grant {
                project_id,
                operation,
                expires_at: Instant::now() + ttl,
            },
        );
        Ok(())
    }

    pub fn consume(
        &mut self,
        token: &str,
        project_id: &str,
        operation: &str,
    ) -> Result<(), &'static str> {
        let grant = self
            .grants
            .remove(token)
            .ok_or("BRAIN_CORE_APPROVAL_REQUIRED")?;
        if grant.expires_at < Instant::now() {
            return Err("BRAIN_CORE_APPROVAL_EXPIRED");
        }
        if grant.project_id != project_id || grant.operation != operation {
            return Err("BRAIN_CORE_APPROVAL_SCOPE_MISMATCH");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn consumes_a_scoped_grant_once() {
        let mut approvals = ApprovalRegistry::default();
        approvals
            .register(
                TOKEN.to_owned(),
                "project-1".to_owned(),
                "file.write".to_owned(),
                Duration::from_secs(30),
            )
            .expect("grant registered");
        assert_eq!(approvals.consume(TOKEN, "project-1", "file.write"), Ok(()));
        assert_eq!(
            approvals.consume(TOKEN, "project-1", "file.write"),
            Err("BRAIN_CORE_APPROVAL_REQUIRED")
        );
    }

    #[test]
    fn consumes_a_wrongly_scoped_grant_without_reuse() {
        let mut approvals = ApprovalRegistry::default();
        approvals
            .register(
                TOKEN.to_owned(),
                "project-1".to_owned(),
                "file.write".to_owned(),
                Duration::from_secs(30),
            )
            .expect("grant registered");
        assert_eq!(
            approvals.consume(TOKEN, "project-2", "file.write"),
            Err("BRAIN_CORE_APPROVAL_SCOPE_MISMATCH")
        );
        assert_eq!(
            approvals.consume(TOKEN, "project-1", "file.write"),
            Err("BRAIN_CORE_APPROVAL_REQUIRED")
        );
    }
}
