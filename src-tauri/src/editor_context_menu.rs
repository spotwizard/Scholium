//! Adds an "insert file link" item to WKWebView's native context menu.
//!
//! WKWebView builds its context menu natively (Look Up, Writing Tools, spelling, …), so the
//! frontend cannot add items to it. The frontend reports which window's editor is under the
//! pointer; when WebKit opens a context menu there, `willOpenMenu:withEvent:` appends the item
//! and a click is forwarded to that window as `scholium-insert-file-link`.

use std::ffi::c_void;
use std::sync::{Mutex, OnceLock};

use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Imp, NSObject, Sel};
use objc2::{define_class, ffi, msg_send, sel, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSEvent, NSMenu, NSMenuItem, NSUserInterfaceItemIdentification};
use objc2_foundation::NSString;
use tauri::{AppHandle, Emitter, Manager};

pub(crate) const INSERT_FILE_LINK_EVENT: &str = "scholium-insert-file-link";
const WEBKIT_PASTE_IDENTIFIER: &str = "WKMenuItemIdentifierPaste";

struct InsertFileMenuTarget {
    window_label: String,
    title: String,
}

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
static MENU_TARGET: Mutex<Option<InsertFileMenuTarget>> = Mutex::new(None);
static ORIGINAL_WILL_OPEN_MENU: OnceLock<Option<Imp>> = OnceLock::new();

type WillOpenMenuFn = unsafe extern "C-unwind" fn(&AnyObject, Sel, &NSMenu, &NSEvent);

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "ScholiumInsertFileMenuAction"]
    struct InsertFileMenuAction;

    impl InsertFileMenuAction {
        #[unsafe(method(insertFileLink:))]
        fn insert_file_link(&self, _sender: Option<&AnyObject>) {
            let Some(app) = APP_HANDLE.get() else {
                return;
            };
            let Some(label) = current_target().map(|target| target.0) else {
                return;
            };
            if let Err(error) = app.emit_to(label, INSERT_FILE_LINK_EVENT, ()) {
                eprintln!("failed to emit insert file link event: {error}");
            }
        }
    }
);

thread_local! {
    // NSMenuItem only keeps a weak reference to its target.
    static MENU_ACTION: Retained<InsertFileMenuAction> = {
        let mtm = MainThreadMarker::new().expect("context menu runs on the main thread");
        unsafe { msg_send![InsertFileMenuAction::alloc(mtm), init] }
    };
}

fn current_target() -> Option<(String, String)> {
    MENU_TARGET
        .lock()
        .ok()?
        .as_ref()
        .map(|target| (target.window_label.clone(), target.title.clone()))
}

pub(crate) fn set_target(window_label: &str, enabled: bool, title: String) {
    let Ok(mut target) = MENU_TARGET.lock() else {
        return;
    };

    if enabled {
        *target = Some(InsertFileMenuTarget {
            window_label: window_label.to_string(),
            title,
        });
    } else if target
        .as_ref()
        .is_some_and(|current| current.window_label == window_label)
    {
        *target = None;
    }
}

fn menu_item_is_paste(item: &NSMenuItem) -> bool {
    if item.action() == Some(sel!(paste:)) {
        return true;
    }

    item.identifier()
        .is_some_and(|identifier| identifier.to_string() == WEBKIT_PASTE_IDENTIFIER)
}

fn webview_is_in_window(app: &AppHandle, webview: &AnyObject, window_label: &str) -> bool {
    let Some(window) = app.get_webview_window(window_label) else {
        return false;
    };
    let Ok(ns_window) = window.ns_window() else {
        return false;
    };
    let webview_window: *mut AnyObject = unsafe { msg_send![webview, window] };

    !ns_window.is_null() && webview_window as *mut c_void == ns_window
}

fn append_insert_file_item(webview: &AnyObject, menu: &NSMenu) {
    let Some(app) = APP_HANDLE.get() else {
        return;
    };
    let Some((window_label, title)) = current_target() else {
        return;
    };
    if !webview_is_in_window(app, webview, &window_label) {
        return;
    }
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };

    let item = unsafe {
        NSMenuItem::initWithTitle_action_keyEquivalent(
            NSMenuItem::alloc(mtm),
            &NSString::from_str(&title),
            Some(sel!(insertFileLink:)),
            &NSString::from_str(""),
        )
    };
    MENU_ACTION.with(|action| unsafe { item.setTarget(Some(action)) });

    let items = menu.itemArray();
    let paste_index =
        (0..items.count()).find(|&index| menu_item_is_paste(&items.objectAtIndex(index)));
    match paste_index {
        Some(index) => menu.insertItem_atIndex(&item, (index + 1) as isize),
        None => {
            menu.insertItem_atIndex(&NSMenuItem::separatorItem(mtm), 0);
            menu.insertItem_atIndex(&item, 0);
        }
    }
}

unsafe extern "C-unwind" fn will_open_menu(
    this: &AnyObject,
    cmd: Sel,
    menu: &NSMenu,
    event: &NSEvent,
) {
    if let Some(Some(original)) = ORIGINAL_WILL_OPEN_MENU.get() {
        let original: WillOpenMenuFn = std::mem::transmute(*original);
        original(this, cmd, menu, event);
    }

    append_insert_file_item(this, menu);
}

/// Installs `willOpenMenu:withEvent:` on wry's WKWebView subclass. WryWebView does not
/// override it, so the inherited WKWebView implementation is kept and called first.
pub(crate) fn install(app: &AppHandle) {
    let _ = APP_HANDLE.set(app.clone());

    let Some(class) = AnyClass::get(c"WryWebView") else {
        eprintln!("failed to find WryWebView class for the editor context menu");
        return;
    };
    let selector = sel!(willOpenMenu:withEvent:);

    unsafe {
        let inherited_method = ffi::class_getInstanceMethod(class, selector);
        let _ = ORIGINAL_WILL_OPEN_MENU.set(if inherited_method.is_null() {
            None
        } else {
            ffi::method_getImplementation(inherited_method)
        });

        let implementation: WillOpenMenuFn = will_open_menu;
        let added = ffi::class_addMethod(
            class as *const AnyClass as *mut AnyClass,
            selector,
            std::mem::transmute::<WillOpenMenuFn, Imp>(implementation),
            c"v@:@@".as_ptr(),
        );
        if !added.as_bool() {
            eprintln!("failed to add the editor context menu hook to WryWebView");
        }
    }
}
