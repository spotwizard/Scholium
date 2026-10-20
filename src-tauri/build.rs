fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new()
            .file("src/text_context_menu.m")
            .flag("-fobjc-arc")
            .compile("scholium_text_context_menu");
        println!("cargo:rustc-link-lib=framework=WebKit");
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rerun-if-changed=src/text_context_menu.m");
    }
    tauri_build::build()
}
