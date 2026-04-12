use std::{
  net::{SocketAddr, TcpStream},
  path::{Path, PathBuf},
  process::{Child, Command, Stdio},
  sync::Mutex,
  thread,
  time::{Duration, Instant},
};

use tauri::{Manager, RunEvent, WebviewWindow};

struct BackendProcess(Mutex<Option<Child>>);

impl BackendProcess {
  fn new() -> Self {
    Self(Mutex::new(None))
  }

  fn set(&self, child: Child) {
    if let Ok(mut slot) = self.0.lock() {
      *slot = Some(child);
    }
  }

  fn stop(&self) {
    if let Ok(mut slot) = self.0.lock() {
      if let Some(mut child) = slot.take() {
        let _ = child.kill();
        let _ = child.wait();
      }
    }
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let backend_process = BackendProcess::new();

  let app = tauri::Builder::default()
    .manage(backend_process)
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let window = app
        .get_webview_window("main")
        .expect("main window should be configured");

      if !backend_is_available() {
        let child = spawn_backend()?;
        app.state::<BackendProcess>().set(child);
      }

      wait_for_backend(Duration::from_secs(15));
      reveal_window(&window)?;
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  app.run(|app_handle, event| {
    if matches!(event, RunEvent::Exit) {
      app_handle.state::<BackendProcess>().stop();
    }
  });
}

fn reveal_window(window: &WebviewWindow) -> tauri::Result<()> {
  window.show()?;
  window.set_focus()?;
  Ok(())
}

fn backend_is_available() -> bool {
  let address: SocketAddr = "127.0.0.1:8000".parse().expect("socket address should parse");
  TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok()
}

fn wait_for_backend(timeout: Duration) {
  let deadline = Instant::now() + timeout;
  while Instant::now() < deadline {
    if backend_is_available() {
      return;
    }
    thread::sleep(Duration::from_millis(200));
  }
}

fn spawn_backend() -> tauri::Result<Child> {
  let project_root = project_root();
  let venv_python = project_root.join(".venv/bin/python");
  let python = if venv_python.exists() {
    venv_python
  } else {
    PathBuf::from("python3")
  };

  let child = Command::new(python)
    .current_dir(&project_root)
    .env(
      "PYTHONPATH",
      python_path_for_project(&project_root),
    )
    .arg("-m")
    .arg("uvicorn")
    .arg("investing_platform.main:app")
    .arg("--host")
    .arg("127.0.0.1")
    .arg("--port")
    .arg("8000")
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .spawn()
    .map_err(tauri::Error::from)?;

  Ok(child)
}

fn project_root() -> PathBuf {
  Path::new(env!("CARGO_MANIFEST_DIR"))
    .join("../..")
    .canonicalize()
    .expect("project root should resolve")
}

fn python_path_for_project(project_root: &Path) -> String {
  let mut paths = vec![project_root.join("src")];
  if let Some(existing) = std::env::var_os("PYTHONPATH") {
    paths.extend(std::env::split_paths(&existing));
  }
  std::env::join_paths(paths)
    .expect("PYTHONPATH entries should be valid")
    .to_string_lossy()
    .into_owned()
}
