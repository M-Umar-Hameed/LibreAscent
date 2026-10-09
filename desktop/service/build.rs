use std::io::Write;
use std::path::Path;

// Packs desktop/extension into the .xpi that browser_policy writes to disk for
// LibreWolf to force-install.
fn main() {
    let extension_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../extension");
    println!("cargo:rerun-if-changed={}", extension_dir.display());

    let manifest: serde_json::Value = serde_json::from_slice(
        &std::fs::read(extension_dir.join("manifest.json")).expect("read extension manifest"),
    )
    .expect("parse extension manifest");
    let version = manifest["version"].as_str().expect("manifest version");
    println!("cargo:rustc-env=BLOCKER_XPI_VERSION={version}");

    let mut entries: Vec<_> = std::fs::read_dir(&extension_dir)
        .expect("read extension dir")
        .map(|entry| entry.expect("extension dir entry").path())
        .filter(|path| path.is_file())
        .filter(|path| !path.to_string_lossy().ends_with(".test.js"))
        .collect();
    entries.sort();

    let out = Path::new(&std::env::var("OUT_DIR").unwrap()).join("libreascent-blocker.xpi");
    let mut zip = zip::ZipWriter::new(std::fs::File::create(&out).expect("create xpi"));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for path in entries {
        let name = path.file_name().unwrap().to_string_lossy();
        zip.start_file(name, options).expect("add xpi entry");
        zip.write_all(&std::fs::read(&path).expect("read extension file"))
            .expect("write xpi entry");
    }
    zip.finish().expect("finish xpi");

    // FNV-1a of the packed bytes, so a changed extension gets a new install_url
    // even when the manifest version was not bumped.
    let hash = std::fs::read(&out)
        .expect("read xpi")
        .iter()
        .fold(0x811c_9dc5_u32, |h, b| (h ^ u32::from(*b)).wrapping_mul(0x0100_0193));
    println!("cargo:rustc-env=BLOCKER_XPI_HASH={hash:08x}");
}
