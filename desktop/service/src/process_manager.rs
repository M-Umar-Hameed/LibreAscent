use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};
use libreascent_shared::config::DesktopConfig;
use std::path::PathBuf;

pub fn check_and_block_apps(sys: &mut System, config: &DesktopConfig) -> Vec<PathBuf> {
    if config.blocked_apps.is_empty() {
        return Vec::new();
    }

    sys.refresh_processes(ProcessesToUpdate::All, true);
    let mut blocked_paths = Vec::new();

    for (pid, process) in sys.processes() {
        let exe_name = process.name().to_string_lossy().to_lowercase();
        let exe_path = process.exe().map(|path| path.to_string_lossy().to_string());

        if should_block_process(&exe_name, exe_path.as_deref(), config) {
            println!("Blocking app: {} (PID: {:?})", exe_name, pid);
            if let Some(path) = process.exe() {
                blocked_paths.push(path.to_path_buf());
            }
            let _ = process.kill();
        }
    }

    blocked_paths.sort();
    blocked_paths.dedup();
    blocked_paths
}

pub fn create_system_handle() -> System {
    System::new_with_specifics(RefreshKind::nothing().with_processes(ProcessRefreshKind::everything()))
}

fn should_block_process(exe_name: &str, exe_path: Option<&str>, config: &DesktopConfig) -> bool {
    let exe_name = exe_name.to_lowercase();
    let exe_path = exe_path.map(|path| path.to_lowercase());

    config.blocked_apps.iter().any(|rule| {
        executable_matches(&exe_name, exe_path.as_deref(), &rule.executable.to_lowercase())
    })
}

fn executable_matches(exe_name: &str, exe_path: Option<&str>, rule_exe: &str) -> bool {
    exe_name == rule_exe
        || exe_name == format!("{rule_exe}.exe")
        || exe_path
            .map(|path| path.contains(rule_exe))
            .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use libreascent_shared::config::default_config;

    #[test]
    fn allows_cloudflare_warp_unless_user_configured_it() {
        let config = default_config();

        assert!(!should_block_process(
            "warp-svc.exe",
            Some(r"C:\Program Files\Cloudflare\Cloudflare WARP\warp-svc.exe"),
            &config,
        ));
    }

    #[test]
    fn allows_unconfigured_normal_process() {
        let config = default_config();

        assert!(!should_block_process("notepad.exe", None, &config));
    }
}
