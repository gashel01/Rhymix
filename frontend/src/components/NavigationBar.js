
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

import SettingsIcon from "@mui/icons-material/SettingsOutlined";
import CloseIcon from "@mui/icons-material/CloseOutlined";
import Brightness4 from "@mui/icons-material/Brightness4Outlined";
import Brightness7 from "@mui/icons-material/Brightness7Outlined";
import VolumeUp from "@mui/icons-material/VolumeUpOutlined";
import VolumeOff from "@mui/icons-material/VolumeOffOutlined";
import MenuIcon from "@mui/icons-material/MenuOutlined";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { BrushCleaning } from "lucide-react";
import  Theme  from "./Homeview/Theme.js";
import {
  clearStoredGroqApiKey,
  getStoredGroqApiKey,
  looksLikeGroqApiKey,
  setStoredGroqApiKey,
} from "../utils/groqSettings";

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

  const { t } = Theme({ darkMode });
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

  /* Anything rendered through a portal to <body> — the floating selection bar —
     is positioned against the viewport, not against the content area, so
     centring it puts it half the sidebar's width to the left of everything it
     belongs with. Publish the rail's width so those can centre on the content
     instead. */
  useEffect(() => {
    document.body.style.setProperty("--rhymix-rail-w", `${tokens.sidebarW}px`);
    return () => document.body.style.removeProperty("--rhymix-rail-w");
  }, [tokens.sidebarW]);


  const pct = Math.max(0, Math.min(100, Math.round((volume ?? 0) * 100)));
  const [groqApiKey, setGroqApiKey] = useState("");
  const [groqSettingsError, setGroqSettingsError] = useState("");
  const [groqSettingsMessage, setGroqSettingsMessage] = useState("");

  useEffect(() => {
    setGroqApiKey(getStoredGroqApiKey());
  }, []);

  const handleSaveGroqKey = () => {
    const nextValue = String(groqApiKey || "").trim();
    setGroqSettingsError("");
    setGroqSettingsMessage("");
    if (!nextValue) {
      setGroqSettingsError("Enter a Groq API key.");
      return;
    }
    if (!looksLikeGroqApiKey(nextValue)) {
      setGroqSettingsError("That Groq API key does not look valid.");
      return;
    }
    setStoredGroqApiKey(nextValue);
    setGroqApiKey(nextValue);
    setGroqSettingsMessage("Groq API key saved.");
  };

  const handleClearGroqKey = () => {
    clearStoredGroqApiKey();
    setGroqApiKey("");
    setGroqSettingsError("");
    setGroqSettingsMessage("Groq API key cleared.");
  };

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

  const NavItem = ({ item, mobile, style }) => {
    const selected = currentView === item.id;

    return (
      <button
        type="button"
        onClick={() => handleNavigation(item.id)}
        title={sidebarCollapsed && !mobile ? item.label : undefined}
        style={{
          width: "100%",
          border: !selected ? "none" : `1px solid ${
            selected ? "rgba(10,132,255,0.35)" : tokens.hairline
          }`,
          borderRadius: tokens.radiusMd,
          background: selected
            ? `linear-gradient(135deg, ${tokens.primaryWash}, ${tokens.primaryWash2})`
            : "none",
          // backdropFilter: "blur(16px)",
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
          ...style,
        }}
        onMouseEnter={(e) => {
          if (sidebarCollapsed && !mobile) return;
          if (selected) return;
          // e.currentTarget.style.background = `linear-gradient(180deg, ${tokens.hoverA}, ${tokens.hoverB})`;
          e.currentTarget.style.transform = "translateX(3px)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "translateX(0)";
          e.currentTarget.style.background = selected
            ? `linear-gradient(135deg, ${tokens.primaryWash}, ${tokens.primaryWash2})`
            : 'none';
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

 
  return (
    <>
      {/* Mobile hamburger button */}
      

     
      {/* Desktop sidebar */}
      
        <div style={{ width: tokens.sidebarW, flexShrink: 0 }}>
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              bottom: 0,
              width: tokens.sidebarW,
              transition: "width 120ms ease",
            }}
          >
            <GlassPanel style={{ height: "100%", padding:  "12px 0px", position: "relative" }}>
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

              {/* <Hairline style={{ margin: "6px 0 12px 0" }} /> */}

              {/* nav */}
              <div style={{ display: "grid", gap: 10, padding: "12px 16px" }}>
                {navigationItems.map((item) => (
                  <NavItem key={item.id} item={item} />
                ))}
              </div>

              {/* quick actions */}
              {!sidebarCollapsed && (
                <>
                  <Hairline style={{ margin: "12px 16px" }} />
                  <div style={{ padding: "12px 16px" }}>
                    <div style={{ color: tokens.subtext, fontWeight: 750, fontSize: 11, letterSpacing: 0.8 }}>
                      QUICK ACTIONS
                    </div>
                  </div>

                  <div style={{ padding: "12px 16px" }}>
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
                        textAlign: "center",
                        opacity: loading ? 0.6 : 1,
                      }}
                    >
                      Clean All Data
                    </button>
                  </div>
                </>
              )}

              {sidebarCollapsed && (
                <>
                   <Hairline style={{ margin: "12px 16px" }} />
                <div style={{ display:"flex",  justifyContent:"center", alignItems:"center"}}>
                  
               
                  <NavItem style={{ justifyContent:"center", display:"flex",  height: 40 , alignSelf:"center", JustifySelf:"center"}} onClick={() => handleCleanDirectories(true)} item={{ id: "clean-all-data", label: "Clean All Data", icon: <BrushCleaning size={16}  fill={t.flatIconActive}/> }} />

                </div>

                </>
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

                  {/* Clipped to zero height, but max-height and opacity alone
                      leave the API key field and its buttons in the tab order:
                      you would tab from the sidebar into controls you cannot
                      see. `inert` takes the whole subtree out of focus and of
                      the accessibility tree while it is closed. */}
                  <div
                      inert={open ? undefined : ""}
                      aria-hidden={open ? undefined : "true"}
                      style={{
                        maxHeight: open ? 360 : 0,
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

                        <Hairline />

                        <div style={{ display: "grid", gap: 8 }}>
                          <div style={{ color: tokens.subtext, fontWeight: 650, fontSize: 12, letterSpacing: 0.4 }}>
                            Groq API Key
                          </div>
                          <input
                            type="password"
                            value={groqApiKey}
                            onChange={(e) => {
                              setGroqApiKey(e.target.value);
                              if (groqSettingsError) setGroqSettingsError("");
                              if (groqSettingsMessage) setGroqSettingsMessage("");
                            }}
                            placeholder="gsk_..."
                            style={{
                              width: "100%",
                              borderRadius: 12,
                              border: `1px solid ${tokens.hairline}`,
                              background: "transparent",
                              color: tokens.text,
                              padding: "10px 12px",
                              outline: "none",
                              fontSize: 13,
                              fontWeight: 650,
                              boxSizing: "border-box",
                            }}
                          />
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              type="button"
                              onClick={handleSaveGroqKey}
                              style={{
                                flex: 1,
                                borderRadius: 12,
                                border: `1px solid ${tokens.hairline}`,
                                background: tokens.primaryWash,
                                color: tokens.text,
                                padding: "10px 12px",
                                fontWeight: 750,
                                cursor: "pointer",
                              }}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={handleClearGroqKey}
                              style={{
                                flex: 1,
                                borderRadius: 12,
                                border: `1px solid ${tokens.hairline}`,
                                background: "transparent",
                                color: tokens.subtext,
                                padding: "10px 12px",
                                fontWeight: 750,
                                cursor: "pointer",
                              }}
                            >
                              Clear
                            </button>
                          </div>
                          {groqSettingsError ? (
                            <div style={{ color: "rgba(255,107,107,0.95)", fontSize: 12, fontWeight: 650 }}>
                              {groqSettingsError}
                            </div>
                          ) : null}
                          {groqSettingsMessage ? (
                            <div style={{ color: tokens.subtext, fontSize: 12, fontWeight: 650 }}>
                              {groqSettingsMessage}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
              </div>
            </GlassPanel>
          </div>
        </div>
      
    </>
  );
}

export default NavigationBar;
