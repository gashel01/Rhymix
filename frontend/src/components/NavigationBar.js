
import {
  Box,
  Typography,
  IconButton,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  Divider,
  Button,
  Slider,
  Collapse,
  Stack,
  alpha,
} from "@mui/material";
import ClickAwayListener from "@mui/material/ClickAwayListener";

import SettingsIcon from "@mui/icons-material/Settings";
import CloseIcon from "@mui/icons-material/Close";
import Brightness4 from "@mui/icons-material/Brightness4";
import Brightness7 from "@mui/icons-material/Brightness7";
import VolumeUp from "@mui/icons-material/VolumeUp";
import VolumeOff from "@mui/icons-material/VolumeOff";
import MenuIcon from "@mui/icons-material/Menu";

import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * NavigationBar (no MUI)
 * - Keeps your existing props + functionalities:
 *   - mobile drawer (handleDrawerToggle + drawerOpen)
 *   - desktop sidebar + collapse (sidebarCollapsed + handleSidebarToggle)
 *   - navigation items (navigationItems, currentView, handleNavigation)
 *   - settings collapse (open, setOpen)
 *   - theme toggle (handleThemeToggle, darkMode)
 *   - clean action (handleCleanDirectories, loading)
 *   - volume controls (onVolumeChange, muted, volume)
 *
 * - DOES NOT change icons/functionalities — you still pass item.icon (React nodes).
 * - Frosted iOS-like design via CSS (backdrop-filter, hairlines, shadows).
 *
 * Tip: Ensure your app has a background behind the sidebar for the frosted effect.
 */

