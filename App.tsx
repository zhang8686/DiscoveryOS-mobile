import { effect, Image, mount, Overlay, Scroll, signal, Storage, Text, untracked, View, windowSize, type JSX, type ViewRef } from "nsh";
import { Input } from "nsh/base";
import { currentUser, currentUserUid, loadLoginQuestions, login, logout, restoreSession } from "./src/discuz/client";
import { avatarUrlForUid } from "./src/discuz/avatarUrl";
import { loadProfile } from "./src/discuz/forum";
import type { Profile } from "./src/discuz/parse";
import { clearCredentials, loadCredentials, saveCredentials } from "./src/discuz/credentials";
import { hasSavedCookies, reloadCookies } from "./src/discuz/cookies";
import { initVault } from "./src/discuz/vault";
import { ImageViewer, viewerOpen } from "./src/ui/imageViewer";
import { Forum } from "./src/ui/Forum";
import { notify, Toaster } from "./src/ui/toast";
import { ThemeIcon } from "./src/ui/icons";
import { SettingsSheet } from "./src/ui/SettingsSheet";
import { PROFILE_ROWS } from "./src/ui/ProfileSheet";
import { GearIcon } from "./src/ui/icons";
import { keyboardInset } from "./src/ui/keyboard";
import { appearanceMode, appearanceName, cycleAppearance, palette, restoreAppearance } from "./src/ui/appearance";
import { CookieImportDialog, cookieImportOpen, setOnCookiesImported } from "./src/ui/CookieImport";
import { AboutDialog, aboutOpen } from "./src/ui/AboutDialog";
import { debugEnabled } from "./src/debugLog";

// Port of `LoginView` (`Views/MainView.swift`) and `CurrentUserStore`: the forum is
// shown to everyone; the session is restored on launch from the saved cookies, then
// the saved password. Signing in is a dialog opened from the account row.

// `secondary` is the quiet choice beside a primary one (Cancel): an outlined surface
// instead of the solid button color, so the primary action is the one that stands out.
function Button(props: { label: string; disabled?: boolean; secondary?: boolean; onPress: () => void }) {
  const secondary = props.secondary === true;
  return (
    <View
      onPress={props.disabled ? undefined : props.onPress}
      style={{
        backgroundColor: secondary ? palette().surface : props.disabled ? palette().buttonDisabled : palette().button,
        borderWidth: secondary ? 1 : 0,
        borderColor: palette().border,
        borderRadius: 8,
        paddingVertical: 8,
        paddingHorizontal: 16,
        alignItems: "center",
      }}
    >
      <Text
        style={{
          color: secondary ? palette().text : palette().buttonText,
          fontSize: 14,
        }}
      >
        {props.label}
      </Text>
    </View>
  );
}

// The account row's theme control.

function IconButton(props: { icon: JSX.Element; title: string; disabled?: boolean; onPress: () => void }) {
  return (
    <View
      onPress={props.disabled ? undefined : props.onPress}
      accessibilityLabel={props.title}
      style={{
        width: 34,
        height: 34,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "transparent",
      }}
    >
      {props.icon}
    </View>
  );
}

// Discuz's usual security questions, used until the login page's own list arrives.
const DEFAULT_LOGIN_QUESTIONS = [
  { id: 0, text: "安全提问（未设置请忽略）" },
  { id: 1, text: "母亲的名字" },
  { id: 2, text: "爷爷的名字" },
  { id: 3, text: "父亲出生的城市" },
  { id: 4, text: "您其中一位老师的名字" },
  { id: 5, text: "您个人计算机的型号" },
  { id: 6, text: "您最喜欢的餐馆名称" },
  { id: 7, text: "驾驶执照最后四位数字" },
];

function MenuRow(props: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
      <Text style={{ fontSize: 12, color: palette().muted }}>{props.label}</Text>
      <Text style={{ fontSize: 12, color: palette().text }}>{props.value}</Text>
    </View>
  );
}

