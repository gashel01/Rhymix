import React, { useCallback, useEffect, useMemo, useState } from "react";

import "./tokens.css";
import "./shell.css";

import { PlayerProvider, usePlayer, formatTime } from "./player";
import { ToastProvider, useToasts, timeAgo } from "./toasts";
import Menu, { MenuItem, MenuSeparator } from "./components/Menu";
import useIsMobile from "./useIsMobile";
import SystemStatus from "./components/SystemStatus";
import MasterFader from "./components/MasterFader";
import {
  LibraryIcon,
  CreateIcon,
  VoiceIcon,
  TrainIcon,
  SpeakerIcon,
  StudioIcon,
  SettingsIcon,
  SearchIcon,
  MoreIcon,
} from "./icons";

import LibraryView from "./views/LibraryView";
import VoicesView from "./views/VoicesView";
import TrainView from "./views/TrainView";
import SpeakersView from "./views/SpeakersView";
import SettingsView from "./views/SettingsView";
import StudioView from "./views/StudioView";

/**
 * The new UI, as a whole.
 *
 * It mounts at /next and replaces the MUI shell rather than living inside it —
 * the two have incompatible ideas about layout, spacing and colour, and nesting
 * them would mean fighting MUI's resets on every view. The legacy app is
 * untouched and still the default; this is opt-in until every view here has
 * been confirmed to work against the real backend.
 */

const VIEWS = [
  { id: "library", label: "Library", Icon: LibraryIcon, group: null, Component: LibraryView },
  // Create is the same workspace with its writing column open, not a page of
  // its own — so starting a track never takes the library off screen.
  { id: "create", label: "Create", Icon: CreateIcon, group: null, Component: LibraryView },
  { id: "studio", label: "Studio", Icon: StudioIcon, group: null, Component: StudioView },
  { id: "voices", label: "My voices", Icon: VoiceIcon, group: "Voices", Component: VoicesView },
  { id: "train", label: "Train", Icon: TrainIcon, group: null, Component: TrainView },
  { id: "speakers", label: "Speakers", Icon: SpeakerIcon, group: "Tools", Component: SpeakersView },
  { id: "settings", label: "Settings", Icon: SettingsIcon, group: "System", Component: SettingsView },
];

const DEFAULT_VIEW = "library";

// Applied to whichever of Studio's persistent bits (its view, its transport
// slot) isn't the one currently on screen — `display: none` costs nothing
// (no paint, no layout) but, unlike unmounting, doesn't touch what's running
// underneath it: an AudioContext and a requestAnimationFrame loop are both
// indifferent to an ancestor's CSS display.
const HIDDEN_STYLE = { display: "none" };

// Speakers still routes (a stored #speakers link keeps working) but earns no
// spot in the rail or the mobile "More" menu - nothing here actually uses it.
const HIDDEN_FROM_NAV = ["speakers"];
const NAV_VIEWS = VIEWS.filter((view) => !HIDDEN_FROM_NAV.includes(view.id));

// What fits in the bottom bar of a phone, in the order it appears there.
// Create sits in the middle because it is the one thing you came to do; the
// rest lives behind More, along with what you set once and forget.
const PRIMARY_VIEWS = ["library", "voices", "create", "train"];