function NavigationBar({
  theme, // kept for compatibility; not required
  darkMode,
  open,
  setOpen,
  handleThemeToggle,
  handleDrawerToggle,
  drawerOpen,
  navigationItems,
  currentView,
  handleNavigation,
  sidebarCollapsed,
  handleSidebarToggle,
  handleCleanDirectories,
  loading,
  onVolumeChange,
  muted,
  volume,
}) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia("(max-width: 599px)").matches
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(max-width: 599px)");
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);

  // Click-away for the settings popover (desktop)
  const settingsWrapRef = useRef(null);
  useEffect(() => {
    const onDown = (e) => {
      if (!open) return;
      const el = settingsWrapRef.current;
      if (!el) return;
      if (el.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open, setOpen]);

  const tokens = useMemo(() => {
    const isDark = !!darkMode;

    // iOS-ish frosted tokens
    return {
      isDark,
      sidebarW: sidebarCollapsed ? 88 : 312,
      radiusLg: 22,
      radiusMd: 16,
      radiusSm: 12,
      hairline: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)",
      text: isDark ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.90)",
      subtext: isDark ? "rgba(255,255,255,0.62)" : "rgba(0,0,0,0.55)",
      glassA: isDark ? "rgba(18,18,20,0.62)" : "rgba(255,255,255,0.72)",
      glassB: isDark ? "rgba(26,26,28,0.56)" : "rgba(248,248,250,0.78)",
      itemA: isDark ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.86)",
      itemB: isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.70)",
      hoverA: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.95)",
      hoverB: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.78)",
      shadow: isDark ? "0 18px 44px rgba(0,0,0,0.55)" : "0 18px 46px rgba(0,0,0,0.14)",
      shadowSoft: isDark ? "0 10px 24px rgba(0,0,0,0.42)" : "0 12px 26px rgba(0,0,0,0.12)",
      primary: isDark ? "rgba(10,132,255,1)" : "rgba(0,122,255,1)", // iOS blue-ish
      primaryWash: isDark ? "rgba(10,132,255,0.20)" : "rgba(0,122,255,0.16)",
      primaryWash2: isDark ? "rgba(10,132,255,0.10)" : "rgba(0,122,255,0.08)",
    };
  }, [darkMode, sidebarCollapsed]);

  const pct = Math.max(0, Math.min(100, Math.round((volume ?? 0) * 100)));

  const Brand = ({ compact = false }) => (
    <div style={{ display: "flex", alignItems: "center",  minWidth: 0 }}>
     
      {!compact && (
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              color: tokens.text,
              fontWeight: 850,
              letterSpacing: -0.4,
              fontSize: 16,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            Rhymix
          </div>
          <div
            style={{
              color: tokens.subtext,
              fontSize: 12,
              marginTop: 2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            Studio Console
          </div>
        </div>
      )}
    </div>
  );

  const GlassPanel = ({ children, style }) => (
    <div
      style={{
        borderRadius: tokens.radiusLg,
        border: `1px solid ${tokens.hairline}`,
        background: `linear-gradient(180deg, ${tokens.glassA}, ${tokens.glassB})`,
        backdropFilter: "blur(22px) saturate(140%)",
        WebkitBackdropFilter: "blur(22px) saturate(140%)",
        boxShadow: tokens.shadow,
        ...style,
      }}
    >
      {children}
    </div>
  );

  const IconCircleButton = ({ onClick, title, children, disabled, style, ariaLabel }) => (
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel || title}
      title={title}
      onClick={onClick}
      style={{
        appearance: "none",
        border: `1px solid ${tokens.hairline}`,
        background: `linear-gradient(180deg, ${tokens.itemA}, ${tokens.itemB})`,
        color: tokens.text,
        borderRadius: 999,
        padding: 8,
        cursor: disabled ? "not-allowed" : "pointer",
        boxShadow: tokens.shadowSoft,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.55 : 1,
        transition: "transform 120ms ease, background 160ms ease, opacity 160ms ease",
        ...style,
      }}
      onMouseDown={(e) => {
        if (disabled) return;
        e.currentTarget.style.transform = "scale(0.98)";
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = "scale(1)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "scale(1)";
      }}
    >
      {children}
    </button>
  );

  const Hairline = ({ style }) => (
    <div
      style={{
        height: 1,
        background: tokens.hairline,
        opacity: 1,
        ...style,
      }}
    />
  );

  const NavItem = ({ item, mobile }) => {
    const selected = currentView === item.id;

    return (
      <button
        type="button"
        onClick={() => handleNavigation(item.id)}
        title={sidebarCollapsed && !mobile ? item.label : undefined}
        style={{
          width: "100%",
          border: `1px solid ${
            selected ? "rgba(10,132,255,0.35)" : tokens.hairline
          }`,
          borderRadius: tokens.radiusMd,
          background: selected
            ? `linear-gradient(135deg, ${tokens.primaryWash}, ${tokens.primaryWash2})`
            : `linear-gradient(180deg, ${tokens.itemA}, ${tokens.itemB})`,
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          boxShadow: selected ? tokens.shadowSoft : "none",
          color: tokens.text,
          padding: sidebarCollapsed && !mobile ? "12px 10px" : "12px 12px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 12,
          minHeight: mobile ? 64 : 60,
          textAlign: "left",
          transition: "transform 140ms ease, background 160ms ease, box-shadow 160ms ease",
        }}
        onMouseEnter={(e) => {
          if (sidebarCollapsed && !mobile) return;
          if (selected) return;
          e.currentTarget.style.background = `linear-gradient(180deg, ${tokens.hoverA}, ${tokens.hoverB})`;
          e.currentTarget.style.transform = "translateX(3px)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "translateX(0)";
          e.currentTarget.style.background = selected
            ? `linear-gradient(135deg, ${tokens.primaryWash}, ${tokens.primaryWash2})`
            : `linear-gradient(180deg, ${tokens.itemA}, ${tokens.itemB})`;
        }}
      >
        <div
          style={{
            width: 40,
            minWidth: 40,
            height: 40,
            borderRadius: 14,
            border: `1px solid ${tokens.hairline}`,
            background: selected
              ? `linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.05))`
              : `linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03))`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: selected ? tokens.primary : tokens.subtext,
            boxShadow: selected ? tokens.shadowSoft : "none",
          }}
        >
          {/* Keep icons exactly as provided */}
          {item.icon}
        </div>

        {(!sidebarCollapsed || mobile) && (
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontWeight: selected ? 750 : 580,
                fontSize: 14,
                letterSpacing: -0.2,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                color: selected ? tokens.text : tokens.text,
              }}
            >
              {item.label}
            </div>
            <div
              style={{
                fontSize: 12,
                color: tokens.subtext,
                marginTop: 3,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {item.description}
            </div>
          </div>
        )}
      </button>
    );
  };

  const Range = ({ value, onChange }) => (
    <div style={{ width: "100%", display: "flex", alignItems: "center" }}>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: "100%",
          accentColor: tokens.primary,
        }}
      />
    </div>
  );

  // Mobile Drawer Overlay
  const MobileDrawer = () => {
    const onOverlayClick = () => handleDrawerToggle();

    return (
      <>
        {/* overlay */}
        <div
          onClick={onOverlayClick}
          style={{
            position: "fixed",
            inset: 0,
            background: tokens.isDark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.30)",
            backdropFilter: "blur(2px)",
            WebkitBackdropFilter: "blur(2px)",
            zIndex: 1200,
            opacity: drawerOpen ? 1 : 0,
            pointerEvents: drawerOpen ? "auto" : "none",
            transition: "opacity 160ms ease",
          }}
        />
        {/* panel */}
        <div
          style={{
            position: "fixed",
            top: 14,
            bottom: 14,
            left: 14,
            width: 340,
            zIndex: 1250,
            transform: drawerOpen ? "translateX(0)" : "translateX(-110%)",
            transition: "transform 200ms ease",
          }}
        >
          <GlassPanel style={{ height: "100%", padding: 12, position: "relative" }}>
            {/* header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "6px 6px 10px 6px",
              }}
            >
              <Brand />
              <IconCircleButton onClick={handleDrawerToggle} title="Close" ariaLabel="Close menu">
                {/* keep your icon */}
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                  {/* CloseIcon */}
                  {/** you pass MUI icons in your parent already; here we keep your CloseIcon import */}
                  <CloseIcon fontSize="small" />
                </span>
              </IconCircleButton>
            </div>

            <Hairline style={{ margin: "4px 0 12px 0" }} />

            {/* nav list */}
            <div style={{ display: "grid", gap: 10, padding: "0 6px" }}>
              {navigationItems.map((item) => (
                <NavItem key={item.id} item={item} mobile />
              ))}
            </div>

            {/* bottom theme card */}
            <div style={{ position: "absolute", left: 12, right: 12, bottom: 12 }}>
              <div
                style={{
                  borderRadius: tokens.radiusMd,
                  border: `1px solid ${tokens.hairline}`,
                  background: `linear-gradient(180deg, ${tokens.itemA}, ${tokens.itemB})`,
                  padding: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ color: tokens.subtext, fontWeight: 650, fontSize: 12, letterSpacing: 0.4 }}>
                  Appearance
                </div>
                <IconCircleButton
                  onClick={handleThemeToggle}
                  title={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
                  ariaLabel="Toggle theme"
                  style={{ padding: 7 }}
                >
                  {darkMode ? <Brightness7 /> : <Brightness4 />}
                </IconCircleButton>
              </div>
            </div>
          </GlassPanel>
        </div>
      </>
    );
  };

  return (
    <>
      {/* Mobile hamburger button */}
      {isMobile && (
        <div style={{ position: "fixed", top: 16, left: 16, zIndex: 1300 }}>
          <IconCircleButton onClick={handleDrawerToggle} title="Menu" ariaLabel="Open menu">
            <MenuIcon />
          </IconCircleButton>
        </div>
      )}

      {/* Mobile drawer */}
      {isMobile && <MobileDrawer />}

      {/* Desktop sidebar */}
      {!isMobile && (
        <div style={{ width: tokens.sidebarW, flexShrink: 0 }}>
          <div
            style={{
              position: "fixed",
              top: 14,
              left: 14,
              bottom: 14,
              width: tokens.sidebarW,
              transition: "width 220ms ease",
            }}
          >
            <GlassPanel style={{ height: "100%", padding: sidebarCollapsed ? 10 : 12, position: "relative" }}>
              {/* header */}
              <div
                onClick={handleSidebarToggle}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: sidebarCollapsed ? "center" : "space-between",
                  padding: sidebarCollapsed ? "8px 6px" : "8px 10px",
                  cursor: "pointer",
                  userSelect: "none",
                 
                }}
                title="Toggle sidebar"
              >
                <Brand compact={sidebarCollapsed} />
                {!sidebarCollapsed && (
                  <IconCircleButton onClick={undefined} title="" ariaLabel="Toggle">
                    <MenuIcon style={{ fontSize: 20 }} />
                  </IconCircleButton>
                )}
                {sidebarCollapsed && (
                  <IconCircleButton onClick={undefined} title="" ariaLabel="Toggle">
                    <MenuIcon style={{ fontSize: 20 }} />
                  </IconCircleButton>
                )}
              </div>

              <Hairline style={{ margin: "6px 0 12px 0" }} />

              {/* nav */}
              <div style={{ display: "grid", gap: 10, padding: "0 6px" }}>
                {navigationItems.map((item) => (
                  <NavItem key={item.id} item={item} />
                ))}
              </div>

              {/* quick actions */}
              {!sidebarCollapsed && (
                <>
                  <Hairline style={{ margin: "14px 12px" }} />
                  <div style={{ padding: "0 10px 8px 10px" }}>
                    <div style={{ color: tokens.subtext, fontWeight: 750, fontSize: 11, letterSpacing: 0.8 }}>
                      QUICK ACTIONS
                    </div>
                  </div>

                  <div style={{ padding: "0 8px" }}>
                    <button
                      type="button"
                      onClick={() => handleCleanDirectories(true)}
                      disabled={loading}
                      style={{
                        width: "100%",
                        borderRadius: tokens.radiusMd,
                        border: `1px solid ${tokens.hairline}`,
                        background: `linear-gradient(180deg, ${tokens.itemA}, ${tokens.itemB})`,
                        color: tokens.text,
                        padding: "12px 12px",
                        cursor: loading ? "not-allowed" : "pointer",
                        fontWeight: 650,
                        textAlign: "left",
                        boxShadow: tokens.shadowSoft,
                        opacity: loading ? 0.6 : 1,
                      }}
                    >
                      🧹&nbsp;&nbsp;Clean All Data
                    </button>
                  </div>
                </>
              )}

              {sidebarCollapsed && (
                <div style={{ padding: "12px 6px 0 6px" }}>
                  <button
                    type="button"
                    onClick={() => handleCleanDirectories(true)}
                    disabled={loading}
                    title="Clean All Data"
                    style={{
                      width: "100%",
                      borderRadius: tokens.radiusMd,
                      border: `1px solid ${tokens.hairline}`,
                      background: `linear-gradient(180deg, ${tokens.itemA}, ${tokens.itemB})`,
                      color: tokens.text,
                      padding: "12px 0",
                      cursor: loading ? "not-allowed" : "pointer",
                      boxShadow: tokens.shadowSoft,
                      opacity: loading ? 0.6 : 1,
                    }}
                  >
                    🧹
                  </button>
                </div>
              )}

              {/* bottom settings (click-away supported) */}
              <div
                ref={settingsWrapRef}
                style={{
                  position: "absolute",
                  left: 12,
                  right: 12,
                  bottom: 12,
                }}
              >
                <div
                  style={{
                    borderRadius: tokens.radiusLg,
                    border: `1px solid ${tokens.hairline}`,
                    background: `linear-gradient(180deg, ${tokens.itemA}, ${tokens.itemB})`,
                    boxShadow: tokens.shadowSoft,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: sidebarCollapsed ? "center" : "space-between",
                      padding: "10px 10px",
                      gap: 10,
                    }}
                  >
                    {!sidebarCollapsed && (
                      <div style={{ color: tokens.subtext, fontWeight: 750, fontSize: 12, letterSpacing: 0.4 }}>
                        Settings
                      </div>
                    )}

                    <IconCircleButton
                      onClick={() => setOpen((o) => !o)}
                      title={open ? "Close Settings" : "Open Settings"}
                      ariaLabel="Toggle settings"
                      style={{ padding: 7, boxShadow: "none" }}
                    >
                      {open ? <CloseIcon style={{ fontSize: 18 }} /> : <SettingsIcon style={{ fontSize: 18 }} />}
                    </IconCircleButton>
                  </div>

                  <div
                    style={{
                      maxHeight: open ? 220 : 0,
                      opacity: open ? 1 : 0,
                      transform: open ? "translateY(0)" : "translateY(4px)",
                      transition: "max-height 220ms ease, opacity 200ms ease, transform 200ms ease",
                      overflow: "hidden",
                    }}
                  >
                    <Hairline />

                    <div style={{ padding: 12, display: "grid", gap: 10 }}>
                      {/* Theme row */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ color: tokens.subtext, fontWeight: 650, fontSize: 12, letterSpacing: 0.4 }}>
                          Appearance
                        </div>
                        <IconCircleButton
                          onClick={handleThemeToggle}
                          title={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
                          ariaLabel="Toggle theme"
                          style={{ padding: 7, boxShadow: "none" }}
                        >
                          {darkMode ? <Brightness7 style={{ fontSize: 20 }} /> : <Brightness4 style={{ fontSize: 20 }} />}
                        </IconCircleButton>
                      </div>

                      {/* Volume row */}
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <IconCircleButton
                          onClick={() => onVolumeChange(muted ? 0.8 : 0)}
                          title={muted ? "Unmute" : "Mute"}
                          ariaLabel="Toggle mute"
                          style={{ padding: 7, boxShadow: "none" }}
                        >
                          {muted ? <VolumeOff style={{ fontSize: 20 }} /> : <VolumeUp style={{ fontSize: 20 }} />}
                        </IconCircleButton>

                        <div style={{ flex: 1 }}>
                          <Range
                            value={pct}
                            onChange={(v) => onVolumeChange(v / 100)}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </GlassPanel>
          </div>
        </div>
      )}
    </>
  );
}

export default NavigationBar;
