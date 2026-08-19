use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

pub struct ProjectBoundary {
    root: PathBuf,
}

impl ProjectBoundary {
    pub fn bind(root: &Path) -> io::Result<Self> {
        let root = fs::canonicalize(root)?;
        if !root.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "project root is not a directory",
            ));
        }
        Ok(Self { root })
    }

    pub fn existing(&self, relative: &Path) -> io::Result<PathBuf> {
        let candidate = self.lexical_candidate(relative)?;
        let canonical = fs::canonicalize(candidate)?;
        self.require_inside(canonical)
    }

    pub fn writable(&self, relative: &Path) -> io::Result<PathBuf> {
        let candidate = self.lexical_candidate(relative)?;
        let parent = candidate
            .parent()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no parent"))?;
        let canonical_parent = fs::canonicalize(parent)?;
        self.require_inside(canonical_parent)?;
        Ok(candidate)
    }

    fn lexical_candidate(&self, relative: &Path) -> io::Result<PathBuf> {
        if relative.as_os_str().is_empty() || relative.is_absolute() {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "path must be project-relative",
            ));
        }
        if relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::Prefix(_) | Component::RootDir
            )
        }) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "path escapes project",
            ));
        }
        Ok(self.root.join(relative))
    }

    fn require_inside(&self, candidate: PathBuf) -> io::Result<PathBuf> {
        if candidate == self.root || candidate.starts_with(&self.root) {
            Ok(candidate)
        } else {
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "path escapes project",
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_root() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "brain-core-path-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        fs::create_dir_all(path.join("nested")).expect("temp root");
        path
    }

    #[test]
    fn rejects_parent_traversal() {
        let root = temporary_root();
        let boundary = ProjectBoundary::bind(&root).expect("bind root");
        assert_eq!(
            boundary
                .existing(Path::new("../outside"))
                .unwrap_err()
                .kind(),
            io::ErrorKind::PermissionDenied
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn accepts_an_existing_file_inside_the_project() {
        let root = temporary_root();
        fs::write(root.join("nested/report.txt"), b"report").expect("fixture");
        let boundary = ProjectBoundary::bind(&root).expect("bind root");
        assert!(boundary
            .existing(Path::new("nested/report.txt"))
            .expect("inside")
            .starts_with(fs::canonicalize(&root).expect("root")));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlink_that_escapes_the_project() {
        use std::os::unix::fs::symlink;
        let root = temporary_root();
        let outside = temporary_root();
        fs::write(outside.join("secret.txt"), b"secret").expect("fixture");
        symlink(outside.join("secret.txt"), root.join("nested/link.txt")).expect("symlink");
        let boundary = ProjectBoundary::bind(&root).expect("bind root");
        assert_eq!(
            boundary
                .existing(Path::new("nested/link.txt"))
                .unwrap_err()
                .kind(),
            io::ErrorKind::PermissionDenied
        );
        fs::remove_dir_all(root).expect("cleanup root");
        fs::remove_dir_all(outside).expect("cleanup outside");
    }
}
