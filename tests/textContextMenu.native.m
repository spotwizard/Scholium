// Background native integration test: no window is shown and no user input is sent.
#import "../src-tauri/src/text_context_menu.m"
#include <assert.h>
#undef assert
#define assert(condition) do { if (!(condition)) { fprintf(stderr, "FAIL line %d: %s\n", __LINE__, #condition); _Exit(1); } } while (0)

static BOOL waitUntil(BOOL (^condition)(void)) {
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:10];
    while (!condition() && deadline.timeIntervalSinceNow > 0) {
        [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
    }
    return condition();
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        assert(argc == 2);
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
        WKWebViewConfiguration *configuration = [WKWebViewConfiguration new];
        configuration.websiteDataStore = WKWebsiteDataStore.nonPersistentDataStore;
        NSString *selectionScript = [NSString stringWithContentsOfFile:@(argv[1]) encoding:NSUTF8StringEncoding error:nil];
        assert(selectionScript != nil);
        [configuration.userContentController addUserScript:[[WKUserScript alloc]
            initWithSource:[selectionScript stringByAppendingString:@"\nContextMenuSelection.preserveEditorContextMenuSelection(document);"]
            injectionTime:WKUserScriptInjectionTimeAtDocumentEnd forMainFrameOnly:YES]];
        WKWebView *view = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 800, 600) configuration:configuration];
        NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 800, 600)
            styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskResizable | NSWindowStyleMaskClosable
            backing:NSBackingStoreBuffered defer:NO];
        window.contentView = view;
        Class original = object_getClass(view);
        scholium_install_text_context_menu((__bridge void *)view);
        assert(object_getClass(view) == original);
        scholium_install_text_context_menu((__bridge void *)view);
        assert(object_getClass(view) == original);
        [view loadHTMLString:@"<html><body><script>window.__scholiumTextMenu={prepare:()=>({request:1,canInsert:true}),files:async()=>({request:1,names:['中文.md','photo.png']}),insert:(request,index)=>{window.result=[request,index]}}</script></body></html>" baseURL:nil];
        __block BOOL loaded = NO;
        assert(waitUntil(^BOOL{
            if (!loaded) [view evaluateJavaScript:@"Boolean(window.__scholiumTextMenu)" completionHandler:^(id result, NSError *error) { if (!error) loaded = [result boolValue]; }];
            return loaded;
        }));
        NSString *selectionChecks = @"(() => {"
            "document.body.innerHTML='<section class=editor-pane><div class=milkdown-markdown-editor><p contenteditable=true>alpha  beta</p></div><div class=markdown-editor-host><pre contenteditable=true>alpha  beta</pre></div></section><input id=outside>';"
            "const selection=getSelection();"
            "const check=(ok,label)=>{if(!ok)throw Error(label)};"
            "for(const target of document.querySelectorAll('[contenteditable]')){"
                "const text=target.firstChild,rect=JSON.stringify(target.getBoundingClientRect());"
                "for(let round=0;round<2;round++){"
                    "for(const offsets of [[0,0],[5,0],[5,7],null]){"
                        "selection.removeAllRanges(); if(offsets)selection.setBaseAndExtent(text,offsets[0],text,offsets[1]);"
                        "const down=new MouseEvent('mousedown',{button:2,bubbles:true,cancelable:true}); target.dispatchEvent(down);"
                        "check(down.defaultPrevented,'right mousedown only');"
                        "selection.setBaseAndExtent(text,5,text,7);"
                        "const menu=new MouseEvent('contextmenu',{button:2,bubbles:true,cancelable:true}); target.dispatchEvent(menu);"
                        "check(!menu.defaultPrevented,'native menu remains available');"
                        "check(offsets ? selection.anchorOffset===offsets[0] && selection.focusOffset===offsets[1] : selection.rangeCount===0,'original caret/range restored');"
                        "check(target.textContent==='alpha  beta' && JSON.stringify(target.getBoundingClientRect())===rect,'text and layout unchanged');"
                    "}"
                "}"
                "const left=new MouseEvent('mousedown',{button:0,bubbles:true,cancelable:true}); target.dispatchEvent(left); check(!left.defaultPrevented,'left selection allowed');"
                "selection.setBaseAndExtent(text,1,text,4);"
                "target.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));"
                "check(selection.anchorOffset===1 && selection.focusOffset===4,'keyboard menu preserves selection');"
            "}"
            "const outside=new MouseEvent('mousedown',{button:2,bubbles:true,cancelable:true}); document.getElementById('outside').dispatchEvent(outside); check(!outside.defaultPrevented,'other fields unchanged');"
            "return true;"
        "})()";
        __block BOOL selectionFinished = NO;
        __block BOOL selectionPassed = NO;
        [view evaluateJavaScript:selectionChecks completionHandler:^(id result, NSError *error) {
            if (error) fprintf(stderr, "%s\n", error.description.UTF8String);
            selectionPassed = !error && [result boolValue];
            selectionFinished = YES;
        }];
        assert(waitUntil(^BOOL { return selectionFinished; }));
        assert(selectionPassed);
        [view evaluateJavaScript:@"ContextMenuSelection.testLinkBoundary().then(() => window.linkBoundaryResult='passed', error => window.linkBoundaryResult=String(error))" completionHandler:nil];
        __block NSString *linkBoundaryResult = nil;
        assert(waitUntil(^BOOL {
            if (!linkBoundaryResult) [view evaluateJavaScript:@"window.linkBoundaryResult ?? null" completionHandler:^(id result, NSError *error) {
                if (!error && [result isKindOfClass:NSString.class]) linkBoundaryResult = result;
            }];
            return linkBoundaryResult != nil;
        }));
        if (![linkBoundaryResult isEqualToString:@"passed"]) fprintf(stderr, "%s\n", linkBoundaryResult.UTF8String);
        assert([linkBoundaryResult isEqualToString:@"passed"]);
        for (NSUInteger round = 0; round < 3; round++) {
            [window setContentSize:NSMakeSize(1400, 900)];
            assert(NSEqualSizes(view.frame.size, NSMakeSize(1400, 900)));
            [window setContentSize:NSMakeSize(800, 600)];
            assert(NSEqualSizes(view.frame.size, NSMakeSize(800, 600)));
        }
        NSMenu *menu = [NSMenu new];
        NSMenuItem *copy = [[NSMenuItem alloc] initWithTitle:@"Copy" action:@selector(copy:) keyEquivalent:@""];
        copy.target = view;
        [menu addItem:copy];
        NSMenuItem *speech = [[NSMenuItem alloc] initWithTitle:@"Speech" action:nil keyEquivalent:@""];
        speech.submenu = [NSMenu new];
        [speech.submenu addItemWithTitle:@"Start Speaking" action:@selector(startSpeaking:) keyEquivalent:@""];
        [menu addItem:speech];
        NSEvent *event = [NSEvent mouseEventWithType:NSEventTypeRightMouseDown location:NSMakePoint(30, 40) modifierFlags:0 timestamp:0 windowNumber:0 context:nil eventNumber:0 clickCount:1 pressure:1];
        [view willOpenMenu:menu withEvent:event];
        assert(waitUntil(^BOOL { return menu.itemArray.lastObject.submenu.numberOfItems == 2; }));
        assert([copy.title isEqualToString:@"複製"]);
        assert(copy.target == view && copy.action == @selector(copy:));
        assert([speech.title isEqualToString:@"語音"]);
        assert([speech.submenu.itemArray.firstObject.title isEqualToString:@"開始朗讀"]);
        NSMenu *files = menu.itemArray.lastObject.submenu;
        assert([menu.itemArray.lastObject.title isEqualToString:@"插入檔案"]);
        assert([files.itemArray.firstObject.title isEqualToString:@"中文.md"]);
        [files performActionForItemAtIndex:1];
        __block BOOL inserted = NO;
        assert(waitUntil(^BOOL {
            if (!inserted) [view evaluateJavaScript:@"JSON.stringify(window.result)" completionHandler:^(id result, NSError *error) { inserted = !error && [result isEqual:@"[1,1]"]; }];
            return inserted;
        }));
        WKWebView *plainView = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 800, 600) configuration:configuration];
        NSMenu *plainMenu = [NSMenu new];
        [plainMenu addItemWithTitle:@"Copy" action:@selector(copy:) keyEquivalent:@""];
        [plainView willOpenMenu:plainMenu withEvent:event];
        assert(plainMenu.numberOfItems == 1);
        assert([plainMenu.itemArray.firstObject.title isEqualToString:@"Copy"]);
        puts("native resize/restore, unchanged view classes, menu translation and file selection: PASS");
    }
    return 0;
}
