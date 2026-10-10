use std::io::Write;
use std::path::Path;

// Provides the .xpi that browser_policy writes to disk for Firefox and LibreWolf
// to force-install: the Mozilla-signed copy in desktop/extension-signed for the
// manifest's version when there is one, else desktop/extension packed unsigned,
// which only LibreWolf loads.
fn main() {
    let extension_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../extension");
    let signed_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../extension-signed");
    println!("cargo:rerun-if-changed={}", extension_dir.display());
    println!("cargo:rerun-if-changed={}", signed_dir.display());

    let manifest: serde_json::Value = serde_json::from_slice(
        &std::fs::read(extension_dir.join("manifest.json")).expect("read extension manifest"),
    )
    .expect("parse extension manifest");
    let version = manifest["version"].as_str().expect("manifest version");
    println!("cargo:rustc-env=BLOCKER_XPI_VERSION={version}");

    let out = Path::new(&std::env::var("OUT_DIR").unwrap()).join("libreascent-blocker.xpi");
    let signed = signed_dir.join(format!("libreascent-blocker-{version}.xpi"));
    if signed.is_file() {
        std::fs::copy(&signed, &out).expect("copy signed xpi");
        println!("cargo:rustc-env=BLOCKER_XPI_SIGNED=1");
    } else {
        println!(
            "cargo:warning=no signed blocker for {version}: packing it unsigned, which Firefox will not load. Sign it with web-ext sign --channel=unlisted into {}",
            signed_dir.display()
        );
        pack_unsigned(&extension_dir, &out);
        println!("cargo:rustc-env=BLOCKER_XPI_SIGNED=0");
    }

    // FNV-1a of the packed bytes, so a changed extension gets a new install_url
    // even when the manifest version was not bumped.
    let hash = std::fs::read(&out)
        .expect("read xpi")
        .iter()
        .fold(0x811c_9dc5_u32, |h, b| (h ^ u32::from(*b)).wrapping_mul(0x0100_0193));
    println!("cargo:rustc-env=BLOCKER_XPI_HASH={hash:08x}");
}

fn pack_unsigned(extension_dir: &Path, out: &Path) {
    let mut entries: Vec<_> = std::fs::read_dir(extension_dir)
        .expect("read extension dir")
        .map(|entry| entry.expect("extension dir entry").path())
        .filter(|path| path.is_file())
        .filter(|path| !path.to_string_lossy().ends_with(".test.js"))
        // web-ext's .amo-upload-uuid and other tool state stay out.
        .filter(|path| !path.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.')))
        .collect();
    entries.sort();

    let mut zip = zip::ZipWriter::new(std::fs::File::create(out).expect("create xpi"));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for path in entries {
        let name = path.file_name().unwrap().to_string_lossy();
        zip.start_file(name, options).expect("add xpi entry");
        zip.write_all(&std::fs::read(&path).expect("read extension file"))
            .expect("write xpi entry");
    }
    zip.finish().expect("finish xpi");
}
