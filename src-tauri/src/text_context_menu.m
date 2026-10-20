#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

static char controllerKey;
static IMP originalWillOpenMenu;

// Keep WebKit's original actions, validation, spelling suggestions and Services.
static void translateTextMenu(NSMenu *menu) {
    NSDictionary *labels = @{
        @"Cut": @"剪下", @"Copy": @"複製", @"Paste": @"貼上",
        @"Paste and Match Style": @"貼上並符合樣式", @"Delete": @"刪除",
        @"Select All": @"全選", @"Undo": @"復原", @"Redo": @"重做",
        @"Spelling and Grammar": @"拼字與文法", @"Show Spelling and Grammar": @"顯示拼字與文法",
        @"Check Document Now": @"立即檢查文件", @"Check Spelling While Typing": @"輸入時檢查拼字",
        @"Check Grammar With Spelling": @"隨拼字檢查文法", @"Correct Spelling Automatically": @"自動更正拼字",
        @"Learn Spelling": @"記住拼字", @"Ignore Spelling": @"忽略拼字", @"No Guesses Found": @"找不到建議字詞",
        @"Substitutions": @"替代項目", @"Show Substitutions": @"顯示替代項目",
        @"Smart Copy/Paste": @"智慧型複製／貼上", @"Smart Quotes": @"智慧型引號",
        @"Smart Dashes": @"智慧型破折號", @"Smart Links": @"智慧型連結",
        @"Data Detectors": @"資料偵測器", @"Text Replacement": @"文字替代",
        @"Transformations": @"文字轉換", @"Make Upper Case": @"轉成大寫",
        @"Make Lower Case": @"轉成小寫", @"Capitalize": @"字首大寫",
        @"Speech": @"語音", @"Start Speaking": @"開始朗讀", @"Stop Speaking": @"停止朗讀",
        @"Writing Direction": @"書寫方向", @"Paragraph Direction": @"段落方向",
        @"Selection Direction": @"選取範圍方向", @"Default": @"預設",
        @"Left to Right": @"由左至右", @"Right to Left": @"由右至左",
        @"Font": @"字體", @"Bold": @"粗體", @"Italic": @"斜體", @"Underline": @"底線",
        @"Outline": @"外框", @"Styles": @"樣式", @"Show Fonts": @"顯示字體",
        @"Open Link": @"開啟連結", @"Open Link in New Window": @"在新視窗開啟連結",
        @"Download Linked File": @"下載連結檔案", @"Copy Link": @"複製連結",
        @"Copy Link Address": @"複製連結位址", @"Search the Web": @"搜尋網路",
        @"Search with Google": @"使用 Google 搜尋", @"Search with Google…": @"使用 Google 搜尋…",
        @"Share": @"分享", @"Services": @"服務", @"Writing Tools": @"寫作工具",
        @"Inspect Element": @"檢查元素", @"Translate": @"翻譯"
    };
    for (NSMenuItem *item in menu.itemArray) {
        NSString *title = item.title;
        NSString *plain = [title stringByTrimmingCharactersInSet:[NSCharacterSet characterSetWithCharactersInString:@".…"]];
        NSString *translation = labels[title] ?: labels[plain];
        if (translation) {
            item.title = (translation == labels[plain] && ![plain isEqualToString:title])
                ? [translation stringByAppendingString:@"…"] : translation;
        } else if ([title hasPrefix:@"Look Up "]) {
            item.title = [@"查詢 " stringByAppendingString:[title substringFromIndex:8]];
        } else if ([title hasPrefix:@"Translate "]) {
            item.title = [@"翻譯 " stringByAppendingString:[title substringFromIndex:10]];
        }
        if (item.submenu) translateTextMenu(item.submenu);
    }
}

@interface ScholiumTextMenuController : NSObject <WKScriptMessageHandler>
@property(nonatomic, weak) WKWebView *webView;
@property(nonatomic, strong) NSMenu *fileMenu;
@property(nonatomic, strong) NSNumber *request;
@end

@implementation ScholiumTextMenuController
- (void)insertFile:(NSMenuItem *)sender {
    NSArray *selection = sender.representedObject;
    if (![selection isKindOfClass:NSArray.class] || selection.count != 2) return;
    NSString *script = [NSString stringWithFormat:@"window.__scholiumTextMenu?.insert(%@,%@)", selection[0], selection[1]];
    [self.webView evaluateJavaScript:script completionHandler:nil];
}

- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
    if (!message.frameInfo.mainFrame || ![message.body isKindOfClass:NSDictionary.class]) return;
    NSDictionary *result = message.body;
    if (![result[@"request"] isEqual:self.request]) return;
    [self.fileMenu removeAllItems];
    NSArray *names = [result[@"names"] isKindOfClass:NSArray.class] ? result[@"names"] : @[];
    if (!names.count) {
        NSString *text = [result[@"message"] isKindOfClass:NSString.class] ? result[@"message"] : @"同一目錄沒有其他檔案";
        NSMenuItem *empty = [[NSMenuItem alloc] initWithTitle:text action:nil keyEquivalent:@""];
        empty.enabled = NO;
        [self.fileMenu addItem:empty];
    }
    [names enumerateObjectsUsingBlock:^(id name, NSUInteger index, BOOL *stop) {
        (void)stop;
        if (![name isKindOfClass:NSString.class]) return;
        NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:name action:@selector(insertFile:) keyEquivalent:@""];
        item.target = self;
        item.representedObject = @[self.request, @(index)];
        [self.fileMenu addItem:item];
    }];
    [self.fileMenu.supermenu update];
}

- (void)prepareMenu:(NSMenu *)menu event:(NSEvent *)event {
    WKWebView *webView = self.webView;
    NSPoint point = [webView convertPoint:event.locationInWindow fromView:nil];
    CGFloat y = webView.isFlipped ? point.y : webView.bounds.size.height - point.y;
    NSString *script = [NSString stringWithFormat:@"window.__scholiumTextMenu?.prepare(%f,%f) ?? null", point.x, y];
    [webView evaluateJavaScript:script completionHandler:^(id result, NSError *error) {
        if (error || ![result isKindOfClass:NSDictionary.class] || ![result[@"request"] isKindOfClass:NSNumber.class]) return;
        translateTextMenu(menu);
        self.request = result[@"request"];
        NSMenu *files = [[NSMenu alloc] initWithTitle:@"插入檔案"];
        files.autoenablesItems = NO;
        NSMenuItem *placeholder = [[NSMenuItem alloc] initWithTitle:result[@"message"] ?: @"正在讀取檔案…" action:nil keyEquivalent:@""];
        placeholder.enabled = NO;
        [files addItem:placeholder];
        self.fileMenu = files;
        [menu addItem:NSMenuItem.separatorItem];
        NSMenuItem *insert = [[NSMenuItem alloc] initWithTitle:@"插入檔案" action:nil keyEquivalent:@""];
        insert.submenu = files;
        [menu addItem:insert];
        if (![result[@"canInsert"] boolValue]) return;
        NSString *load = [NSString stringWithFormat:@"window.__scholiumTextMenu.files(%@).then(result => window.webkit.messageHandlers.scholiumFileMenu.postMessage(result))", self.request];
        [webView evaluateJavaScript:load completionHandler:nil];
    }];
}
@end

static void willOpenTextMenu(id view, SEL selector, NSMenu *menu, NSEvent *event) {
    ((void (*)(id, SEL, NSMenu *, NSEvent *))originalWillOpenMenu)(view, selector, menu, event);
    ScholiumTextMenuController *controller = objc_getAssociatedObject(view, &controllerKey);
    [controller prepareMenu:menu event:event];
}

void scholium_install_text_context_menu(void *pointer) {
    WKWebView *view = (__bridge WKWebView *)pointer;
    if (objc_getAssociatedObject(view, &controllerKey)) return;
    // AppKit's dynamic properties depend on the existing view class during resize.
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        Class target = WKWebView.class;
        SEL selector = @selector(willOpenMenu:withEvent:);
        Method method = class_getInstanceMethod(target, selector);
        originalWillOpenMenu = method_getImplementation(method);
        if (!class_addMethod(target, selector, (IMP)willOpenTextMenu, method_getTypeEncoding(method))) {
            class_replaceMethod(target, selector, (IMP)willOpenTextMenu, method_getTypeEncoding(method));
        }
    });
    ScholiumTextMenuController *controller = [ScholiumTextMenuController new];
    controller.webView = view;
    objc_setAssociatedObject(view, &controllerKey, controller, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    [view.configuration.userContentController addScriptMessageHandler:controller name:@"scholiumFileMenu"];
}