// Every other view is a bare id in the hash (`#library`). Studio is the one
// exception: it also carries which project to open, so its hash looks like
// `#studio/<assetId>?projectId=<id>` — a path segment plus a query string,
// both optional. Splitting on "/" before matching against VIEWS is what lets
// `#studio/abc123` still resolve to the "studio" nav entry instead of falling
// through to the default view.
const readView = (hash) => {
  const id = String(hash || "").replace(/^#/, "").split("?")[0].split("/")[0];
  return VIEWS.some((view) => view.id === id) ? id : DEFAULT_VIEW;
};

const readStudioRoute = (hash) => {
  const raw = String(hash || "").replace(/^#/, "");
  const [pathPart, query] = raw.split("?");
  const segments = pathPart.split("/");
  if (segments[0] !== "studio") return { assetId: null, projectId: null };
  const assetId = segments[1] ? decodeURIComponent(segments[1]) : null;
  const params = new URLSearchParams(query || "");
  return { assetId, projectId: params.get("projectId") || null };
};

/**
 * The notification list, in the top bar.
 *
 * It replaces the toasts that used to slide in at the bottom right. A toast
 * that has faded is unrecoverable: a job that failed while you were reading
 * lyrics left nothing behind, and there was nowhere in the interface to find
 * out what happened. Opening this marks everything read.
 */
function Notifications() {
  const { items, unread, markSeen, clear } = useToasts();

  return (
    <span className="rx-notif" data-unread={unread > 0 ? "" : undefined}>
      <Menu
        className="rx-iconbtn"
        label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        trigger={
          <>
            <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true">
              <path d="M12 2.6a6 6 0 0 1 6 6v3.6l1.6 3.1a1 1 0 0 1-.9 1.5H5.3a1 1 0 0 1-.9-1.5L6 12.2V8.6a6 6 0 0 1 6-6zM9.6 18.6h4.8a2.4 2.4 0 0 1-4.8 0z" />
            </svg>
            {unread > 0 && <span className="rx-notif-dot">{unread > 9 ? "9+" : unread}</span>}
          </>
        }
      >
        {() => (
          <div className="rx-notif-list" onAnimationStart={markSeen}>
            <div className="mlabel rx-notif-head">
              Notifications
              {items.length > 0 && (
                <button type="button" className="rx-notif-clear" onClick={clear}>
                  Clear
                </button>
              )}
            </div>
            {items.length === 0 ? (
              <div className="rx-notif-empty hint">Nothing yet.</div>
            ) : (
              items.map((item) => (
                <div className="rx-notif-item" key={item.id} data-kind={item.kind}>
                  <span>{item.text}</span>
                  <em>{timeAgo(item.at)}</em>
                </div>
              ))
            )}
          </div>
        )}
      </Menu>
    </span>
  );
}

function PlayerBar({ onGoToPlaying, hidden = false }) {
  const player = usePlayer();
  const onSeek = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    player.seek((event.clientX - rect.left) / rect.width);
  };

  return (
    <div className="rx-player" style={hidden ? HIDDEN_STYLE : undefined}>
      {/* The tile and title are the one place in the whole bar that names
          what is playing, so they are also where "find it" belongs — no
          separate icon competing for the same 78px of height. Disabled with
          nothing loaded rather than hidden, so the bar's width never jumps
          the moment something starts. */}
      <button
        type="button"
        className="np"
        onClick={() => onGoToPlaying && onGoToPlaying(player.sourceId)}
        disabled={!player.sourceId}
        title={player.sourceId ? "Show this track in the library" : undefined}
      >
        <span
          className="tile"
          style={
            player.cover
              ? { background: `url(${player.cover}) center / cover, ${player.tint || "var(--card-3)"}` }
              : player.tint
              ? { background: player.tint }
              : undefined
          }
        />
        <span className="tx">
          <b>{player.title || "Nothing playing"}</b>
          <span>{player.subtitle || "Pick a track to start"}</span>
        </span>
      </button>
      <button
        type="button"
        className="rx-playbtn"
        onClick={player.toggle}
        disabled={!player.url}
        aria-label={player.playing ? "Pause" : "Play"}
      >
        {player.playing ? (
          <svg viewBox="0 0 24 24">
            <rect x="6" y="4.5" width="4.2" height="15" rx="1.5" />
            <rect x="13.8" y="4.5" width="4.2" height="15" rx="1.5" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24">
            <path d="M8 5.2v13.6c0 .9 1 1.4 1.7.9l10.1-6.8a1.1 1.1 0 0 0 0-1.8L9.7 4.3A1.1 1.1 0 0 0 8 5.2z" />
          </svg>
        )}
      </button>
      <div className="seek">
        <span className="t">{formatTime(player.position)}</span>
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
        <div className="bar" onClick={onSeek} role="presentation">
          <i style={{ width: `${Math.round(player.progress * 100)}%` }} />
        </div>
        <span className="t">{formatTime(player.duration)}</span>
      </div>
    </div>
  );
}

function Shell() {
  const [view, setView] = useState(() => readView(window.location.hash));
  const [studioRoute, setStudioRoute] = useState(() => readStudioRoute(window.location.hash));
  const [search, setSearch] = useState("");
  // A sourceId handed down from the player bar to whichever view can actually
  // resolve it — only the library knows which row a take belongs to. Cleared
  // by that view once it has used it, so the same click does not re-fire the
  // jump on every later re-render.
  const [playingJump, setPlayingJump] = useState(null);
  // Same one-shot handoff as playingJump, for a view that wants to land
  // somewhere else pre-loaded with a choice already made — Voices sending
  // "write a song with this voice in mind" or "convert this track" over to
  // Create/Library rather than acting on it itself. Cleared by whichever
  // view consumes it, so it never re-fires on a later re-render.
  const [pendingAction, setPendingAction] = useState(null);
  const [theme, setTheme] = useState(
    () => window.localStorage.getItem("rx-theme") || "dark"
  );

  useEffect(() => {
    const onHash = () => {
      const nextView = readView(window.location.hash);
      setView(nextView);
      // Studio stays mounted in the background once visited (see
      // `studioMounted` below), so its route must not get clobbered by
      // navigating elsewhere — a hash like "#library" parses to
      // {assetId:null, projectId:null}, which would otherwise reset the
      // still-running Studio instance to a blank project the moment you
      // left it.
      if (nextView === "studio") {
        setStudioRoute(readStudioRoute(window.location.hash));
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("rx-theme", theme);
    // The canvas waveforms watch documentElement for this, because a theme flip
    // changes what their tint resolves to without re-rendering React.
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // `id` is usually a bare view id ("library"), but the studio view also
  // accepts its route in the same string ("studio/<assetId>?projectId=..."),
  // same shape readStudioRoute parses back out of the hash.
  const go = useCallback((id, action) => {
    window.location.hash = id;
    const nextView = readView(`#${id}`);
    setView(nextView);
    // Same guard as the hashchange listener above: only a real navigation
    // into Studio should update its route.
    if (nextView === "studio") {
      setStudioRoute(readStudioRoute(`#${id}`));
    }
    if (action !== undefined) setPendingAction(action);
  }, []);

  const active = useMemo(() => VIEWS.find((v) => v.id === view) || VIEWS[0], [view]);
  const ActiveView = active.Component;
  const isStudioView = view === "studio";
  // Studio's audio engine (useStudioPlayback) and its master fader should
  // keep running once the user has opened it, even after navigating to
  // another view — see the "volume controls should stay available always"
  // request. Swapping `ActiveView` on every nav click would unmount it like
  // any other view, tearing down its AudioContext and every scheduled
  // source. Instead, once Studio has been visited, it stays mounted for the
  // rest of the session and is only hidden (not unmounted) when some other
  // view is on screen.
  const [studioMounted, setStudioMounted] = useState(isStudioView);
  useEffect(() => {
    if (isStudioView) setStudioMounted(true);
  }, [isStudioView]);
  const mobile = useIsMobile();
  const railViews = useMemo(
    () =>
      mobile
        ? PRIMARY_VIEWS.map((id) => NAV_VIEWS.find((item) => item.id === id)).filter(Boolean)
        : NAV_VIEWS,
    [mobile]
  );
  const moreViews = useMemo(
    () => NAV_VIEWS.filter((item) => !PRIMARY_VIEWS.includes(item.id)),
    []
  );

  return (
    <div className="rx" data-theme={theme}>
      <div className="rx-shell">
        <header className="rx-topbar">
          <div className="rx-brand">
            Rhy<span>mix</span>
          </div>
          <span className="rx-sp" />
          {/* Searches tracks and voices — neither exists as a concept inside
              a single Studio project, so the field has nothing to do there.
              Studio's own "Search assets" field (LibraryPanel) reuses this
              same component instead. */}
          {view !== "studio" && (
            <div className="rx-search">
              <SearchIcon className="ic" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={mobile ? "Search" : "Search your tracks and voices"}
                aria-label="Search"
              />
            </div>
          )}
          <span className="rx-sp" />
          <Notifications />
          <button
            type="button"
            className="rx-iconbtn"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            title={theme === "dark" ? "Light theme" : "Dark theme"}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </header>

        <nav className="rx-rail" aria-label="Sections">
          {railViews.map((item) => (
            <React.Fragment key={item.id}>
              {!mobile && item.group && <div className="sect">{item.group}</div>}
              <button
                type="button"
                className="rx-nav"
                // The one action, not one destination among five.
                data-cta={mobile && item.id === "create" ? "" : undefined}
                aria-current={item.id === view ? "page" : undefined}
                onClick={() => go(item.id)}
              >
                <item.Icon />
                <span className="rx-nav-lab">{item.label}</span>
              </button>
            </React.Fragment>
          ))}
          {mobile ? (
            <Menu
              className="rx-nav"
              label="More"
              trigger={
                <>
                  <MoreIcon />
                  <span className="rx-nav-lab">More</span>
                </>
              }
            >
              {(close) => (
                <>
                  {moreViews.map((item) => (
                    <MenuItem
                      key={item.id}
                      checked={item.id === view}
                      onSelect={() => go(item.id)}
                      close={close}
                    >
                      {item.label}
                    </MenuItem>
                  ))}
                  <MenuSeparator />
                  <MenuItem
                    onSelect={() => setTheme(theme === "dark" ? "light" : "dark")}
                    close={close}
                  >
                    {theme === "dark" ? "Light theme" : "Dark theme"}
                  </MenuItem>
                  {/* The one readout that decides whether the next job runs.
                      There is no room for it in a bottom bar, and it is a
                      system thing, so it sits with the other system things. */}
                  <SystemStatus />
                </>
              )}
            </Menu>
          ) : (
            <div className="foot">
              {/* The one volume/pan control for the whole app (masterAudio.js)
                  — always mounted here, not just once Studio has been opened,
                  so it's reachable from every view including before Studio
                  has ever run. Above the VRAM readout, not below it — the
                  fader is something you reach for, the VRAM number is
                  something you glance at. */}
              <MasterFader />
              <SystemStatus />
            </div>
          )}
        </nav>

        <main className="rx-main" data-studio={isStudioView ? "" : undefined}>
          {!isStudioView && ActiveView ? (
            <ActiveView
              search={search}
              onNavigate={go}
              showCreate={view === "create"}
              playingJump={playingJump}
              onPlayingJumped={() => setPlayingJump(null)}
              pendingAction={pendingAction}
              onPendingActionHandled={() => setPendingAction(null)}
            />
          ) : null}
          {/* Kept mounted for the rest of the session once first opened, instead
              of unmounting like every other view on a nav click — that's what
              lets its AudioContext keep playing and its master fader keep
              responding while you're looking at Library or Train. Hidden with
              `display: none` rather than removed, which costs nothing extra:
              CSS visibility has no effect on a running AudioContext or a
              requestAnimationFrame loop, only on paint. */}
          {studioMounted ? (
            <div className="rx-studio-persist" style={isStudioView ? undefined : HIDDEN_STYLE}>
              <StudioView
                assetId={studioRoute.assetId}
                projectId={studioRoute.projectId}
                onNavigate={go}
                active={isStudioView}
              />
            </div>
          ) : null}
        </main>

        {/* Both bars stay permanently mounted at the same grid cell (see
            `.rx-player { grid-row: 3 }` in shell.css) and CSS decides which
            one is visible, rather than NextApp swapping one for the other —
            swapping would destroy and recreate #rx-studio-player-slot every
            time you left and returned to Studio, leaving the transport
            StudioView already portaled into the old (now-detached) node. */}
        <div className="rx-player" id="rx-studio-player-slot" style={isStudioView ? undefined : HIDDEN_STYLE} />
        <PlayerBar
          hidden={isStudioView}
          onGoToPlaying={(sourceId) => {
            if (!sourceId) return;
            setPlayingJump(sourceId);
            go("library");
          }}
        />
      </div>
    </div>
  );
}

export default function NextApp() {
  return (
    <ToastProvider>
      <PlayerProvider>
        <Shell />
      </PlayerProvider>
    </ToastProvider>
  );
}