// A row the account menu acts on.
function MenuAction(props: { label: string; onPress: () => void }) {
  return (
    <View
      onPress={props.onPress}
      accessibilityLabel={props.label}
      style={{ paddingVertical: 10, paddingHorizontal: 6, marginHorizontal: -6, borderRadius: 6 }}
    >
      <Text style={{ fontSize: 13, color: palette().text }}>{props.label}</Text>
    </View>
  );
}


function App() {
  // Nothing touches the network until the saved cookies are back in memory.
  const ready = signal(false);
  // True while the saved session is being restored. The forum waits for the answer before it asks
  // for the channel list, so a launch loads the boards once, as a member, instead of twice: once
  // signed out and again a moment later.
  const restoring = signal(true);
  const user = signal<string | null>(currentUser());
  const name = signal("");
  const pass = signal("");
  const busy = signal(false);
  // The security question a member may have set: 0 is none (Discuz's "未设置请忽略").
  const questionId = signal(0);
  const answer = signal("");
  const questionsOpen = signal(false);
  const questions = signal(DEFAULT_LOGIN_QUESTIONS);
  const avatar = signal<string | null>(null);
  // The sign-in dialog, opened from the blank avatar while signed out.
  const dialogOpen = signal(false);
  // The account menu, opened from the avatar while signed in: the profile's fields and sign-out.
  // `avatarNode` is the avatar's node: the menu's overlay is placed against it, and sits above the
  // whole window (a sibling column drawn later would otherwise cover a menu that is only absolute).
  const menuOpen = signal(false);
  const profile = signal<Profile | null>(null);
  const avatarNode = signal<ViewRef | null>(null);
  // The sign-out confirmation, opened from the menu's Sign Out.
  const confirmOpen = signal(false);
  // The display settings panel, opened from the gear between the account and the theme.
  const settingsOpen = signal(false);

  function refreshProfile(name: string) {
    loadProfile(name)
      .then((p) => {
        avatar.set(p.avatar ?? null);
        profile.set(p);
      })
      .catch(() => {
        // No profile to show: the menu stops saying it is loading, and shows only Sign Out.
        avatar.set(null);
        profile.set({});
      });
  }

  // `askForum` is false when the name is already known and only the avatar is wanted: the uid's
  // static address is enough, and the profile page is left for the account menu.
  function showProfile(name: string, askForum = true) {
    user.set(name);
    // Remembered so the next launch shows the account at once, without waiting for the forum.
    Storage.setItem("visual:lastUser", name).catch(() => undefined);
    if (askForum) {
      refreshProfile(name);
      return;
    }
    const known = avatarUrlForUid(currentUserUid() ?? undefined);
    if (known) avatar.set(known);
    else refreshProfile(name);
  }

  function openMenu() {
    menuOpen.set(true);
    refreshProfile(user() ?? "");
  }

  function closeMenu() {
    menuOpen.set(false);
  }

  async function signIn() {
    busy.set(true);
    try {
      const ok = await login(name(), pass(), questionId(), answer());
      if (ok) {
        saveCredentials({ name: name(), pass: pass() });
        showProfile(name());
        pass.set("");
        answer.set("");
        dialogOpen.set(false);
      } else {
        notify("sign-in", "登录失败。");
      }
    } catch (e) {
      notify("sign-in", `登录失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      busy.set(false);
    }
  }

  async function signOut() {
    busy.set(true);
    try {
      await logout();
    } catch {
      // The local session ends either way; the server's answer is not needed.
    }
    clearCredentials();
    avatar.set(null);
    profile.set(null);
    menuOpen.set(false);
    user.set(null);
    Storage.removeItem("visual:lastUser").catch(() => undefined);
    name.set("");
    pass.set("");
    busy.set(false);
  }

  restoreAppearance();

  // Restores the session: the saved cookies first, then the saved password. Only a
  // refused password clears what is saved. The dialog is opened by tapping the empty avatar,
  // not here. Runs on launch and after a cookie import.
  function restoreLogin() {
    const saved = loadCredentials();
    busy.set(true);
    restoreSession(saved)
      .then((state) => {
        if (state === "signed-in") {
          // The session page already named the member and the uid: the avatar comes from the uid
          // at once, without a second request for the profile page.
          showProfile(currentUser() ?? saved?.name ?? "", false);
          dialogOpen.set(false);
        }
        else if (state === "signed-out") {
          if (saved) clearCredentials();
        } else if (state === "offline") notify("restore", "当前离线，已保留已保存的登录信息。");
      })
      .catch((e) => notify("restore", `恢复登录失败：${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        busy.set(false);
        restoring.set(false);
      });
  }

  // Debug: an import of cookies signs in with them at once.
  setOnCookiesImported(restoreLogin);

  // The window opens at once: the vault (an encrypted cookie store) is read in the background and
  // the session restored after it, instead of holding the first screen until the forum answers.
  ready.set(true);
  // The last account shows in the corner at once; the session check follows and corrects it.
  // Only while that check is still pending: if it has already decided "signed out", a late read of
  // the old name must not put the app back into a signed-in-looking state with no session.
  Storage.getItem("visual:lastUser")
    .then((saved: string | null) => { if (saved && restoring() && !user()) user.set(saved); })
    .catch(() => undefined);
  void initVault().then(() => {
    reloadCookies();
    if (hasSavedCookies()) restoreLogin();
    else restoring.set(false);
  });

  // The account menu, above the avatar: the signed-in user's profile fields, then Sign Out.
  // Fields the page lacks are left out; until the profile arrives the menu says it is loading.
  const accountMenu = (): JSX.Element => {
    const p = profile();
    return (
      <View
        style={{
          width: 240,
          padding: 12,
          gap: 6,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: palette().border,
          backgroundColor: palette().surface,
        }}
      >
        <Text style={{ fontSize: 14, fontWeight: 600, color: palette().text }}>{user() ?? ""}</Text>
        {p ? (
          <Each
            of={PROFILE_ROWS.flatMap(([label, key]) => {
              const value = p[key];
              return value ? [{ label, value }] : [];
            })}
            key={(row: { label: string; value: string }) => row.label}
          >
            {(row) => <MenuRow label={row().label} value={row().value} />}
          </Each>
        ) : (
          <Text style={{ fontSize: 12, color: palette().muted }}>加载中…</Text>
        )}
        <View style={{ height: 1, backgroundColor: palette().border, marginVertical: 4 }} />
        <MenuAction
          label="退出登录"
          onPress={() => {
            closeMenu();
            confirmOpen.set(true);
          }}
        />
      </View>
    );
  };

  // The account row and its controls sit at the bottom of the channel column,
  // as the Claude Code sidebar keeps its account at the bottom left. Signed out,
  // the row is a blank avatar that opens the sign-in dialog.
  // `compact` is the channel rail's width: the avatar, theme and sign-out stack in a column.
  const accountFooter = (compact: boolean): JSX.Element => (
    <View style={{ borderTopWidth: 1, borderColor: palette().border }}>
      <View style={{ padding: compact ? 6 : 10, flexDirection: compact ? "column" : "row", alignItems: "center", gap: 8 }}>
        {user() ? (
          <>
            {/* The avatar opens the account menu; the menu closes on a press outside it. */}
            <View
              ref={(n: ViewRef | null) => avatarNode.set(n)}
              onPress={menuOpen() ? undefined : openMenu}
              accessibilityLabel="账户菜单"
            >
              {avatar() ? (
                <Image src={avatar()!} style={{ width: 24, height: 24, borderRadius: 12 }} />
              ) : (
                <View
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: palette().border,
                    backgroundColor: palette().surface,
                  }}
                />
              )}
            </View>
            {/* An overlay, not an absolute view: it draws above the whole window, not just this column. */}
            {menuOpen() && avatarNode() ? (
              <Overlay anchor={avatarNode()} placement="top" align="start" offset={8} onPressOutside={closeMenu}>
                {accountMenu()}
              </Overlay>
            ) : null}
          </>
        ) : (
          <View
            onPress={() => dialogOpen.set(true)}
            accessibilityLabel="登录"
            style={{
              width: 24,
              height: 24,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: palette().border,
              backgroundColor: palette().surface,
            }}
          />
        )}
        {compact ? null : user() ? (
          <Text style={{ fontSize: 13, color: palette().text, flex: 1 }}>{user()!}</Text>
        ) : (
          // Signed out, the name's place reads "Sign in" and opens the same dialog as the avatar.
          <View onPress={() => dialogOpen.set(true)} accessibilityLabel="登录" style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, color: palette().text }}>登录</Text>
          </View>
        )}
        <IconButton
          icon={<GearIcon size={17} />}
          title="显示设置"
          onPress={() => settingsOpen.set(true)}
        />
        <IconButton icon={<ThemeIcon size={16} mode={appearanceMode} />} title={`Theme: ${appearanceName(appearanceMode())}`} onPress={cycleAppearance} />
      </View>
    </View>
  );

  // The forum's login page names the security questions it accepts; its list replaces the
  // client's default one when it loads. A failure keeps the default list.
  effect(() => {
    if (!dialogOpen()) return;
    untracked(() => {
      void loadLoginQuestions().then((list) => {
        if (list.length > 0) questions.set(list);
      }).catch(() => undefined);
    });
  });

  // The sign-in dialog: a panel over the forum, with Cancel and Sign in.
  const signInDialog: JSX.Element = (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0,0,0,0.35)",
      }}
    >
      <View
        style={{
          width: Math.min(320, windowSize().width - 40),
          padding: 16,
          gap: 10,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: palette().border,
          backgroundColor: palette().surface,
        }}
      >
        <Text style={{ fontSize: 15, fontWeight: 600, color: palette().text }}>账户</Text>
        <Input
          placeholder="用户名"
          value={name()}
          onChange={({ value: text }: { value: string }) => name.set(text)}
          style={{ height: 36, paddingHorizontal: 10, fontSize: 14, color: palette().text, placeholderColor: palette().muted, caretColor: palette().link, borderRadius: 8, borderWidth: 1, borderColor: palette().border, backgroundColor: palette().bg }}
        />
        <Input
          placeholder="密码"
          masked={true}
          value={pass()}
          onChange={({ value: text }: { value: string }) => pass.set(text)}
          // Return in the password field signs in, like the default button in the Swift sheet.
          onSubmit={() => {
            if (!busy() && name().length > 0 && pass().length > 0) void signIn();
          }}
          style={{ height: 36, paddingHorizontal: 10, fontSize: 14, color: palette().text, placeholderColor: palette().muted, caretColor: palette().link, borderRadius: 8, borderWidth: 1, borderColor: palette().border, backgroundColor: palette().bg }}
        />
        {/* A member who set a security question answers it here; id 0 posts none. */}
        <View
          onPress={() => questionsOpen.set(!questionsOpen())}
          accessibilityLabel="安全提问"
          style={{
            height: 30, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1,
            borderColor: palette().border, backgroundColor: palette().bg,
            flexDirection: "row", alignItems: "center", gap: 6,
          }}
        >
          <Text style={{ fontSize: 13, color: questionId() === 0 ? palette().muted : palette().text, flex: 1, numberOfLines: 1 }}>
            {questions().find((q) => q.id === questionId())?.text ?? "安全提问（未设置请忽略）"}
          </Text>
          <Text style={{ fontSize: 11, color: palette().muted }}>▾</Text>
        </View>
        {questionsOpen() ? (
          <Scroll style={{ maxHeight: 168 }} contentStyle={{ gap: 1 }}>
            <View style={{ borderRadius: 6, borderWidth: 1, borderColor: palette().border, overflow: "hidden" }}>
              {questions().map((q) => (
                <View
                  onPress={() => {
                    questionId.set(q.id);
                    if (q.id === 0) answer.set("");
                    questionsOpen.set(false);
                  }}
                  style={{ paddingVertical: 7, paddingHorizontal: 8, backgroundColor: q.id === questionId() ? palette().selected : palette().bg }}
                >
                  <Text style={{ fontSize: 12.5, color: palette().text }}>{q.text}</Text>
                </View>
              ))}
            </View>
          </Scroll>
        ) : null}
        {questionId() > 0 ? (
          <Input
            placeholder="安全提问的答案"
            value={answer()}
            onChange={({ value: text }: { value: string }) => answer.set(text)}
            style={{ height: 36, paddingHorizontal: 10, fontSize: 14, color: palette().text, placeholderColor: palette().muted, caretColor: palette().link, borderRadius: 8, borderWidth: 1, borderColor: palette().border, backgroundColor: palette().bg }}
          />
        ) : null}
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
          <Button label="取消" secondary={true} onPress={() => dialogOpen.set(false)} />
          <Button
            label={busy() ? "正在登录…" : "登录"}
            disabled={busy() || name().length === 0 || pass().length === 0}
            onPress={signIn}
          />
        </View>
      </View>
    </View>
  );

  // The sign-out confirmation: a panel over the forum, with Cancel and Sign Out.
  const signOutDialog: JSX.Element = (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0,0,0,0.35)",
      }}
    >
      <View
        style={{
          width: 280,
          padding: 16,
          gap: 10,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: palette().border,
          backgroundColor: palette().surface,
        }}
      >
        <Text style={{ fontSize: 15, fontWeight: 600, color: palette().text }}>退出登录？</Text>
        <Text style={{ fontSize: 13, color: palette().text }}>{`退出登录 ${user() ?? "此账户"}？`}</Text>
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
          <Button label="取消" secondary={true} onPress={() => confirmOpen.set(false)} />
          <Button
            label={busy() ? "正在退出…" : "退出登录"}
            disabled={busy()}
            onPress={() => {
              confirmOpen.set(false);
              signOut();
            }}
          />
        </View>
      </View>
    </View>
  );

  // The whole interface used to be one `selectable` view so every text could be copied.
  // On Android that makes NSH wrap the entire window in a `SelectableView` selection layer
  // (it captures ACTION_DOWN to start a long-press text-selection gesture). That layer sits
  // above every child and swallows the single-tap (onPress) dispatch, so buttons and thread
  // rows stop responding and taps feel "off" (only the control's non-text area still fires).
  // Selection is therefore scoped off the root; if copy is wanted later, mark the specific
  // read-only text blocks `selectable` instead of the whole window.

  return (
    <View
      style={{
        flex: 1,
        paddingTop: "env(safe-area-inset-top)",
        paddingRight: "env(safe-area-inset-right)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        alignItems: "stretch",
        justifyContent: "flex-start",
        backgroundColor: palette().bg,
      }}
    >
      <View style={{ flex: 1, alignSelf: "stretch", paddingBottom: keyboardInset() }}>
        {ready() ? (
          <Forum
            user={user}
            restoring={restoring}
            footer={(compact) => accountFooter(compact)}
            onSignInNeeded={() => dialogOpen.set(true)}
          />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 14, color: palette().muted }}>正在恢复登录状态…</Text>
          </View>
        )}
      </View>
      {dialogOpen() ? signInDialog : null}
      {confirmOpen() ? signOutDialog : null}
      {debugEnabled && cookieImportOpen() ? <CookieImportDialog /> : null}
      {aboutOpen() ? <AboutDialog /> : null}
      {/* Mounted only while a picture is shown: the read happens in this reactive
          child position, not inside the viewer's own body, or the overlay never
          appears when the viewer is opened later. */}
      {settingsOpen() ? <SettingsSheet onClose={() => settingsOpen.set(false)} /> : null}
      {viewerOpen() ? <ImageViewer /> : null}
      {/* After the viewer, so a message about saving a picture shows over it. */}
      <Toaster />

    </View>
  );
}

mount(App);
